import fs from "fs";
import path from "path";
import TelegramBot from "node-telegram-bot-api";
import { startWhatsAppBot, loadAllSessions } from "./whatsapp_bot.js";
import { ensureDataFolder } from "./utils.js";

// --------------------
// Load config.json safely
// --------------------
const configPath = path.join(process.cwd(), "config.json");
let config = {};
if (fs.existsSync(configPath)) {
  const raw = fs.readFileSync(configPath, "utf-8");
  config = JSON.parse(raw);
}

// Ensure data folder exists
ensureDataFolder();

// Prompt for bot token if missing
async function getBotToken() {
  if (config.botToken && config.botToken.trim() !== "") return config.botToken;

  process.stdout.write("Enter your Telegram Bot Token: ");
  return new Promise((resolve) => {
    process.stdin.once("data", (data) => {
      const token = data.toString().trim();
      resolve(token);
    });
  });
}

async function main() {
  try {
    const token = await getBotToken();
    config.botToken = token;

    // Start Telegram bot
    const telegramBot = new TelegramBot(token, { polling: true });
    // Import telegram_bot.js to start listeners automatically
    await import("./telegram_bot.js");

    // Load existing WhatsApp sessions (if any)
    const sessions = loadAllSessions();

    // Start WhatsApp bot sessions
    startWhatsAppBot(sessions, telegramBot, config);

    console.log("Double Mighty Bot is running...");
  } catch (error) {
    console.error("Error starting the bot:", error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down Double Mighty Bot...");
  process.exit(0);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

main();
