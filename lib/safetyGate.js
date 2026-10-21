/**
 * Used by the download commands: asks the safety scanner whether a link must be blocked.
 * If anything goes wrong inside the scanner, the download simply continues.
 */
async function blocked(sock, chatId, message, url) {
    try {
        return await require('../commands/safety').blockedBySafety(sock, chatId, message, url);
    } catch {
        return false;
    }
}

module.exports = { blocked };
