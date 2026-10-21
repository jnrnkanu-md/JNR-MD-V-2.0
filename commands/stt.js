const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const settings = require('../settings');
const isOwnerOrSudo = require('../lib/isOwner');
const { listModelIds, hasKey, getKey } = require('../lib/groq');
const style = require('../lib/style');

/**
 * JNR-MD - voice note to text
 *   .stt               reply to a voice note (or audio / video) and get the words as text
 *   .stt yo            tell it the language (en, fr, yo, ha, sw ...) for better accuracy
 *   .stt translate     get an English translation of what was said
 *   .stt auto on/off   (owner) every voice note someone sends you privately is turned into text for you automatically
 *   .stt auto status
 *
 * Where the text goes:
 *   - in a group, or when someone else uses the command: in the same chat
 *   - when YOU use it inside a private chat: to your own chat only, so the other person sees nothing
 * Uses Groq's free Whisper models with your GROQ_API_KEY. Nothing is saved.
 */

const API = 'https://api.groq.com/openai/v1/audio';
const MAX_BYTES = 24 * 1024 * 1024;          // Groq's free limit is 25 MB
const PREFERRED = ['whisper-large-v3-turbo', 'whisper-large-v3', 'distil-whisper-large-v3-en'];
const COOLDOWN_MS = 8000;
const cooldown = new Map();
let callWindow = [];

/* ---------------- settings (data/stt.json) ---------------- */
const DATA_PATH = path.join(__dirname, '../data/stt.json');
let state = null;
function load() {
    if (state) return state;
    try { state = { auto: false, ...(fs.existsSync(DATA_PATH) ? JSON.parse(fs.readFileSync(DATA_PATH, 'utf8') || '{}') : {}) }; } catch { state = { auto: false }; }
    return state;
}
function save() {
    try { fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true }); fs.writeFileSync(DATA_PATH, JSON.stringify(load(), null, 2)); } catch (e) { console.error('STT save error:', e.message); }
}

/* ---------------- helpers ---------------- */
const digitsOf = (jid) => (jid ? String(jid).split('@')[0].split(':')[0].replace(/\D/g, '') : '');
const ownerJid = () => `${String(settings.ownerNumber || '').replace(/\D/g, '')}@s.whatsapp.net`;
const isPrivate = (jid) => !!jid && (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid'));

function unwrap(msg) {
    let m = msg;
    for (let i = 0; i < 4 && m; i++) {
        const inner = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || m.documentWithCaptionMessage?.message;
        if (!inner) break;
        m = inner;
    }
    return m;
}

async function pickModel(translate) {
    let ids;
    try { ids = (await listModelIds()).filter(i => /whisper/i.test(i)); }
    catch (e) {
        if (e.response?.status === 401 || e.response?.status === 403) throw Object.assign(new Error('bad key'), { status: e.response.status });
        ids = null;                                               // could not read the list: just try the usual model
    }
    if (ids === null) return translate ? 'whisper-large-v3' : 'whisper-large-v3-turbo';
    const model = translate ? ['whisper-large-v3'].find(x => ids.includes(x)) : (PREFERRED.find(x => ids.includes(x)) || ids[0]);
    if (!model) throw Object.assign(new Error('no whisper model'), { code: 'NO_WHISPER', translate });
    return model;
}

function fileNameFor(mime) {
    const m = String(mime || '').toLowerCase();
    if (m.includes('ogg') || m.includes('opus')) return 'voice.ogg';
    if (m.includes('mpeg') || m.includes('mp3')) return 'audio.mp3';
    if (m.includes('mp4') && m.startsWith('video')) return 'video.mp4';
    if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'audio.m4a';
    if (m.includes('wav')) return 'audio.wav';
    if (m.includes('webm')) return 'audio.webm';
    return 'audio.ogg';
}

async function transcribe(buffer, { mime, language, translate }) {
    const model = await pickModel(translate);
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: String(mime || 'audio/ogg').split(';')[0] }), fileNameFor(mime));
    form.append('model', model);
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    if (language && !translate) form.append('language', language);
    const res = await fetch(`${API}/${translate ? 'translations' : 'transcriptions'}`, {
        method: 'POST', headers: { Authorization: `Bearer ${getKey()}` }, body: form
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, body });
    }
    return { ...(await res.json()), model };
}

async function download(media, type) {
    const stream = await downloadContentFromMessage(media, type);
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    return Buffer.concat(chunks);
}

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const splitText = (text) => { const parts = []; for (let i = 0; i < text.length; i += 3500) parts.push(text.slice(i, i + 3500)); return parts; };

