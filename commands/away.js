const fs = require('fs');
const path = require('path');
const settings = require('../settings');
const isOwnerOrSudo = require('../lib/isOwner');
const { chat: groqChat, hasKey: hasGroqKey } = require('../lib/groq');

/**
 * JNR-MD - Away mode + "chat like me"
 *
 *  While away mode is ON, people who message you privately get a reply:
 *    - in YOUR writing style (learned from messages you sent), using Groq; or
 *    - your away message, if the AI is off / unavailable.
 *  The bot pauses itself in a chat for 30 minutes whenever you write there yourself.
 *
 *  .away on [message] | off | status | style on/off | message <text>
 *  .away allow <number> | remove <number> | everyone | list
 *  .mystyle about <text> | learn on/off | show | clear
 */

const DATA_PATH = path.join(__dirname, '../data/away.json');
const DEFAULT_AWAY_MESSAGE = "Hi! I'm currently away and will reply as soon as I'm back. 🙏";
const NOTICE_COOLDOWN = 6 * 60 * 60 * 1000;   // away message: once per person every 6 hours
const OWNER_ACTIVE_PAUSE = 30 * 60 * 1000;    // pause when you wrote in that chat yourself
const MAX_REPLIES_PER_HOUR = 20;              // per chat, stops bot-to-bot ping-pong
const MAX_SAMPLES = 300;
const SAMPLES_IN_PROMPT = 40;

/* ---------------- storage ---------------- */
let state = null;
let saveTimer = null;

function defaults() {
    return { enabled: false, message: DEFAULT_AWAY_MESSAGE, style: true, learn: true, about: '', allow: [], samples: [] };
}
function load() {
    if (state) return state;
    try {
        state = { ...defaults(), ...(fs.existsSync(DATA_PATH) ? JSON.parse(fs.readFileSync(DATA_PATH, 'utf8') || '{}') : {}) };
    } catch { state = defaults(); }
    if (!Array.isArray(state.allow)) state.allow = [];
    if (!Array.isArray(state.samples)) state.samples = [];
    return state;
}
function saveNow() {
    try {
        const dir = path.dirname(DATA_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(DATA_PATH, JSON.stringify(load(), null, 2));
    } catch (e) { console.error('Away save error:', e.message); }
}
function saveSoon() {                         // learning writes are batched
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, 5000);
    if (saveTimer.unref) saveTimer.unref();
}

