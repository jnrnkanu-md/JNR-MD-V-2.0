/**
 * The welcome message the bot sends to its own chat right after it connects.
 */
const fs = require('fs');
const path = require('path');
const settings = require('../settings');
const style = require('./style');

const TIMEZONE = 'Africa/Lagos';   // used for the date and time shown in the message

function currentMode() {
    try {
        const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/messageCount.json'), 'utf8'));
        return data.isPublic === false ? 'private' : 'public';
    } catch { return 'public'; }
}

function dateAndTime() {
    const now = new Date();
    try {
        return {
            date: new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, day: 'numeric', month: 'short', year: 'numeric' }).format(now),
            time: new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit', hour12: true }).format(now)
        };
    } catch {
        return { date: now.toDateString(), time: now.toLocaleTimeString() };
    }
}

function buildConnectMessage() {
    const prefix = settings.prefix || '.';
    const owner = String(settings.botOwner || 'boss').replace(/[™®©]/g, '').trim();
    const { date, time } = dateAndTime();
    return `${style.title}
${style.powered}
━━━━━━━━━━━━━━━━━━
✅ ${style.bold('BOT CONNECTED SUCCESSFULLY!')}
👋 Hello ${owner}, I'm ready!

╭━〔 📡 ${style.bold('STATUS')} 〕━⬣
┃➤ 🟢 Status : Online
┃➤ 📦 Version : ${settings.version}
┃➤ ⚡ Prefix : ${prefix}
┃➤ 🌍 Mode : ${currentMode()}
┃➤ 📅 Date : ${date}
┃➤ 🕒 Time : ${time}
╰━━━━━━━━━━━━⬣

╭━〔 🚀 ${style.bold('QUICK START')} 〕━⬣
┃➤ ${prefix}menu : all menus
┃➤ ${prefix}allmenu : every command
┃➤ ${prefix}ping : check speed
┃➤ ${prefix}ai hello : chat with AI
┃➤ ${prefix}agent : business assistant
╰━━━━━━━━━━━━⬣

📢 Join our channel for updates.`;
}

// The bot image (local file, so no internet is needed to send it)
function botImage() {
    try { return fs.readFileSync(path.join(__dirname, '../assets/bot_image.jpg')); } catch { return null; }
}

module.exports = { buildConnectMessage, botImage };
