/**
 * JNR-MD - get someone's profile picture
 *   .getpp @user          tag the person
 *   .getpp (reply)        reply to one of their messages
 *   .getpp 2349137495210  or type their number
 *   .getpp                your own picture (in a private chat: the other person's)
 * The picture is sent with a tag of that person.
 */
const digitsOf = (jid) => (jid ? String(jid).split('@')[0].split(':')[0].replace(/\D/g, '') : '');

async function getppCommand(sock, chatId, message) {
    try {
        const sender = message.key.participant || message.key.remoteJid;
        const isGroup = chatId.endsWith('@g.us');
        const ctx = message.message?.extendedTextMessage?.contextInfo
            || message.message?.imageMessage?.contextInfo;
        const text = message.message?.conversation || message.message?.extendedTextMessage?.text ||
                     message.message?.imageMessage?.caption || '';
        const typed = text.trim().replace(/^\S+/, '').replace(/@/g, '').replace(/\D/g, '');

        // Who? mentioned person > replied-to person > typed number > yourself / the other person in a private chat
        let target = (ctx?.mentionedJid && ctx.mentionedJid[0]) || ctx?.participant || null;
        if (!target && typed.length >= 7 && typed.length <= 15) target = `${typed}@s.whatsapp.net`;
        if (!target) target = isGroup ? sender : chatId;   // group: you / private chat: the other person
        if (!target || target === 'status@broadcast') return;

        // Find every id we know for this person (phone number and/or LID) from the group list
        const ids = [target];
        let pnJid = String(target).endsWith('@s.whatsapp.net') ? target : null;
        if (isGroup) {
            try {
                const meta = await sock.groupMetadata(chatId);
                const known = digitsOf(target);
                for (const p of meta.participants || []) {
                    const pids = [p.id, p.lid, p.phoneNumber, p.jid].filter(Boolean);
                    if (pids.some(i => digitsOf(i) === known)) {
                        ids.push(...pids);
                        pnJid = pnJid || pids.find(i => String(i).endsWith('@s.whatsapp.net')) || null;
                    }
                }
            } catch { /* group list is optional */ }
        }
        const mentionJid = pnJid ? `${digitsOf(pnJid)}@s.whatsapp.net` : target;
        const tag = `@${digitsOf(mentionJid)}`;

        await sock.sendMessage(chatId, { react: { text: '📸', key: message.key } });

        let picture = null;
        for (const jid of [...new Set(ids)]) {
            try { picture = await sock.profilePictureUrl(jid, 'image'); if (picture) break; } catch { /* hidden or none */ }
        }

        if (!picture) {
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return await sock.sendMessage(chatId, {
                text: `❌ ${tag} has no profile picture, or it is hidden by their privacy settings.`,
                mentions: [mentionJid]
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, {
            image: { url: picture },
            caption: `📸 *Profile picture of* ${tag}`,
            mentions: [mentionJid]
        }, { quoted: message });
        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
    } catch (error) {
        console.error('Error in getpp command:', error);
        await sock.sendMessage(chatId, { text: '❌ Could not get the profile picture. Please try again.' }, { quoted: message });
    }
}

module.exports = getppCommand;
