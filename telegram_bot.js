import TelegramBot from 'node-telegram-bot-api';
import { createWASession, unlinkWASession } from './whatsappBot.js';
import { generatePasskey } from './utils.js';
import config from './config.json';

const botToken = config.token || process.env.BOT_TOKEN;
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
    const opts = {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Grant', callback_data: `grant_${userId}` },
                 { text: 'Ignore', callback_data: `ignore_${userId}` }]
            ]
        }
    };
    bot.sendMessage(config.adminId, `New user @${username} (${userId}) wants access.`, opts);
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

            const opts = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Send', callback_data: `sendpass_${targetUserId}_${passkey}` },
                         { text: 'Erase', callback_data: `erasepass_${targetUserId}` }]
                    ]
                }
            };
            bot.sendMessage(fromId, `Passkey generated for user ${targetUserId}: ${passkey}`, opts);
        }
        return;
    }

    if (data.startsWith('sendpass_') || data.startsWith('erasepass_')) {
        if (!isAdmin(fromId)) return sendUnauthorized(fromId);
        const parts = data.split('_');
        const targetUserId = parts[1];
        const passkey = parts[2];

        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: fromId, message_id: query.message.message_id });

        if (data.startsWith('erasepass_')) {
            bot.sendMessage(fromId, `Passkey erased for user ${targetUserId}.`);
            bot.sendMessage(targetUserId, `Admin erased your access request.`);
        } else {
            authorizedUsers[targetUserId] = { passkey, numbers: [], verified: false };
            delete pendingUsers[targetUserId];
            bot.sendMessage(targetUserId, `Your passkey is: ${passkey}\nSend /verify <passkey> to unlock access.`);
        }
        return;
    }

    if (data.startsWith('unlinkconfirm_') || data.startsWith('unlinkcancel_')) {
        const parts = data.split('_');
        const userId = parseInt(parts[1]);
        const number = parts[2];

        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: fromId, message_id: query.message.message_id });

        if (data.startsWith('unlinkcancel_')) return bot.sendMessage(userId, `Unlink cancelled for ${number}.`);
        await unlinkWASession(number);
        const idx = authorizedUsers[userId].numbers.indexOf(number);
        if (idx > -1) authorizedUsers[userId].numbers.splice(idx, 1);
        bot.sendMessage(userId, `Number ${number} successfully unlinked.`);
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

bot.onText(/\/link/, async (msg) => {
    const userId = msg.from.id;
    if (!authorizedUsers[userId]?.verified) return sendUnauthorized(userId);

    bot.sendMessage(userId, "Send the WhatsApp number you want to link (with country code):");

    const listener = (reply) => {
        if (reply.from.id !== userId) return;
        const number = reply.text.trim();
        bot.removeListener('message', listener);

        const opts = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'QR Code', callback_data: `linkqr_${number}` },
                     { text: 'Phone Pairing', callback_data: `linkphone_${number}` }]
                ]
            }
        };
        bot.sendMessage(userId, `Choose linking method for ${number}:`, opts);
    };
    bot.on('message', listener);
});
bot.on('callback_query', async (query) => {
    const data = query.data;
    const userId = query.from.id;

    if (data.startsWith('linkqr_') || data.startsWith('linkphone_')) {
        const parts = data.split('_');
        const method = parts[0] === 'linkqr' ? 'qr' : 'phone';
        const number = parts[1];

        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: userId, message_id: query.message.message_id });
        try {
            await createWASession(number, method, userId, bot);
        } catch (err) {
            bot.sendMessage(userId, `Failed to link ${number}. Try again.`);
        }
    }

    if (data.startsWith('viewmsgs_')) {
        const number = data.split('_')[1];
        const msgs = authorizedUsers[userId].messages?.[number] || [];
        if (msgs.length === 0) return bot.sendMessage(userId, `No deleted messages for ${number}.`);

        const pageSize = 10;
        let page = 0;

        function sendPage() {
            const start = page * pageSize;
            const end = start + pageSize;
            const pageMsgs = msgs.slice(start, end).join('\n');
            const buttons = [];
            if (end < msgs.length) buttons.push([{ text: 'Next', callback_data: `next_${number}_${page + 1}` }]);
            if (start > 0) buttons.push([{ text: 'Prev', callback_data: `prev_${number}_${page - 1}` }]);
            if (end >= msgs.length) buttons.push([{ text: 'Delete All', callback_data: `deletemsgs_${number}` }]);

            bot.sendMessage(userId, pageMsgs, { reply_markup: { inline_keyboard: buttons } });
        }
        sendPage();
    }

    if (data.startsWith('next_') || data.startsWith('prev_')) {
        const parts = data.split('_');
        const number = parts[1];
        const newPage = parseInt(parts[2]);
        page = newPage;
        bot.deleteMessage(userId, query.message.message_id);
        sendPage();
    }

    if (data.startsWith('deletemsgs_')) {
        const number = data.split('_')[1];
        delete authorizedUsers[userId].messages[number];
        bot.sendMessage(userId, `Deleted messages for ${number}.`);
        bot.deleteMessage(userId, query.message.message_id);
    }

    if (data.startsWith('adminchat_') || data.startsWith('broadcast_') || data.startsWith('disconnect')) {
        if (!isAdmin(userId)) return sendUnauthorized(userId);
        handleAdminCommunication(data, bot);
    }
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
        if (chatType === 'broadcast' || chatType === 'direct') {
            bot.sendMessage(config.adminId, `From ${userId} (${msg.from.username || msg.from.first_name}): ${msg.text || '[media]'}`);
        }
    } else if (!authorizedUsers[userId]?.verified && !pendingUsers[userId]) {
        return;
    }
});

export default bot;