const isAdmin = require('../lib/isAdmin');
const isOwnerOrSudo = require('../lib/isOwner');

// Everyone can use .tagall; the bot does NOT need to be an admin.
// To stop spam, regular members must wait 60 seconds between uses in the same group.
const COOLDOWN_MS = 60 * 1000;
const lastUse = new Map();

async function tagAllCommand(sock, chatId, senderId, message) {
    try {
        let privileged = !!message.key.fromMe;
        if (!privileged) privileged = await isOwnerOrSudo(senderId, sock, chatId);
        if (!privileged) {
            const { isSenderAdmin } = await isAdmin(sock, chatId, senderId);
            privileged = !!isSenderAdmin;
        }

        if (!privileged) {
            const wait = COOLDOWN_MS - (Date.now() - (lastUse.get(chatId) || 0));
            if (wait > 0) {
                await sock.sendMessage(chatId, { text: `⏳ Please wait *${Math.ceil(wait / 1000)}s* before tagging everyone again.` }, { quoted: message });
                return;
            }
            lastUse.set(chatId, Date.now());
        }

        const groupMetadata = await sock.groupMetadata(chatId);
        const participants = groupMetadata.participants;
        if (!participants || participants.length === 0) {
            await sock.sendMessage(chatId, { text: 'No participants found in the group.' });
            return;
        }

        let messageText = '🔊 *Hello Everyone:*\n\n';
        participants.forEach(participant => {
            messageText += `@${participant.id.split('@')[0].split(':')[0]}\n`;
        });

        await sock.sendMessage(chatId, { text: messageText, mentions: participants.map(p => p.id) });
    } catch (error) {
        console.error('Error in tagall command:', error);
        await sock.sendMessage(chatId, { text: 'Failed to tag all members.' });
    }
}

module.exports = tagAllCommand;
