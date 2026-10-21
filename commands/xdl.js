/**
 * JNR-MD - X (Twitter) downloader
 * Commands: .x  .xdl  .twitter  .tw  <link to a post>
 * Downloads the videos, GIFs and photos of a post. Two free servers are tried one after another.
 */
const axios = require('axios');
const style = require('../lib/style');

const processedMessages = new Set();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const LINK = /https?:\/\/(?:www\.|mobile\.)?(?:twitter\.com|x\.com|t\.co)\/[^\s]+/i;
const MAX_VIDEO_BYTES = 64 * 1024 * 1024;   // bigger videos are sent as a document
const MAX_PHOTOS = 4;

// Gets the user name and post id from a link (t.co short links are expanded first)
async function parseLink(url) {
    let finalUrl = url;
    if (/\/\/t\.co\//i.test(url)) {
        try {
            const res = await axios.get(url, { maxRedirects: 5, timeout: 15000, validateStatus: s => s < 400, headers: { 'User-Agent': UA } });
            finalUrl = res.request?.res?.responseUrl || url;
        } catch { /* keep the short link */ }
    }
    const m = finalUrl.match(/(?:twitter\.com|x\.com)\/(?:([A-Za-z0-9_]+)\/)?status(?:es)?\/(\d+)/i);
    if (!m) return null;
    const user = m[1] && !/^i$/i.test(m[1]) ? m[1] : 'i';
    return { user, id: m[2] };
}

// Each provider returns { name, handle, text, media: [{ type: 'video'|'photo', url }] } or throws
const PROVIDERS = [
    {
        name: 'fxtwitter',
        run: async ({ user, id }) => {
            const { data } = await axios.get(`https://api.fxtwitter.com/${user}/status/${id}`, { timeout: 20000, headers: { 'User-Agent': UA } });
            const t = data?.tweet;
            if (!t) throw new Error(data?.message || 'post not found');
            const all = t.media?.all || [...(t.media?.photos || []), ...(t.media?.videos || [])];
            return {
                name: t.author?.name, handle: t.author?.screen_name, text: t.text,
                media: all.filter(m => m?.url).map(m => ({ type: m.type === 'photo' ? 'photo' : 'video', url: m.url }))
            };
        }
    },
    {
        name: 'vxtwitter',
        run: async ({ user, id }) => {
            const { data } = await axios.get(`https://api.vxtwitter.com/${user}/status/${id}`, { timeout: 20000, headers: { 'User-Agent': UA } });
            if (!data || (!data.text && !data.media_extended)) throw new Error('post not found');
            return {
                name: data.user_name, handle: data.user_screen_name, text: data.text,
                media: (data.media_extended || []).filter(m => m?.url).map(m => ({ type: m.type === 'image' ? 'photo' : 'video', url: m.url }))
            };
        }
    }
];

async function fetchBuffer(url) {
    const res = await axios.get(url, {
        responseType: 'arraybuffer', timeout: 90000, maxContentLength: 120 * 1024 * 1024,
        headers: { 'User-Agent': UA, Accept: '*/*' }
    });
    const buf = Buffer.from(res.data);
    if (buf.length < 2000) throw new Error('file too small');
    if (buf[0] === 0x3c || buf[0] === 0x7b) throw new Error('got a web page instead of a file');   // "<" or "{"
    return buf;
}

async function xdlCommand(sock, chatId, message) {
    try {
        if (processedMessages.has(message.key.id)) return;
        processedMessages.add(message.key.id);
        setTimeout(() => processedMessages.delete(message.key.id), 5 * 60 * 1000).unref?.();

        const text = message.message?.conversation || message.message?.extendedTextMessage?.text ||
                     message.message?.imageMessage?.caption || message.message?.videoMessage?.caption || '';
        const found = text.match(LINK);
        if (!found) {
            return await sock.sendMessage(chatId, {
                text: '❌ Please send a link to an X (Twitter) post.\n\n*Example:* `.x https://x.com/user/status/123456789`'
            }, { quoted: message });
        }

        if (await require('../lib/safetyGate').blocked(sock, chatId, message, found[0])) return;
        await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

        const target = await parseLink(found[0].replace(/[)\].,]+$/, ''));
        if (!target) {
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return await sock.sendMessage(chatId, { text: '❌ That link does not point to a post. It should look like `x.com/user/status/123…`' }, { quoted: message });
        }

        let post = null;
        const failures = [];
        for (const provider of PROVIDERS) {
            try { post = await provider.run(target); if (post) break; }
            catch (err) {
                const reason = err.response?.status ? `HTTP ${err.response.status}` : (err.code || err.message);
                failures.push(`${provider.name}: ${reason}`);
                console.error(`[X] ${provider.name} failed: ${reason}`);
            }
        }

        if (!post) {
            console.error('[X] All servers failed ->', failures.join(' | '));
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return await sock.sendMessage(chatId, {
                text: '❌ Could not get this post right now.\nIt may be deleted, private or age-restricted, or the servers are busy. Please try again in a few minutes.'
            }, { quoted: message });
        }

        const who = [post.name, post.handle ? `@${post.handle}` : ''].filter(Boolean).join(' ');
        const body = String(post.text || '').replace(/https?:\/\/t\.co\/\S+/g, '').trim().slice(0, 300);
        const caption = `🐦 ${style.bold('X DOWNLOAD')}${who ? `\n👤 ${who}` : ''}${body ? `\n\n📝 ${body}` : ''}`;

        const videos = post.media.filter(m => m.type === 'video');
        const photos = post.media.filter(m => m.type === 'photo').slice(0, MAX_PHOTOS);

        if (!videos.length && !photos.length) {
            await sock.sendMessage(chatId, { react: { text: 'ℹ️', key: message.key } });
            return await sock.sendMessage(chatId, { text: `${caption}\n\nℹ️ This post has no photo or video to download.` }, { quoted: message });
        }

        let first = true;
        for (const v of videos) {
            let buf = null;
            try { buf = await fetchBuffer(v.url); } catch (e) { console.error('[X] video download failed, sending by link:', e.message); }
            const cap = first ? caption : undefined;
            if (buf && buf.length > MAX_VIDEO_BYTES) {
                await sock.sendMessage(chatId, { document: buf, mimetype: 'video/mp4', fileName: 'x_video.mp4', caption: cap }, { quoted: message });
            } else {
                await sock.sendMessage(chatId, { video: buf || { url: v.url }, mimetype: 'video/mp4', caption: cap }, { quoted: message });
            }
            first = false;
        }
        for (const p of photos) {
            await sock.sendMessage(chatId, { image: { url: p.url }, caption: first ? caption : undefined }, { quoted: message });
            first = false;
        }
        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
    } catch (error) {
        console.error('Error in X download command:', error);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } }).catch(() => {});
        await sock.sendMessage(chatId, { text: '❌ Failed to download this post. Please try again later.' }, { quoted: message });
    }
}

module.exports = xdlCommand;
module.exports.parseLink = parseLink;
