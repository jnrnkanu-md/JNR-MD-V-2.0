const isAdmin = require('../lib/isAdmin');
const store = require('../lib/antiGcStatus');

/** .antigcstatus on | off   - group admins only. Deletes Group Status posts from non-admins. */
module.exports = async function antigcstatusCommand(sock, chatId, message) {
    const reply = (text) => sock.sendMessage(chatId, { text }, { quoted: message });
    if (!chatId.endsWith('@g.us')) return reply('❌ This command works in groups only.');
    const sender = message.key.participant || message.key.remoteJid;
    const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, sender);
    if (!isSenderAdmin && !message.key.fromMe) return reply('❌ For group admins only!');

    const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
    const arg = text.trim().split(/\s+/)[1]?.toLowerCase();
    if (arg === 'on') {
        store.set(chatId, true);
        return reply('✅ *Anti Group Status is ON.*\nGroup status posts from non-admins will be deleted.' + (isBotAdmin ? '' : '\n\n⚠️ Make the bot an admin so it can delete them.'));
    }
    if (arg === 'off') { store.set(chatId, false); return reply('✅ *Anti Group Status is OFF.*'); }
    return reply(`*Anti Group Status:* ${store.isOn(chatId) ? 'ON ✅' : 'OFF ❌'}\n\nUse *.antigcstatus on* or *.antigcstatus off*`);
};
