const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const settings = require('../settings');
const isAdmin = require('../lib/isAdmin');
const isOwnerOrSudo = require('../lib/isOwner');
const S = require('../lib/safety');

/**
 * JNR-MD - safety scan (strong mode)
 *   .safety on / off            this group (group admins) or all private chats (owner)
 *   .safety status              what is on, and what your Groq key can do
 *   .safety level strict|normal (owner) strict = catches more, may flag a few harmless things
 *   .safety links on/off        (owner) link, message-wording and file checks
 *   .safety images on/off       (owner) picture, sticker and video checks
 *   .safety allow <domain>      (owner) never flag this website
 *   .safety remove <domain>     (owner) remove it from the allowed list
 *   .safety list                the allowed websites
 *   .safety check               check a link, text, file, image or video now: type it, or reply to it  (also: .scan)
 *
 * Groups: dangerous things are removed (the bot must be an admin) and the group is warned.
 *         Admins are checked too, but only YOU get a private alert, nothing is deleted.
 * Private chats: only YOU are warned, in your own chat. The sender never gets a message.
 */

const digitsOf = (jid) => (jid ? String(jid).split('@')[0].split(':')[0].replace(/\D/g, '') : '');
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const warnCooldown = new Map();
const privateCooldown = new Map();

function unwrap(msg) {
    let m = msg;
    for (let i = 0; i < 4 && m; i++) {
        const inner = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || m.documentWithCaptionMessage?.message;
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

const ownerJid = () => `${String(settings.ownerNumber || '').replace(/\D/g, '')}@s.whatsapp.net`;
const icon = (level) => (level === 'danger' ? '🚨' : level === 'warn' ? '⚠️' : level === 'safe' ? '✅' : 'ℹ️');
const textOf = (m) => m?.conversation || m?.extendedTextMessage?.text || m?.imageMessage?.caption || m?.videoMessage?.caption || m?.documentMessage?.caption || '';

/* ---------------- looks at everything inside one message ---------------- */
// -> [{ kind, label, level: 'safe'|'warn'|'danger'|'unknown', reasons: [], note }]
async function analyze(content, text) {
    const cfg = S.config();
    const items = [];

    if (cfg.links) {
        const t = String(text || '');
        if (t.trim().length >= 12) {
            const r = await S.assessText(t);
            if (r.level !== 'safe') items.push({ kind: 'text', label: 'message wording', level: r.level, reasons: r.reasons });
        }
        for (const url of S.extractUrls(t).slice(0, 3)) {
            const r = await S.assessUrl(url, t);
            items.push({ kind: 'link', label: url.length > 60 ? url.slice(0, 60) + '…' : url, level: r.level, reasons: r.reasons });
        }
        const doc = content?.documentMessage;
        if (doc) {
            const r = S.assessFile({ fileName: doc.fileName, mimetype: doc.mimetype });
            items.push({ kind: 'file', label: doc.fileName || 'file', level: r.level, reasons: r.reasons });
        }
    }

    if (cfg.images) {
        const scan = async (buffer, kind) => { try { return await S.scanImage(buffer, kind); } catch (e) { return { skipped: e.message }; } };
        const imageItem = (label, r) => (r.skipped
            ? { kind: 'image', label, level: 'unknown', reasons: [], note: `not scanned: ${r.skipped}` }
            : { kind: 'image', label, level: r.flagged ? 'danger' : 'safe', reasons: r.labels });

        try {
            const img = content?.imageMessage || (content?.documentMessage && /^image\//i.test(content.documentMessage.mimetype || '') ? content.documentMessage : null);
            if (img && (!img.fileLength || Number(img.fileLength) <= MAX_IMAGE_BYTES)) {
                items.push(imageItem(content.imageMessage ? 'image' : 'image file', await scan(await readBuffer(img, content.imageMessage ? 'image' : 'document'), 'image')));
            }
            if (content?.stickerMessage && S.isStrict() && (!content.stickerMessage.fileLength || Number(content.stickerMessage.fileLength) <= MAX_IMAGE_BYTES)) {
                items.push(imageItem('sticker', await scan(await readBuffer(content.stickerMessage, 'sticker'), 'sticker')));
            }
            const vid = content?.videoMessage || content?.ptvMessage;
            if (vid) {
                let frames = [];
                if (!vid.fileLength || Number(vid.fileLength) <= MAX_VIDEO_BYTES) {
                    try { frames = await S.videoFrames(await readBuffer(vid, 'video')); } catch (e) { console.error('Safety: video download failed:', e.message); }
                }
                if (!frames.length && vid.jpegThumbnail && vid.jpegThumbnail.length > 500) frames = [Buffer.from(vid.jpegThumbnail)];
                if (frames.length) {
                    const results = [];
                    for (const f of frames) results.push(await scan(f, 'frame'));
                    const flagged = results.find(r => r.flagged);
                    const skipped = results.every(r => r.skipped) ? results[0] : null;
                    items.push(skipped ? { ...imageItem('video', skipped), kind: 'video' }
                        : { kind: 'video', label: 'video', level: flagged ? 'danger' : 'safe', reasons: flagged ? flagged.labels : [] });
                }
            }
        } catch (e) { console.error('Safety: media check failed:', e.message); }
    }
    return items;
}

const describe = (p) => {
    if (p.kind === 'link') return `• link: ${p.label}\n   ${p.reasons.slice(0, 3).join('; ')}`;
    if (p.kind === 'text') return `• message wording: ${p.reasons.slice(0, 3).join('; ')}`;
    if (p.kind === 'file') return `• file "${p.label}": ${p.reasons.slice(0, 2).join('; ')}`;
    return `• ${p.label}: possible ${p.reasons.join(', ')}`;
};

/* ---------------- automatic guard (called from main.js for every message) ---------------- */
// Returns true when the message was removed.
async function safetyGuard(sock, message) {
    try {
        const chatId = message?.key?.remoteJid;
        if (!chatId || message.key.fromMe) return false;
        const isGroup = chatId.endsWith('@g.us');
        if (!isGroup && !chatId.endsWith('@s.whatsapp.net') && !chatId.endsWith('@lid')) return false;
        if (!S.isEnabledFor(chatId)) return false;

        let msg = unwrap(message.message);
        if (!msg) return false;
        const sender = message.key.participant || chatId;

        // an EDITED message is checked too (a harmless message can be edited into a scam)
        let deleteKey = message.key;
        if (msg.protocolMessage) {
            const proto = msg.protocolMessage;
            if (!proto.editedMessage) return false;
            deleteKey = { remoteJid: chatId, id: proto.key?.id, fromMe: false, participant: isGroup ? sender : undefined };
            msg = unwrap(proto.editedMessage);
            if (!msg) return false;
        }

        let trustedAdmin = false, isBotAdmin = false;
        if (isGroup) {
            const a = await isAdmin(sock, chatId, sender);
            isBotAdmin = !!a.isBotAdmin;
            if (await isOwnerOrSudo(sender, sock, chatId)) return false;     // you and your sudo users
            trustedAdmin = !!a.isSenderAdmin;
        }

        const items = await analyze(msg, textOf(msg));
        const problems = items.filter(i => i.level === 'warn' || i.level === 'danger');
        for (const i of items) if (i.level === 'unknown' && i.note) console.log(`Safety: ${i.label} ${i.note}`);
        if (!problems.length) return false;
        const removeIt = problems.some(p => p.level === 'danger');
        const lines = problems.map(describe).join('\n');

        // private chat, or a group admin: tell the owner only
        if (!isGroup || trustedAdmin) {
            const key = `${chatId}|${sender}`;
            if (Date.now() - (privateCooldown.get(key) || 0) < 60000) return false;
            privateCooldown.set(key, Date.now());
            const who = isGroup ? `admin +${digitsOf(sender)} in a group (${chatId.split('@')[0]})` : `+${digitsOf(chatId)}`;
            await sock.sendMessage(ownerJid(), {
                text: `${removeIt ? '🚨' : '⚠️'} *SAFETY ALERT*${isGroup ? '' : ' (private chat)'}\n\nFrom ${who}:\n${lines}\n\n${removeIt ? "Don't open it." : 'Be careful with it.'}`
            }, { noFooter: true });
            return false;
        }

        const tag = `@${digitsOf(sender)}`;
        if (removeIt && isBotAdmin) {
            await sock.sendMessage(chatId, { delete: deleteKey });
            await sock.sendMessage(chatId, { text: `🚨 *SAFETY ALERT*\n\n${tag}'s message was removed:\n${lines}`, mentions: [sender] });
            return true;
        }
        const key = `${chatId}|${sender}`;
        if (Date.now() - (warnCooldown.get(key) || 0) < 20000) return false;
        warnCooldown.set(key, Date.now());
        await sock.sendMessage(chatId, {
            text: `${removeIt ? '🚨 *SAFETY ALERT*' : '⚠️ *Be careful*'}\n\n${tag} shared something unsafe:\n${lines}\n\n${removeIt ? "Don't open it. (I'm not an admin, so I can't remove it.)" : "Don't enter passwords or install anything from it."}`,
            mentions: [sender]
        });
        return false;
    } catch (err) {
        console.error('Safety guard error:', err.message);
        return false;
    }
}

/* ---------------- gate for the download commands ---------------- */
// Returns true (and tells the user) when a link must NOT be downloaded.
async function blockedBySafety(sock, chatId, message, url) {
    try {
        if (!S.isEnabledFor(chatId) || !S.config().links) return false;
        const r = await S.assessUrl(url);
        if (r.level !== 'danger') return false;
        await sock.sendMessage(chatId, { text: `🚨 *Download blocked*\n\nThis link looks unsafe:\n${r.reasons.slice(0, 3).map(x => `• ${x}`).join('\n')}` }, { quoted: message });
        return true;
    } catch { return false; }
}

/* ---------------- command ---------------- */
async function safetyCommand(sock, chatId, message) {
    const reply = (text, extra = {}) => sock.sendMessage(chatId, { text, ...extra }, { quoted: message });
    const senderId = message.key.participant || message.key.remoteJid;
    const isGroup = chatId.endsWith('@g.us');
    const isOwner = !!message.key.fromMe || await isOwnerOrSudo(senderId, sock, chatId);
    let isGroupAdmin = false;
    if (!isOwner && isGroup) isGroupAdmin = !!(await isAdmin(sock, chatId, senderId)).isSenderAdmin;
    if (!isOwner && !isGroupAdmin) return reply('❌ Only group admins or the bot owner can use this command.');

    const own = unwrap(message.message) || {};
    const raw = textOf(own).trim();
    const first = raw.split(/\s+/)[0].toLowerCase().replace(/^[^a-z]+/, '');
    const parts = raw.replace(/^\S+/, '').trim().split(/\s+/).filter(Boolean);
    const isScanAlias = first === 'scan';
    const sub = isScanAlias ? 'check' : (parts[0] || '').toLowerCase();
    const rest = isScanAlias ? parts : parts.slice(1);
    const cfg = S.config();
    const ownerOnly = () => { if (!isOwner) { reply('❌ Only the bot owner can change this.'); return true; } return false; };

    if (sub === 'on' || sub === 'off') {
        if (!isGroup && ownerOnly()) return;
        if (isGroup) cfg.groups[chatId] = sub === 'on'; else cfg.privateChats = sub === 'on';
        S.save();
        const where = isGroup ? 'this group' : 'all private chats';
        let note = '';
        if (sub === 'on') {
            note = isGroup
                ? `\n\nI check links, scam messages, files, pictures, stickers and videos (${cfg.level} mode). Dangerous things are removed and the group is warned.\n⚠️ I must be a group admin to delete messages.`
                : '\n\nI will warn you in your own chat. I never write to the sender.';
            if (!cfg.links && !cfg.images) note += '\n(Links and images are both switched off. Use .safety links on / .safety images on)';
        }
        return reply(`${sub === 'on' ? '✅ *Safety scan ON*' : '❌ *Safety scan OFF*'} for ${where}.${note}`);
    }
    if (sub === 'level') {
        if (ownerOnly()) return;
        const v = (rest[0] || '').toLowerCase();
        if (v !== 'strict' && v !== 'normal') return reply('Use *.safety level strict* (catches more) or *.safety level normal* (fewer false alarms).');
        cfg.level = v; S.save();
        return reply(v === 'strict' ? '🔒 *Strict mode.* Catches more, uses two image models, and may flag a few harmless things.' : '🔓 *Normal mode.* Fewer false alarms, one image model.');
    }
    if (sub === 'links' || sub === 'images') {
        if (ownerOnly()) return;
        const v = (rest[0] || '').toLowerCase();
        if (v !== 'on' && v !== 'off') return reply(`Use *.safety ${sub} on* or *.safety ${sub} off*`);
        cfg[sub] = v === 'on'; S.save();
        return reply(`${v === 'on' ? '✅' : '❌'} ${sub === 'links' ? 'Link, message and file' : 'Picture, sticker and video'} checks *${v.toUpperCase()}*.`);
    }
    if (sub === 'allow' || sub === 'remove') {
        if (ownerOnly()) return;
        const d = S.normDomain(rest[0]);
        if (!d || !d.includes('.')) return reply(`Use *.safety ${sub} example.com*`);
        if (sub === 'allow') { if (!cfg.allow.includes(d)) cfg.allow.push(d); S.save(); return reply(`✅ *${d}* will never be flagged.`); }
        cfg.allow = cfg.allow.filter(x => x !== d); S.save();
        return reply(`✅ Removed *${d}* from the allowed list.`);
    }
    if (sub === 'models') {
        if (ownerOnly()) return;
        try {
            const ids = await S.listModels();
            const guard = ids.filter(i => /llama-guard/i.test(i)), vision = ids.filter(i => /llama-4|scout|maverick|vision|[-/]vl\b|pixtral|llava/i.test(i));
            return reply(`🧠 *Models your Groq key can use* (${ids.length})\n\n${ids.slice(0, 40).map(i => `• ${i}`).join('\n') || '(none)'}\n\n*Safety models:* ${guard.length ? guard.join(', ') : 'none'}\n*Picture models:* ${vision.length ? vision.join(', ') : 'none'}`);
        } catch (e) {
            return reply(`❌ Could not read the models for your key (${e.response?.status || e.message}).\nCheck that *GROQ_API_KEY* in the .env file is correct.`);
        }
    }
    if (sub === 'list') {
        return reply(cfg.allow.length ? `✅ *Allowed websites*\n\n${cfg.allow.map((d, i) => `${i + 1}. ${d}`).join('\n')}` : 'No allowed websites yet. Add one with *.safety allow example.com*');
    }
    if (sub === 'check') {
        const ctx = own.extendedTextMessage?.contextInfo || own.imageMessage?.contextInfo || own.videoMessage?.contextInfo || own.documentMessage?.contextInfo;
        const quoted = unwrap(ctx?.quotedMessage);
        const typed = rest.join(' ');
        let target, targetText;
        if (own.imageMessage || own.videoMessage || own.documentMessage) { target = own; targetText = typed; }      // media sent with the command
        else if (typed.trim()) { target = { conversation: typed }; targetText = typed; }
        else if (quoted) { target = quoted; targetText = textOf(quoted); }
        if (!target) return reply('Use *.safety check <link or text>*, or reply to a message, file, image or video with *.safety check* (or *.scan*).');
        await sock.sendMessage(chatId, { react: { text: '🔎', key: message.key } }).catch(() => {});

        // a manual check always looks at links, wording, files and pictures, whatever the switches say
        const saved = { links: cfg.links, images: cfg.images };
        cfg.links = true; cfg.images = true;
        let items;
        try { items = await analyze(target, targetText); } finally { cfg.links = saved.links; cfg.images = saved.images; }

        const out = items.map(i => {
            if (i.level === 'unknown') return `ℹ️ *${i.label}*: ${i.note}`;
            const verdict = i.level === 'safe' ? 'looks safe' : i.level === 'warn' ? 'suspicious' : 'dangerous';
            const extra = i.reasons.length ? '\n' + i.reasons.slice(0, 4).map(x => `   • ${x}`).join('\n') : '';
            return `${icon(i.level)} *${i.kind === 'link' ? 'Link' : i.kind === 'text' ? 'Message wording' : i.kind === 'file' ? 'File' : i.label[0].toUpperCase() + i.label.slice(1)}*: ${verdict}${i.kind === 'link' || i.kind === 'file' ? `\n   ${i.label}` : ''}${extra}`;
        });
        if (!out.length) out.push('✅ Nothing suspicious found (no links, harmful wording, files or pictures to check).');
        return reply(`🔎 *SAFETY CHECK*\n\n${out.join('\n\n')}\n\n_A scan helps, but it is not a guarantee._`);
    }

    // status (default)
    const caps = await S.capabilities();
    const here = S.isEnabledFor(chatId);
    const imageLine = !caps.key ? '❌ no Groq key' : caps.guard && caps.vision ? '✅ Llama Guard 4 + vision model (strongest)' : caps.guard ? '✅ Llama Guard 4' : caps.vision ? '✅ vision model' : caps.error ? `⚠️ could not read your models (${caps.error})` : `❌ your key can use ${caps.count ?? 0} models, but none can check pictures (send .safety models to see them)`;
    return reply(
        `🛡️ *SAFETY SCAN*\n\n` +
        `This ${isGroup ? 'group' : 'chat'}: *${here ? 'ON ✅' : 'OFF ❌'}*\n` +
        `Groups switched on: *${Object.values(cfg.groups).filter(Boolean).length}*  |  Private chats: *${cfg.privateChats ? 'ON' : 'OFF'}*\n` +
        `Mode: *${cfg.level.toUpperCase()}*\n` +
        `Link, message and file checks: *${cfg.links ? 'ON' : 'OFF'}*\nPicture, sticker and video checks: *${cfg.images ? 'ON' : 'OFF'}*\n` +
        `Allowed websites: *${cfg.allow.length}*\n\n` +
        `*Image scanner:* ${imageLine}\n*Video frames (ffmpeg):* ${caps.ffmpeg ? '✅' : '❌ only the video preview is checked'}\n\n` +
        `*Commands*\n.safety on / off\n.safety level strict/normal\n.safety links on/off\n.safety images on/off\n.safety models\n.safety allow <domain>\n.safety remove <domain>\n.safety list\n.safety check <link/text>  (or reply with .scan)`);
}

module.exports = { safetyCommand, safetyGuard, blockedBySafety, analyze };
