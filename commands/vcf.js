const chalk = require('chalk');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const isAdmin = require('../lib/isAdmin');
const isOwnerOrSudo = require('../lib/isOwner');
const names = require('../lib/names');

/**
 * .vcf  (in a group)       -> a contact file with ONLY that group's members (numbers + names)
 * .vcf  (reply to a .vcf)  -> re-labels that file's contacts with the same tag
 * Every name gets the tag at the end:  Name 🫧ᴶᴺᴿ⁻ᴹᴰ🔥
 * Group admins and the bot owner only.
 */
const TAG = '🫧ᴶᴺᴿ⁻ᴹᴰ🔥';

const digitsOf = (jid) => (jid ? String(jid).split('@')[0].split(':')[0].replace(/\D/g, '') : '');
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, ' ');

function buildVcf(entries) {
    return entries.map(({ number, name }) => {
        const full = `${name} ${TAG}`;
        return `BEGIN:VCARD\nVERSION:3.0\nN:;${esc(full)};;;\nFN:${esc(full)}\nTEL;TYPE=CELL;waid=${number}:+${number}\nEND:VCARD`;
    }).join('\n') + '\n';
}

// A real phone number for a group participant (not a LID)
function phoneOf(p) {
    const candidates = [p.phoneNumber, p.jid, p.id];
    for (const c of candidates) {
        if (c && String(c).endsWith('@s.whatsapp.net')) return digitsOf(c);
    }
    return null;
}

function nameOf(p, number) {
    const store = (() => { try { return require('../lib/lightweight_store'); } catch { return null; } })();
    const ids = [p.id, p.lid, p.phoneNumber, p.jid, number && `${number}@s.whatsapp.net`];
    const fromStore = store && ids.map(i => store.contacts?.[i]?.name).find(Boolean);
    return (names.lookup(ids) || p.name || p.notify || fromStore || `+${number}`).trim();
}

const safeFile = (s) => String(s || 'Group').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 40) || 'Group';

async function vcfCommand(sock, chatId, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const isGroup = chatId.endsWith('@g.us');
        const ctx = message.message?.extendedTextMessage?.contextInfo;
        const documentMessage = ctx?.quotedMessage?.documentMessage;

        if (!isGroup && !documentMessage) {
            return await sock.sendMessage(chatId, {
                text: '❌ Use *.vcf* inside a group to get that group\'s contacts, or reply to a .vcf file.'
            }, { quoted: message });
        }

        if (isGroup && !message.key.fromMe && !(await isOwnerOrSudo(senderId, sock, chatId))) {
            const { isSenderAdmin } = await isAdmin(sock, chatId, senderId);
            if (!isSenderAdmin) {
                return await sock.sendMessage(chatId, { text: '❌ Only group admins can use *.vcf*.' }, { quoted: message });
            }
        }

        await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });
        const entries = [];
        let skipped = 0;
        let fileLabel = 'Contacts';
        let groupName = '';

        if (isGroup && !documentMessage) {
            // ---- ONLY the members of THIS group ----
            const meta = await sock.groupMetadata(chatId);
            groupName = meta.subject || 'Group';
            fileLabel = groupName;
            const botNumber = digitsOf(sock.user?.id);
            const seen = new Set();
            for (const p of meta.participants || []) {
                const number = phoneOf(p);
                if (!number) { skipped++; continue; }          // hidden-number (LID only) members
                if (number === botNumber || seen.has(number)) continue;
                seen.add(number);
                entries.push({ number, name: nameOf(p, number) });
            }
        } else {
            // ---- reply to a .vcf file: same contacts, new tag ----
            const stream = await downloadContentFromMessage(documentMessage, 'document');
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            const text = Buffer.concat(chunks).toString('utf-8');
            fileLabel = (documentMessage.fileName || 'Contacts').replace(/\.vcf$/i, '');
            const seen = new Set();
            for (const block of text.split(/BEGIN:VCARD/i)) {
                if (!block.trim()) continue;
                const fn = block.match(/^FN(?:;[^:]*)?:(.*)$/im);
                const n = block.match(/^N(?:;[^:]*)?:(.*)$/im);
                let name = (fn ? fn[1] : n ? n[1].replace(/;/g, ' ') : '').trim().replace(/\s*🫧.*$/u, '');
                for (const m of block.matchAll(/^TEL(?:;[^:]*)?:(.*)$/gim)) {
                    const number = m[1].replace(/\D/g, '');
                    if (number.length < 7 || seen.has(number)) continue;
                    seen.add(number);
                    entries.push({ number, name: name || `+${number}` });
                }
            }
        }

        if (entries.length === 0) {
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return await sock.sendMessage(chatId, { text: '❌ No contacts with phone numbers were found.' }, { quoted: message });
        }

        const buffer = Buffer.from(buildVcf(entries), 'utf-8');
        const caption = `✅ *VCF ready!*\n\n` +
            `👥 *Group:* ${groupName || fileLabel}\n` +
            `📇 *Contacts:* ${entries.length}\n` +
            (skipped ? `🙈 *Skipped (hidden numbers):* ${skipped}\n` : '') +
            `🏷️ *Tag added:* ${TAG}`;

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
        await sock.sendMessage(chatId, {
            document: buffer,
            mimetype: 'text/vcard',
            fileName: `${safeFile(fileLabel)}.vcf`,
            caption
        }, { quoted: message });
    } catch (err) {
        console.error(chalk.red('[ERROR] in vcf command:'), err);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } }).catch(() => {});
        await sock.sendMessage(chatId, { text: '❌ Could not create the contact file. Please try again.' }, { quoted: message });
    }
}

module.exports = { vcfCommand, buildVcf, TAG };
