const axios = require('axios');
const { execFile } = require('child_process');
const isOwnerOrSudo = require('../lib/isOwner');
const style = require('../lib/style');

/**
 * .dltest  (owner only): checks every download server and tells you which ones are alive.
 * Use it when .song / .play / .video / .tiktok / .fb stop working: if a server shows OFFLINE it is the
 * free server that is down (not the bot).
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const enc = encodeURIComponent;
const YT = 'https://youtu.be/dQw4w9WgXcQ';
const TT = 'https://www.tiktok.com/@tiktok/video/7106594312292453675';
const SERVERS = [
    ['Song  · knightbotapi', `https://knightbotapi.stream/api/ytmp3?apikey=knight&query=${enc('burna boy last last')}`, j => j && j.success && j.download],
    ['Song  · davidcyril', `https://apis.davidcyril.name.ng/play?query=${enc('burna boy last last')}`, j => j && j.status && j.result && j.result.download_url],
    ['Video · siputzx', `https://api.siputzx.my.id/api/d/ytmp4?url=${enc(YT)}`, j => j && (j.status || j.data)],
    ['Video · izumi', `https://izumiiiiiiii.dpdns.org/downloader/youtube?url=${enc(YT)}&format=720`, j => j && (j.result || j.status)],
    ['YouTube search', `https://www.youtube.com/results?search_query=${enc('last last')}`, null],
    ['TikTok · tikwm', `https://www.tikwm.com/api/?url=${enc(TT)}`, j => j && j.code === 0],
    ['TikTok · tiklydown', `https://api.tiklydown.eu.org/api/download/v3?url=${enc(TT)}`, j => j && (j.result || j.video)],
    ['Facebook · delirius', `https://deliriussapi-oficial.vercel.app/download/fbdl?url=${enc('https://www.facebook.com/watch?v=1')}`, null],
    ['X · fxtwitter', 'https://api.fxtwitter.com/jack/status/20', j => j && j.tweet]
];

async function probe([name, url, good]) {
    const t = Date.now();
    try {
        const r = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': UA }, validateStatus: () => true });
        const ms = Date.now() - t;
        if (r.status >= 500 || r.status === 404) return `❌ ${name}: DOWN (HTTP ${r.status})`;
        if (r.status === 401 || r.status === 403) return `⚠️ ${name}: BLOCKED (HTTP ${r.status}, key or IP refused)`;
        if (good) { let ok = false; try { ok = !!good(r.data); } catch {} return ok ? `✅ ${name}: working (${ms} ms)` : `⚠️ ${name}: answers but gave no download (${ms} ms)`; }
        return `✅ ${name}: reachable (${ms} ms)`;
    } catch (e) {
        return `❌ ${name}: OFFLINE (${e.code || e.message})`;
    }
}
const ffmpeg = () => new Promise(r => execFile('ffmpeg', ['-version'], { timeout: 8000 }, e => r(!e)));

module.exports = async function dltestCommand(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    if (!message.key.fromMe && !(await isOwnerOrSudo(senderId, sock, chatId))) {
        return sock.sendMessage(chatId, { text: '❌ Only the bot owner can use this.' }, { quoted: message });
    }
    await sock.sendMessage(chatId, { text: '🔎 Checking the download servers, this takes about 15 seconds...' }, { quoted: message });
    const lines = await Promise.all(SERVERS.map(probe));
    const hasFfmpeg = await ffmpeg();
    const up = lines.filter(l => l.startsWith('✅')).length;
    const text = `🧪 ${style.bold('DOWNLOAD SERVER CHECK')}\n━━━━━━━━━━━━━━━━━━\n${lines.join('\n')}\n` +
        `${hasFfmpeg ? '✅' : '❌'} ffmpeg: ${hasFfmpeg ? 'installed' : 'missing (some songs cannot be converted)'}\n━━━━━━━━━━━━━━━━━━\n` +
        `${up} of ${SERVERS.length} servers are working.\n` +
        (up === 0 ? 'Every server failed: this host may have no internet, or the whole list is down. Send this message to your developer.' :
            'A server marked DOWN, OFFLINE or BLOCKED is the problem, not the bot. The bot already switches to the next working one.');
    await sock.sendMessage(chatId, { text }, { quoted: message });
};
