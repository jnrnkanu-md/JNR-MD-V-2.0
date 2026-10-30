const settings = require('../settings.js');
const style = require('../lib/style');

function formatTime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    if (secs || parts.length === 0) parts.push(`${secs}s`);
    return parts.join(' ');
}

// 🟢 fast / 🟡 okay / 🔴 slow
function quality(ms) {
    if (ms < 250) return '🟢 TURBO 🚀';
    if (ms < 700) return '🟡 Good';
    return '🔴 Slow';
}

function buildPing(ms) {
    const mb = Math.round(process.memoryUsage().rss / 1048576);
    return `${style.title}
━━━━━━━━━━━━━━━━━━
🏓 ${style.bold('PONG!')}  ⚡ ${style.boldItalic('Live status')}

╭━〔 📡 ${style.bold('NETWORK')} 〕━⬣
┃➤ ⚡ Speed : ${ms} ms
┃➤ 📶 Quality : ${quality(ms)}
┃➤ 🟢 Status : Online
╰━━━━━━━━━━━━⬣

╭━〔 🖥️ ${style.bold('SYSTEM')} 〕━⬣
┃➤ ⏱️ Uptime : ${formatTime(process.uptime())}
┃➤ 💾 Memory : ${mb} MB
┃➤ 📦 Version : ${settings.version}
┃➤ 👑 Owner : ${settings.botOwner || 'JNR NKANU'}
╰━━━━━━━━━━━━⬣

${style.powered}`;
}

async function pingCommand(sock, chatId, message) {
    try {
        const start = Date.now();
        const sent = await sock.sendMessage(chatId, { text: '🏓 *Pinging...*' }, { quoted: message });
        const ms = Math.max(1, Math.round((Date.now() - start) / 2));
        const text = buildPing(ms);

        // Turn the "Pinging..." message into the result; if editing is not possible send a new message
        try {
            if (!sent?.key) throw new Error('no key');
            await sock.sendMessage(chatId, { text, edit: sent.key });
        } catch {
            await sock.sendMessage(chatId, { text }, { quoted: message });
        }
    } catch (error) {
        console.error('Error in ping command:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to get bot status.' });
    }
}

module.exports = pingCommand;
module.exports.buildPing = buildPing;
