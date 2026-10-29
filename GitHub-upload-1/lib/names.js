/**
 * Remembers the WhatsApp display names (pushName) of people the bot sees,
 * so .vcf can label contacts with real names. Saved in data/contactNames.json.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '../data/contactNames.json');
let names = null;
let timer = null;

function load() {
    if (names) return names;
    try { names = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8') || '{}') : {}; } catch { names = {}; }
    return names;
}
function saveSoon() {
    if (timer) return;
    timer = setTimeout(() => {
        timer = null;
        try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(load())); } catch { /* ignore */ }
    }, 10000);
    if (timer.unref) timer.unref();
}

const digits = (jid) => (jid ? String(jid).split('@')[0].split(':')[0].replace(/\D/g, '') : '');

// ids: every id we know for that person (phone jid, lid ...)
function remember(ids, name) {
    const clean = String(name || '').replace(/[\r\n]+/g, ' ').trim();
    if (!clean || clean.length > 60) return;
    const data = load();
    let changed = false;
    for (const id of ids) {
        const d = digits(id);
        if (d && data[d] !== clean) { data[d] = clean; changed = true; }
    }
    if (changed) saveSoon();
}

// Called for every incoming message
function rememberFromMessage(message) {
    if (!message || message.key?.fromMe || !message.pushName) return;
    remember([message.key.participant, message.key.participantAlt, message.key.remoteJid, message.key.remoteJidAlt], message.pushName);
}

function lookup(ids) {
    const data = load();
    for (const id of ids) {
        const d = digits(id);
        if (d && data[d]) return data[d];
    }
    return null;
}

module.exports = { remember, rememberFromMessage, lookup, digits };
