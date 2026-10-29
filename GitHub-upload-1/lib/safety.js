/**
 * JNR-MD - safety scanner (strong mode)
 *
 *  links      : warning signs in the address, look-alike / typo-squatted brands, short-link expansion,
 *               optional Google Safe Browsing, and an AI opinion from Groq
 *  messages   : scam wording (OTP/PIN requests, "double your money", fake jobs, prizes, loans ...)
 *  files      : dangerous attachments (.apk .exe ...), double extensions, archives, macro documents
 *  images     : Groq Llama Guard 4 + a Groq vision model (both in strict mode)
 *  videos     : real frames are taken with ffmpeg and scanned like images
 *
 * Nothing is saved: pictures and videos are checked in memory and discarded.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const axios = require('axios');
const { chat, rawChat, listModelIds, hasKey, hasGroqKey, envValue } = require('./groq');

/* ======================== settings (data/safety.json) ======================== */
const DATA_PATH = path.join(__dirname, '../data/safety.json');
let cfg = null;
function config() {
    if (cfg) return cfg;
    const base = { groups: {}, privateChats: false, links: true, images: true, level: 'strict', allow: [] };
    try { cfg = { ...base, ...(fs.existsSync(DATA_PATH) ? JSON.parse(fs.readFileSync(DATA_PATH, 'utf8') || '{}') : {}) }; } catch { cfg = base; }
    if (!cfg.groups || typeof cfg.groups !== 'object') cfg.groups = {};
    if (!Array.isArray(cfg.allow)) cfg.allow = [];
    if (cfg.level !== 'normal') cfg.level = 'strict';
    return cfg;
}
function save() {
    try { fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true }); fs.writeFileSync(DATA_PATH, JSON.stringify(config(), null, 2)); }
    catch (e) { console.error('Safety save error:', e.message); }
}
function isEnabledFor(chatId) {
    const c = config();
    if (!chatId) return false;
    return chatId.endsWith('@g.us') ? !!c.groups[chatId] : !!c.privateChats;
}
const isStrict = () => config().level !== 'normal';
// strict: a score of 2 is already "danger"; normal: 3
const dangerAt = () => (isStrict() ? 2 : 3);
const toLevel = (score) => (score >= dangerAt() ? 'danger' : score >= 1 ? 'warn' : 'safe');

/* ======================== links ======================== */
function normalizeText(t) {
    return String(t || '')
        .replace(/hxxp(s?)/gi, 'http$1')
        .replace(/\[\.\]|\(\.\)|\{\.\}|\[dot\]|\(dot\)/gi, '.');
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const TLDS = 'com|net|org|ng|co|io|xyz|top|click|link|me|ly|app|info|site|online|store|shop|live|vip|club|cc|tk|ml|ga|cf|gq|ru|cn|in|us|tv|to|gl|gd|bz|biz|icu|buzz|cyou|sbs|cfd|work|loan|zip|mov|page|dev|cloud|win|bid|fun|space|website|tech|gg|sh|su|pw|ws';
const BARE_RE = new RegExp(`(?<![@\\w./-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLDS})\\b(?:/[^\\s<>"']*)?`, 'gi');

function extractUrls(text) {
    const t = normalizeText(text);
    const out = new Map();
    const clean = (u) => u.replace(/[)\].,!?;:]+$/, '');
    for (const m of t.match(URL_RE) || []) out.set(clean(m).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, ''), clean(m));
    for (const m of t.match(BARE_RE) || []) {
        const u = clean(m);
        const key = u.toLowerCase().replace(/^www\./, '');
        if (/^\d+(\.\d+)*$/.test(u) || [...out.keys()].some(k => k.startsWith(key))) continue;
        if (!out.has(key)) out.set(key, u);
    }
    return [...out.values()];
}

const TWO_PART = new Set(['com.ng', 'org.ng', 'gov.ng', 'edu.ng', 'net.ng', 'co.uk', 'org.uk', 'co.za', 'com.au', 'co.ke', 'com.gh', 'co.in', 'com.br']);
function registeredDomain(host) {
    const p = host.split('.');
    if (p.length <= 2) return host;
    return TWO_PART.has(p.slice(-2).join('.')) ? p.slice(-3).join('.') : p.slice(-2).join('.');
}

