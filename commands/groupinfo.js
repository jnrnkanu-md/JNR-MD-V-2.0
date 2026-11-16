const style = require('../lib/style');

/**
 * .groupinfo / .infogp : the group's picture with its description and the important details.
 * Nobody is tagged, so no one gets a notification.
 */
const num = (j) => String(j || '').split('@')[0].split(':')[0];

async function groupInfoCommand(sock, chatId, msg) {
    try {
        if (!chatId.endsWith('@g.us')) {
            return await sock.sendMessage(chatId, { text: '❌ This command works in groups only.' }, { quoted: msg });
        }
        const md = await sock.groupMetadata(chatId);
        const people = md.participants || [];
        const admins = people.filter(p => p.admin);

        // owner: shown as a plain number (when WhatsApp gives a phone number)
        const ownerRaw = md.ownerPn || md.owner || admins.find(p => p.admin === 'superadmin')?.phoneNumber || admins.find(p => p.admin === 'superadmin')?.id || '';
        const ownerShown = ownerRaw && !String(ownerRaw).endsWith('@lid') ? `+${num(ownerRaw)}` : '';

        const created = md.creation ? new Date(Number(md.creation) * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
        const desc = String(md.desc || '').trim();

        // invite link: WhatsApp only gives it to a group admin, so the bot must be an admin
        let link = '';
        try { const code = await sock.groupInviteCode(chatId); if (code) link = `https://chat.whatsapp.com/${code}`; } catch { /* bot is not an admin */ }

        const lines = [
            `👥 ${style.bold('GROUP INFO')}`,
            '━━━━━━━━━━━━━━━━━━',
            `*Name:* ${md.subject}`,
            `*Members:* ${people.length}`,
            `*Admins:* ${admins.length}`,
            ...(ownerShown ? [`*Created by:* ${ownerShown}`] : []),
            ...(created ? [`*Created:* ${created}`] : []),
            `*Who can send messages:* ${md.announce ? 'Admins only 🔒' : 'Everyone'}`,
            `*Who can edit group info:* ${md.restrict ? 'Admins only' : 'Everyone'}`,
            ...(md.joinApprovalMode ? ['*Join approval:* On'] : []),
            `🖇️ *Group link:* ${link || 'not available (make the bot an admin to show it)'}`,
            '',
            `📌 ${style.bold('DESCRIPTION')}`,
            desc || 'No description'
        ];
        const caption = lines.join('\n').slice(0, 3500);

        let pp = null;
        try { pp = await sock.profilePictureUrl(chatId, 'image'); } catch { /* group has no picture */ }

        if (pp) await sock.sendMessage(chatId, { image: { url: pp }, caption }, { quoted: msg });
        else await sock.sendMessage(chatId, { text: caption }, { quoted: msg });
    } catch (error) {
        console.error('Error in groupinfo command:', error);
        await sock.sendMessage(chatId, { text: '❌ Could not get the group info right now. Please try again.' }, { quoted: msg });
    }
}

module.exports = groupInfoCommand;
