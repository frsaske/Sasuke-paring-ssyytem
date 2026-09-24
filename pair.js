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
import pn from "awesome-phonenumber";
import { dispatchSasukeSession } from "./session-sender.js";

const router = express.Router();

function rm(p) {
    try { 
        if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); 
    } catch(e) {
        console.error("Cleanup error:", e);
    }
}

router.get("/", async (req, res) => {
    let rawNum = req.query.number || "";
    let num = String(rawNum).replace(/[^0-9]/g, "");
    if (!num) {
        return res.status(400).send({ 
            success: false,
            code: "Number required", 
            error: "Please enter your WhatsApp number with country code" 
        });
    }

    const phone = pn("+" + num);
    if (!phone.isValid()) {
        return res.status(400).send({ 
            success: false,
            code: "Invalid number", 
            error: "The provided number format is invalid" 
        });
    }
    num = phone.getNumber("e164").replace("+", "");

    const dir = "./session_" + num;
    rm(dir);

    async function start() {
        const { state, saveCreds } = await useMultiFileAuthState(dir);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
            },
            logger: pino({ level: "fatal" }),
            browser: Browsers.windows("Chrome"),
            printQRInTerminal: false,
            markOnlineOnConnect: false,
        });

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
            if (connection === "open") {
                try {
                    console.log(`⚡ [SASUKE-X] Successfully authenticated for +${num}! Dispatching session...`);
                    const userDisplayName = sock.authState.creds.me?.name || `+${num}`;
                    
                    await dispatchSasukeSession({
                        sock,
                        dir,
                        phoneNumber: num,
                        userDisplayName,
                    });

                    console.log(`✅ [SASUKE-X] Session successfully sent to +${num}`);

                    await delay(2000);
                    rm(dir);
                    try { sock.end(undefined); } catch (e) {}
                } catch (err) {
                    console.error("❌ [SASUKE-X] Error in session dispatch:", err);
                    rm(dir);
                    try { sock.end(undefined); } catch (e) {}
                }
            }

            if (connection === "close") {
                const c = lastDisconnect?.error?.output?.statusCode;
                if (c !== 401) {
                    setTimeout(() => start(), 2000);
                }
            }
        });

        if (!sock.authState.creds.registered) {
            await delay(2500);
            try {
                let code = await sock.requestPairingCode(num);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                if (!res.headersSent) {
                    res.send({ 
                        success: true, 
                        code: code,
                        message: "Pairing code generated successfully. Link device in WhatsApp." 
                    });
                }
            } catch(err) {
                console.error("❌ [SASUKE-X] Pairing error:", err);
                if (!res.headersSent) {
                    res.status(503).send({ 
                        success: false,
                        code: "PAIR_FAIL", 
                        error: err.message || "Failed to generate pairing code"
                    });
                }
                rm(dir);
                try { sock.end(undefined); } catch (e) {}
            }
        }
    }

    start();
});

export default router;
