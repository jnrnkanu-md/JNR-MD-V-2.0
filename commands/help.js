const settings = require('../settings');
const { channelInfo } = require('../lib/messageConfig');
const style = require('../lib/style');

/**
 * JNR-MD menu system
 *   .menu                     -> welcome card + list of all menus
 *   .group menu  (.groupmenu) -> every command of that menu, one per line
 *   .allmenu                  -> every menu and command
 * Every command line is kept short so it never wraps onto a second line.
 */

const P = () => settings.prefix || '.';

// Image sent first (welcome card) and image sent with the menu
const BIO_IMAGE = 'https://i.ibb.co/zhHLZvLd/file-000000009eac8210991b316753689ea6.png';
const MENU_IMAGE = 'https://i.ibb.co/Cp8z1d1K/file-00000000b6548210908fa79ad2258763.png';

const MENUS = {
    general: {
        icon: '📚', names: ['general', 'main', 'basic'],
        boxes: [{ title: '📚 GENERAL', lines: [
            '.menu / .help / .bot / .list', '.ping', '.alive', '.owner', '.jid', '.url / .tourl', '.vcf',
            '.tts <text>', '.trt <text> <lang>', '.weather <city>', '.news', '.google <question>',
            '.lyrics <song>', '.shazam / .findsong', '.apk <app name>', '.subtt / .subtitle', '.ss / .screenshot <url>',
            '.joke', '.quote', '.fact', '.8ball <question>', '.shayari', '.roseday', '.goodnight / .gn',
            '.groupinfo / .infogp', '.getpp @user', '.stt (reply to a VN)', '.stt auto on / off', '.staff / .admins', '.topmembers', '.vv', '.vv2',
            '.newsletter / .nl <link>', '.git / .github', '.sc / .script / .repo'
        ] }]
    },
    group: {
        icon: '🛡️', names: ['group', 'groups', 'groupadmin'],
        boxes: [
            { title: '🛡️ GROUP ADMIN', lines: [
                '.ban @user', '.unban @user', '.kick @user', '.warn @user', '.warnings @user', '.mute <minutes>', '.unmute',
                '.promote @user', '.demote @user', '.delete / .del', '.clear', '.tag', '.tagall (everyone)', '.tagnotadmin',
                '.hidetag <text>', '.chatbot', '.antilink', '.antibadword', '.antitag', '.resetlink / .revoke',
                '.setgname <name>', '.setgdesc <text>', '.setgpp'
            ] },
            { title: '👋 WELCOME', lines: [
                '.welcome on / off', '.welcome set <message>', '.welcome reset', '.welcome preview', '.goodbye'
            ] },
            { title: '🛡️ SAFETY SCAN', lines: [
                '.safety on / off', '.safety status', '.safety level strict/normal', '.safety links on/off',
                '.safety images on/off', '.safety models', '.safety allow <domain>', '.safety remove <domain>', '.safety list',
                '.safety check / .scan'
            ] },
            { title: '🔐 VERIFICATION', lines: [
                '.verification on / off', '.verification status', '.verify <number>', '.unverify <number>', '.verified'
            ] }
        ]
    },
    admin: {
        icon: '👑', names: ['admin', 'admins', 'owner', 'owners'],
        boxes: [
            { title: '👑 ADMIN (OWNER)', lines: [
                '.mode <public/private>', '.settings', '.update', '.sudo', '.setprefix', '.setbotname', '.setprofilename',
                '.setmenuimage', '.setpp', '.clearsession', '.cleartmp', '.antidelete', '.antiviewonce',
                '.autoreact / .areact', '.autostatus', '.autostatus react', '.autotyping', '.autoread', '.anticall',
                '.pmblocker', '.mention', '.setmention', '.adminalert <on/off>', '.tostatus', '.dltest'
            ] },
            { title: '🌙 AWAY MODE', lines: [
                '.away on [message]', '.away off', '.away status', '.away style on/off', '.away message <text>',
                '.away allow <number>', '.away remove <number>', '.away everyone', '.away list'
            ] },
            { title: '🧠 MY STYLE', lines: [
                '.mystyle about <text>', '.mystyle show', '.mystyle learn on/off', '.mystyle clear'
            ] }
        ]
    },
    ai: {
        icon: '🤖', names: ['ai', 'ais', 'agent'],
        boxes: [
            { title: '🤖 AI TOOLS', lines: [
                '.ai <question>', '.ask <question>', '.gpt <question>', '.chatgpt <question>', '.gemini <question>',
                '.llama <question>', '.groq <question>', '.imagine <prompt>', '.flux <prompt>', '.dalle <prompt>', '.sora <prompt>'
            ] },
            { title: '🧑‍💼 CHAT AGENT', lines: [
                '.agent (setup guide)', '.agent on / off', '.agent all on / off', '.agent business <name>',
                '.agent name <name>', '.agent about <text>', '.agent tone <text>', '.agent teach <text>',
                '.agent faq <q> | <a>', '.agent greeting <text>', '.agent role <text>', '.agent show',
                '.agent forget fact/faq <no>', '.agent clear facts/faqs', '.agent reset'
            ] }
        ]
    },
    download: {
        icon: '📥', names: ['download', 'downloads', 'downloader', 'dl'],
        boxes: [{ title: '📥 DOWNLOADER', lines: [
            '.play <song name>', '.song <song name>', '.mp3 <song name>', '.ytmp3 <link>', '.music <song name>',
            '.spotify <query>', '.video <name/link>', '.yt <name/link>', '.ytmp4 <link>',
            '.tiktok / .tt <link>', '.instagram / .ig <link>', '.igs <link>', '.igsc <link>',
            '.facebook / .fb <link>', '.x / .twitter <link>', '.animedl / .adl <name>'
        ] }]
    },
    sticker: {
        icon: '🖼️', names: ['sticker', 'stickers', 'image', 'images', 'img'],
        boxes: [{ title: '🖼️ IMAGE & STICKER', lines: [
            '.sticker / .s', '.attp <text>', '.simage', '.crop', '.blur', '.removebg / .rmbg',
            '.remini / .enhance', '.tgsticker / .tg', '.take <pack>', '.emojimix <e1>+<e2>', '.meme'
        ] }]
    },
    text: {
        icon: '🔤', names: ['text', 'texts', 'textmaker', 'logo', 'logos'],
        boxes: [{ title: '🔤 TEXT EFFECTS', lines: [
            '(use: .effect <text>)', '.metallic', '.ice', '.snow', '.neon', '.impressive', '.matrix', '.light', '.devil',
            '.purple', '.thunder', '.leaves', '.1917', '.arena', '.hacker', '.sand', '.blackpink', '.glitch', '.fire'
        ] }]
    },
    game: {
        icon: '🎮', names: ['game', 'games'],
        boxes: [{ title: '🎮 GAMES', lines: [
            '.tictactoe / .ttt', '.move <number>', '.surrender', '.hangman', '.guess <letter>',
            '.trivia', '.answer <answer>', '.truth', '.dare'
        ] }]
    },
    fun: {
        icon: '🎨', names: ['fun', 'funny', 'effects', 'photo'],
        boxes: [
            { title: '💞 SOCIAL FUN', lines: [
                '.compliment @user', '.insult @user', '.flirt', '.ship @user', '.simp @user', '.stupid @user', '.character @user', '.waste @user'
            ] },
            { title: '🎨 PHOTO EFFECTS', lines: [
                '.heart', '.horny', '.circle', '.lgbt', '.lolice', '.simpcard', '.tonikawa',
                '.its-so-stupid / .iss', '.namecard', '.oogway', '.oogway2', '.tweet', '.ytcomment',
                '.comrade', '.gay', '.glass', '.jail', '.passed', '.triggered'
            ] },
            { title: '🌍 PIES', lines: [
                '.pies <country>', '.china', '.indonesia', '.japan', '.korea', '.india', '.malaysia', '.thailand'
            ] }
        ]
    },
    anime: {
        icon: '🎌', names: ['anime', 'animes'],
        boxes: [{ title: '🎌 ANIME', lines: [
            '.anime', '.animuquote', '.nom', '.poke', '.cry', '.kiss', '.pat', '.hug', '.wink', '.facepalm'
        ] }]
    },
    adult: {
        icon: '🔞', names: ['adult', 'adults', '18', 'nsfw', 'xxx'],
        boxes: [{ title: '🔞 ADULT · 18+ ONLY', lines: [
            '.xvideos / .xv <query>', '.xvdl / .xselect <number>', '.leaktapes / .lt', '.darknaija / .dn',
            '.nacknaija / .nn', '.naijacum / .nc', '.naijaceleb / .ncl', '.stellaplus / .sp', '.totoleak / .tl'
        ] }]
    }
};

