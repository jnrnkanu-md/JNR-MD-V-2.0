/**
 * Audio download helper for .play and .song
 *
 * Why "unable to load audio" happens: the free download server often returns a file that is NOT a real MP3
 * (it can be m4a, webm or opus data, a half-finished download, or even an error page) while the bot named it
 * ".mp3" and told WhatsApp it was MP3. WhatsApp then cannot play it.
 * This helper checks what was really downloaded, converts it to a real MP3 with ffmpeg when needed,
 * and retries once with a fresh link when the download is broken.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const { execFile } = require('child_process');

const API = 'https://apis.davidcyril.name.ng/play?query=';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const run = (cmd, args, timeout = 20000) => new Promise((resolve, reject) => execFile(cmd, args, { timeout }, (err, stdout) => (err ? reject(err) : resolve(String(stdout)))));

let ffmpegOk = null;
async function hasFfmpeg() {
    if (ffmpegOk !== null) return ffmpegOk;
    try { await run('ffmpeg', ['-version'], 5000); ffmpegOk = true; } catch { ffmpegOk = false; }
    return ffmpegOk;
}

// What is this file really? (looks at the first bytes)
function detectType(filePath) {
    const fd = fs.openSync(filePath, 'r');
    const b = Buffer.alloc(16);
    const n = fs.readSync(fd, b, 0, 16, 0);
    fs.closeSync(fd);
    if (n < 4) return 'empty';
    if (b.slice(0, 3).toString() === 'ID3') return 'mp3';
    if (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0) return 'mp3';
    if (b.slice(4, 8).toString() === 'ftyp') return 'mp4';
    if (b.slice(0, 4).toString() === 'OggS') return 'ogg';
    if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return 'webm';
    if (b.slice(0, 4).toString() === 'RIFF') return 'wav';
    if (b.slice(0, 4).toString() === 'fLaC') return 'flac';
    if (b[0] === 0x3C || b[0] === 0x7B) return 'text';          // "<" or "{": an error page, not audio
    return 'unknown';
}

async function durationOf(filePath) {
    try { return parseFloat((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath], 10000)).trim()) || 0; }
    catch { return 0; }
}

async function download(url, filePath, timeout) {
    const response = await axios({ url, method: 'GET', responseType: 'stream', timeout, headers: { 'User-Agent': UA } });
    if (response.status && response.status >= 400) throw new Error(`download server answered HTTP ${response.status}`);
    const expected = parseInt(response.headers?.['content-length'] || '0', 10);
    await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(filePath);
        response.data.on('error', reject);
        writer.on('error', reject);
        writer.on('finish', resolve);
        response.data.pipe(writer);
    });
    const size = fs.statSync(filePath).size;
    if (size < 10 * 1024) throw new Error('downloaded file is too small');
    if (expected && size < expected) throw new Error(`download was cut short (${size} of ${expected} bytes)`);
    return size;
}

// Makes sure the file is something WhatsApp can play. -> { filePath, mimetype, converted }
async function makePlayable(filePath) {
    const type = detectType(filePath);
    if (type === 'text' || type === 'empty') throw new Error('the download server sent an error page instead of audio');
    const ffmpeg = await hasFfmpeg();

    if (type === 'mp3') {
        if (!ffmpeg || (await durationOf(filePath)) > 1) return { filePath, mimetype: 'audio/mpeg', converted: false };
        // an "mp3" that has no readable length is broken: re-encode it below
    }
    // an m4a / AAC file in an mp4 container plays fine in WhatsApp as audio/mp4: no need to re-encode it
    if (type === 'mp4' && (!ffmpeg || (await durationOf(filePath)) > 1)) return { filePath, mimetype: 'audio/mp4', converted: false };
    if (!ffmpeg) {
        if (type === 'mp4') return { filePath, mimetype: 'audio/mp4', converted: false };
        if (type === 'ogg') return { filePath, mimetype: 'audio/ogg; codecs=opus', converted: false };
        throw new Error(`the file is ${type} audio and ffmpeg is not available to convert it`);
    }

    const out = `${filePath}.fixed.mp3`;
    try {
        await run('ffmpeg', ['-v', 'error', '-y', '-i', filePath, '-vn', '-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '2', out], 120000);
        if (fs.existsSync(out) && fs.statSync(out).size > 10 * 1024) return { filePath: out, mimetype: 'audio/mpeg', converted: true };
    } catch (e) { console.error('[AUDIO] mp3 conversion failed:', e.message); }
    // second try: AAC in an mp4 container (WhatsApp plays audio/mp4 as well)
    const out2 = `${filePath}.fixed.m4a`;
    try {
        await run('ffmpeg', ['-v', 'error', '-y', '-i', filePath, '-vn', '-map_metadata', '-1', '-c:a', 'aac', '-b:a', '128k', '-f', 'ipod', out2], 120000);
        if (fs.existsSync(out2) && fs.statSync(out2).size > 10 * 1024) return { filePath: out2, mimetype: 'audio/mp4', converted: true };
    } catch (e) { console.error('[AUDIO] aac conversion failed:', e.message); }
    throw new Error('could not convert the downloaded audio');
}

/**
 * Searches, downloads and prepares a song.
 * -> { filePath, mimetype, song, cleanup() }   (throws a readable error when everything fails)
 */
async function fetchSong(query, { apiTimeout = 30000, downloadTimeout = 120000, attempts = 2 } = {}) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        const files = [];
        const cleanup = () => files.forEach(f => { try { fs.unlinkSync(f); } catch { /* already gone */ } });
        try {
            const { data } = await axios.get(API + encodeURIComponent(query), { timeout: apiTimeout, headers: { 'User-Agent': UA } });
            if (!data || !data.status || !data.result || !data.result.download_url) throw new Error('the server could not find that song');
            const song = data.result;
            const safe = String(song.title || query).replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40);
            const raw = path.join(os.tmpdir(), `song_${Date.now()}_${attempt}_${safe}.dl`);
            files.push(raw);
            await download(song.download_url, raw, downloadTimeout);
            const playable = await makePlayable(raw);
            if (playable.filePath !== raw) files.push(playable.filePath);
            return { filePath: playable.filePath, mimetype: playable.mimetype, song, converted: playable.converted, cleanup };
        } catch (err) {
            lastError = err;
            console.error(`[AUDIO] attempt ${attempt} failed: ${err.message}`);
            cleanup();
            if (attempt < attempts) await new Promise(r => setTimeout(r, 1500));
        }
    }
    throw lastError;
}

module.exports = { fetchSong, makePlayable, detectType, hasFfmpeg, _test: { setFfmpeg: (v) => { ffmpegOk = v; } } };
