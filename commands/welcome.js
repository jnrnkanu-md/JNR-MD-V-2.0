const { handleWelcome } = require('../lib/welcome');
const { isWelcomeOn, getWelcome, DEFAULT_WELCOME } = require('../lib/index');
const { isVerificationEnabled } = require('./verification');

const VERIFY_LINE = '🔐 *Verification is ON.* Ask an admin to verify you before you can post.';

async function welcomeCommand(sock, chatId, message, match) {
    if (!chatId.endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: 'This command can only be used in groups.' });
        return;
    }

    const text = message.message?.conversation ||
                 message.message?.extendedTextMessage?.text || '';
    const matchText = text.split(' ').slice(1).join(' ');

    // .welcome preview -> shows the welcome exactly as a new member would see it
    if (matchText.trim().toLowerCase() === 'preview') {
        const sender = message.key.participant || message.key.remoteJid;
        const metadata = await sock.groupMetadata(chatId);
        const template = (await getWelcome(chatId)) || DEFAULT_WELCOME;
        await sendWelcomeFor(sock, chatId, metadata, sender, template);
        return;
    }

    await handleWelcome(sock, chatId, message, matchText);
}

// Replace {variables} without treating "$" in the values specially
function fill(template, vars) {
    return template.replace(/\{(user|group|description|count|verify)\}/gi, (_, key) => vars[key.toLowerCase()] ?? '');
}

async function getProfilePicture(sock, jids) {
    for (const jid of jids.filter(Boolean)) {
        try {
            const url = await sock.profilePictureUrl(jid, 'image');
            if (url) return url;
        } catch { /* no picture / hidden by privacy settings */ }
    }
    return null;
}

const digitsOf = (jid) => (jid ? String(jid).split('@')[0].split(':')[0].replace(/\D/g, '') : '');

// Works out the best way to tag the new member: a real phone-number tag when we know the number
// (it shows as a proper clickable tag), otherwise the LID the group uses for that person.
function resolveMember(participant, metadata) {
    const own = typeof participant === 'string' ? { id: participant } : (participant || {});
    const ids = [own.id, own.lid, own.phoneNumber, own.jid].filter(Boolean);
    const known = new Set(ids.map(digitsOf));
    let pnJid = ids.find(i => String(i).endsWith('@s.whatsapp.net')) || null;
    let lidJid = ids.find(i => String(i).endsWith('@lid')) || null;
    for (const p of metadata.participants || []) {
        const pids = [p.id, p.lid, p.phoneNumber, p.jid].filter(Boolean);
        if (pids.some(i => known.has(digitsOf(i)))) {
            pnJid = pnJid || pids.find(i => String(i).endsWith('@s.whatsapp.net')) || null;
            lidJid = lidJid || pids.find(i => String(i).endsWith('@lid')) || null;
        }
    }
    const mentionJid = pnJid ? `${digitsOf(pnJid)}@s.whatsapp.net` : (lidJid || ids[0]);
    return { mentionJid, number: digitsOf(mentionJid), picJids: [pnJid, lidJid, ids[0]] };
}

// Builds the welcome for ONE member: profile picture + caption that tags them
// (a normal message: no forwarded / newsletter label)
async function sendWelcomeFor(sock, groupId, groupMetadata, participant, template) {
    const member = resolveMember(participant, groupMetadata);
    const groupName = groupMetadata.subject || 'the group';
    let description = (groupMetadata.desc || '').toString().trim();
    if (description.length > 300) description = description.slice(0, 297) + '...';

    const verifyOn = isVerificationEnabled(groupId);
    let caption = fill(template, {
        user: `@${member.number}`,
        group: groupName,
        description,
        count: String(groupMetadata.participants?.length || ''),
        verify: verifyOn ? VERIFY_LINE : ''
    });
    // A custom message without {user} would not tag anyone: always tag the new member
    if (!/\{user\}/i.test(template)) caption = `👋 @${member.number}\n\n${caption}`;
    // Tell new members how to get verified, unless the template already places {verify} itself
    if (verifyOn && !/\{verify\}/i.test(template)) caption += `\n\n${VERIFY_LINE}`;
    // Group has no description: drop the empty "About us" heading from the default message
    if (!description) caption = caption.replace(/📜 \*About us\*\n*/, '');
    caption = caption.replace(/\n{3,}/g, '\n\n').trim();

    const picture = await getProfilePicture(sock, member.picJids);

    if (picture) {
        try {
            await sock.sendMessage(groupId, { image: { url: picture }, caption, mentions: [member.mentionJid] });
            return;
        } catch (err) {
            console.log('Welcome picture failed, sending text instead:', err.message);
        }
    }
    // No profile picture (or it could not be sent): text-only welcome that still tags them
    await sock.sendMessage(groupId, { text: caption, mentions: [member.mentionJid] });
}

async function handleJoinEvent(sock, id, participants) {
    const isWelcomeEnabled = await isWelcomeOn(id);
    if (!isWelcomeEnabled) return;

    const template = (await getWelcome(id)) || DEFAULT_WELCOME;
    const groupMetadata = await sock.groupMetadata(id);

    for (const participant of participants) {
        try {
            await sendWelcomeFor(sock, id, groupMetadata, participant, template);
        } catch (error) {
            console.error('Error sending welcome message:', error);
        }
    }
}

module.exports = { welcomeCommand, handleJoinEvent };
