/**
 * JNR-MD - Facebook video downloader
 * Commands: .fb  .facebook  .fbdl  <Facebook video link>
 *
 * Share links (facebook.com/share/..., fb.watch/...) are expanded first, then several download
 * servers are tried one after another. The first one that gives a real video is used.
 */
const axios = require('axios');

const processedMessages = new Set();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const enc = encodeURIComponent;
const MAX_VIDEO_BYTES = 64 * 1024 * 1024;   // bigger files are sent as a document

const PROVIDERS = [
    { name: 'delirius', url: (u) => `https://deliriussapi-oficial.vercel.app/download/fbdl?url=${enc(u)}` },
    { name: 'siputzx',  url: (u) => `https://api.siputzx.my.id/api/d/facebook?url=${enc(u)}` },
    { name: 'agatz',    url: (u) => `https://api.agatz.xyz/api/facebook?url=${enc(u)}` }
];

// Expands share / short links (facebook.com/share/r/..., fb.watch/...) to the real video URL
async function resolveFacebookUrl(shortUrl) {
    try {
        const response = await axios.get(shortUrl, {
            maxRedirects: 5, timeout: 15000,
            validateStatus: (s) => s >= 200 && s < 400,
            headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.5' }
        });
        return response.request?.res?.responseUrl || shortUrl;
    } catch {
        return shortUrl;
    }
}

const THUMB_KEYS = /thumb|image|cover|avatar|poster|photo|picture|preview/i;
const rank = (label) => {
    const s = String(label || '').toLowerCase();
    if (/hd|1080|720|high/.test(s)) return 3;
    if (/sd|480|360|low|normal/.test(s)) return 2;
    return 1;
};

// Different servers answer in different shapes: collect every video link and pick the best (HD first)
function pickVideo(payload) {
    const found = [];
    const walk = (node, label, depth = 0) => {
        if (depth > 6 || node == null) return;
        if (typeof node === 'string') {
            if (/^https?:\/\//i.test(node) && !THUMB_KEYS.test(label || '') && !/\.(jpe?g|png|webp|gif)(\?|$)/i.test(node)) {
                found.push({ url: node, label: label || '' });
            }
            return;
        }
        if (Array.isArray(node)) { node.forEach(n => walk(n, label, depth + 1)); return; }
        if (typeof node === 'object') {
            const quality = node.resolution || node.quality || node.label || node.type;
            for (const [key, value] of Object.entries(node)) {
                if (typeof value === 'string') walk(value, `${key} ${quality || ''}`, depth + 1);
                else walk(value, key, depth + 1);
            }
        }
    };
    walk(payload, '');
    const videos = found.filter(f => /\.mp4|fbcdn|video|download|dl|hd|sd|play|url|link/i.test(f.url + ' ' + f.label));
    videos.sort((a, b) => rank(b.label) - rank(a.label));
    const best = videos[0];
    return best ? { url: best.url, quality: rank(best.label) === 3 ? 'HD' : rank(best.label) === 2 ? 'SD' : '' } : null;
}

async function downloadVideo(url) {
    const res = await axios.get(url, {
        responseType: 'arraybuffer', timeout: 90000, maxContentLength: 120 * 1024 * 1024,
        headers: { 'User-Agent': UA, Referer: 'https://www.facebook.com/', Accept: '*/*' }
    });
    const buf = Buffer.from(res.data);
    if (buf.length < 10000) throw new Error('file too small');
    if (buf[0] === 0x3c || buf[0] === 0x7b) throw new Error('got a web page instead of a video');   // "<" or "{"
    return buf;
}

async function fbCommand(sock, chatId, message, args) {
    try {
        if (processedMessages.has(message.key.id)) return;
        processedMessages.add(message.key.id);
        setTimeout(() => processedMessages.delete(message.key.id), 5 * 60 * 1000).unref?.();

        // The link comes from the ORIGINAL message text (`args` is a lowercased copy, which breaks
        // case-sensitive Facebook share links such as /share/r/AbC123/)
        const originalText = message.message?.conversation ||
                             message.message?.extendedTextMessage?.text ||
                             message.message?.imageMessage?.caption ||
                             message.message?.videoMessage?.caption || '';
        const found = originalText.match(/https?:\/\/[^\s]+/i);
        const rawUrl = (found ? found[0] : (args && args[0]) || '').replace(/['"]+/g, '').trim();

        if (!rawUrl) {
            return await sock.sendMessage(chatId, {
                text: '⚠️ *Please send a Facebook video link!*\n\n*Example:* `.fb https://www.facebook.com/...`'
            }, { quoted: message });
        }
        if (!/https?:\/\/(?:[\w-]+\.)?(?:facebook\.com|fb\.com|fb\.watch|fb\.me)\//i.test(rawUrl)) {
            return await sock.sendMessage(chatId, { text: '❌ *That doesn\'t look like a valid Facebook link.*' }, { quoted: message });
        }

        if (await require('../lib/safetyGate').blocked(sock, chatId, message, rawUrl)) return;
        await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

        const resolvedUrl = await resolveFacebookUrl(rawUrl);
        const attempts = [...new Set([resolvedUrl, rawUrl])];   // some servers prefer the share link as it is

        let video = null;
        const failures = [];
        outer:
        for (const provider of PROVIDERS) {
            for (const target of attempts) {
                try {
                    const { data } = await axios.get(provider.url(target), { timeout: 30000, headers: { 'User-Agent': UA, Accept: 'application/json' } });
                    const picked = pickVideo(data);
                    if (!picked) throw new Error('no video link in the answer');
                    video = { ...picked, buffer: null };
                    try { video.buffer = await downloadVideo(picked.url); }
                    catch (e) { console.error(`[FB] ${provider.name}: download failed (${e.message}), sending by link`); }
                    break outer;
                } catch (err) {
                    const reason = err.response?.status ? `HTTP ${err.response.status}` : (err.code || err.message);
                    failures.push(`${provider.name}: ${reason}`);
                    console.error(`[FB] ${provider.name} failed: ${reason}`);
                }
            }
        }

        if (!video) {
            console.error('[FB] All servers failed ->', failures.join(' | '));
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return await sock.sendMessage(chatId, {
                text: '❌ *Could not download this Facebook video right now.*\n\nThe download servers may be busy, please try again in a few minutes. (Videos from private groups or private profiles cannot be downloaded.)'
            }, { quoted: message });
        }

        const caption = `🎬 *Facebook Video Downloaded*${video.quality ? `\n📹 *Quality:* ${video.quality}` : ''}`;
        const source = video.buffer || { url: video.url };
        if (video.buffer && video.buffer.length > MAX_VIDEO_BYTES) {
            await sock.sendMessage(chatId, { document: video.buffer, mimetype: 'video/mp4', fileName: 'facebook_video.mp4', caption }, { quoted: message });
        } else {
            await sock.sendMessage(chatId, { video: source, mimetype: 'video/mp4', caption }, { quoted: message });
        }
        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
    } catch (error) {
        console.error('Error in Facebook command execution:', error);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } }).catch(() => {});
        await sock.sendMessage(chatId, { text: '❌ *An error occurred while processing your request.*' }, { quoted: message });
    }
}

module.exports = fbCommand;
module.exports.pickVideo = pickVideo;
