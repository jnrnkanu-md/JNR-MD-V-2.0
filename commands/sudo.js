const settings = require('../settings');
const style = require('../lib/style');
const { addSudo, removeSudo, getSudoList } = require('../lib/index');
const isOwnerOrSudo = require('../lib/isOwner');
const { isOwnerOnly, resolveIds } = isOwnerOrSudo;

/**
 * .sudo add <@user | number | reply>   give someone owner-level access (only the real owner)
 * .sudo del <@user | number | reply>   take it away
 * .sudo list                           see who has it
 * Works whether WhatsApp shows the person as a phone number or as a hidden ID (LID): both are saved and matched.
 */

const digitsOf = (jid) => (jid ? String(jid).split('@')[0].split(':')[0].replace(/\D/g, '') : '');
const title = (name) => `👑 ${style.bold(name)}\n━━━━━━━━━━━━━━━━━━\n`;

function parseTarget(message, argsText) {
    const ctx = message.message?.extendedTextMessage?.contextInfo;
    const jid = (ctx?.mentionedJid && ctx.mentionedJid[0]) || ctx?.participant || null;
    if (jid) return { jid };
    const typed = String(argsText || '').replace(/\D/g, '');
    if (!typed) return { error: 'empty' };
    if (typed.startsWith('0')) return { error: 'local' };
    if (typed.length < 7 || typed.length > 15) return { error: 'invalid' };
    return { jid: `${typed}@s.whatsapp.net` };
}

async function sudoCommand(sock, chatId, message) {
    const reply = (text) => sock.sendMessage(chatId, { text }, { quoted: message });
    const senderJid = message.key.participant || message.key.remoteJid;

    const rawText = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
    const args = rawText.trim().split(/\s+/).slice(1);
    const sub = (args[0] || '').toLowerCase();

    const usage = `${title('SUDO')}Give someone owner-level access.\n\n╭━〔 📖 ${style.bold('COMMANDS')} 〕━⬣\n┃➤ .sudo add <@user/number>\n┃➤ .sudo del <@user/number>\n┃➤ .sudo list\n╰━━━━━━━━━━━━⬣\n\nYou can also reply to their message.`;
    if (!['add', 'del', 'remove', 'list'].includes(sub)) return reply(usage);

    const owner = message.key.fromMe || await isOwnerOnly(senderJid, sock, chatId);

    if (sub === 'list') {
        if (!owner && !(await isOwnerOrSudo(senderJid, sock, chatId))) return reply('❌ Only the owner and sudo users can see this list.');
        const list = await getSudoList();
        const numbers = [...new Set(list.filter(j => String(j).endsWith('@s.whatsapp.net')).map(digitsOf))];
        const linked = list.filter(j => String(j).endsWith('@lid')).length;
        if (!numbers.length && !linked) return reply(`${title('SUDO USERS')}No sudo users yet.\nAdd one with *.sudo add <number>*`);
        return reply(`${title('SUDO USERS')}${numbers.map((n, i) => `${i + 1}. +${n}`).join('\n')}${linked ? `\n\n🔗 ${linked} linked hidden ID${linked > 1 ? 's' : ''}` : ''}`);
    }

    // only the real owner can change the list (a sudo user can not add or remove other sudo users)
    if (!owner) return reply('❌ Only the bot owner can add or remove sudo users. Use *.sudo list* to view.');

    const target = parseTarget(message, args.slice(1).join(' '));
    if (target.error === 'empty') return reply(usage);
    if (target.error === 'local') return reply('❌ Please use the full number with country code, e.g. *2349137495210*.');
    if (target.error === 'invalid') return reply('❌ That does not look like a valid phone number. Tag the person or reply to their message instead.');

    const ids = await resolveIds(sock, chatId, target.jid);
    const shown = ids.pn ? `+${digitsOf(ids.pn)}` : 'that user';

    if (sub === 'add') {
        const forms = [ids.pn, ids.lid].filter(Boolean);
        if (!forms.length) forms.push(target.jid);
        let ok = true;
        for (const f of forms) ok = (await addSudo(f)) && ok;
        return reply(ok ? `${title('SUDO ADDED')}✅ ${shown} now has sudo access.${ids.lid ? '\n🔗 Their hidden ID is linked too.' : ''}` : '❌ Could not save the sudo user. Please try again.');
    }

    // del / remove
    const ownerDigits = digitsOf(settings.ownerNumber);
    if (ids.digits.includes(ownerDigits)) return reply('❌ The owner cannot be removed.');
    const list = await getSudoList();
    const toRemove = list.filter(j => ids.digits.includes(digitsOf(j)));
    if (!toRemove.length) return reply(`ℹ️ ${shown} is not a sudo user.`);
    let ok = true;
    for (const j of toRemove) ok = (await removeSudo(j)) && ok;
    return reply(ok ? `${title('SUDO REMOVED')}✅ ${shown} no longer has sudo access.` : '❌ Could not remove the sudo user. Please try again.');
}

module.exports = sudoCommand;
