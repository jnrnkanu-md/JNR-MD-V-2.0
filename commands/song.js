const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const style = require('../lib/style');
const { makePlayable, fetchSong } = require('../lib/audio');

/**
 * .song / .play  <song name>
 * Main source: knightbotapi.stream (search + MP3 link in one call).
 * Safety net: the downloaded file is checked and converted to real audio WhatsApp can play, and if the
 * main source fails the bot falls back to the other song server automatically.
 */

const API_URL = 'https://knightbotapi.stream/api/ytmp3';
const shorten = (s, n = 30) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

// Same look as the rest of the bot: bold title, divider, ┃➤ lines
const card = (rows) => `🎵 ${style.bold('SONG DOWNLOADER')}\n━━━━━━━━━━━━━━━━━━\n${rows}`;

async function sendProcessing(sock, chatId, message, title, thumbnail) {
    const caption = card(`╭━〔 🎶 ${style.bold('NOW PROCESSING')} 〕━⬣\n┃➤ 🎧 ${shorten(title)}\n┃➤ ⏳ Downloading audio...\n╰━━━━━━━━━━━━⬣`);
    if (thumbnail) {
        try { return await sock.sendMessage(chatId, { image: { url: thumbnail }, caption }, { quoted: message }); }
        catch { /* thumbnail could not be sent: use plain text */ }
    }
    return sock.sendMessage(chatId, { text: caption }, { quoted: message });
}

async function songCommand(sock, chatId, message) {
    const cleanups = [];
    const cleanupAll = () => cleanups.forEach(f => { try { fs.unlinkSync(f); } catch { /* already gone */ } });
    try {
        const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';

        // Cleanly strip out .song, .play, /song, /play, !song, or !play prefixes
        const searchQuery = text.replace(/^[\.\/\\!]?\s*(song|play)\s*/i, '').trim();
        const word = ((text.match(/^[\.\/\\!]?\s*(song|play)/i) || [])[1] || 'song').toLowerCase();

        if (!searchQuery) {
            return await sock.sendMessage(chatId, {
                text: card(`What song do you want to download?\n\n╭━〔 💡 ${style.bold('EXAMPLE')} 〕━⬣\n┃➤ .${word} London view by bm\n╰━━━━━━━━━━━━⬣`)
            }, { quoted: message });
        }

        console.log(`[SONG COMMAND] Clean Query: "${searchQuery}"`);

        let title = searchQuery, audio = null, mimetype = 'audio/mpeg';
        try {
            // Fetch song details and download URL from the main API
            const { data } = await axios.get(API_URL, { params: { apikey: 'knight', query: searchQuery }, timeout: 120000 });
            if (!data || !data.success || !data.download) throw new Error('API response did not return a valid download link');

            title = data.title || searchQuery;
            await sendProcessing(sock, chatId, message, title, data.thumbnail);

            console.log(`[SONG COMMAND] Fetching audio from: ${data.download}`);
            const audioResponse = await axios.get(data.download, { responseType: 'arraybuffer', timeout: 90000 });
            const buffer = Buffer.from(audioResponse.data);
            if (!buffer || buffer.length === 0) throw new Error('Downloaded audio buffer is empty.');

            // Check what was really downloaded and make sure WhatsApp can play it
            const raw = path.join(os.tmpdir(), `song_${Date.now()}_raw.dl`);
            cleanups.push(raw);
            fs.writeFileSync(raw, buffer);
            const playable = await makePlayable(raw);
            if (playable.filePath !== raw) cleanups.push(playable.filePath);
            audio = fs.readFileSync(playable.filePath);
            mimetype = playable.mimetype;
        } catch (primaryError) {
            console.error('[SONG COMMAND] main source failed:', primaryError.response ? `HTTP ${primaryError.response.status}` : primaryError.message, '-> trying the backup server');
            const job = await fetchSong(searchQuery);            // throws if the backup fails too
            cleanups.push(job.filePath);
            title = job.song.title || searchQuery;
            await sendProcessing(sock, chatId, message, title, job.song.thumbnail);
            audio = fs.readFileSync(job.filePath);
            mimetype = job.mimetype;
            job.cleanup();
        }

        const cleanTitle = title.replace(/[^\w\s-]/g, '').trim() || 'audio';
        await sock.sendMessage(chatId, {
            audio,
            mimetype,
            fileName: `${cleanTitle}.${mimetype === 'audio/mp4' ? 'm4a' : 'mp3'}`,
            ptt: false
        }, { quoted: message });

    } catch (err) {
        if (err.response) console.error(`[SONG COMMAND ERROR] Status: ${err.response.status} | URL: ${err.config?.url}`);
        else console.error('[SONG COMMAND ERROR]:', err.message);

        let reason = 'I could not get a working audio file for that song right now. Please try again in a moment.';
        if (/could not find/i.test(err.message)) reason = 'I could not find that song. Try the artist and the title.';
        else if (err.response?.status === 404) reason = 'The song server is not responding (404). Please try again later.';
        else if (/timeout|ECONNABORTED/i.test(err.message)) reason = 'The server took too long. Please try again in a few seconds.';
        await sock.sendMessage(chatId, { text: `❌ ${style.bold('SONG FAILED')}\n━━━━━━━━━━━━━━━━━━\n${reason}` }, { quoted: message });
    } finally {
        cleanupAll();
    }
}

module.exports = songCommand;
