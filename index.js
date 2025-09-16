import fs from "fs";
import path from "path";
import TelegramBot from "node-telegram-bot-api";
import { startWhatsAppBot, loadAllSessions } from "./whatsapp_bot.js";
import { ensureDataFolder } from "./utils.js";

// --------------------
// Config paths
// --------------------
const configPath = path.join(process.cwd(), "config.json");
let config = {};

// Load config.json if exists
if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

// Ensure data folder exists
ensureDataFolder();

// --------------------
// Get Telegram Bot Token
// --------------------
async function getBotToken() {
  if (config.botToken && config.botToken.trim() !== "") return config.botToken;

  return new Promise((resolve) => {
    process.stdout.write("Enter your Telegram Bot Token: ");
    process.stdin.resume();
    process.stdin.once("data", (data) => {
      const token = data.toString().trim();

      if (!token) {
        console.error("\nTelegram Bot Token not set! Exiting...");
        process.exit(1);
      }

      // Save token to config.json for future runs
      config.botToken = token;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      process.stdin.pause();
      resolve(token);
    });
  });
}

// --------------------
// Main function
// --------------------
async function main() {
  try {
    const token = await getBotToken();

    // Start Telegram bot
    const telegramBot = new TelegramBot(token, { polling: true });

    // Start Telegram listeners
    await import("./telegram_bot.js");

    // Load existing WhatsApp sessions
    const sessions = loadAllSessions();

    // Start WhatsApp bot sessions
    startWhatsAppBot(sessions, telegramBot, config);

    console.log("Double Mighty Bot is running...");
  } catch (error) {
    console.error("Error starting the bot:", error);
    process.exit(1);
  }
}

// --------------------
// Graceful shutdown
// --------------------
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
