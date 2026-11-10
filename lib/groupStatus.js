/**
 * Group Status helper.
 * WhatsApp needs the media type to be read from a normal (unwrapped) message, and the
 * "groupStatusMessageV2" wrapper to be added only just before encryption. So the command sends a normal
 * message tagged with a one-time secret, and patch() (given to the socket as patchMessageBeforeSending)
 * wraps only those tagged messages.
 */
const tagged = new Set();

const hex = (u) => Buffer.from(u || []).toString('hex');

function tag(secret) { tagged.add(hex(secret)); setTimeout(() => tagged.delete(hex(secret)), 10 * 60 * 1000).unref?.(); }

function patch(message) {
    try {
        const sec = message?.messageContextInfo?.messageSecret;
        if (sec && tagged.has(hex(sec))) {
            const { messageContextInfo, ...content } = message;
            return { messageContextInfo, groupStatusMessageV2: { message: content } };
        }
    } catch {}
    return message;
}

module.exports = { tag, patch };
