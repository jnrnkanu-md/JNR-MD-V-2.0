/**
 * JNR-MD - AI chat command (Groq)
 * Commands: .ai  .ask  .gpt  .chatgpt  .gemini  .llama  .groq  <question>
 *
 * Needs a Groq API key in the .env file:  GROQ_API_KEY=your_key
 */
const { chat, hasKey } = require('../lib/groq');

const COMMAND_NAMES = ['ask', 'llama', 'gemini', 'ai', 'groq', 'chatgpt', 'gpt'];

const SYSTEM_PROMPT = 'You are JNR-MD, a friendly and helpful WhatsApp assistant. ' +
    'Answer clearly and keep replies reasonably short. Use simple formatting that works in WhatsApp.';

function explain(err) {
    const status = err.response?.status;
    const code = err.response?.data?.error?.code;
    if (status === 401 || status === 403) return '❌ The AI key is invalid or expired. Check *GROQ_API_KEY* in your .env file.';
    if (status === 404 || code === 'model_not_found') return '❌ No AI model is available for this key. In the Groq console, check that your project has access to a chat model.';
    if (status === 429) return '⏳ The AI is busy right now (rate limit). Please try again in a minute.';
    if (err.code === 'ECONNABORTED') return '⌛ The AI took too long to answer. Please try again.';
    return '❌ Failed to get a response. Please try again later.';
}

async function aiCommand(sock, chatId, message) {
    try {
        const text = message.message?.conversation ||
                     message.message?.extendedTextMessage?.text || '';
        if (!text) return;

        const parts = text.trim().split(/\s+/);
        const name = parts[0].toLowerCase().replace(/^[#.!/]/, '');
        if (!COMMAND_NAMES.includes(name)) return;

        const question = parts.slice(1).join(' ').trim();
        if (!question) {
            return await sock.sendMessage(chatId, {
                text: `❌ Please provide a question.\nExample: *.${name} what is a noun?*`
            }, { quoted: message });
        }

        if (!hasKey()) {
            console.error('GROQ_API_KEY is empty. Paste your key after GROQ_API_KEY= in the .env file and restart the bot.');
            return await sock.sendMessage(chatId, {
                text: '❌ AI is not set up yet. The bot owner needs to add the *GROQ_API_KEY* in the .env file.'
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, { react: { text: '🤖', key: message.key } }).catch(() => {});

        const answer = await chat([
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: question }
        ], { maxTokens: 1000, temperature: 0.7 });
        await sock.sendMessage(chatId, { text: answer }, { quoted: message });
    } catch (err) {
        console.error('AI command error:', err.response?.status || err.code || err.message,
            JSON.stringify(err.response?.data?.error || ''));
        await sock.sendMessage(chatId, { text: explain(err) }, { quoted: message });
    }
}

module.exports = aiCommand;