const BRANDS = {
    paypal: ['paypal.com', 'paypal.me'], facebook: ['facebook.com', 'fb.com', 'fb.me', 'fb.watch'],
    instagram: ['instagram.com'], whatsapp: ['whatsapp.com', 'whatsapp.net', 'wa.me'],
    google: ['google.com', 'google.com.ng', 'googleusercontent.com', 'googleapis.com', 'gstatic.com', 'goo.gl', 'g.co', 'googlevideo.com'],
    gmail: ['gmail.com'], youtube: ['youtube.com', 'youtu.be'], tiktok: ['tiktok.com', 'tiktokcdn.com', 'tiktokv.com'],
    twitter: ['twitter.com', 't.co', 'x.com'], apple: ['apple.com', 'icloud.com'],
    microsoft: ['microsoft.com', 'live.com', 'office.com', 'microsoftonline.com', 'outlook.com', 'sharepoint.com'],
    netflix: ['netflix.com'], amazon: ['amazon.com', 'amazonaws.com', 'amazon.co.uk', 'amzn.to'],
    binance: ['binance.com'], telegram: ['telegram.org', 't.me'], coinbase: ['coinbase.com'], metamask: ['metamask.io'],
    trustwallet: ['trustwallet.com'], linkedin: ['linkedin.com'], snapchat: ['snapchat.com'], spotify: ['spotify.com', 'scdn.co'],
    discord: ['discord.com', 'discord.gg', 'discordapp.com'], roblox: ['roblox.com'], dhl: ['dhl.com'], fedex: ['fedex.com'],
    gtbank: ['gtbank.com', 'gtco.com'], zenithbank: ['zenithbank.com'], flutterwave: ['flutterwave.com'], paystack: ['paystack.com'],
    palmpay: ['palmpay.com'], moniepoint: ['moniepoint.com'], jumia: ['jumia.com.ng', 'jumia.com']
};
const KNOWN_SAFE = new Set(['youtube.com', 'youtu.be', 'google.com', 'google.com.ng', 'facebook.com', 'fb.com', 'fb.watch', 'fb.me', 'instagram.com', 'tiktok.com', 'twitter.com', 'x.com', 't.co',
    'whatsapp.com', 'wa.me', 'wikipedia.org', 'github.com', 'telegram.org', 't.me', 'linkedin.com', 'spotify.com', 'microsoft.com', 'apple.com', 'amazon.com', 'netflix.com', 'paypal.com', 'zoom.us', 'whatsapp.net']);
