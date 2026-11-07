const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '../data/antigcstatus.json');

function read() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } }
function write(d) {
    try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(d, null, 2)); } catch (e) { console.error('antigcstatus save:', e.message); }
}
const isOn = (gid) => !!read()[gid];
function set(gid, on) { const d = read(); if (on) d[gid] = true; else delete d[gid]; write(d); }

// true when this message is a WhatsApp Group Status post
function isGroupStatus(message) {
    let m = message;
    for (let i = 0; i < 3 && m; i++) {
        if (m.groupStatusMessageV2 || m.groupStatusMessage) return true;
        m = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || null;
    }
    return false;
}

// Called for every incoming message. Deletes group status posts in groups where it is switched on.
async function handle(sock, mek) {
    try {
        const gid = mek?.key?.remoteJid;
        if (!gid || !gid.endsWith('@g.us') || mek.key.fromMe) return;
        if (!isGroupStatus(mek.message) || !isOn(gid)) return;

        const sender = mek.key.participant || mek.participant;
        const isAdmin = require('./isAdmin');
        const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, gid, sender);
        if (isSenderAdmin) return;                     // group admins may post
        try { if (await require('./isOwner')(sender, sock, gid)) return; } catch {}
        if (!isBotAdmin) return;                       // the bot cannot delete without admin rights

        await sock.sendMessage(gid, { delete: mek.key });
        await sock.sendMessage(gid, {
            text: `🚫 @${String(sender).split('@')[0].split(':')[0]}, group status posts are not allowed in this group.`,
            mentions: [sender]
        });
    } catch (e) { console.error('antigcstatus:', e.message); }
}

module.exports = { isOn, set, isGroupStatus, handle };
