const axios = require('axios');
const style = require('../lib/style');
const isOwnerOrSudo = require('../lib/isOwner');
const { envValue } = require('../lib/groq');

/**
 * .sora <prompt>   text to video
 *
 * Sources, tried in order:
 *   1. the free community endpoint (api.siputzx.my.id), which is unreliable and often offline
 *   2. fal.ai (reliable, needs a FAL_KEY in the .env file; new accounts get free credits, then it is paid)
 */

const COMMUNITY = (prompt) => `https://api.siputzx.my.id/api/ai/sora?prompt=${encodeURIComponent(prompt)}`;
const FAL_MODEL = () => envValue('FAL_VIDEO_MODEL') || 'fal-ai/ltx-video';
const head = (name) => `🎥 ${style.bold(name)}\n━━━━━━━━━━━━━━━━━━\n`;

const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);
const pickUrl = (d) => [d?.data, d?.url, d?.result, d?.video?.url, d?.videos?.[0]?.url, d?.data?.url, d?.result?.url].find(isHttp) || null;

async function fromCommunity(prompt) {
    const res = await axios.get(COMMUNITY(prompt), { timeout: 60000 });
    const url = pickUrl(res.data);
    if (!url) throw new Error('the community server did not return a video');
    return url;
}

async function fromFal(prompt) {
    const key = envValue('FAL_KEY');
    if (!key) return null;                                  // not set up: skip this source
    const res = await axios.post(`https://fal.run/${FAL_MODEL()}`, { prompt }, {
        headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' }, timeout: 240000
    });
    const url = pickUrl(res.data);
    if (!url) throw new Error('fal.ai did not return a video');
    return url;
}

async function soraCommand(sock, chatId, message) {
    try {
        const rawText = message.message?.conversation?.trim() ||
            message.message?.extendedTextMessage?.text?.trim() ||
            message.message?.imageMessage?.caption?.trim() ||
            message.message?.videoMessage?.caption?.trim() || '';

        const used = (rawText || '').split(/\s+/)[0] || '.sora';
        const args = rawText.slice(used.length).trim();
        const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const quotedText = quoted?.conversation || quoted?.extendedTextMessage?.text || '';
        const input = args || quotedText;

        if (!input) {
            return await sock.sendMessage(chatId, {
                text: `${head('SORA VIDEO')}Describe the video you want.\n\n╭━〔 💡 ${style.bold('EXAMPLE')} 〕━⬣\n┃➤ .sora a baby laughing\n┃➤ .sora futuristic city\n╰━━━━━━━━━━━━⬣`
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, { react: { text: '🎥', key: message.key } }).catch(() => {});
        await sock.sendMessage(chatId, { text: `${head('SORA VIDEO')}⏳ Creating your video...\nThis can take 1 to 3 minutes.` }, { quoted: message });

        let videoUrl = null;
        const failures = [];
        for (const [name, source] of [['community', fromCommunity], ['fal.ai', fromFal]]) {
            try {
                videoUrl = await source(input);
                if (videoUrl) break;
            } catch (err) {
                const reason = err.response?.status ? `HTTP ${err.response.status}` : (err.code || err.message);
                failures.push(`${name}: ${reason}`);
                console.error(`[SORA] ${name} failed: ${reason}`);
            }
        }

        if (!videoUrl) {
            console.error('[SORA] all sources failed ->', failures.join(' | ') || 'none available');
            const senderId = message.key.participant || message.key.remoteJid;
            const isOwner = message.key.fromMe || await isOwnerOrSudo(senderId, sock, chatId);
            let hint = '';
            if (isOwner) {
                const falFail = failures.find(f => f.startsWith('fal.ai'));
                if (!envValue('FAL_KEY')) hint = '\n\n👑 Owner tip: the free server is down. For a reliable source, add a *FAL_KEY* (from fal.ai) to your .env file and restart.';
                else if (falFail) {
                    const code = (falFail.match(/HTTP (\d+)/) || [])[1];
                    const why = code === '401' || code === '403' ? 'your key was rejected or your balance is empty'
                        : code === '404' || code === '422' ? 'the video model was not found or refused this prompt'
                        : 'it did not answer in time';
                    hint = `\n\n👑 Owner: fal.ai said ${falFail.replace('fal.ai: ', '')}, ${why}. Check your key and balance at fal.ai.`;
                }
            }
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } }).catch(() => {});
            return await sock.sendMessage(chatId, {
                text: `${head('VIDEO FAILED')}❌ The video server is offline.\nPlease try again later.${hint}`
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, {
            video: { url: videoUrl },
            mimetype: 'video/mp4',
            caption: `${head('SORA VIDEO')}📝 ${input.slice(0, 200)}`
        }, { quoted: message });
        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } }).catch(() => {});
    } catch (error) {
        console.error('[SORA] error:', error?.message || error);
        await sock.sendMessage(chatId, { text: `${head('VIDEO FAILED')}❌ Something went wrong.\nPlease try again later.` }, { quoted: message });
    }
}

module.exports = soraCommand;
