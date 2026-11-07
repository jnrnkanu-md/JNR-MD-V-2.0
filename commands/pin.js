const axios = require('axios');
const style = require('../lib/style');

/**
 * JNR-MD - Pinterest downloader
 * Command: .pin <pin link>   (also .pinterest)
 * Works with pinterest.com/pin/..., pin.it/... short links. Sends the video, GIF or picture.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const LINK = /https?:\/\/(?:[\w-]+\.)?(?:pinterest\.[a-z.]+|pin\.it)\/\S+/i;
const done = new Set();

const unescapeUrl = (u) => String(u || '').replace(/\\u002F/g, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&');

async function resolve(url) {
    const res = await axios.get(url, {
        timeout: 20000, maxRedirects: 8, headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
        validateStatus: s => s < 500
    });
    const finalUrl = res.request?.res?.responseUrl || url;
    return { html: typeof res.data === 'string' ? res.data : JSON.stringify(res.data), finalUrl };
}

function pinId(u) {
    const m = String(u).match(/\/pin\/(?:[^/?#]*-)?(\d{6,})/);
    return m ? m[1] : null;
}

function fromHtml(html) {
    const meta = (p) => {
        const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']+)["']`, 'i'))
               || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${p}["']`, 'i'));
        return m ? unescapeUrl(m[1]) : null;
    };
    const title = (meta('og:title') || '').replace(/\s*\|\s*Pinterest.*$/i, '').trim();

    // 1. real video files embedded in the page data
    const vids = [...html.matchAll(/"url"\s*:\s*"(https:[^"]+?\.mp4[^"]*)"/g)].map(m => unescapeUrl(m[1]));
    const mp4 = vids.find(v => /720p|1080p|\/videos\/iht\//.test(v)) || vids[0];
    if (mp4) return { type: 'video', url: mp4, title };

    const og = meta('og:video') || meta('og:video:url') || meta('twitter:player:stream');
    if (og && /\.mp4/i.test(og)) return { type: 'video', url: og, title };

    // 2. GIF
    const gif = (html.match(/"(https:[^"]+?\.gif)"/) || [])[1];
    if (gif) return { type: 'image', url: unescapeUrl(gif), title };

    // 3. original-size image
    const orig = (html.match(/"orig"\s*:\s*\{[^}]*?"url"\s*:\s*"([^"]+)"/) || [])[1];
    if (orig) return { type: 'image', url: unescapeUrl(orig), title };
    const img = meta('og:image') || meta('twitter:image');
    if (img) return { type: 'image', url: img.replace(/\/\d+x\//, '/originals/'), title };
    return null;
}

async function fromWidget(id) {
    const { data } = await axios.get(`https://widgets.pinterest.com/v3/pidgets/pins/info/?pin_ids=${id}`, { timeout: 20000, headers: { 'User-Agent': UA } });
    const p = data?.data?.[0];
    if (!p) throw new Error('pin not found');
    const vl = p.videos?.video_list;
    if (vl) {
        const best = vl.V_720P || Object.values(vl).find(v => v?.url && /\.mp4/.test(v.url));
        if (best?.url) return { type: 'video', url: best.url, title: p.description || '' };
    }
    const im = p.images?.orig?.url || p.images?.['736x']?.url;
    if (!im) throw new Error('no media');
    return { type: 'image', url: im, title: p.description || '' };
}

async function getBuffer(url) {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000, maxContentLength: 60 * 1024 * 1024, headers: { 'User-Agent': UA, Referer: 'https://www.pinterest.com/' } });
    const buf = Buffer.from(res.data);
    if (buf.length < 1500 || buf[0] === 0x3c) throw new Error('not a media file');
    return buf;
}

async function pinCommand(sock, chatId, message) {
    if (done.has(message.key.id)) return;
    done.add(message.key.id);
    setTimeout(() => done.delete(message.key.id), 5 * 60 * 1000).unref?.();

    const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
    const found = text.match(LINK);
    if (!found) {
        return sock.sendMessage(chatId, { text: `❌ Send a Pinterest link after the command.\n\n*Example:* \`.pin https://pin.it/xxxx\`` }, { quoted: message });
    }
    const url = found[0].replace(/[)\].,]+$/, '');
    try {
        if (await require('../lib/safetyGate').blocked(sock, chatId, message, url)) return;
    } catch {}

    await sock.sendMessage(chatId, { react: { text: '🔄', key: message.key } });

    let media = null; const why = [];
    let page = null;
    try {
        page = await resolve(url);
        media = fromHtml(page.html);
        if (!media) why.push('page: no media found');
    } catch (e) { why.push('page: ' + (e.response?.status ? 'HTTP ' + e.response.status : e.code || e.message)); }

    if (!media || media.type === 'image') {
        const id = pinId(page?.finalUrl || url);
        if (id) {
            try { const w = await fromWidget(id); if (w && (!media || w.type === 'video')) media = w; }
            catch (e) { why.push('widget: ' + (e.message)); }
        }
    }

    if (!media) {
        console.error('[PIN] failed ->', why.join(' | '));
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        return sock.sendMessage(chatId, { text: '❌ Could not download this pin. Make sure the link is a public Pinterest pin and try again.' }, { quoted: message });
    }

    const caption = `⬇️ ${style.bold('DOWNLOADED BY')} *JNR-MD*` + (media.title ? `\n\n📝 ${String(media.title).slice(0, 200)}` : '');
    let data;
    try { data = await getBuffer(media.url); } catch { data = { url: media.url }; }
    const isGif = /\.gif(\?|$)/i.test(media.url);
    const payload = media.type === 'video'
        ? { video: data, mimetype: 'video/mp4', caption }
        : isGif ? { video: data, gifPlayback: true, mimetype: 'video/mp4', caption }
        : { image: data, caption };
    await sock.sendMessage(chatId, payload, { quoted: message });
    await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
}

module.exports = pinCommand;
module.exports._test = { fromHtml, pinId };
