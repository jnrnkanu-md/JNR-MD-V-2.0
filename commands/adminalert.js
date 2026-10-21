const fs = require('fs');
const isOwnerOrSudo = require('../lib/isOwner');

const ALERT_PATH = './data/adminalert.json';

// Announcements are OFF by default
function readState() {
    try {
        if (!fs.existsSync(ALERT_PATH)) return { enabled: false };
        const data = JSON.parse(fs.readFileSync(ALERT_PATH, 'utf8') || '{}');
        return { enabled: data.enabled === true };
    } catch {
        return { enabled: false };
    }
}

function writeState(enabled) {
    try {
        if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
        fs.writeFileSync(ALERT_PATH, JSON.stringify({ enabled: !!enabled }, null, 2));
        return true;
    } catch {
        return false;
    }
}

// Used by promote.js / demote.js before they send an announcement
function isAdminAlertEnabled() {
    return readState().enabled;
}

// .adminalert on | off | status   (owner / sudo only)
async function adminAlertCommand(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    const isOwner = await isOwnerOrSudo(senderId, sock, chatId);

    if (!message.key.fromMe && !isOwner) {
        await sock.sendMessage(chatId, { text: '❌ Only the bot owner can use this command!' }, { quoted: message });
        return;
    }

    const sub = (args || '').trim().split(/\s+/)[0].toLowerCase();
    const state = readState();

    if (!sub || sub === 'status') {
        await sock.sendMessage(chatId, {
            text: `🔔 *ADMIN ALERTS*\n\nPromote/demote announcements are currently *${state.enabled ? 'ON ✅' : 'OFF ❌'}*\n\n` +
                  `*Usage:*\n.adminalert on - Enable announcements\n.adminalert off - Disable announcements\n.adminalert status - Show status`
        }, { quoted: message });
        return;
    }

    if (sub !== 'on' && sub !== 'off') {
        await sock.sendMessage(chatId, { text: '❓ Use *.adminalert on* or *.adminalert off*' }, { quoted: message });
        return;
    }

    const ok = writeState(sub === 'on');
    await sock.sendMessage(chatId, {
        text: ok
            ? (sub === 'on'
                ? '✅ *Admin alerts enabled.* Promote/demote announcements will be sent.'
                : '❌ *Admin alerts disabled.* Promote/demote announcements will no longer be sent.')
            : '❌ Failed to save the setting.'
    }, { quoted: message });
}

module.exports = { adminAlertCommand, isAdminAlertEnabled, readState };
