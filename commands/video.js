const axios = require('axios');
const yts = require('yt-search');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * JNR-MD - YouTube video downloader
 * Commands: .video  .ytmp4  .yt  <video name or YouTube link>
 *
 * Several download servers are tried one after another, so if one is down
 * (or its key has expired) the next one is used automatically.
 */

const MEGAN_API_KEY = 'megan_ee570c538efeae230e2c8a8361b81707';
const enc = encodeURIComponent;

const PROVIDERS = [
    { name: 'megan',   url: u => `https://apis.megan.qzz.io/download/hd?api_key=${MEGAN_API_KEY}&url=${enc(u)}` },
    { name: 'siputzx', url: u => `https://api.siputzx.my.id/api/d/ytmp4?url=${enc(u)}` },
    { name: 'izumi',   url: u => `https://izumiiiiiiii.dpdns.org/downloader/youtube?url=${enc(u)}&format=720` }
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const LINK_KEYS = ['proxyUrl', 'downloadUrl', 'download_url', 'dl', 'download', 'mp4', 'video', 'url', 'link'];
const MAX_VIDEO_BYTES = 60 * 1024 * 1024; // bigger files are sent as a document

// Different servers use different response shapes, so look for the first link-like value
function pickMedia(payload) {
    let title = null;
    const walk = (obj, depth = 0) => {
        if (!obj || typeof obj !== 'object' || depth > 4) return null;
        if (!title && typeof obj.title === 'string') title = obj.title;
        for (const key of LINK_KEYS) {
            if (typeof obj[key] === 'string' && /^https?:\/\//i.test(obj[key])) return obj[key];
        }
        for (const value of Object.values(obj)) {
            const found = walk(value, depth + 1);
            if (found) return found;
        }
        return null;
    };
    const url = walk(payload);
    return url ? { url, title } : null;
}

async function downloadToFile(url, filePath) {
    const response = await axios({
        url, method: 'GET', responseType: 'stream', timeout: 180000,
        headers: { 'User-Agent': UA }
    });
    await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
    });
    const size = fs.statSync(filePath).size;
    if (size < 20 * 1024) throw new Error('file too small (probably an error page)');
    // Real video files never start with "<" (HTML) or "{" (JSON)
    const fd = fs.openSync(filePath, 'r');
    const head = Buffer.alloc(8);
    fs.readSync(fd, head, 0, 8, 0);
    fs.closeSync(fd);
    if (head[0] === 0x3c || head[0] === 0x7b) throw new Error('server returned a page instead of a video');
    return size;
}

async function videoCommand(sock, chatId, message) {
    let tempFilePath = null;
    try {
        const text = message.message?.conversation
            || message.message?.extendedTextMessage?.text
            || message.text
            || '';

        const searchQuery = text.split(' ').slice(1).join(' ').trim();

        if (!searchQuery) {
            await sock.sendMessage(chatId, {
                text: '❌ *Usage:* `.video <video name or YouTube link>`\n(`.yt` and `.ytmp4` work too)\n\n*Example:* `.video Golden by hunters`'
            }, { quoted: message });
            return;
        }

        let targetUrl = '';
        let videoTitle = searchQuery;
        let videoThumbnail = '';

        const isUrl = /^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\/.+/i.test(searchQuery);

        if (isUrl) {
            targetUrl = searchQuery;
        } else {
            const searchResult = await yts(searchQuery);
            if (!searchResult || !searchResult.videos || searchResult.videos.length === 0) {
                await sock.sendMessage(chatId, { text: '❌ No videos found for your search query!' }, { quoted: message });
                return;
            }
            targetUrl = searchResult.videos[0].url;
            videoTitle = searchResult.videos[0].title;
            videoThumbnail = searchResult.videos[0].thumbnail;
        }

        if (isUrl && await require('../lib/safetyGate').blocked(sock, chatId, message, targetUrl)) return;

        if (videoThumbnail) {
            await sock.sendMessage(chatId, {
                image: { url: videoThumbnail },
                caption: `🎬 Downloading Video: *${videoTitle}*\n_Please wait..._`
            }, { quoted: message });
        } else {
            await sock.sendMessage(chatId, {
                text: `🎬 *Processing:* _"${searchQuery}"_\n_Please wait, downloading video..._`
            }, { quoted: message });
        }

        // Try each download server until one gives a real video file
        let title = videoTitle;
        let fileSize = 0;
        const failures = [];
        for (const provider of PROVIDERS) {
            try {
                const { data } = await axios.get(provider.url(targetUrl), {
                    timeout: 45000,
                    headers: { 'User-Agent': UA, Accept: 'application/json' }
                });
                const media = pickMedia(data);
                if (!media) throw new Error('no video link in response');

                title = media.title || videoTitle;
                const safe = title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40);
                tempFilePath = path.join(os.tmpdir(), `video_${Date.now()}_${safe}.mp4`);
                fileSize = await downloadToFile(media.url, tempFilePath);
                failures.length = 0;
                break;
            } catch (err) {
                const reason = err.response?.status ? `HTTP ${err.response.status}` : (err.code || err.message);
                failures.push(`${provider.name}: ${reason}`);
                console.error(`[VIDEO] ${provider.name} failed: ${reason}`);
                if (tempFilePath && fs.existsSync(tempFilePath)) { try { fs.unlinkSync(tempFilePath); } catch {} }
                tempFilePath = null;
            }
        }

        if (!tempFilePath) {
            console.error('[VIDEO] All servers failed ->', failures.join(' | '));
            await sock.sendMessage(chatId, {
                text: '❌ Could not download this video right now. All download servers failed, please try again later.'
            }, { quoted: message });
            return;
        }

        const cleanName = `${title.replace(/[^\w\s-]/g, '').trim() || 'video'}.mp4`;
        const caption = `*${title}*\n\n> *_Downloaded by JNR-MD_*`;

        if (fileSize > MAX_VIDEO_BYTES) {
            await sock.sendMessage(chatId, {
                document: { url: tempFilePath }, mimetype: 'video/mp4', fileName: cleanName, caption
            }, { quoted: message });
        } else {
            await sock.sendMessage(chatId, {
                video: { url: tempFilePath }, mimetype: 'video/mp4', fileName: cleanName, caption
            }, { quoted: message });
        }

    } catch (error) {
        console.error('[VIDEO] Command Error:', error?.message || error);
        let errorMessage = '❌ Failed to download video.';
        if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
            errorMessage = '❌ Download timed out. The video might be too large or the server is busy.';
        }
        await sock.sendMessage(chatId, { text: errorMessage }, { quoted: message });
    } finally {
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            try { fs.unlinkSync(tempFilePath); } catch {}
        }
    }
}

module.exports = videoCommand;
