const fs = require('fs');
const path = require('path');
const isAdmin = require('../lib/isAdmin');
const isOwnerOrSudo = require('../lib/isOwner');

const DATA_PATH = path.join(__dirname, '../data/verification.json');

/* ------------------------------------------------------------------ */
/*  Storage:  { "<groupId>": { enabled: bool, verified: ["234...", ...] } }  */
/* ------------------------------------------------------------------ */
let cache = null;

function load() {
    if (cache) return cache;
    try {
        cache = fs.existsSync(DATA_PATH) ? JSON.parse(fs.readFileSync(DATA_PATH, 'utf8') || '{}') : {};
    } catch {
        cache = {};
    }
    return cache;
}

function save() {
    try {
        const dir = path.dirname(DATA_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(DATA_PATH, JSON.stringify(cache, null, 2));
        return true;
    } catch (e) {
        console.error('Verification save error:', e.message);
        return false;
    }
}

function getGroup(chatId) {
    const data = load();
    if (!data[chatId]) data[chatId] = { enabled: false, verified: [] };
    if (!Array.isArray(data[chatId].verified)) data[chatId].verified = [];
    // `entries` is the readable list shown by .verified (older data only had `verified`)
    if (!Array.isArray(data[chatId].entries)) {
        data[chatId].entries = data[chatId].verified.map(id => ({ id }));
    }
    return data[chatId];
}

function isVerificationEnabled(chatId) {
    return !!(load()[chatId] && load()[chatId].enabled);
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */
// "2349137495210:12@s.whatsapp.net" / "1234@lid" -> "2349137495210" / "1234"
function idDigits(jid) {
    if (!jid) return '';
    return String(jid).split('@')[0].split(':')[0].replace(/\D/g, '');
}

const metaCache = new Map(); // chatId -> { t, md }
async function getMetadata(sock, chatId, fresh = false) {
    const hit = metaCache.get(chatId);
    if (!fresh && hit && Date.now() - hit.t < 60000) return hit.md;
    try {
        const md = await sock.groupMetadata(chatId);
        metaCache.set(chatId, { t: Date.now(), md });
        return md;
    } catch {
        return hit ? hit.md : { participants: [] };
    }
}

// Every numeric id we can find for a group member (phone number and/or LID)
function expandIds(participants, seedIds) {
    const ids = new Set(seedIds.filter(Boolean));
    for (const p of participants || []) {
        const pids = [p.id, p.lid, p.phoneNumber, p.jid].map(idDigits).filter(Boolean);
        if (pids.some(x => ids.has(x))) pids.forEach(x => ids.add(x));
    }
    return ids;
}

async function getSenderIds(sock, chatId, message, fresh = false) {
    const seed = [message.key.participant, message.key.participantAlt].map(idDigits);
    const md = await getMetadata(sock, chatId, fresh);
    return expandIds(md.participants, seed);
}

async function canManage(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (message.key.fromMe) return true;
    if (await isOwnerOrSudo(senderId, sock, chatId)) return true;
    const { isSenderAdmin } = await isAdmin(sock, chatId, senderId);
    return !!isSenderAdmin;
}

/* ------------------------------------------------------------------ */
/*  Auto-moderation: called for every group message                   */
/*  Returns true when the message was removed.                        */
/* ------------------------------------------------------------------ */
const noticeCooldown = new Map(); // "chat|user" -> timestamp
const adminHintCooldown = new Map(); // chat -> timestamp
const IGNORED_TYPES = new Set([
    'protocolMessage', 'reactionMessage', 'encReactionMessage', 'senderKeyDistributionMessage',
    'pollUpdateMessage', 'keepInChatMessage', 'messageContextInfo'
]);

async function verificationGuard(sock, message) {
    try {
        const chatId = message?.key?.remoteJid;
        if (!chatId || !chatId.endsWith('@g.us')) return false;
        if (message.key.fromMe) return false;

        const group = load()[chatId];
        if (!group || !group.enabled) return false;

        const types = Object.keys(message.message || {}).filter(k => k !== 'messageContextInfo');
        if (types.length === 0 || IGNORED_TYPES.has(types[0])) return false;

        const sender = message.key.participant;
        if (!sender) return false;

        // Admins (and the bot owner / sudo) are never checked
        const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, sender);
        if (isSenderAdmin) return false;
        if (await isOwnerOrSudo(sender, sock, chatId)) return false;

        // Verified members may post
        const ids = await getSenderIds(sock, chatId, message);
        if (group.verified.some(v => ids.has(v))) return false;

        // Not verified: the bot needs admin rights to delete other people's messages
        if (!isBotAdmin) {
            const last = adminHintCooldown.get(chatId) || 0;
            if (Date.now() - last > 10 * 60 * 1000) {
                adminHintCooldown.set(chatId, Date.now());
                await sock.sendMessage(chatId, { text: '⚠️ Verification is ON but I am not an admin, so I cannot delete messages. Please make me an admin.' });
            }
            return false;
        }

        await sock.sendMessage(chatId, { delete: message.key });

        // Tag the user (at most once every 30s so the bot does not spam)
        const key = `${chatId}|${sender}`;
        if (Date.now() - (noticeCooldown.get(key) || 0) > 30000) {
            noticeCooldown.set(key, Date.now());
            await sock.sendMessage(chatId, {
                text: `⚠️ @${idDigits(sender)} *get verified before posting!*`,
                mentions: [sender]
            });
        }
        return true;
    } catch (err) {
        console.error('Verification guard error:', err.message);
        return false;
    }
}

/* ------------------------------------------------------------------ */
/*  Commands                                                          */
/* ------------------------------------------------------------------ */
async function guardCommand(sock, chatId, message) {
    if (!chatId.endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: '❌ This command can only be used in groups.' }, { quoted: message });
        return false;
    }
    if (!(await canManage(sock, chatId, message))) {
        await sock.sendMessage(chatId, { text: '❌ Only group admins can use this command.' }, { quoted: message });
        return false;
    }
    return true;
}

