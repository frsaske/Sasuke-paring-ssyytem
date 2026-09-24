import express from "express";
import fs from "fs";
import pino from "pino";
import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { dispatchSasukeSession } from "./session-sender.js";

const router = express.Router();

function removeFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) return false;
        fs.rmSync(filePath, { recursive: true, force: true });
    } catch (e) {
        console.error("Error removing file:", e);
    }
}

router.get("/", async (req, res) => {
    const sessionId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
    const dirs = `./qr_sessions/session_${sessionId}`;

    if (!fs.existsSync("./qr_sessions")) {
        fs.mkdirSync("./qr_sessions", { recursive: true });
    }

    removeFile(dirs);

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();
            let responseSent = false;

            const KnightBot = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(
                        state.keys,
                        pino({ level: "fatal" })
                    ),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }),
                browser: Browsers.windows("Chrome"),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            });

            KnightBot.ev.on("creds.update", saveCreds);

            KnightBot.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr && !responseSent) {
                    console.log("⚡ [SASUKE-X] QR Code generated successfully");

                    try {
                        const qrDataURL = await QRCode.toDataURL(qr, {
                            errorCorrectionLevel: "M",
                            type: "image/png",
                            quality: 0.95,
                            margin: 1,
                            color: {
                                dark: "#0f0c20",
                                light: "#ffffff",
                            },
                        });

                        if (!responseSent) {
                            responseSent = true;
                            res.send({
                                success: true,
                                qr: qrDataURL,
                                message: "Scan this QR code with WhatsApp to pair",
                                instructions: [
                                    "Open WhatsApp on your phone",
                                    "Tap Menu (⋮) or Settings > Linked Devices",
                                    "Tap 'Link a Device'",
                                    "Point your camera at this QR code to scan"
                                ],
                            });
                        }
                    } catch (qrError) {
                        console.error("QR Code rendering error:", qrError);
                        if (!responseSent) {
                            responseSent = true;
                            res.status(500).send({
                                success: false,
                                code: "Failed to generate QR code",
                            });
                        }
                    }
                }

                if (connection === "open") {
                    console.log("⚡ [SASUKE-X] Connected via QR code! Sending session credentials...");

                    try {
                        const rawId = KnightBot.authState.creds.me?.id || "";
                        const phoneNumber = rawId.split(":")[0] || rawId.split("@")[0] || "";
                        const userDisplayName = KnightBot.authState.creds.me?.name || `+${phoneNumber}`;

                        await dispatchSasukeSession({
                            sock: KnightBot,
                            dir: dirs,
                            phoneNumber,
                            userDisplayName,
                        });

                        console.log(`✅ [SASUKE-X] QR Session sent to +${phoneNumber}`);
                        await delay(2000);
                        removeFile(dirs);
                        try { KnightBot.end(undefined); } catch (e) {}
                    } catch (error) {
                        console.error("❌ [SASUKE-X] Error dispatching QR session:", error);
                        removeFile(dirs);
                        try { KnightBot.end(undefined); } catch (e) {}
                    }
                }

                if (connection === "close") {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode === 401) {
                        console.log("❌ Logged out or QR expired");
                    } else {
                        setTimeout(() => initiateSession(), 2000);
                    }
                }
            });

            setTimeout(() => {
                if (!responseSent) {
                    responseSent = true;
                    res.status(408).send({ success: false, code: "QR generation timeout" });
                    removeFile(dirs);
                    try { KnightBot.end(undefined); } catch (e) {}
                }
            }, 35000);
        } catch (err) {
            console.error("Error initializing QR session:", err);
            if (!res.headersSent) {
                res.status(503).send({ success: false, code: "Service Unavailable" });
            }
            removeFile(dirs);
        }
    }

    await initiateSession();
});

export default router;