// Order shown in the menu list
const MENU_ORDER = ['general', 'group', 'admin', 'ai', 'download', 'sticker', 'text', 'game', 'fun', 'anime', 'adult'];
const ALIAS = { all: 'all', full: 'all', everything: 'all' };
for (const key of MENU_ORDER) for (const n of MENUS[key].names) ALIAS[n] = key;

/**
 * Works out which menu a message asks for.
 * Accepts: ".group menu", ".groupmenu", ".group menue", ".menu group", ".allmenu"
 * Returns a menu key, or null when the text is not a sub-menu request (plain ".menu" returns null).
 */
function matchMenuKey(text, prefix = P()) {
    const t = String(text || '').trim().toLowerCase();
    if (!t.startsWith(prefix)) return null;
    const body = t.slice(prefix.length).trim();
    let m = body.match(/^([a-z0-9]+?)\s*menue?$/);
    if (m && ALIAS[m[1]]) return ALIAS[m[1]];
    m = body.match(/^menue?\s+([a-z0-9]+)$/);
    if (m && ALIAS[m[1]]) return ALIAS[m[1]];
    return null;
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const botName = () => settings.botName || 'JNR-MD';
const owner = () => settings.botOwner || 'JNR NKANU';

function uptimeText() {
    const s = Math.floor(process.uptime());
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return `${d ? d + 'd ' : ''}${h ? h + 'h ' : ''}${m}m`;
}

// Name first, "Powered by" second, then a divider
function header() {
    return `${style.title}\n${style.powered}\n━━━━━━━━━━━━━━━━━━`;
}

function box(title, lines) {
    return `╭━〔 ${title} 〕━⬣\n${lines.map(l => `┃➤ ${l.replace(/^\./, P())}`).join('\n')}\n╰━━━━━━━━━━━━⬣`;
}

// First message of .menu: welcome card (sent with the first image)
function welcomeCardText(userName) {
    return `${header()}

👋 ${style.bold('Welcome')}, ${userName || 'friend'}!

${box(`🤖 ${style.bold('BOT INFO')}`, [
        `📦 Version : ${settings.version}`,
        `👑 Owner : ${owner()}`,
        `⚡ Prefix : ${P()}`,
        `🟢 Status : Online`,
        `⏱️ Uptime : ${uptimeText()}`,
        `📂 Menus : ${MENU_ORDER.length}`
    ])}

✨ ${style.boldItalic('Loading your menu...')}`;
}

function mainMenuText(userName) {
    const list = [...MENU_ORDER.map(k => `${P()}${MENUS[k].names[0]} menu`), `${P()}allmenu`];
    return `${header()}

👤 *User:* ${userName || 'User'}
📦 *Version:* ${settings.version}
👑 *Owner:* ${owner()}
⚡ *Prefix:* ${P()}

${box(`📂 ${style.bold('MENU LIST')}`, list)}

💡 Send any menu above
    to see its commands.
Example: *${P()}group menu*

${box(`💻 ${style.bold('DEVELOPER')}`, ['Nkanu Onnoghen Nkanu', '+2349137495210', 'IG: Jnr Nkanu Concepts'])}`;
}

function subMenuText(key) {
    const menu = MENUS[key];
    const boxes = menu.boxes.map(b => box(`${b.title.split(' ')[0]} ${style.bold(b.title.split(' ').slice(1).join(' '))}`, b.lines)).join('\n\n');
    return `${header()}

${boxes}

↩️ Send *${P()}menu* for the menu list.`;
}

// .allmenu: every menu and every command, sent as text in a few parts
function allMenuParts() {
    const sections = [];
    for (const key of MENU_ORDER) for (const b of MENUS[key].boxes) {
        sections.push(box(`${b.title.split(' ')[0]} ${style.bold(b.title.split(' ').slice(1).join(' '))}`, b.lines));
    }
    const parts = [];
    let current = `${header()}\n\n📜 ${style.bold('ALL MENUS & COMMANDS')}\n`;
    for (const s of sections) {
        if ((current + '\n' + s).length > 3500) { parts.push(current); current = ''; }
        current += (current ? '\n' : '') + s + '\n';
    }
    current += `\n↩️ Send *${P()}menu* for the menu list.`;
    parts.push(current);
    return parts;
}

/* ---- menu pictures: downloaded ONCE, kept in memory and on disk ----
   Sending a picture by link makes WhatsApp's library download it again on every .menu, which is slow
   (or fails) on a slow host and drops the menu to plain text. Now the first .menu fetches it (max 6 s),
   every later .menu is instant, and if the picture site is unreachable the local bot image is used. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const CACHE_DIR = path.join(__dirname, '../data/cache');
const LOCAL_FALLBACK = path.join(__dirname, '../assets/bot_image.jpg');
const memo = new Map();       // url -> Buffer
const pending = new Map();    // url -> Promise
const fileFor = (url) => path.join(CACHE_DIR, crypto.createHash('md5').update(url).digest('hex') + '.img');

function cached(url) {
    if (memo.has(url)) return memo.get(url);
    try { const b = fs.readFileSync(fileFor(url)); if (b.length > 2000) { memo.set(url, b); return b; } } catch { /* not on disk yet */ }
    return null;
}
function download(url) {
    if (pending.has(url)) return pending.get(url);
    const p = axios.get(url, { responseType: 'arraybuffer', timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } })
        .then(res => {
            const b = Buffer.from(res.data);
            if (b.length < 2000 || b[0] === 0x3c) throw new Error('not a picture');
            memo.set(url, b);
            try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(fileFor(url), b); } catch { /* memory copy is enough */ }
            return b;
        })
        .catch(() => null)
        .finally(() => pending.delete(url));
    pending.set(url, p);
    return p;
}
async function pictureFor(url) {
    const hit = cached(url);
    if (hit) return hit;
    const got = await Promise.race([download(url), new Promise(r => setTimeout(() => r(null), 6000))]);
    if (got) return got;
    try { return fs.readFileSync(LOCAL_FALLBACK); } catch { return null; }
}
// warm the cache shortly after start so even the first .menu is instant
setTimeout(() => { download(BIO_IMAGE); download(MENU_IMAGE); }, 4000).unref?.();