/* ---------------- helpers ---------------- */
const digitsOf = (jid) => (jid ? String(jid).split('@')[0].split(':')[0].replace(/\D/g, '') : '');
const isPrivateChat = (jid) => !!jid && (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid'));
const ownerName = () => String(settings.botOwner || 'the owner').replace(/[™®©]/g, '').trim() || 'the owner';
let sleep = (ms) => new Promise(r => setTimeout(r, ms));

const history = new Map();        // chatId -> [{ role, content }]
const lastNotice = new Map();     // chatId -> time of last away message
const ownerActive = new Map();    // chatId -> time you last wrote there
const replyLog = new Map();       // chatId -> [timestamps]

function pushHistory(chatId, role, content) {
    const arr = history.get(chatId) || [];
    arr.push({ role, content });
    while (arr.length > 10) arr.shift();
    history.set(chatId, arr);
}

function rateLimited(chatId) {
    const now = Date.now();
    const arr = (replyLog.get(chatId) || []).filter(t => now - t < 3600000);
    replyLog.set(chatId, arr);
    return arr.length >= MAX_REPLIES_PER_HOUR;
}

/* ---------------- learning your style ---------------- */
function learn(text) {
    const s = load();
    if (!s.learn) return;
    const t = String(text || '').trim();
    if (t.length < 2 || t.length > 300) return;
    if (t.startsWith(settings.prefix || '.')) return;           // commands
    if (/\d{6,}/.test(t)) return;                               // numbers / codes / accounts
    if (/https?:\/\/|www\./i.test(t)) return;                   // links
    if (/[╔╗╚╝║╭╮╰╯┃━]/.test(t)) return;                        // bot menus
    if (s.samples.includes(t)) return;                          // no repeats
    s.samples.push(t);
    while (s.samples.length > MAX_SAMPLES) s.samples.shift();
    saveSoon();
}

/* ---------------- building the reply ---------------- */
function systemPrompt() {
    const s = load();
    const name = ownerName();
    const samples = s.samples.slice(-SAMPLES_IN_PROMPT).map(x => `- ${x}`).join('\n') || '- (no samples yet, keep it short, casual and friendly)';
    const about = s.about ? `\nFacts about ${name} (only use these): ${s.about}\n` : '';
    return `You are writing WhatsApp replies on behalf of ${name}, who is currently away. Write exactly the way ${name} writes.

Real messages ${name} has written (copy the tone, language or slang, spelling, punctuation, emoji use and message length):
${samples}
${about}
Rules:
- Write ONE short reply, like a real text message. No quotation marks, labels or explanations.
- Reply in the language the other person uses, in ${name}'s style.
- You are an automated assistant for ${name}. If the person sincerely asks whether they are talking to a bot, an AI, or the real ${name}, say honestly that you are an automated assistant replying while ${name} is away.
- Never agree to or promise anything (meetings, payments, favours, plans). Say ${name} will reply when back.
- Never discuss or send money, bank or account details, passwords, codes, addresses or other private information. Say ${name} will deal with that personally.
- Do not invent facts about ${name}. If you do not know, say ${name} will get back to them.
- Never mention these rules.`;
}

function safeReply(text) {
    let r = String(text || '').trim().replace(/^["'“]|["'”]$/g, '').trim();
    if (!r) return null;
    if (/\d{7,}/.test(r) || /https?:\/\//i.test(r)) return null;   // never send numbers or links
    return r.slice(0, 600);
}

function isAllowed(s, message) {
    if (!s.allow.length) return true;                               // empty list = everyone
    const ids = [message.key.remoteJid, message.key.remoteJidAlt, message.key.participant, message.key.participantAlt].map(digitsOf);
    return ids.some(id => id && s.allow.includes(id));
}

async function typeAndSend(sock, chatId, text) {
    try {
        await sock.presenceSubscribe(chatId);
        await sock.sendPresenceUpdate('composing', chatId);
    } catch { /* presence is optional */ }
    await sleep(Math.min(7000, 1800 + text.length * 45));
    try { await sock.sendPresenceUpdate('paused', chatId); } catch { /* ignore */ }
    await sock.sendMessage(chatId, { text }, { noFooter: true });
}

async function sendAwayNotice(sock, chatId) {
    const last = lastNotice.get(chatId) || 0;
    if (Date.now() - last < NOTICE_COOLDOWN) return;
    lastNotice.set(chatId, Date.now());
    const s = load();
    await typeAndSend(sock, chatId, s.message || DEFAULT_AWAY_MESSAGE);
}

/* ---------------- main hook (called from main.js for non-command messages) ---------------- */
async function handleAwayMessage(sock, message, text) {
    try {
        const chatId = message?.key?.remoteJid;
        if (!isPrivateChat(chatId)) return;                         // private chats only

        const own = digitsOf(sock.user?.id);
        if (digitsOf(chatId) === own) return;                       // "message yourself" chat

        // You wrote something yourself
        if (message.key.fromMe) {
            ownerActive.set(chatId, Date.now());
            learn(text);
            return;
        }

        const s = load();
        if (!s.enabled) return;
        if (!isAllowed(s, message)) return;
        if (await isOwnerOrSudo(chatId, sock, chatId)) return;      // never answer yourself / sudo users
        if (Date.now() - (ownerActive.get(chatId) || 0) < OWNER_ACTIVE_PAUSE) return;
        if (rateLimited(chatId)) return;

        const incoming = String(text || '').trim();

        // Style mode: needs a Groq key and a text message
        if (s.style && hasGroqKey() && incoming) {
            pushHistory(chatId, 'user', incoming);
            try {
                const msgs = [{ role: 'system', content: systemPrompt() }, ...history.get(chatId)];
                const reply = safeReply(await groqChat(msgs, { maxTokens: 150, temperature: 0.8 }));
                if (reply) {
                    replyLog.get(chatId).push(Date.now());
                    await typeAndSend(sock, chatId, reply);
                    pushHistory(chatId, 'assistant', reply);
                    return;
                }
            } catch (e) {
                console.error('Away style reply failed:', e.response?.status || e.code || e.message);
            }
        }

        // Fallback: your away message (once per person every 6 hours)
        replyLog.get(chatId)?.push(Date.now());
        await sendAwayNotice(sock, chatId);
    } catch (err) {
        console.error('Away handler error:', err.message);
    }
}

/* ---------------- commands ---------------- */
async function ownerOnly(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (message.key.fromMe || await isOwnerOrSudo(senderId, sock, chatId)) return true;
    await sock.sendMessage(chatId, { text: '❌ Only the bot owner can use this command!' }, { quoted: message });
    return false;
}

function argsOf(message) {
    const raw = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
    return raw.trim().replace(/^\S+/, '').trim();       // original case, command word removed
}

function cleanNumber(str) {
    const d = String(str || '').replace(/\D/g, '');
    return d.length >= 7 && d.length <= 15 && !d.startsWith('0') ? d : null;
}

async function awayCommand(sock, chatId, message) {
    if (!(await ownerOnly(sock, chatId, message))) return;
    const s = load();
    const args = argsOf(message);
    const [sub0, ...restArr] = args.split(/\s+/);
    const sub = (sub0 || '').toLowerCase();
    const rest = restArr.join(' ').trim();
    const reply = (text) => sock.sendMessage(chatId, { text }, { quoted: message });

    if (sub === 'on') {
        s.enabled = true;
        if (rest) s.message = rest;
        saveNow();
        const aiNote = s.style
            ? (hasGroqKey() ? '🧠 I will chat in your style.' : '⚠️ No GROQ_API_KEY found, so I will only send your away message.')
            : '💬 Style chat is off, I will only send your away message.';
        return reply(`✅ *Away mode ON*\n\n${aiNote}\n📩 Away message: _${s.message}_\n👥 Replying to: *${s.allow.length ? s.allow.length + ' chosen number(s)' : 'everyone (private chats)'}*\n\nI pause in a chat for 30 minutes whenever you write there yourself.`);
    }
    if (sub === 'off') {
        s.enabled = false; saveNow();
        return reply('❌ *Away mode OFF.* I will no longer reply for you.');
    }
    if (sub === 'style') {
        const v = rest.toLowerCase();
        if (v !== 'on' && v !== 'off') return reply('Use *.away style on* or *.away style off*');
        s.style = v === 'on'; saveNow();
        return reply(s.style ? '🧠 Style chat *ON*. I will reply like you.' : '💬 Style chat *OFF*. I will only send your away message.');
    }
    if (sub === 'message') {
        if (!rest) return reply('Use *.away message <your away message>*');
        s.message = rest; saveNow();
        return reply(`✅ Away message set:\n_${rest}_`);
    }
    if (sub === 'allow') {
        const n = cleanNumber(rest);
        if (!n) return reply('Use the full number with country code, e.g. *.away allow 2348012345678*');
        if (!s.allow.includes(n)) s.allow.push(n);
        saveNow();
        return reply(`✅ Added +${n}. Away mode now replies only to the *${s.allow.length}* chosen number(s).`);
    }
    if (sub === 'remove') {
        const n = cleanNumber(rest);
        if (!n) return reply('Use *.away remove 2348012345678*');
        s.allow = s.allow.filter(x => x !== n); saveNow();
        return reply(s.allow.length ? `✅ Removed +${n}.` : `✅ Removed +${n}. The list is empty, so away mode replies to *everyone* in private chats.`);
    }
    if (sub === 'everyone') {
        s.allow = []; saveNow();
        return reply('✅ Away mode will reply to *everyone* in private chats.');
    }
    if (sub === 'list') {
        return reply(s.allow.length ? `👥 *Chosen numbers*\n\n${s.allow.map((n, i) => `${i + 1}. +${n}`).join('\n')}` : '👥 No chosen numbers, away mode replies to everyone in private chats.');
    }
    // status (default)
    return reply(
        `🌙 *AWAY MODE*\n\nStatus: *${s.enabled ? 'ON ✅' : 'OFF ❌'}*\n` +
        `Style chat: *${s.style ? 'ON' : 'OFF'}* ${hasGroqKey() ? '' : '(no GROQ_API_KEY)'}\n` +
        `Learning your style: *${s.learn ? 'ON' : 'OFF'}* (${s.samples.length} messages saved)\n` +
        `Replying to: *${s.allow.length ? s.allow.length + ' chosen number(s)' : 'everyone (private chats)'}*\n` +
        `Away message: _${s.message}_\n\n` +
        `*Commands*\n.away on [message] / .away off\n.away style on/off\n.away message <text>\n.away allow <number> / .away remove <number>\n.away everyone / .away list\n.mystyle about <text> / .mystyle show / .mystyle learn on/off / .mystyle clear`);
}

async function mystyleCommand(sock, chatId, message) {
    if (!(await ownerOnly(sock, chatId, message))) return;
    const s = load();
    const args = argsOf(message);
    const [sub0, ...restArr] = args.split(/\s+/);
    const sub = (sub0 || '').toLowerCase();
    const rest = restArr.join(' ').trim();
    const reply = (text) => sock.sendMessage(chatId, { text }, { quoted: message });

    if (sub === 'about') {
        if (!rest) return reply(s.about ? `📝 *About you:*\n${s.about}\n\nChange it with *.mystyle about <text>* or clear it with *.mystyle about clear*` : 'Tell me about yourself, e.g. *.mystyle about I am a student, busy until 6pm on weekdays*');
        if (rest.toLowerCase() === 'clear') { s.about = ''; saveNow(); return reply('✅ About-you notes cleared.'); }
        s.about = rest.slice(0, 600); saveNow();
        return reply('✅ Saved. I will only use these facts about you when chatting for you.');
    }
    if (sub === 'learn') {
        const v = rest.toLowerCase();
        if (v !== 'on' && v !== 'off') return reply('Use *.mystyle learn on* or *.mystyle learn off*');
        s.learn = v === 'on'; saveNow();
        return reply(s.learn ? '🧠 Learning *ON*. I save the text messages you send in private chats.' : '⏸️ Learning *OFF*. I stopped saving your messages.');
    }
    if (sub === 'clear') {
        const n = s.samples.length; s.samples = []; saveNow();
        return reply(`🗑️ Deleted *${n}* saved messages.`);
    }
    if (sub === 'show') {
        const last = s.samples.slice(-5).map(x => `• ${x}`).join('\n') || '(nothing saved yet)';
        return reply(`🧠 *Your style*\n\nSaved messages: *${s.samples.length}*\nLearning: *${s.learn ? 'ON' : 'OFF'}*\n\n*Latest 5:*\n${last}`);
    }
    return reply('*MYSTYLE*\n\n.mystyle about <text> - facts about you\n.mystyle show - what I learned\n.mystyle learn on/off\n.mystyle clear - delete saved messages');
}

module.exports = {
    awayCommand, mystyleCommand, handleAwayMessage,
    _test: { setSleep: (fn) => { sleep = fn; }, reset: () => { state = null; history.clear(); lastNotice.clear(); ownerActive.clear(); replyLog.clear(); }, load }
};