function explain(err) {
    if (err.code === 'NO_WHISPER') return err.translate
        ? '❌ Translation needs the *whisper-large-v3* model, which your Groq key cannot use. Use *.stt* to get the text in the original language.'
        : '❌ Your Groq key cannot use a speech-to-text (Whisper) model. In the Groq console, open your project settings and allow *whisper-large-v3-turbo*, or create a new key in your default project.';
    if (err.status === 401 || err.status === 403) return '❌ The AI key is invalid or expired. Check *GROQ_API_KEY* in your .env file.';
    if (err.status === 404) return '❌ That speech model is not available for your Groq key. Allow *whisper-large-v3-turbo* in the Groq console.';
    if (err.status === 413) return '❌ That audio is too large. Send a shorter one (under about 24 MB).';
    if (err.status === 429) return '⏳ The speech service is busy right now. Please try again in a minute.';
    if (err.status === 400) return '❌ I could not read that audio. Try a different voice note.';
    return '❌ Could not turn that into text right now. Please try again later.';
}

/* ---------------- .stt ---------------- */
async function sttCommand(sock, chatId, message) {
    const isGroup = chatId.endsWith('@g.us');
    const ownDm = isPrivate(chatId) && message.key.fromMe && digitsOf(chatId) !== digitsOf(ownerJid());
    // used by YOU inside a private chat: the answer goes to your own chat, and nothing is shown to the other person
    const target = ownDm ? ownerJid() : chatId;
    const quietly = ownDm;
    const reply = (text, extra) => sock.sendMessage(target, { text }, quietly ? undefined : { quoted: message, ...(extra || {}) });
    const react = (emoji) => (quietly ? Promise.resolve() : sock.sendMessage(chatId, { react: { text: emoji, key: message.key } }).catch(() => {}));

    try {
        const own = unwrap(message.message) || {};
        const raw = own.conversation || own.extendedTextMessage?.text || '';
        const arg = raw.trim().replace(/^\S+/, '').trim().toLowerCase();

        // .stt auto on / off / status (owner)
        if (arg.startsWith('auto')) {
            const senderId = message.key.participant || message.key.remoteJid;
            if (!message.key.fromMe && !(await isOwnerOrSudo(senderId, sock, chatId))) return await reply('❌ Only the bot owner can use this.');
            const v = arg.replace(/^auto\s*/, '');
            const s = load();
            if (v === 'on' || v === 'off') { s.auto = v === 'on'; save(); }
            const note = !hasKey() ? '\n⚠️ No GROQ_API_KEY found in .env yet.' : '';
            return await sock.sendMessage(ownDm ? ownerJid() : chatId, {
                text: v === 'on' || v === 'off'
                    ? (s.auto ? `✅ *Auto voice-note to text ON*\nEvery voice note someone sends you privately is turned into text and sent to your own chat.${note}` : '❌ *Auto voice-note to text OFF*')
                    : `🎙️ Auto voice-note to text is *${s.auto ? 'ON ✅' : 'OFF ❌'}*\n\nUse *.stt auto on* or *.stt auto off*`
            }, { quoted: ownDm ? undefined : message });
        }

        const translate = arg === 'translate' || arg === 'english';
        const language = /^[a-z]{2,3}$/.test(arg) && arg !== 'on' ? arg : undefined;

        const ctx = own.extendedTextMessage?.contextInfo;
        const quoted = unwrap(ctx?.quotedMessage);
        const audio = quoted?.audioMessage || null;
        const video = !audio ? quoted?.videoMessage : null;
        const doc = !audio && !video && /^audio\//i.test(quoted?.documentMessage?.mimetype || '') ? quoted.documentMessage : null;
        const media = audio || video || doc;
        if (!media) {
            return await reply('🎙️ *Voice note to text*\n\nReply to a voice note with *.stt*\n\n• *.stt* : the words as text\n• *.stt yo* : set the language (en, fr, yo, ha, sw...)\n• *.stt translate* : translate it to English\n• *.stt auto on* : (owner) turn every private voice note into text automatically');
        }
        if (!hasKey()) return await reply('❌ Speech-to-text is not set up yet. The bot owner needs to add the *GROQ_API_KEY* in the .env file.');
        if (media.fileLength && Number(media.fileLength) > MAX_BYTES) return await reply('❌ That audio is too large. Send a shorter one (under about 24 MB).');

        const wait = COOLDOWN_MS - (Date.now() - (cooldown.get(chatId) || 0));
        if (wait > 0) return await reply(`⏳ Please wait *${Math.ceil(wait / 1000)}s* before the next one.`);
        const now = Date.now();
        callWindow = callWindow.filter(t => now - t < 60000);
        if (callWindow.length >= 20) return await reply('⏳ Too many requests right now. Please try again in a minute.');
        cooldown.set(chatId, now); callWindow.push(now);

        await react('🎙️');
        const buffer = await download(media, audio ? 'audio' : video ? 'video' : 'document');
        if (buffer.length > MAX_BYTES) return await reply('❌ That audio is too large. Send a shorter one (under about 24 MB).');

        const result = await transcribe(buffer, { mime: media.mimetype, language, translate });
        const text = String(result.text || '').trim();
        if (!text) { await react('❌'); return await reply('🙉 I could not hear any speech in that audio.'); }

        const seconds = media.seconds || Math.round(result.duration || 0);
        const lang = cap(result.language || language || '');
        const from = ownDm ? `📥 Chat with +${digitsOf(chatId)}\n` : '';
        const head = `🎙️ ${style.bold(translate ? 'TRANSLATED TO ENGLISH' : 'VOICE NOTE TO TEXT')}\n${from}` +
            `${seconds ? `⏱️ ${clock(seconds)}  ` : ''}${lang && !translate ? `🌐 ${lang}` : ''}\n━━━━━━━━━━━━━━━━━━\n`;
        const parts = splitText(text);
        for (let i = 0; i < parts.length; i++) {
            await sock.sendMessage(target, { text: (i === 0 ? head : `${style.bold(`PART ${i + 1}`)}\n`) + parts[i] }, i === 0 && !quietly ? { quoted: message } : undefined);
        }
        await react('✅');
    } catch (err) {
        console.error('STT error:', err.status || err.code || err.message, String(err.body || '').slice(0, 200));
        await react('❌');
        await reply(explain(err));
    }
}

