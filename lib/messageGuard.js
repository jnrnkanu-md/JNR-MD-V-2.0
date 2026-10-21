/**
 * Stops the bot from acting twice, or acting on old messages.
 *
 *  - only LIVE messages are handled: messages WhatsApp delivers late (after a restart or reconnect,
 *    or from the chat history) are ignored, so old commands are never run again while you are away
 *  - the same message is never handled twice (even if two connections deliver it, or WhatsApp repeats it)
 *  - a message older than settings.maxMessageAgeSeconds (default 90) is ignored
 *  - the same person repeating the same command within 3 seconds is ignored
 */
const settings = require('../settings');

const seen = new Map();      // "chat|messageId" -> time first seen
const recent = new Map();    // "chat|sender|command text" -> time
const DUPLICATE_MEMORY_MS = 15 * 60 * 1000;
const REPEAT_WINDOW_MS = 3000;

const toMs = (t) => {
    if (!t) return 0;
    const n = typeof t === 'number' ? t : (typeof t.toNumber === 'function' ? t.toNumber() : Number(t.low ?? t));
    if (!n || Number.isNaN(n)) return 0;
    return n > 1e12 ? n : n * 1000;                 // WhatsApp sends seconds
};

const textOf = (m) => m?.conversation || m?.extendedTextMessage?.text || m?.imageMessage?.caption || m?.videoMessage?.caption || m?.documentMessage?.caption || '';

function prune(map, ttl, now) {
    if (map.size < 1500) return;
    for (const [k, t] of map) if (now - t > ttl) map.delete(k);
}

// -> a short reason when the message must be skipped, or null when it should be handled
function shouldSkip(mek, chatUpdate, now = Date.now()) {
    const chatId = mek?.key?.remoteJid;
    if (!chatId || !mek.key.id) return null;
    const isStatus = chatId === 'status@broadcast';

    // 1. live messages only (offline / history deliveries come as "append")
    if (!isStatus && chatUpdate?.type && chatUpdate.type !== 'notify') return 'old delivery';

    // 2. never twice
    const dupKey = `${chatId}|${mek.key.id}`;
    if (seen.has(dupKey)) return 'duplicate';
    seen.set(dupKey, now);
    prune(seen, DUPLICATE_MEMORY_MS, now);

    // 3. too old
    const sent = toMs(mek.messageTimestamp);
    const maxAge = (Number(settings.maxMessageAgeSeconds) || 90) * 1000;
    if (!isStatus && sent && now - sent > maxAge) return 'old message';

    // 4. the same command repeated at once
    const text = textOf(mek.message).trim();
    const prefix = settings.prefix || '.';
    if (text.startsWith(prefix) && text.length > prefix.length) {
        const sender = mek.key.participant || chatId;
        const key = `${chatId}|${sender}|${text.toLowerCase()}`;
        if (recent.has(key) && now - recent.get(key) < REPEAT_WINDOW_MS) return 'repeated command';
        recent.set(key, now);
        prune(recent, REPEAT_WINDOW_MS, now);
    }
    return null;
}

module.exports = { shouldSkip, _test: { reset: () => { seen.clear(); recent.clear(); } } };
