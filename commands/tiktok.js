const axios = require('axios');
const style = require('../lib/style');

/**
 * JNR-MD - TikTok downloader
 * Commands: .tiktok  .tt  <TikTok link>
 *
 * Several free download servers are tried one after another (tikwm, tiklydown, siputzx and the
 * ruhend-scraper package). The first one that works is used. Nothing needs to be provided:
 * if all of them fail, the console shows the reason for each server.
 */

const processedMessages = new Set();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TIKTOK_LINK = /https?:\/\/(?:[\w-]+\.)?tiktok\.com\/\S+/i;
const enc = encodeURIComponent;

const abs = (u, base) => (u && u.startsWith('/') ? base + u : u);

// Each provider returns { video, title, audio, images } or throws
const PROVIDERS = [
    {
        name: 'tikwm',
        run: async (url) => {
            const { data } = await axios.get(`https://www.tikwm.com/api/?url=${enc(url)}&hd=1`, { timeout: 20000, headers: { 'User-Agent': UA } });
            const d = data?.data;
            if (!d || (data.code !== undefined && data.code !== 0)) throw new Error(data?.msg || 'no data');
            return {
                video: abs(d.hdplay || d.play, 'https://www.tikwm.com'),
                title: d.title,
                audio: abs(d.music, 'https://www.tikwm.com'),
                images: Array.isArray(d.images) && d.images.length ? d.images : null
            };
        }
    },
    {
        name: 'tiklydown',
        run: async (url) => {
            const { data } = await axios.get(`https://api.tiklydown.eu.org/api/download/v3?url=${enc(url)}`, { timeout: 20000, headers: { 'User-Agent': UA } });
            const r = data?.result || data;
            const video = r?.video?.noWatermark || r?.video?.watermark || r?.video?.url || (typeof r?.video === 'string' ? r.video : null);
            if (!video && !(r?.images || []).length) throw new Error('no video in response');
            return { video, title: r?.desc || r?.title, audio: r?.music?.play_url || null, images: (r?.images || []).length ? r.images : null };
        }
    },
    {
        name: 'siputzx',
        run: async (url) => {
            const { data } = await axios.get(`https://api.siputzx.my.id/api/d/tiktok?url=${enc(url)}`, { timeout: 20000, headers: { 'User-Agent': UA } });
            const d = data?.data;
            if (!data?.status || !d) throw new Error('invalid response');
            const video = (Array.isArray(d.urls) && d.urls[0]) || d.video_url || d.url || d.download_url;
            if (!video) throw new Error('no video url');
            return { video, title: d.metadata?.title };
        }
    },
    {
        name: 'ruhend',
        run: async (url) => {
            const { ttdl } = require('ruhend-scraper');
            const res = await ttdl(url);
            const items = res?.data || [];
            if (!items.length) throw new Error('no media');
            const video = items.find(m => m.type === 'video' || /\.(mp4|mov|webm)(\?|$)/i.test(m.url || ''));
            if (video) return { video: video.url, title: res.title };
            return { images: items.map(m => m.url).filter(Boolean), title: res.title };
        }
    }
];

async function fetchBuffer(url) {
    const res = await axios.get(url, {
        responseType: 'arraybuffer', timeout: 60000, maxContentLength: 100 * 1024 * 1024,
        headers: { 'User-Agent': UA, Referer: 'https://www.tiktok.com/', Accept: '*/*' }
    });
    const buf = Buffer.from(res.data);
    if (buf.length < 5000) throw new Error('file too small');
    if (buf[0] === 0x3c || buf[0] === 0x7b) throw new Error('got a web page instead of a video');   // "<" or "{"
    return buf;
}

async function tiktokCommand(sock, chatId, message) {
    try {
        if (processedMessages.has(message.key.id)) return;
        processedMessages.add(message.key.id);
        setTimeout(() => processedMessages.delete(message.key.id), 5 * 60 * 1000).unref?.();

        const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        const found = text.match(TIKTOK_LINK);
        if (!found) {
            return await sock.sendMessage(chatId, {
                text: '❌ Please send a TikTok link.\n\n*Example:* `.tiktok https://vm.tiktok.com/xxxx`'
            }, { quoted: message });
        }
        const url = found[0];
        if (await require('../lib/safetyGate').blocked(sock, chatId, message, url)) return;

        await sock.sendMessage(chatId, { react: { text: '🔄', key: message.key } });

        let result = null;
        const failures = [];
        for (const provider of PROVIDERS) {
            try {
                const r = await provider.run(url);
                if (r && (r.video || r.images)) { result = r; break; }
                throw new Error('empty result');
            } catch (err) {
                const reason = err.response?.status ? `HTTP ${err.response.status}` : (err.code || err.message);
                failures.push(`${provider.name}: ${reason}`);
                console.error(`[TIKTOK] ${provider.name} failed: ${reason}`);
            }
        }

        if (!result) {
            console.error('[TIKTOK] All servers failed ->', failures.join(' | '));
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return await sock.sendMessage(chatId, {
                text: '❌ Could not download this TikTok right now.\nMake sure the link is public, then try again in a few minutes.'
            }, { quoted: message });
        }

        const caption = `⬇️ ${style.bold('DOWNLOADED BY')} *JNR-MD*` + (result.title ? `\n\n📝 ${String(result.title).slice(0, 200)}` : '');

        // Photo slideshow
        if (!result.video && result.images) {
            for (const img of result.images.slice(0, 10)) {
                await sock.sendMessage(chatId, { image: { url: img }, caption }, { quoted: message });
            }
            return await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
        }

        // Video: send the file; if the download itself is blocked, let WhatsApp fetch the link
        let payload;
        try { payload = { video: await fetchBuffer(result.video), mimetype: 'video/mp4', caption }; }
        catch (err) {
            console.error('[TIKTOK] file download failed, sending by link:', err.message);
            payload = { video: { url: result.video }, mimetype: 'video/mp4', caption };
        }
        await sock.sendMessage(chatId, payload, { quoted: message });
        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
    } catch (error) {
        console.error('Error in TikTok command:', error);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } }).catch(() => {});
        await sock.sendMessage(chatId, { text: '❌ Failed to download this TikTok. Please try again later.' }, { quoted: message });
    }
}

module.exports = tiktokCommand;
