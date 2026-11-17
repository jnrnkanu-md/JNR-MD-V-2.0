const noPrefix = require('../lib/noPrefix');
const isOwnerOrSudo = require('../lib/isOwner');

/** .noprefix on | off : (owner only) lets YOU use commands without the prefix, e.g. "menu" instead of ".menu" */
module.exports = async function noprefixCommand(sock, chatId, message) {
    const sender = message.key.participant || message.key.remoteJid;
    if (!message.key.fromMe && !(await isOwnerOrSudo.isOwnerOnly(sender, sock, chatId))) {
        return sock.sendMessage(chatId, { text: '❌ Only the bot owner can use this command!' }, { quoted: message });
    }
    const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
    const arg = text.trim().split(/\s+/)[1]?.toLowerCase();
    if (arg === 'on' || arg === 'off') noPrefix.set(arg === 'on');
    const on = noPrefix.isOn();
    const note = arg === 'on' || arg === 'off'
        ? (on ? '✅ *No-prefix mode ON* (for you only).\nType a command name without the dot, e.g. *menu* or *kick @user*. Everyone else still needs the prefix.' : '❌ *No-prefix mode OFF.*')
        : `No-prefix mode is *${on ? 'ON ✅' : 'OFF ❌'}*.\n\nUse *.noprefix on* or *.noprefix off*`;
    return sock.sendMessage(chatId, { text: note }, { quoted: message });
};
