import TelegramBot from 'node-telegram-bot-api';
import { createWASession, unlinkWASession } from './whatsapp_bot.js';
import { generatePasskey } from './utils.js';
import config from './config.json' assert { type: "json" };

const botToken = config.botToken || process.env.BOT_TOKEN;
if (!botToken) process.exit(1);

const bot = new TelegramBot(botToken, { polling: true });

const authorizedUsers = {};
const pendingUsers = {};
const activeChats = {};

function isAdmin(userId) {
    return userId === config.adminId;
}

function sendUnauthorized(userId) {
    bot.sendMessage(userId, "You are not authorized to use this bot.");
}

bot.onText(/\/start/, (msg) => {
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;

    if (isAdmin(userId) || authorizedUsers[userId]?.verified) {
        bot.sendMessage(userId, `Welcome back, ${username}!`);
        return;
    }

    if (pendingUsers[userId]) return;

    pendingUsers[userId] = { username };
    bot.sendMessage(config.adminId, `New user @${username} (${userId}) wants access.`, {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Grant', callback_data: `grant_${userId}` },
                 { text: 'Ignore', callback_data: `ignore_${userId}` }]
            ]
        }
    });
    bot.sendMessage(userId, "Please wait for admin approval.");
});

bot.on('callback_query', async (query) => {
    const data = query.data;
    const fromId = query.from.id;

    if (data.startsWith('grant_') || data.startsWith('ignore_')) {
        if (!isAdmin(fromId)) return sendUnauthorized(fromId);
        const targetUserId = data.split('_')[1];

        if (data.startsWith('ignore_')) {
            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: fromId, message_id: query.message.message_id });
            bot.sendMessage(targetUserId, "Your request was ignored by admin.");
            delete pendingUsers[targetUserId];
        } else {
            const passkey = generatePasskey();
            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: fromId, message_id: query.message.message_id });
            bot.sendMessage(fromId, `Passkey generated for user ${targetUserId}: ${passkey}`, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Send', callback_data: `sendpass_${targetUserId}_${passkey}` },
                         { text: 'Erase', callback_data: `erasepass_${targetUserId}` }]
                    ]
                }
            });
        }
        return;
    }

    if (data.startsWith('sendpass_') || data.startsWith('erasepass_')) {
        if (!isAdmin(fromId)) return sendUnauthorized(fromId);
        const [ , targetUserId, passkey] = data.split('_');

        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: fromId, message_id: query.message.message_id });

        if (data.startsWith('erasepass_')) {
            bot.sendMessage(fromId, `Passkey erased for user ${targetUserId}.`);
            bot.sendMessage(targetUserId, `Admin erased your access request.`);
        } else {
            authorizedUsers[targetUserId] = { passkey, numbers: [], verified: false, messages: {} };
            delete pendingUsers[targetUserId];
            bot.sendMessage(targetUserId, `Your passkey is: ${passkey}\nSend /verify <passkey> to unlock access.`);
        }
        return;
    }

    if (data.startsWith('unlinkconfirm_') || data.startsWith('unlinkcancel_')) {
        const [ , uid, number] = data.split('_');
        const userId = parseInt(uid);

        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: fromId, message_id: query.message.message_id });

        if (data.startsWith('unlinkcancel_')) return bot.sendMessage(userId, `Unlink cancelled for ${number}.`);
        await unlinkWASession(number);
        const idx = authorizedUsers[userId].numbers.indexOf(number);
        if (idx > -1) authorizedUsers[userId].numbers.splice(idx, 1);
        bot.sendMessage(userId, `Number ${number} successfully unlinked.`);
    }

    if (data.startsWith('linkqr_') || data.startsWith('linkphone_')) {
        const [methodKey, number] = data.split('_');
        const method = methodKey === 'linkqr' ? 'qr' : 'phone';
        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: fromId, message_id: query.message.message_id });
        try { await createWASession(number, method, fromId, bot); } 
        catch { bot.sendMessage(fromId, `Failed to link ${number}. Try again.`); }
    }
});

bot.onText(/\/verify (.+)/, (msg, match) => {
    const userId = msg.from.id;
    const inputKey = match[1];

    if (!authorizedUsers[userId] || authorizedUsers[userId].passkey !== inputKey) {
        return bot.sendMessage(userId, "Invalid passkey.");
    }

    authorizedUsers[userId].verified = true;
    bot.sendMessage(userId, "Access granted! You can now use the bot.");
});

bot.onText(/\/link/, (msg) => {
    const userId = msg.from.id;
    if (!authorizedUsers[userId]?.verified) return sendUnauthorized(userId);

    bot.sendMessage(userId, "Send the WhatsApp number you want to link (with country code):");

    const listener = (reply) => {
        if (reply.from.id !== userId) return;
        const number = reply.text.trim();
        bot.removeListener('message', listener);
        bot.sendMessage(userId, `Choose linking method for ${number}:`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'QR Code', callback_data: `linkqr_${number}` },
                     { text: 'Phone Pairing', callback_data: `linkphone_${number}` }]
                ]
            }
        });
    };
    bot.on('message', listener);
});

bot.onText(/\/unlink/, (msg) => {
    const userId = msg.from.id;
    if (!authorizedUsers[userId]?.verified) return sendUnauthorized(userId);

    const numbers = authorizedUsers[userId].numbers || [];
    if (numbers.length === 0) return bot.sendMessage(userId, "No linked numbers found.");

    const buttons = numbers.map(n => [{ text: n, callback_data: `unlinkconfirm_${userId}_${n}` }]);
    bot.sendMessage(userId, "Select a number to unlink:", { reply_markup: { inline_keyboard: buttons } });
});

bot.onText(/\/view/, (msg) => {
    const userId = msg.from.id;
    if (!authorizedUsers[userId]?.verified) return sendUnauthorized(userId);

    const numbers = Object.keys(authorizedUsers[userId].messages || {});
    if (numbers.length === 0) return bot.sendMessage(userId, "No messages found.");

    const buttons = numbers.map(n => [{ text: n, callback_data: `viewmsgs_${n}` }]);
    bot.sendMessage(userId, "Select a number to view deleted messages:", { reply_markup: { inline_keyboard: buttons } });
});

function handleAdminCommunication(data, botInstance) {
    if (data.startsWith('disconnect')) {
        Object.keys(activeChats).forEach(chatId => delete activeChats[chatId]);
        botInstance.sendMessage(config.adminId, "All active chats disconnected.");
        return;
    }

    if (data.startsWith('broadcast_')) {
        Object.keys(authorizedUsers).forEach(uid => {
            botInstance.sendMessage(uid, "Admin started a broadcast. You can now send messages.");
            activeChats[uid] = { type: 'broadcast' };
        });
        return;
    }

    if (data.startsWith('adminchat_')) {
        const targetId = parseInt(data.split('_')[1]);
        botInstance.sendMessage(targetId, "Admin wants to chat with you.");
        activeChats[targetId] = { type: 'direct' };
    }
}

bot.on('message', (msg) => {
    const userId = msg.from.id;
    if (activeChats[userId]) {
        const chatType = activeChats[userId].type;
        bot.sendMessage(config.adminId, `From ${userId} (${msg.from.username || msg.from.first_name}): ${msg.text || '[media]'}`);
    }
});

export default bot;
