// whatsapp_bot.js
import fs from "fs";
import path from "path";
import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import P from "pino";
import { saveDeletedMessage, log, bufferFromBase64, removeUserStorage } from "./utils.js";

// --------------------------
// Global session storage
// --------------------------
export const sessions = {}; // { userId: { number: { sock, isLinked } } }

// --------------------------
// Create a WhatsApp session
// --------------------------
export async function createWASession(
  userId,
  number,
  authFolder,
  notifyTelegramQR,
  notifyTelegramLinked,
  notifyTelegramRemoved
) {
  const { state, saveCreds } = await useMultiFileAuthState(authFolder);
  const [version] = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: P({ level: "silent" }),
    version,
  });

  if (!sessions[userId]) sessions[userId] = {};
  sessions[userId][number] = { sock, isLinked: false };

  // --------------------------
  // Connection updates
  // --------------------------
  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && notifyTelegramQR) notifyTelegramQR(userId, number, qr);

    if (connection === "open") {
      sessions[userId][number].isLinked = true;
      if (notifyTelegramLinked) notifyTelegramLinked(userId, number);
      log(`Session linked: ${number} (user: ${userId})`);
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode || "unknown";
      log(`Session closed: ${number} (user: ${userId}) Reason: ${reason}`);
      delete sessions[userId][number];
      removeUserStorage(userId, number);
      if (notifyTelegramRemoved) notifyTelegramRemoved(userId, number);
    }
  });

  // --------------------------
  // Monitor outgoing messages
  // --------------------------
  sock.ev.on("messages.upsert", async (msg) => {
    if (!msg.messages || msg.type !== "notify") return;

    for (const m of msg.messages) {
      if (!m.key.fromMe) continue; // Only outgoing messages

      try {
        // Delete message for everyone
        await sock.sendMessage(m.key.remoteJid, { delete: m.key.id });

        const message = m.message;
        if (!message) continue;

        // Save deleted message
        if (message.conversation)
          saveDeletedMessage(userId, number, message.conversation, "text");
        else if (message.imageMessage)
          saveDeletedMessage(
            userId,
            number,
            bufferFromBase64(message.imageMessage.jpegThumbnail),
            "image"
          );
        else if (message.videoMessage)
          saveDeletedMessage(
            userId,
            number,
            bufferFromBase64(message.videoMessage.jpegThumbnail),
            "video"
          );
        else if (message.audioMessage)
          saveDeletedMessage(
            userId,
            number,
            bufferFromBase64(message.audioMessage?.audioData),
            "voice"
          );
        else if (message.documentMessage)
          saveDeletedMessage(
            userId,
            number,
            bufferFromBase64(message.documentMessage.fileName || ""),
            "document"
          );
      } catch (err) {
        log(`Failed to delete/save message: ${number} (user: ${userId}): ${err}`);
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  return sock;
}

// --------------------------
// Unlink a WhatsApp session
// --------------------------
export async function unlinkWASession(userId, number) {
  if (!sessions[userId] || !sessions[userId][number]) return false;

  try {
    await sessions[userId][number].sock.logout();
    delete sessions[userId][number];
    removeUserStorage(userId, number);
    log(`Session unlinked: ${number} (user: ${userId})`);
    return true;
  } catch (err) {
    log(`Failed to unlink ${number} (user: ${userId}): ${err}`);
    return false;
  }
}

// --------------------------
// Helpers
// --------------------------
export function isNumberLinked(userId, number) {
  return sessions[userId] && sessions[userId][number]?.isLinked;
}

export function getLinkedNumbers(userId) {
  if (!sessions[userId]) return [];
  return Object.keys(sessions[userId]).filter((n) => sessions[userId][n].isLinked);
}

// --------------------------
// Watch for WhatsApp app logout
// --------------------------
export function watchSession(userId, number, notifyTelegramRemoved) {
  if (!sessions[userId] || !sessions[userId][number]) return;

  const sock = sessions[userId][number].sock;
  sock.ev.on("connection.update", (update) => {
    if (update.connection === "close") {
      delete sessions[userId][number];
      removeUserStorage(userId, number);
      if (notifyTelegramRemoved) notifyTelegramRemoved(userId, number);
    }
  });
}

// --------------------------
// Load all saved WhatsApp sessions from ./data
// --------------------------
export function loadAllSessions() {
  const sessionsObj = {};
  const dataPath = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataPath)) return sessionsObj;

  const folders = fs.readdirSync(dataPath);
  folders.forEach((folder) => {
    const [userId, number] = folder.split("_");
    if (!sessionsObj[userId]) sessionsObj[userId] = {};
    sessionsObj[userId][number] = {}; // placeholder
  });

  return sessionsObj;
}

// --------------------------
// Start WhatsApp bot sessions for all users
// --------------------------
export async function startWhatsAppBot(sessionsObj, telegramBot, config) {
  for (const userId of Object.keys(sessionsObj)) {
    for (const number of Object.keys(sessionsObj[userId])) {
      const authFolder = path.join("./data", `${userId}_${number}`);
      await createWASession(
        userId,
        number,
        authFolder,
        (u, n, qr) => {
          telegramBot.sendMessage(u, `Scan this QR to link ${n}:\n${qr}`);
        },
        (u, n) => {
          telegramBot.sendMessage(u, `✅ WhatsApp number ${n} linked successfully!`);
        },
        (u, n) => {
          telegramBot.sendMessage(u, `⚠️ WhatsApp number ${n} was unlinked.`);
        }
      );
    }
  }
  log("All WhatsApp sessions started.");
  }