/* ---------------- automatic mode (called from main.js for every message) ---------------- */
const autoCooldown = new Map();
let noWhisperNotified = 0;
async function sttAuto(sock, message) {
    try {
        if (!load().auto) return;
        const chatId = message?.key?.remoteJid;
        if (!chatId || message.key.fromMe || !isPrivate(chatId)) return;
        if (digitsOf(chatId) === digitsOf(ownerJid()) || digitsOf(chatId) === digitsOf(sock.user?.id)) return;
        const audio = unwrap(message.message)?.audioMessage;
        if (!audio || !audio.ptt) return;                              // voice notes only, not music files
        if (!hasKey()) return;
        if (audio.fileLength && Number(audio.fileLength) > MAX_BYTES) return;

        const now = Date.now();
        callWindow = callWindow.filter(t => now - t < 60000);
        if (callWindow.length >= 20 || now - (autoCooldown.get(chatId) || 0) < 2000) return;
        autoCooldown.set(chatId, now); callWindow.push(now);

        const buffer = await download(audio, 'audio');
        if (buffer.length > MAX_BYTES) return;
        const result = await transcribe(buffer, { mime: audio.mimetype });
        const text = String(result.text || '').trim();
        if (!text) return;

        const seconds = audio.seconds || Math.round(result.duration || 0);
        const who = message.pushName ? `${message.pushName} (+${digitsOf(chatId)})` : `+${digitsOf(chatId)}`;
        const head = `🎙️ ${style.bold('VOICE NOTE TO TEXT')}\n👤 ${who}\n${seconds ? `⏱️ ${clock(seconds)}  ` : ''}${result.language ? `🌐 ${cap(result.language)}` : ''}\n━━━━━━━━━━━━━━━━━━\n`;
        const parts = splitText(text);
        for (let i = 0; i < parts.length; i++) {
            await sock.sendMessage(ownerJid(), { text: (i === 0 ? head : `${style.bold(`PART ${i + 1}`)}\n`) + parts[i] }, { noFooter: true });
        }
    } catch (err) {
        console.error('STT auto error:', err.status || err.code || err.message);
        if (err.code === 'NO_WHISPER' && Date.now() - noWhisperNotified > 6 * 3600 * 1000) {      // tell the owner once in a while
            noWhisperNotified = Date.now();
            sock.sendMessage(ownerJid(), { text: explain(err) }, { noFooter: true }).catch(() => {});
        }
    }
}

module.exports = sttCommand;
module.exports.sttAuto = sttAuto;
module.exports._test = { reset: () => { cooldown.clear(); autoCooldown.clear(); callWindow = []; noWhisperNotified = 0; state = null; } };
