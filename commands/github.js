const moment = require('moment-timezone');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const settings = require('../settings');
const isOwnerOrSudo = require('../lib/isOwner');

/**
 * .git  .github  .sc  .script  .repo
 * Shows the repository card. Live numbers come from the GitHub API and are kept for 10 minutes,
 * so the command is instant and never hits GitHub's rate limit. If GitHub cannot be reached (private
 * repo, no network, rate limit) a normal card is still sent instead of an error.
 */
const OWNER_REPO = 'jnrnkanu-md/JNR-MD-V-2.0';
const REPO_URL = `https://github.com/${OWNER_REPO}`;
let cache = { at: 0, json: null };

async function loadRepo() {
    if (cache.json && Date.now() - cache.at < 10 * 60 * 1000) return { json: cache.json };
    try {
        const headers = { 'User-Agent': 'JNR-MD-bot', Accept: 'application/vnd.github+json' };
        const token = (process.env.GITHUB_TOKEN || '').trim();
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(`https://api.github.com/repos/${OWNER_REPO}`, { headers, timeout: 8000 });
        if (!res.ok) throw new Error(res.status === 404 ? 'GitHub says 404: the repository is private or the name is wrong' : res.status === 403 ? 'GitHub rate limit reached (403)' : `GitHub answered HTTP ${res.status}`);
        const json = await res.json();
        cache = { at: Date.now(), json };
        return { json };
    } catch (e) {
        if (cache.json) return { json: cache.json };            // an older copy is better than nothing
        return { error: e.message };
    }
}

async function githubCommand(sock, chatId, message) {
    const { json, error } = await loadRepo();
    const name = settings.botName || 'JNR-MD';
    let txt = `*乂  ${name}  乂*\n\n`;
    if (json) {
        txt += `✩  *Name* : ${json.name}\n`;
        txt += `✩  *Stars* : ${json.stargazers_count}\n`;
        txt += `✩  *Forks* : ${json.forks_count}\n`;
        txt += `✩  *Watchers* : ${json.watchers_count}\n`;
        txt += `✩  *Size* : ${(json.size / 1024).toFixed(2)} MB\n`;
        txt += `✩  *Last Updated* : ${moment(json.updated_at).format('DD/MM/YY - HH:mm:ss')}\n`;
        txt += `✩  *URL* : ${json.html_url}\n\n`;
    } else {
        txt += `✩  *Version* : ${settings.version || 'V-2.0'}\n`;
        txt += `✩  *Owner* : ${settings.botOwner || 'JNR NKANU'}\n`;
        txt += `✩  *URL* : ${REPO_URL}\n\n`;
        try {
            const sender = message.key.participant || message.key.remoteJid;
            if (message.key.fromMe || await isOwnerOrSudo(sender, sock, chatId)) txt += `🔧 _Owner note: live stats unavailable (${error}). Using the basic card._\n\n`;
        } catch { /* note is optional */ }
    }
    txt += `💥 *${name}*`;

    try {
        const image = fs.readFileSync(path.join(__dirname, '../assets/bot_image.jpg'));
        await sock.sendMessage(chatId, { image, caption: txt }, { quoted: message });
    } catch {
        await sock.sendMessage(chatId, { text: txt }, { quoted: message });
    }
}

module.exports = githubCommand;