async function sendImage(sock, chatId, message, image, caption, withChannel) {
    const picture = await pictureFor(image);
    const extra = withChannel ? channelInfo : {};
    if (picture) return sock.sendMessage(chatId, { image: picture, caption, ...extra }, { quoted: message });
    return sock.sendMessage(chatId, { text: caption, ...extra }, { quoted: message });
}

async function helpCommand(sock, chatId, message) {
    try {
        await sock.sendMessage(chatId, { react: { text: '🤖', key: message.key } });
        await sendImage(sock, chatId, message, BIO_IMAGE, welcomeCardText(message.pushName), false);
        await delay(400);
        await sendImage(sock, chatId, message, MENU_IMAGE, mainMenuText(message.pushName), true);
    } catch (err) {
        console.error('❌ Menu Error:', err);
        await sock.sendMessage(chatId, { text: mainMenuText(message.pushName) });
    }
}

async function menuCommand(sock, chatId, message, key) {
    if (key === 'all') {
        try {
            await sock.sendMessage(chatId, { react: { text: '📜', key: message.key } });
            const parts = allMenuParts();
            for (let i = 0; i < parts.length; i++) {
                await sock.sendMessage(chatId, i === 0 ? { text: parts[i], ...channelInfo } : { text: parts[i] }, i === 0 ? { quoted: message } : undefined);
                if (i < parts.length - 1) await delay(300);
            }
        } catch (err) {
            console.error('❌ All-menu Error:', err);
        }
        return;
    }
    try {
        await sock.sendMessage(chatId, { react: { text: MENUS[key].icon, key: message.key } });
        await sendImage(sock, chatId, message, MENU_IMAGE, subMenuText(key), true);
    } catch (err) {
        console.error('❌ Sub-menu Error:', err);
        await sock.sendMessage(chatId, { text: subMenuText(key) }, { quoted: message });
    }
}

module.exports = helpCommand;
module.exports.menuCommand = menuCommand;
module.exports.matchMenuKey = matchMenuKey;
module.exports.MENUS = MENUS;
module.exports.MENU_ORDER = MENU_ORDER;
module.exports.mainMenuText = mainMenuText;
module.exports.welcomeCardText = welcomeCardText;
module.exports.subMenuText = subMenuText;
module.exports.allMenuParts = allMenuParts;
module.exports.BIO_IMAGE = BIO_IMAGE;
module.exports.MENU_IMAGE = MENU_IMAGE;
