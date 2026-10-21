const axios = require('axios');

/**
 * JNR-MD - Google Search Command
 * Powered by David Cyril API
 */

async function googleCommand(sock, chatId, message, args) {
    try {
        if (!args || args.length === 0) {
            return await sock.sendMessage(chatId, { 
                text: "❌ *Please provide a search query.*\n\n*Usage:*\n• `.google <search query>`" 
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, { react: { text: '🔍', key: message.key } });

        const query = args.join(' ');
        const apiUrl = `https://apis.davidcyril.name.ng/search/google?q=${encodeURIComponent(query)}`;

        const { data } = await axios.get(apiUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 15000
        });

        // Extract results array dynamically depending on JSON payload structure
        const results = Array.isArray(data) ? data : (data?.results || data?.result || data?.data);

        if (!results || !Array.isArray(results) || results.length === 0) {
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return await sock.sendMessage(chatId, { 
                text: `❌ *No search results found for:* "${query}"` 
            }, { quoted: message });
        }

        // Take top 5 search results
        const topResults = results.slice(0, 5);

        let resultText = `🔍 *【 GOOGLE SEARCH RESULTS 】*\n\n`;
        resultText += `📌 *Query:* ${query}\n`;
        resultText += `───────────────────\n\n`;

        topResults.forEach((item, index) => {
            const title = item.title || item.heading || 'No Title';
            const snippet = item.snippet || item.description || item.content || 'No snippet available.';
            const url = item.url || item.link || item.href || '#';

            resultText += `*${index + 1}. ${title}*\n`;
            resultText += `📖 ${snippet}\n`;
            resultText += `🔗 ${url}\n\n`;
        });

        resultText += `> *_Powered by JNR-MD_*`;

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
        await sock.sendMessage(chatId, { text: resultText }, { quoted: message });

    } catch (err) {
        console.error('❌ Google Search Error:', err.message || err);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        await sock.sendMessage(chatId, { 
            text: "❌ *Failed to fetch search results. Please try again later.*" 
        }, { quoted: message });
    }
}

module.exports = googleCommand;
