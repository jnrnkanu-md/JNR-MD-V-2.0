const settings = require('../settings');
const { isSudo, getSudoList } = require('./index');

// True only for the real owner (the number in settings.js, or the bot's own account)
async function isOwnerOnly(senderId, sock = null, chatId = null) {
    const ownerJid = settings.ownerNumber + "@s.whatsapp.net";
    const ownerNumberClean = settings.ownerNumber.split(':')[0].split('@')[0];
    
    // Direct JID match
    if (senderId === ownerJid) {
        return true;
    }
    
    // Extract sender's numeric parts
    const senderIdClean = senderId.split(':')[0].split('@')[0];
    const senderLidNumeric = senderId.includes('@lid') ? senderId.split('@')[0].split(':')[0] : '';
    
    // Check if sender's phone number matches owner number
    if (senderIdClean === ownerNumberClean) {
        return true;
    }
    
    // In groups, check if sender's LID matches bot's LID (owner uses same account as bot)
    if (sock && chatId && chatId.endsWith('@g.us') && senderId.includes('@lid')) {
        try {
            // Get bot's LID numeric
            const botLid = sock.user?.lid || '';
            const botLidNumeric = botLid.includes(':') ? botLid.split(':')[0] : (botLid.includes('@') ? botLid.split('@')[0] : botLid);
            
            // Check if sender's LID numeric matches bot's LID numeric
            if (senderLidNumeric && botLidNumeric && senderLidNumeric === botLidNumeric) {
                return true;
            }
            
            // Also check participant data for additional matching
            const metadata = await sock.groupMetadata(chatId);
            const participants = metadata.participants || [];
            
            const participant = participants.find(p => {
                const pLid = p.lid || '';
                const pLidNumeric = pLid.includes(':') ? pLid.split(':')[0] : (pLid.includes('@') ? pLid.split('@')[0] : pLid);
                const pId = p.id || '';
                const pIdClean = pId.split(':')[0].split('@')[0];
                
                return (
                    p.lid === senderId || 
                    p.id === senderId ||
                    pLidNumeric === senderLidNumeric ||
                    pIdClean === senderIdClean ||
                    pIdClean === ownerNumberClean
                );
            });
            
            if (participant) {
                const participantId = participant.id || '';
                const participantLid = participant.lid || '';
                const participantIdClean = participantId.split(':')[0].split('@')[0];
                const participantLidNumeric = participantLid.includes(':') ? participantLid.split(':')[0] : (participantLid.includes('@') ? participantLid.split('@')[0] : participantLid);
                
                if (participantId === ownerJid || 
                    participantIdClean === ownerNumberClean ||
                    participantLidNumeric === botLidNumeric) {
                    return true;
                }
            }
        } catch (e) {
            console.error('❌ [isOwner] Error checking participant data:', e);
        }
    }
    
    // Check if sender ID contains owner number (fallback)
    if (senderId.includes(ownerNumberClean)) {
        return true;
    }
    
    return false;
}

const digitsOf = (jid) => (jid ? String(jid).split('@')[0].split(':')[0].replace(/\D/g, '') : '');

// Every form (phone number and LID) we can find for one person
async function resolveIds(sock, chatId, jid) {
    const j = String(jid || '');
    let pn = j.endsWith('@s.whatsapp.net') ? `${digitsOf(j)}@s.whatsapp.net` : null;
    let lid = j.endsWith('@lid') ? `${digitsOf(j)}@lid` : null;
    const map = sock?.signalRepository?.lidMapping;
    try { if (lid && !pn && map?.getPNForLID) { const r = await map.getPNForLID(lid); if (r) pn = `${digitsOf(r)}@s.whatsapp.net`; } } catch { /* optional */ }
    try { if (pn && !lid && map?.getLIDForPN) { const r = await map.getLIDForPN(pn); if (r) lid = `${digitsOf(r)}@lid`; } } catch { /* optional */ }
    if (chatId && chatId.endsWith('@g.us') && sock?.groupMetadata) {
        try {
            const md = await sock.groupMetadata(chatId);
            const known = new Set([digitsOf(j), digitsOf(pn), digitsOf(lid)].filter(Boolean));
            for (const p of md.participants || []) {
                const pids = [p.id, p.lid, p.phoneNumber, p.jid].filter(Boolean);
                if (pids.some(i => known.has(digitsOf(i)))) {
                    pn = pn || (pids.find(i => String(i).endsWith('@s.whatsapp.net')) ? `${digitsOf(pids.find(i => String(i).endsWith('@s.whatsapp.net')))}@s.whatsapp.net` : null);
                    lid = lid || (pids.find(i => String(i).endsWith('@lid')) ? `${digitsOf(pids.find(i => String(i).endsWith('@lid')))}@lid` : null);
                }
            }
        } catch { /* group list is optional */ }
    }
    return { pn, lid, digits: [digitsOf(pn), digitsOf(lid), digitsOf(j)].filter((d, i, a) => d && a.indexOf(d) === i) };
}

// Is this person on the sudo list? Compares numbers, whichever form (phone number / LID) the sender shows up as
async function sudoMatch(senderId, sock, chatId) {
    const list = await getSudoList();
    if (!list.length) return false;
    const saved = new Set(list.map(digitsOf));
    const r = await resolveIds(sock, chatId, senderId);
    return r.digits.some(d => saved.has(d));
}

async function isOwnerOrSudo(senderId, sock = null, chatId = null) {
    if (await isOwnerOnly(senderId, sock, chatId)) return true;
    try {
        return await sudoMatch(senderId, sock, chatId);
    } catch (e) {
        console.error('❌ [isOwner] Error checking sudo:', e);
        return false;
    }
}

module.exports = isOwnerOrSudo;
module.exports.isOwnerOnly = isOwnerOnly;
module.exports.resolveIds = resolveIds;
