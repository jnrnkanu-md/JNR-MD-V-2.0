/**
 * JNR-MD text styling (clear bold fonts that are easy to read).
 *   bold("JNR-MD V-2.0")   -> 𝗝𝗡𝗥-𝗠𝗗 𝗩-𝟮.𝟬        (bold)
 *   boldItalic("Powered")  -> 𝙋𝙤𝙬𝙚𝙧𝙚𝙙               (bold, slightly slanted)
 * Emojis, spaces and symbols are left untouched.
 */
const settings = require('../settings');

const SANS_BOLD_UP = 0x1D5D4;      // 𝗔
const SANS_BOLD_LOW = 0x1D5EE;     // 𝗮
const SANS_BOLD_DIGIT = 0x1D7EC;   // 𝟬
const SANS_BI_UP = 0x1D63C;        // 𝘼
const SANS_BI_LOW = 0x1D656;       // 𝙖

function convert(text, up, low, digit) {
    let out = '';
    for (const ch of String(text)) {
        const c = ch.codePointAt(0);
        if (c >= 65 && c <= 90) out += String.fromCodePoint(up + (c - 65));
        else if (c >= 97 && c <= 122) out += String.fromCodePoint(low + (c - 97));
        else if (c >= 48 && c <= 57) out += String.fromCodePoint(digit + (c - 48));
        else out += ch;
    }
    return out;
}

const bold = (t) => convert(t, SANS_BOLD_UP, SANS_BOLD_LOW, SANS_BOLD_DIGIT);
const boldItalic = (t) => convert(t, SANS_BI_UP, SANS_BI_LOW, SANS_BOLD_DIGIT);

module.exports = {
    fancy: bold,                 // kept for older code
    bold,
    boldItalic,
    // "🫧 𝗝𝗡𝗥-𝗠𝗗 𝗩-𝟮.𝟬🔥"  (follows settings.botName)
    get title() { return bold(settings.botName || 'JNR-MD'); },
    // "𝙋𝙤𝙬𝙚𝙧𝙚𝙙 𝙗𝙮 𝙅𝙣𝙧 𝙉𝙠𝙖𝙣𝙪 𝘾𝙤𝙣𝙘𝙚𝙥𝙩𝙨"
    get powered() { return boldItalic('Powered by Jnr Nkanu Concepts'); }
};
