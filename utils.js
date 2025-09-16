import fs from "fs";
import path from "path";
import crypto from "crypto";

// --------------------------
// Paths
// --------------------------
const superHousePath = "./superHouse";
const passkeysPath = "./data/activePasskeys.json";
const logsPath = "./logs";

// Ensure folders exist
[superHousePath, path.dirname(passkeysPath), logsPath].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// --------------------------
// Logging
// --------------------------
export function log(message) {
  if (!fs.existsSync(logsPath)) fs.mkdirSync(logsPath, { recursive: true });
  const timestamp = new Date().toISOString();
  fs.appendFileSync(path.join(logsPath, "bot.log"), `[${timestamp}] ${message}\n`);
}

// --------------------------
// Passkey Management
// --------------------------
export function generatePasskey(length = 8) {
  return crypto.randomBytes(length).toString("hex").slice(0, length).toUpperCase();
}

export function savePasskey(userId, passkey) {
  const data = loadPasskeys();
  data[userId] = { passkey, createdAt: Date.now() };
  fs.writeFileSync(passkeysPath, JSON.stringify(data, null, 2));
}

export function validatePasskey(userId, inputKey) {
  const data = loadPasskeys();
  if (!data[userId]) return false;
  if (data[userId].passkey === inputKey) {
    removePasskey(userId);
    return true;
  }
  return false;
}

export function removePasskey(userId) {
  const data = loadPasskeys();
  if (data[userId]) {
    delete data[userId];
    fs.writeFileSync(passkeysPath, JSON.stringify(data, null, 2));
  }
}

export function loadPasskeys() {
  if (!fs.existsSync(passkeysPath)) return {};
  return JSON.parse(fs.readFileSync(passkeysPath, "utf8"));
}

// --------------------------
// Deleted Message Storage
// --------------------------
export function saveDeletedMessage(userId, number, message, type = "text") {
  const userPath = path.join(superHousePath, `${userId}`);
  const numberPath = path.join(userPath, `${number}`);
  if (!fs.existsSync(numberPath)) fs.mkdirSync(numberPath, { recursive: true });

  const timestamp = Date.now();
  let filename;
  switch (type) {
    case "text":
      filename = path.join(numberPath, `${timestamp}.txt`);
      fs.writeFileSync(filename, message);
      break;
    case "image":
    case "video":
    case "voice":
    case "document":
      filename = path.join(numberPath, `${timestamp}-${type}`);
      fs.writeFileSync(filename, message); // Buffer expected
      break;
    default:
      filename = path.join(numberPath, `${timestamp}.dat`);
      fs.writeFileSync(filename, message);
      break;
  }
}

// Retrieve messages for a user-number
export function getDeletedMessages(userId, number) {
  const numberPath = path.join(superHousePath, `${userId}`, `${number}`);
  if (!fs.existsSync(numberPath)) return [];
  const files = fs.readdirSync(numberPath);
  return files.map(f => ({
    file: path.join(numberPath, f),
    name: f
  }));
}

// Delete all messages for a number
export function clearDeletedMessages(userId, number) {
  const numberPath = path.join(superHousePath, `${userId}`, `${number}`);
  if (!fs.existsSync(numberPath)) return;
  fs.rmSync(numberPath, { recursive: true, force: true });
}

// --------------------------
// Remove user storage (used for unlinking WA session)
// --------------------------
export function removeUserStorage(userId, number) {
  clearDeletedMessages(userId, number);
}

// --------------------------
// Pagination Helper
// --------------------------
export function paginate(array, pageSize = 10) {
  const pages = [];
  for (let i = 0; i < array.length; i += pageSize) {
    pages.push(array.slice(i, i + pageSize));
  }
  return pages;
}

// --------------------------
// Utility Functions
// --------------------------
export function safeNumber(number) {
  return number.replace(/\D/g, "");
}

export function formatDate(ts) {
  return new Date(ts).toLocaleString();
}

export function bufferFromBase64(base64String) {
  return Buffer.from(base64String, "base64");
}