const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 'cutt.ly', 'is.gd', 'rb.gy', 'shorturl.at', 'ow.ly', 'tiny.cc', 'buff.ly', 'goo.gl', 'bit.do', 't.ly', 'shorte.st', 'v.gd', 'lnkd.in', 'qr.ae', 'tr.ee', 'clk.sh', 'urlz.fr', 'l.ead.me', 'linktr.ee']);
const BAD_TLDS = new Set(['xyz', 'top', 'click', 'gq', 'tk', 'ml', 'cf', 'ga', 'work', 'loan', 'country', 'kim', 'zip', 'mov', 'icu', 'cyou', 'buzz', 'rest', 'monster', 'sbs', 'cfd', 'pw', 'su', 'bid', 'win']);
const RISKY_FILES = /\.(apk|exe|scr|bat|msi|jar|vbs|vbe|ps1|lnk|iso|cmd|dmg|pkg|apks|xapk|hta|wsf|dll)(?:[?#]|$)/i;
const ARCHIVES = /\.(zip|rar|7z)(?:[?#]|$)/i;
const SCAM_WORDS = ['giveaway', 'airdrop', 'claim', 'prize', 'winner', 'jackpot', 'bonus', 'free-money', 'free-data', 'recharge', 'verify', 'login', 'signin', 'secure', 'wallet', 'walletconnect', 'seed', 'kyc', 'recover', 'suspend', 'unlock', 'update-account', 'reward', 'promo'];

function normDomain(input) {
    return String(input || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#:]/)[0].trim();
}
const hostIsIp = (h) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(h) || h.includes(':') || /^\[.*\]$/.test(h);

// letters that look like others: paypa1 -> paypal, g00gle -> google, rn -> m
const LEET = { 0: 'o', 1: 'l', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' };
const deLeet = (s) => s.replace(/[01345$@7]/g, c => LEET[c]).replace(/rn/g, 'm').replace(/vv/g, 'w');
function distance(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return dp[a.length][b.length];
}

// Warning signs in the address itself (no network needed)
function heuristics(rawUrl) {
    const reasons = []; let score = 0;
    let u;
    try { u = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `http://${rawUrl}`); } catch { return { score: 1, reasons: ['the address is not a valid web link'], host: '', reg: '' }; }
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    const reg = registeredDomain(host);
    const add = (n, why) => { score += n; reasons.push(why); };

    if (hostIsIp(host)) add(2, 'uses a raw IP address instead of a website name');
    if (host.includes('xn--')) add(2, 'uses look-alike (punycode) characters in the name');
    if (/@/.test(rawUrl.replace(/^https?:\/\//i, '').split('/')[0])) add(2, 'hides the real website behind a "user@" part');
    if (SHORTENERS.has(reg)) add(1, 'shortened link that hides the real destination');
    if (RISKY_FILES.test(u.pathname + u.search)) add(3, 'leads to an installable or executable file');
    else if (ARCHIVES.test(u.pathname)) add(1, 'leads to a compressed file');
    if (BAD_TLDS.has(host.split('.').pop())) add(1, `uses a "${host.split('.').pop()}" ending often seen in scam sites`);
    if (host.split('.').length - reg.split('.').length >= 3) add(1, 'has an unusually long address');

    // pretends to be (or is one letter away from) a well-known brand
    const label = reg.split('.')[0];
    const flat = deLeet(host.replace(/[-.]/g, ''));
    for (const [brand, official] of Object.entries(BRANDS)) {
        if (official.some(d => host === d || host.endsWith('.' + d))) continue;
        if (brand.length >= 4 && host.includes(brand)) { add(3, `pretends to be ${brand} but is not the real ${brand} website`); break; }
        if (brand.length >= 4 && flat.includes(brand)) { add(3, `imitates ${brand} using look-alike letters or numbers`); break; }
        if (brand.length >= 6 && label.length >= 6 && label !== brand && distance(deLeet(label), brand) <= 1) { add(3, `is almost the same as ${brand} (typo trick)`); break; }
    }
    // scam wording, only counted on sites we do not recognise
    if (!KNOWN_SAFE.has(reg)) {
        const hits = SCAM_WORDS.filter(w => (host + u.pathname).toLowerCase().includes(w));
        if (hits.length) add(Math.min(2, hits.length), `contains scam-style words (${hits.slice(0, 3).join(', ')})`);
        if (u.protocol === 'http:' && hits.length) add(1, 'does not use a secure (https) connection');
    }
    return { score, reasons, host, reg };
}

async function expand(url) {
    try {
        const res = await axios.head(url, { maxRedirects: 4, timeout: 6000, validateStatus: () => true, headers: { 'User-Agent': 'Mozilla/5.0' } });
        return res.request?.res?.responseUrl || url;
    } catch { return url; }
}

async function safeBrowsing(url) {
    const key = envValue('GOOGLE_SAFE_BROWSING_KEY');
    if (!key) return null;
    try {
        const res = await axios.post(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${key}`, {
            client: { clientId: 'jnr-md', clientVersion: '2.0' },
            threatInfo: {
                threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
                platformTypes: ['ANY_PLATFORM'], threatEntryTypes: ['URL'], threatEntries: [{ url }]
            }
        }, { timeout: 8000 });
        return (res.data?.matches || []).length > 0;
    } catch { return null; }
}

/* ---- AI opinions (Groq text model), kept inside the free limits ---- */
const aiCache = new Map();
let aiWindow = [];
async function aiJudge(kind, subject, context) {
    if (!hasKey()) return null;
    const key = `${kind}|${subject}`.slice(0, 240);
    if (aiCache.has(key)) return aiCache.get(key);
    const now = Date.now();
    aiWindow = aiWindow.filter(t => now - t < 60000);
    if (aiWindow.length >= 25) return null;
    aiWindow.push(now);
    try {
        const system = kind === 'link'
            ? 'You are a cybersecurity assistant that judges web addresses for phishing, scams and malware using only the address text. Reply ONLY with JSON like {"verdict":"safe|suspicious|dangerous","reason":"max 12 words"}. Be conservative: well-known legitimate websites are safe.'
            : 'You are a scam-detection assistant for WhatsApp messages. Decide if the message is a scam, phishing, fraud, advance-fee, fake job/investment/giveaway, or a request for OTP/PIN/passwords/seed phrases. Reply ONLY with JSON like {"verdict":"safe|suspicious|dangerous","reason":"max 12 words"}. Normal conversation, business talk and jokes are safe.';
        const text = await chat([{ role: 'system', content: system }, { role: 'user', content: kind === 'link' ? `Address: ${subject}\nMessage it was sent with: ${String(context || '').slice(0, 200)}` : `Message: ${String(subject).slice(0, 700)}` }], { maxTokens: 80, temperature: 0 });
        const m = text.match(/\{[\s\S]*\}/);
        const j = m ? JSON.parse(m[0]) : null;
        const out = j && ['safe', 'suspicious', 'dangerous'].includes(String(j.verdict).toLowerCase())
            ? { verdict: String(j.verdict).toLowerCase(), reason: String(j.reason || '').slice(0, 100) } : null;
        aiCache.set(key, out);
        if (aiCache.size > 500) aiCache.delete(aiCache.keys().next().value);
        return out;
    } catch { return null; }
}

// -> { level: 'safe'|'warn'|'danger', reasons, score, url }
async function assessUrl(rawUrl, context = '', depth = 0) {
    const c = config();
    const first = heuristics(rawUrl);
    if (c.allow.some(d => first.host === d || first.host.endsWith('.' + d))) return { level: 'safe', reasons: [], score: 0, url: rawUrl };

    let { score, reasons } = first;
    if (depth === 0 && SHORTENERS.has(first.reg)) {
        const final = await expand(/^https?:\/\//i.test(rawUrl) ? rawUrl : `http://${rawUrl}`);
        if (final && final !== rawUrl) {
            const inner = await assessUrl(final, context, 1);
            if (inner.level !== 'safe') { score += inner.score; reasons = reasons.concat(inner.reasons.map(r => `destination ${r}`)); }
        }
    }
    if ((await safeBrowsing(rawUrl)) === true) { score += 5; reasons.push('listed as unsafe by Google Safe Browsing'); }
    if (!KNOWN_SAFE.has(first.reg) && first.reg) {
        const ai = await aiJudge('link', rawUrl, context);
        if (ai?.verdict === 'dangerous') { score += 3; reasons.push(`AI check: ${ai.reason || 'looks like a scam'}`); }
        else if (ai?.verdict === 'suspicious') { score += 1; reasons.push(`AI check: ${ai.reason || 'looks suspicious'}`); }
    }
    return { level: toLevel(score), reasons, score, url: rawUrl };
}

/* ======================== scam wording in messages ======================== */
const SCAM_PATTERNS = [
    [3, 'asks for a code, PIN, password or seed phrase', /\b(?:send|share|give|tell|confirm|provide|forward|read)\b[^.\n]{0,40}\b(?:otp|one[- ]time (?:pin|password|code)|verification code|pin|cvv|password|seed phrase|recovery phrase|private key|bvn|card number)\b/i],
    [3, 'asks for a code, PIN, password or seed phrase', /\b(?:otp|verification code|pin|password|seed phrase|cvv)\b[^.\n]{0,25}\b(?:send|share|give|tell|confirm)\b/i],
    [2, 'promises to double or multiply your money', /\b(?:double|triple|10x|multiply)\s+(?:your\s+)?(?:money|investment|btc|bitcoin|capital)\b|guaranteed\s+(?:profit|returns?)|daily\s+(?:profit|returns?)|(?:invest|deposit)[^.\n]{0,25}(?:receive|get|earn)[^.\n]{0,25}(?:within|in)\s+\d+\s*(?:hours?|days?)/i],
    [2, 'fake prize, giveaway or free-money offer', /\b(?:you(?:'ve| have)?\s+won|congratulations[^.\n]{0,40}(?:won|selected|winner)|claim\s+your\s+(?:prize|reward|gift|bonus)|free\s+(?:data|airtime|recharge|money|gift|iphone)|instant\s+loan|loan\s+approved|no\s+collateral)\b/i],
    [2, 'fake "earn money" job or task offer', /\b(?:earn|make)\b[^.\n]{0,15}(?:₦|\$|usd|naira|ngn)?\s?\d[\d,]*\s?(?:per|a|\/)\s?(?:day|week|hour)|work\s+from\s+home[^.\n]{0,25}(?:earn|pay|paid)|(?:simple|easy)\s+tasks?[^.\n]{0,25}(?:earn|paid)|like\s*(?:and|&)\s*(?:subscribe|share)[^.\n]{0,20}(?:earn|paid)/i],
    [2, 'advance-fee / inheritance scam wording', /\b(?:inheritance|next\s+of\s+kin|unclaimed\s+(?:funds|package)|lottery\s+(?:winner|win)|transfer\s+of\s+\$?\s?\d+(?:\.\d+)?\s*(?:million|m)\b)/i],
    [2, 'threatens to suspend or block your account', /\b(?:your\s+(?:account|card|sim)\s+(?:will\s+be|has\s+been|is)\s+(?:suspended|blocked|locked|deactivated|restricted)|verify\s+your\s+account\s+(?:now|immediately)|urgent\s+action\s+required|final\s+warning)\b/i],
    [1, 'impersonal bank / telecom style greeting', /\bdear\s+(?:customer|user|client|valued\s+customer)\b/i],
    [2, 'adult or hook-up spam', /\b(?:sugar\s+(?:mummy|mommy|daddy)|hook\s*-?\s*up\s+(?:with|now)|nudes?\s+for\s+sale|sex\s*(?:chat|videos?)|onlyfans\s+leaks?)\b/i]
];

function scamHeuristics(text) {
    const t = normalizeText(text);
    const reasons = []; let score = 0;
    for (const [weight, why, re] of SCAM_PATTERNS) {
        if (re.test(t) && !reasons.includes(why)) { score += weight; reasons.push(why); }
    }
    return { score, reasons };
}

// -> { level, reasons, score } for the wording of a message
async function assessText(text) {
    const t = String(text || '').trim();
    if (t.length < 12) return { level: 'safe', reasons: [], score: 0 };
    let { score, reasons } = scamHeuristics(t);
    if (score >= 1 && t.length <= 1000) {
        const ai = await aiJudge('text', t);
        if (ai?.verdict === 'dangerous') { score += 3; reasons.push(`AI check: ${ai.reason || 'looks like a scam'}`); }
        else if (ai?.verdict === 'suspicious') { score += 1; reasons.push(`AI check: ${ai.reason || 'looks suspicious'}`); }
        else if (ai?.verdict === 'safe' && score <= 1) { score = 0; reasons = []; }
    }
    return { level: toLevel(score), reasons, score };
}

/* ======================== attachments (files) ======================== */
const DANGER_EXT = /\.(apk|apks|xapk|exe|scr|bat|cmd|msi|jar|vbs|vbe|ps1|lnk|js|jse|wsf|hta|dll|sh|bin|pif|reg|iso|img|dmg|pkg|appimage)$/i;
const DOUBLE_EXT = /\.(jpe?g|png|gif|pdf|docx?|xlsx?|pptx?|mp4|mp3|txt|webp)\.(exe|scr|bat|apk|js|vbs|lnk|cmd|msi|jar|hta|ps1)$/i;

function assessFile({ fileName = '', mimetype = '' } = {}) {
    const name = String(fileName).trim();
    const reasons = []; let score = 0;
    const add = (n, why) => { score += n; reasons.push(why); };
    if (DOUBLE_EXT.test(name)) add(3, `has a fake double extension (${name.slice(-30)})`);
    else if (DANGER_EXT.test(name)) add(3, 'is an installable or executable file');
    if (/android\.package-archive|x-msdownload|x-msdos-program|x-dosexec/i.test(mimetype) && !reasons.length) add(3, 'is an installable or executable file');
    if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) add(1, 'is a compressed file that can hide harmful files');
    if (/\.(docm|xlsm|pptm|dotm)$/i.test(name)) add(2, 'is an Office file that can run macros');
    if (/\.(html?|xhtml|svg)$/i.test(name)) add(2, 'is a web page file (often used for phishing)');
    return { level: toLevel(score), reasons, score, name };
}

/* ======================== images & videos ======================== */
const LABELS = { S1: 'violence', S2: 'illegal activity / fraud', S3: 'sexual crime content', S4: 'child safety', S7: 'private information', S9: 'weapons', S10: 'hate', S11: 'self-harm', S12: 'sexual content / nudity' };
const VISION_RE = /llama-4|scout|maverick|vision|[-/]vl\b|pixtral|llava/i;
const imageCache = new Map();
let callWindow = [];
const canCall = (n = 1) => { const now = Date.now(); callWindow = callWindow.filter(t => now - t < 60000); if (callWindow.length + n > 30) return false; for (let i = 0; i < n; i++) callWindow.push(now); return true; };

async function prepareJpeg(buffer) {
    try {
        const sharp = require('sharp');
        return await sharp(buffer).rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 80 }).toBuffer();
    } catch {
        return buffer.length < 3.5 * 1024 * 1024 ? buffer : null;
    }
}

function parseVision(text) {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
        const j = JSON.parse(m[0]); const labels = [];
        if (j.nudity || j.sexual) labels.push(LABELS.S12);
        if (j.graphic_violence || j.gore) labels.push('graphic violence');
        if (j.child_safety) labels.push(LABELS.S4);
        if (j.self_harm) labels.push(LABELS.S11);
        if (isStrict()) {
            if (j.weapons) labels.push(LABELS.S9);
            if (j.hate_symbols) labels.push('hate symbols');
            if (j.drugs) labels.push('illegal drugs');
            if (j.scam) labels.push('scam / fake payment screenshot');
        }
        return { flagged: labels.length > 0, labels };
    } catch { return null; }
}

const VISION_PROMPT = 'You are a content safety classifier. Look at the image and reply ONLY with JSON: {"nudity":bool,"sexual":bool,"graphic_violence":bool,"gore":bool,"self_harm":bool,"child_safety":bool,"weapons":bool,"hate_symbols":bool,"drugs":bool,"scam":bool}. "scam" means a fake bank alert, fake payment receipt, phishing page, fake giveaway or crypto scam screenshot. Use true only when clearly present.';

async function runGuard(model, dataUrl) {
    const out = await rawChat(model, [{ role: 'user', content: [{ type: 'text', text: 'Check this image.' }, { type: 'image_url', image_url: { url: dataUrl } }] }], { maxTokens: 30 });
    const m = out.match(/^\s*(safe|unsafe)\s*([\s\S]*)$/i);
    if (!m) return null;
    const allowed = isStrict() ? ['S1', 'S2', 'S3', 'S4', 'S7', 'S9', 'S10', 'S11', 'S12'] : ['S1', 'S3', 'S4', 'S9', 'S10', 'S11', 'S12'];
    const codes = (m[2].match(/S\d+/gi) || []).map(s => s.toUpperCase()).filter(c => allowed.includes(c));
    const labels = [...new Set(codes.map(c => LABELS[c]).filter(Boolean))];
    return { flagged: m[1].toLowerCase() === 'unsafe' && labels.length > 0, labels, model };
}

async function runVision(model, dataUrl) {
    const out = await rawChat(model, [
        { role: 'system', content: VISION_PROMPT },
        { role: 'user', content: [{ type: 'text', text: 'Classify this image.' }, { type: 'image_url', image_url: { url: dataUrl } }] }
    ], { maxTokens: 100 });
    const parsed = parseVision(out);
    return parsed ? { ...parsed, model } : null;
}

// kind: 'image' (both models in strict mode) | 'frame' | 'sticker' (one model)
// -> { flagged, labels, model } or { skipped: 'why' }
async function scanImage(buffer, kind = 'image') {
    if (!hasGroqKey()) return { skipped: 'no Groq key' };
    const hash = crypto.createHash('sha1').update(buffer).digest('hex') + kind + config().level;
    if (imageCache.has(hash)) return imageCache.get(hash);

    const jpeg = await prepareJpeg(buffer);
    if (!jpeg) return { skipped: 'image too large' };
    const dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`;

    let ids = [];
    try { ids = await listModelIds(); } catch (e) { return { skipped: `could not read your Groq models (${e.response?.status || e.message})` }; }
    const guard = ids.find(i => /llama-guard-4/i.test(i));
    const vision = ids.find(i => /llama-4-scout/i.test(i)) || ids.find(i => VISION_RE.test(i));
    const both = isStrict() && kind === 'image' && guard && vision;
    if (!canCall(both ? 2 : 1)) return { skipped: 'scan limit reached for this minute' };

    const jobs = [];
    if (guard) jobs.push(runGuard(guard, dataUrl).catch(e => { console.error('Safety: Llama Guard failed:', e.response?.status || e.message); return null; }));
    if (vision && (both || !guard)) jobs.push(runVision(vision, dataUrl).catch(e => { console.error('Safety: vision model failed:', e.response?.status || e.message); return null; }));
    if (!jobs.length) return { skipped: ids.length ? 'no image safety model is available for your key' : 'no models available' };

    const results = (await Promise.all(jobs)).filter(Boolean);
    if (!results.length && vision && guard && !both) {      // guard failed: try the vision model
        try { const v = await runVision(vision, dataUrl); if (v) results.push(v); } catch { /* ignore */ }
    }
    if (!results.length) return { skipped: 'the safety models did not answer' };

    const labels = [...new Set(results.flatMap(r => r.labels))];
    const result = { flagged: results.some(r => r.flagged), labels, model: results.map(r => r.model).join(' + ') };
    imageCache.set(hash, result);
    if (imageCache.size > 300) imageCache.delete(imageCache.keys().next().value);
    return result;
}

/* ---- video frames (ffmpeg) ---- */
const run = (cmd, args, timeout = 20000) => new Promise((resolve, reject) => execFile(cmd, args, { timeout }, (err, stdout) => (err ? reject(err) : resolve(String(stdout)))));
let ffmpegOk = null;
async function hasFfmpeg() {
    if (ffmpegOk !== null) return ffmpegOk;
    try { await run('ffmpeg', ['-version'], 5000); ffmpegOk = true; } catch { ffmpegOk = false; }
    return ffmpegOk;
}

// Up to 2 real frames (strict) or 1 (normal) from a video, as JPEG buffers
async function videoFrames(buffer) {
    if (!(await hasFfmpeg())) return [];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safety-'));
    const file = path.join(dir, 'in.mp4');
    const frames = [];
    try {
        fs.writeFileSync(file, buffer);
        let duration = 0;
        try { duration = parseFloat((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], 8000)).trim()) || 0; } catch { /* unknown length */ }
        const points = duration > 1 ? (isStrict() ? [duration * 0.2, duration * 0.7] : [duration * 0.4]) : [0];
        for (const [i, t] of points.entries()) {
            const out = path.join(dir, `f${i}.jpg`);
            try {
                await run('ffmpeg', ['-v', 'error', '-ss', String(t.toFixed(2)), '-i', file, '-frames:v', '1', '-vf', 'scale=640:-2', '-y', out], 20000);
                if (fs.existsSync(out)) frames.push(fs.readFileSync(out));
            } catch { /* skip this frame */ }
        }
    } catch { /* ignore */ }
    finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
    return frames;
}

async function capabilities() {
    const ffmpeg = await hasFfmpeg();
    if (!hasGroqKey()) return { key: false, guard: false, vision: false, ffmpeg };
    try {
        const ids = await listModelIds();
        return { key: true, ffmpeg, guard: ids.some(i => /llama-guard-4/i.test(i)), vision: ids.some(i => VISION_RE.test(i)), count: ids.length };
    } catch (e) { return { key: true, ffmpeg, error: e.response?.status || e.message, guard: false, vision: false }; }
}

module.exports = {
    config, save, isEnabledFor, isStrict, toLevel, extractUrls, heuristics, assessUrl, assessText, scamHeuristics, assessFile,
    scanImage, videoFrames, capabilities, normDomain, registeredDomain, listModels: async () => { const g = require('./groq'); g.clearModelCache(); return g.listModelIds(); },
    _test: { reset: () => { aiCache.clear(); imageCache.clear(); aiWindow = []; callWindow = []; }, resetConfig: () => { cfg = null; } }
};