// .verification on | off | status
async function verificationCommand(sock, chatId, message, args) {
    if (!(await guardCommand(sock, chatId, message))) return;

    const sub = (args || '').trim().split(/\s+/)[0].toLowerCase();
    const group = getGroup(chatId);

    if (sub === 'on' || sub === 'off') {
        group.enabled = sub === 'on';
        save();
        let text = group.enabled
            ? '✅ *Verification is now ON.*\nOnly verified members can post. Admins are excluded.\nUse *.verify <number>* to verify someone.'
            : '❌ *Verification is now OFF.* Everyone can post again.';
        if (group.enabled) {
            const senderId = message.key.participant || message.key.remoteJid;
            const { isBotAdmin } = await isAdmin(sock, chatId, senderId);
            if (!isBotAdmin) text += '\n\n⚠️ I am not an admin yet. Make me an admin so I can delete messages.';
        }
        await sock.sendMessage(chatId, { text }, { quoted: message });
        return;
    }

    if (!sub || sub === 'status') {
        await sock.sendMessage(chatId, {
            text: `🔐 *VERIFICATION*\n\nStatus: *${group.enabled ? 'ON ✅' : 'OFF ❌'}*\nVerified members: *${group.verified.length}*\n\n` +
                  `*Usage:*\n.verification on\n.verification off\n.verify <number> (or reply to / tag a member)\n.unverify <number>\n.verified (show the list)`
        }, { quoted: message });
        return;
    }

    await sock.sendMessage(chatId, { text: '❓ Use *.verification on* or *.verification off*' }, { quoted: message });
}

// Work out who an admin wants to verify/unverify
function parseTarget(message, rawArgs) {
    const ctx = message.message?.extendedTextMessage?.contextInfo;
    const jid = (ctx?.mentionedJid && ctx.mentionedJid[0]) || ctx?.participant || null;
    if (jid) return { jid, digits: idDigits(jid) };
    const digits = String(rawArgs || '').replace(/\D/g, '');
    return { jid: null, digits };
}

