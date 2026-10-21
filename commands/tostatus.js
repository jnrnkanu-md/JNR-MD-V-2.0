const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const os = require('os');
const settings = require('../settings');
const isOwnerOrSudo = require('../lib/isOwner');

/**
 * JNR-MD - post to the bot's WhatsApp Status
 *
 *  .tostatus                 (reply to an image / video / text message)  -> posts that message
 *  .tostatus <new caption>   (reply to an image / video)                 -> posts it with your caption
 *  .tostatus                 (sent as the caption of an image / video)   -> posts that image / video
 *  .tostatus <text>                                                      -> posts a text status
 *
 * Owner / sudo only.
 */

const BACKGROUNDS = ['#121212', '#0B5345', '#1F618D', '#6C3483', '#B03A2E', '#B9770E', '#117864', '#2E4053'];
const MAX_AUDIENCE = 1500;

const toUserJid = (jid) => {
    if (!jid) return null;
    const num = String(jid).split('@')[0].split(':')[0];
    return `${num}@s.whatsapp.net`;
};

// Peel off wrappers like ephemeral / view-once so the real content is visible
function unwrap(msg) {
    let m = msg;
    for (let i = 0; i < 4 && m; i++) {
        const inner = m.ephemeralMessage?.message || m.viewOnceMessage?.message ||
                      m.viewOnceMessageV2?.message || m.documentWithCaptionMessage?.message;
        if (!inner) break;
        m = inner;
    }
    return m;
}

// People who can see the status: the bot, the owner, and everyone in the groups the bot is in
async function getStatusAudience(sock) {
    const list = new Set();
    const me = toUserJid(sock.user?.id);
    if (me) list.add(me);
    if (settings.ownerNumber) list.add(`${String(settings.ownerNumber).replace(/\D/g, '')}@s.whatsapp.net`);
    try {
        const groups = await sock.groupFetchAllParticipating();
        for (const g of Object.values(groups || {})) {
            for (const p of g.participants || []) {
                const jid = p.phoneNumber ? toUserJid(p.phoneNumber)
                          : (String(p.id).endsWith('@s.whatsapp.net') ? toUserJid(p.id) : null);
                if (jid) list.add(jid);
                if (list.size >= MAX_AUDIENCE) return [...list];
            }
        }
    } catch (e) {
        console.log('Status audience: could not read groups, posting to the owner/bot only');
    }
    return [...list];
}

async function readBuffer(content, type) {
    const stream = await downloadContentFromMessage(content, type);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
}

async function tostatusCommand(sock, chatId, message) {
    let tempFilePath = null;
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        if (!message.key.fromMe && !(await isOwnerOrSudo(senderId, sock, chatId))) {
            return await sock.sendMessage(chatId, { text: '❌ Only the bot owner can use this command!' }, { quoted: message });
        }

        const m = unwrap(message.message) || {};
        const rawText = m.conversation || m.extendedTextMessage?.text ||
                        m.imageMessage?.caption || m.videoMessage?.caption || '';
        // Text typed after the command (original case, not lower-cased)
        const typed = rawText.trim().replace(/^\S+/, '').trim();

        const ctx = m.extendedTextMessage?.contextInfo || m.imageMessage?.contextInfo || m.videoMessage?.contextInfo;
        const quoted = unwrap(ctx?.quotedMessage);

        // What are we posting?
        let image = m.imageMessage || quoted?.imageMessage || null;
        let video = image ? null : (m.videoMessage || quoted?.videoMessage || null);
        const quotedText = quoted?.conversation || quoted?.extendedTextMessage?.text || '';
        const textStatus = (!image && !video) ? (typed || quotedText) : '';
        // When the image/video itself carries the command as its caption, that caption is NOT reused
        const ownMedia = !!(m.imageMessage || m.videoMessage);

        if (!image && !video && !textStatus) {
            return await sock.sendMessage(chatId, {
                text: '❌ *How to use .tostatus*\n\n' +
                      '• Reply to an *image* → `.tostatus` (keeps its caption) or `.tostatus new caption`\n' +
                      '• Reply to a *video* → `.tostatus`\n' +
                      '• Reply to a *text* → `.tostatus`\n' +
                      '• Send an image/video with `.tostatus` as its caption\n' +
                      '• Or type `.tostatus your text`'
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });
        const statusJidList = await getStatusAudience(sock);
        const options = { statusJidList };

        if (image) {
            const buffer = await readBuffer(image, 'image');
            await sock.sendMessage('status@broadcast', { image: buffer, caption: ownMedia ? typed : (typed || image.caption || '') }, options);
        } else if (video) {
            const buffer = await readBuffer(video, 'video');
            tempFilePath = path.join(os.tmpdir(), `status_vid_${Date.now()}.mp4`);
            fs.writeFileSync(tempFilePath, buffer);
            await sock.sendMessage('status@broadcast', {
                video: { url: tempFilePath }, mimetype: 'video/mp4', caption: ownMedia ? typed : (typed || video.caption || '')
            }, options);
        } else {
            await sock.sendMessage('status@broadcast', {
                text: textStatus,
                backgroundColor: BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)],
                font: Math.floor(Math.random() * 6)
            }, options);
        }

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
        await sock.sendMessage(chatId, {
            text: `✅ *${image ? 'Image' : video ? 'Video' : 'Text'} posted to your status!*`
        }, { quoted: message });

    } catch (error) {
        console.error('Error in tostatus command:', error);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } }).catch(() => {});
        await sock.sendMessage(chatId, { text: `❌ *Upload failed:* ${error.message || 'Unknown error'}` }, { quoted: message });
    } finally {
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            try { fs.unlinkSync(tempFilePath); } catch { /* ignore */ }
        }
    }
}

module.exports = tostatusCommand;
