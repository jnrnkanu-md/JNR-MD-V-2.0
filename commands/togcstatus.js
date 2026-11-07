const baileys = require('@whiskeysockets/baileys');
const { downloadContentFromMessage, generateWAMessageFromContent, prepareWAMessageMedia, proto } = baileys;
const isOwnerOrSudo = require('../lib/isOwner');

/**
 * JNR-MD - post to WhatsApp GROUP STATUS in every group the bot is in
 *
 *  .togcstatus / .gcstatus                 (reply to an image / video / text)  -> posts it
 *  .togcstatus <caption>       (reply to an image / video)         -> posts it with your caption
 *  .togcstatus <text>                                              -> posts a text group status
 *  Sent as the caption of an image / video also works.
 *
 * Owner / sudo only. Groups are posted one by one with a pause, to stay safe from bans.
 */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const GAP_MIN = 3000, GAP_MAX = 6000;
const BACKGROUNDS = [0xFF0B5345, 0xFF1F618D, 0xFF6C3483, 0xFFB03A2E, 0xFF117864, 0xFF2E4053];

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

async function readBuffer(content, type) {
    const stream = await downloadContentFromMessage(content, type);
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    return Buffer.concat(chunks);
}

const supported = () => {
    try { return !!(proto?.Message && ('groupStatusMessageV2' in proto.Message.prototype)); } catch { return false; }
};

async function togcstatusCommand(sock, chatId, message) {
    const reply = (text) => sock.sendMessage(chatId, { text }, { quoted: message });
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        if (!message.key.fromMe && !(await isOwnerOrSudo(senderId, sock, chatId))) {
            return reply('❌ Only the bot owner can use this command!');
        }
        if (!supported()) {
            return reply('❌ Group Status is not supported by the WhatsApp library version installed on this bot.\nUpdate @whiskeysockets/baileys (or run .update) and try again.');
        }

        const m = unwrap(message.message) || {};
        const raw = m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || '';
        const typed = raw.replace(/^\S+\s*/, '').trim();       // text after the command
        const quoted = unwrap(m.extendedTextMessage?.contextInfo?.quotedMessage);

        // Work out what to post
        let kind, source, caption = typed;
        const own = m.imageMessage ? ['image', m.imageMessage] : m.videoMessage ? ['video', m.videoMessage] : null;
        const q = quoted ? (quoted.imageMessage ? ['image', quoted.imageMessage] : quoted.videoMessage ? ['video', quoted.videoMessage] : null) : null;
        const pick = own || q;
        if (pick) {
            [kind, source] = pick;
            if (!caption) caption = source.caption || '';
        } else {
            const qText = quoted && (quoted.conversation || quoted.extendedTextMessage?.text);
            const text = typed || qText;
            if (!text) return reply('❌ Reply to an image, video or text with *.togcstatus*, or type *.togcstatus your text*.');
            kind = 'text'; caption = text;
        }

        const groups = Object.keys((await sock.groupFetchAllParticipating()) || {});
        if (!groups.length) return reply('❌ The bot is not in any group.');
        await reply(`⏳ Posting to ${groups.length} group${groups.length > 1 ? 's' : ''}. This takes about ${Math.ceil(groups.length * 4.5 / 60)} min. I will tell you when done.`);

        // Upload the media once, reuse it for every group
        let inner;
        if (kind === 'text') {
            inner = { extendedTextMessage: { text: caption, backgroundArgb: BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)], font: 2 } };
        } else {
            const buffer = await readBuffer(source, kind);
            const prepared = await prepareWAMessageMedia({ [kind]: buffer, mimetype: kind === 'video' ? 'video/mp4' : 'image/jpeg' }, { upload: sock.waUploadToServer });
            const key = kind === 'image' ? 'imageMessage' : 'videoMessage';
            inner = { [key]: { ...prepared[key], caption } };
        }

        let ok = 0; const failed = [];
        for (const gid of groups) {
            try {
                const msg = generateWAMessageFromContent(gid, { groupStatusMessageV2: { message: inner } }, { userJid: sock.user.id });
                await sock.relayMessage(gid, msg.message, { messageId: msg.key.id });
                ok++;
            } catch (e) {
                failed.push(gid);
                console.error('[TOGCSTATUS]', gid, e.message);
            }
            await sleep(GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN));
        }
        await reply(`✅ Group Status posted in ${ok}/${groups.length} groups.` + (failed.length ? `\n⚠️ ${failed.length} failed (see the console).` : ''));
    } catch (e) {
        console.error('[TOGCSTATUS]', e);
        await reply('❌ Could not post the group status: ' + (e.message || e));
    }
}

module.exports = togcstatusCommand;