function usage(cmd) {
    return `❓ *Usage:*\n.${cmd}+2349137495210\n.${cmd} 2349137495210\n.${cmd} @member\nor reply to the member's message with .${cmd}`;
}

async function changeVerified(sock, chatId, message, rawArgs, add) {
    const cmd = add ? 'verify' : 'unverify';
    if (!(await guardCommand(sock, chatId, message))) return;

    const { jid, digits } = parseTarget(message, rawArgs);
    if (!digits) { await sock.sendMessage(chatId, { text: usage(cmd) }, { quoted: message }); return; }
    if (!jid && digits.startsWith('0')) {
        await sock.sendMessage(chatId, { text: '❌ Please use the full number with country code, e.g. *2349137495210*.' }, { quoted: message });
        return;
    }
    if (!jid && (digits.length < 7 || digits.length > 15)) {
        await sock.sendMessage(chatId, { text: `❌ That does not look like a valid phone number.\n\n${usage(cmd)}` }, { quoted: message });
        return;
    }

    const group = getGroup(chatId);
    const md = await getMetadata(sock, chatId, true);
    const ids = expandIds(md.participants, [digits]); // phone number + LID if the member is in the group
    const label = jid ? `@${digits}` : `+${digits}`;
    const mentions = jid ? [jid] : [];

    if (add) {
        const already = group.verified.includes(digits);
        for (const id of ids) if (!group.verified.includes(id)) group.verified.push(id);
        if (!group.entries.some(e => e.id === digits)) group.entries.push({ id: digits, jid: jid || undefined });
        save();
        let text = already
            ? `✅ ${label} is already verified.`
            : `✅ ${label} is now *verified* and can post in this group.`;
        if (!group.enabled) text += '\n\nℹ️ Verification is currently OFF. Turn it on with *.verification on*.';
        await sock.sendMessage(chatId, { text, mentions }, { quoted: message });
    } else {
        const before = group.verified.length;
        group.verified = group.verified.filter(v => !ids.has(v));
        group.entries = group.entries.filter(e => !ids.has(e.id));
        save();
        const text = group.verified.length < before
            ? `❌ ${label} is no longer verified.`
            : `ℹ️ ${label} was not in the verified list.`;
        await sock.sendMessage(chatId, { text, mentions }, { quoted: message });
    }
}

// .verified  -> list everyone verified in this group
async function verifiedListCommand(sock, chatId, message) {
    if (!(await guardCommand(sock, chatId, message))) return;
    const group = getGroup(chatId);
    const shown = group.entries.slice(0, 100);

    if (shown.length === 0) {
        await sock.sendMessage(chatId, {
            text: `🔐 *VERIFIED MEMBERS*\n\nVerification: *${group.enabled ? 'ON ✅' : 'OFF ❌'}*\nNo one is verified yet.\n\nUse *.verify <number>* to verify a member.`
        }, { quoted: message });
        return;
    }

    const mentions = [];
    const lines = shown.map((e, i) => {
        if (e.jid) { mentions.push(e.jid); return `${i + 1}. @${e.id}`; }
        return `${i + 1}. +${e.id}`;
    });
    let text = `🔐 *VERIFIED MEMBERS* (${group.entries.length})\nVerification: *${group.enabled ? 'ON ✅' : 'OFF ❌'}*\n\n${lines.join('\n')}`;
    if (group.entries.length > shown.length) text += `\n\n…and ${group.entries.length - shown.length} more`;
    await sock.sendMessage(chatId, { text, mentions }, { quoted: message });
}

const verifyCommand = (sock, chatId, message, rawArgs) => changeVerified(sock, chatId, message, rawArgs, true);
const unverifyCommand = (sock, chatId, message, rawArgs) => changeVerified(sock, chatId, message, rawArgs, false);

module.exports = { verificationCommand, verifyCommand, unverifyCommand, verifiedListCommand, verificationGuard, isVerificationEnabled };
