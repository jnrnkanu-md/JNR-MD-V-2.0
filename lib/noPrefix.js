/**
 * "No prefix" mode for the OWNER only.
 * When it is on, the owner can type  menu  or  kick @user  without the dot. Everyone else still needs the prefix.
 * Only a message whose FIRST WORD is a real bot command is changed, so normal chatting is not affected.
 */
const fs = require('fs');
const path = require('path');
const settings = require('../settings');
const FILE = path.join(__dirname, '../data/noprefix.json');

let state = null;
const load = () => {
    if (state) return state;
    try { state = { on: false, ...JSON.parse(fs.readFileSync(FILE, 'utf8') || '{}') }; } catch { state = { on: false }; }
    return state;
};
const isOn = () => !!load().on;
function set(on) {
    load().on = !!on;
    try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(state)); } catch (e) { console.error('noprefix save:', e.message); }
}

// every command name the bot knows (read from the menus and the command files)
let names = null;
function commandNames() {
    if (names) return names;
    names = new Set();
    try {
        const help = fs.readFileSync(path.join(__dirname, '../commands/help.js'), 'utf8');
        for (const m of help.matchAll(/(?:^|[\s'"(/,])\.([a-z][a-z0-9]{1,24})\b/gi)) names.add(m[1].toLowerCase());
    } catch { /* menu is optional */ }
    try {
        for (const f of fs.readdirSync(path.join(__dirname, '../commands'))) if (f.endsWith('.js')) names.add(f.slice(0, -3).toLowerCase());
    } catch { /* optional */ }
    ['menu', 'help', 'ping', 'alive', 'stt', 'gcstatus', 'togcstatus', 'pin', 'pinterest', 'agent', 'antigcstatus', 'noprefix'].forEach(n => names.add(n));
    return names;
}

// Rewrites the message text in place when it should be treated as a command. Returns true when it did.
function apply(message) {
    try {
        if (!isOn()) return false;
        let m = message.message;
        for (let i = 0; i < 3 && m; i++) { const inner = m.ephemeralMessage?.message || m.viewOnceMessage?.message; if (!inner) break; m = inner; }
        if (!m) return false;
        const holder = m.conversation !== undefined ? ['conversation']
            : m.extendedTextMessage?.text !== undefined ? ['extendedTextMessage', 'text']
            : m.imageMessage?.caption ? ['imageMessage', 'caption']
            : m.videoMessage?.caption ? ['videoMessage', 'caption'] : null;
        if (!holder) return false;
        const text = holder.length === 1 ? m[holder[0]] : m[holder[0]][holder[1]];
        if (typeof text !== 'string') return false;
        const prefix = global.prefix || settings.prefix || '.';
        const t = text.trimStart();
        if (!t || t.startsWith(prefix)) return false;
        const first = t.split(/\s+/)[0].toLowerCase();
        if (!commandNames().has(first)) return false;
        const out = prefix + t;
        console.log(`🔤 No-prefix: "${first}" run as ${prefix}${first}`);
        if (holder.length === 1) m[holder[0]] = out; else m[holder[0]][holder[1]] = out;
        return true;
    } catch (e) { console.error('noprefix error:', e.message); return false; }
}

const info = () => ({ on: isOn(), prefix: global.prefix || settings.prefix || '.', known: commandNames().size, menuOk: commandNames().has('menu') });

module.exports = { isOn, set, apply, info };
