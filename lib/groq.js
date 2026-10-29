/**
 * Shared Groq chat helper (used by .ai, .chatbot, .agent and away mode).
 *
 * The key is read from the .env file (GROQ_API_KEY=...) or from an environment variable.
 * If a model is not available for your account, the helper asks Groq which models you CAN use
 * and switches to one automatically.
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch { /* dotenv optional */ }

const BASE = process.env.GROQ_BASE || 'https://api.groq.com/openai/v1';
const PREFERRED = [
    process.env.GROQ_MODEL,
    'llama-3.3-70b-versatile',
    'openai/gpt-oss-120b',
    'llama-3.1-8b-instant',
    'openai/gpt-oss-20b',
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'qwen/qwen3-32b'
].filter(Boolean);
const NOT_CHAT = /whisper|tts|playai|guard|embed|orpheus|safeguard/i;

let workingModel = null;   // remembered after the first success

// The key: environment first, then read the .env file directly (handles quotes, spaces, empty env values)
function getKey() {
    let key = (process.env.GROQ_API_KEY || '').trim();
    if (!key) {
        try {
            const file = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
            const line = file.split(/\r?\n/).find(l => /^\s*GROQ_API_KEY\s*=/.test(l));
            if (line) key = line.replace(/^\s*GROQ_API_KEY\s*=/, '').trim();
        } catch { /* no .env file */ }
    }
    return key.replace(/^["']+|["']+$/g, '').trim();
}

const hasGroqKey = () => !!getKey();
// true when ANY AI provider has a key (Groq, or the backups below)
const hasKey = () => !!(getKey() || envValue('GEMINI_API_KEY') || envValue('OPENROUTER_API_KEY'));

const isModelProblem = (err) => {
    const status = err.response?.status;
    const code = err.response?.data?.error?.code || '';
    return status === 404 || code === 'model_not_found' || code === 'model_decommissioned' ||
           (status === 400 && /decommission|not supported|does not exist/i.test(JSON.stringify(err.response?.data || '')));
};

async function request(model, messages, apiKey, maxTokens, temperature) {
    const res = await axios.post(`${BASE}/chat/completions`,
        { model, messages, max_tokens: maxTokens, temperature },
        { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, timeout: 30000 });
    let text = res.data?.choices?.[0]?.message?.content || '';
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();   // some models print their reasoning
    if (!text) throw new Error('empty response');
    return text;
}

// Models this key can really use (asked from Groq), best first
async function availableModels(apiKey) {
    const res = await axios.get(`${BASE}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 20000 });
    const ids = (res.data?.data || []).map(m => m.id).filter(id => id && !NOT_CHAT.test(id));
    return [...PREFERRED.filter(p => ids.includes(p)), ...ids.filter(id => !PREFERRED.includes(id))];
}

// messages: [{ role: 'system'|'user'|'assistant', content }]
async function groqChat(messages, { maxTokens = 300, temperature = 0.8 } = {}) {
    const apiKey = getKey();
    if (!apiKey) throw new Error('GROQ_API_KEY is not set');

    const first = [...new Set([workingModel, ...PREFERRED].filter(Boolean))];
    let lastError;
    let onlyModelProblems = true;

    for (const model of first) {
        try {
            const text = await request(model, messages, apiKey, maxTokens, temperature);
            workingModel = model;
            return text;
        } catch (err) {
            lastError = err;
            const status = err.response?.status;
            if (status === 401 || status === 403) throw err;      // bad key: no model will work
            if (!isModelProblem(err)) onlyModelProblems = false;
            console.error(`Groq model ${model} failed:`, status || err.code || err.message,
                JSON.stringify(err.response?.data?.error || ''));
            if (status === 429) break;                            // rate limit: try again later
        }
    }

    // None of the usual models worked for this account: ask Groq which ones are available
    if (onlyModelProblems) {
        try {
            const models = (await availableModels(apiKey)).filter(m => !first.includes(m)).slice(0, 5);
            console.error('Groq models available for this key:', models.join(', ') || '(none)');
            for (const model of models) {
                try {
                    const text = await request(model, messages, apiKey, maxTokens, temperature);
                    workingModel = model;
                    console.log(`Groq: now using model ${model}`);
                    return text;
                } catch (err) {
                    lastError = err;
                    console.error(`Groq model ${model} failed:`, err.response?.status || err.code || err.message);
                }
            }
        } catch (err) {
            lastError = err;
            console.error('Groq could not list models:', err.response?.status || err.code || err.message,
                JSON.stringify(err.response?.data?.error || ''));
        }
    }
    throw lastError;
}

// One call to ONE named model (no fallback). Used for image safety checks.
async function rawChat(model, messages, { maxTokens = 200, temperature = 0 } = {}) {
    const apiKey = getKey();
    if (!apiKey) throw new Error('GROQ_API_KEY is not set');
    const res = await axios.post(`${BASE}/chat/completions`,
        { model, messages, max_tokens: maxTokens, temperature },
        { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, timeout: 30000 });
    return String(res.data?.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

// Every model id your key can use (cached for an hour)
let modelCache = { time: 0, ids: [] };
async function listModelIds() {
    if (modelCache.ids.length && Date.now() - modelCache.time < 3600000) return modelCache.ids;
    const apiKey = getKey();
    if (!apiKey) throw new Error('GROQ_API_KEY is not set');
    const res = await axios.get(`${BASE}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 20000 });
    modelCache = { time: Date.now(), ids: (res.data?.data || []).map(m => m.id).filter(Boolean) };
    return modelCache.ids;
}

// Reads any key from the environment or the .env file (used for optional extras)
function envValue(name) {
    let v = (process.env[name] || '').trim();
    if (!v) {
        try {
            const file = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
            const line = file.split(/\r?\n/).find(l => new RegExp(`^\\s*${name}\\s*=`).test(l));
            if (line) v = line.replace(new RegExp(`^\\s*${name}\\s*=`), '').trim();
        } catch { /* no .env */ }
    }
    return v.replace(/^["']+|["']+$/g, '').trim();
}

function clearModelCache() { modelCache = { time: 0, ids: [] }; }


/* ---------------- backup AI providers ----------------
   Groq sometimes refuses a host's network ("403 Access denied. Please check your network settings"),
   which is NOT a key problem. When that happens (or Groq is down / busy) the bot tries Gemini or
   OpenRouter, if a key for them is in .env. Speech-to-text and the image scanner stay Groq-only. */
const statusOf = (e) => e?.response?.status || e?.status;
const bodyText = (e) => { try { return JSON.stringify(e?.response?.data || e?.message || ''); } catch { return String(e?.message || ''); } };
// Groq (or its network shield) refusing this host's network, not the key
const isBlocked = (e) => statusOf(e) === 403 && /network settings|access denied|forbidden/i.test(bodyText(e));

async function geminiChat(messages, { maxTokens = 400, temperature = 0.7 } = {}) {
    const key = envValue('GEMINI_API_KEY');
    if (!key) throw new Error('GEMINI_API_KEY is not set');
    const base = envValue('GEMINI_BASE') || 'https://generativelanguage.googleapis.com/v1beta';
    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
    const contents = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content) }] }));
    const models = [...new Set([envValue('GEMINI_MODEL'), 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-flash-latest'].filter(Boolean))];
    let last;
    for (const m of models) {
        try {
            const res = await axios.post(`${base}/models/${m}:generateContent`, {
                ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
                contents: contents.length ? contents : [{ role: 'user', parts: [{ text: 'Hello' }] }],
                generationConfig: { maxOutputTokens: maxTokens, temperature }
            }, { headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, timeout: 30000 });
            const text = (res.data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
            if (!text) throw new Error('empty response');
            return text;
        } catch (e) { last = e; if (statusOf(e) !== 404) break; }   // 404 = that model name is gone: try the next one
    }
    throw last;
}

async function openRouterChat(messages, { maxTokens = 400, temperature = 0.7 } = {}) {
    const key = envValue('OPENROUTER_API_KEY');
    if (!key) throw new Error('OPENROUTER_API_KEY is not set');
    const base = envValue('OPENROUTER_BASE') || 'https://openrouter.ai/api/v1';
    const models = [...new Set([envValue('OPENROUTER_MODEL'), 'meta-llama/llama-3.3-70b-instruct:free', 'google/gemini-2.0-flash-exp:free'].filter(Boolean))];
    let last;
    for (const m of models) {
        try {
            const res = await axios.post(`${base}/chat/completions`, { model: m, messages, max_tokens: maxTokens, temperature },
                { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, timeout: 40000 });
            const text = String(res.data?.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
            if (!text) throw new Error('empty response');
            return text;
        } catch (e) { last = e; if (![404, 400].includes(statusOf(e))) break; }
    }
    throw last;
}

// Groq first; if it fails for any reason, the backups (only those that have a key)
async function chat(messages, opts = {}) {
    let groqError = null;
    if (getKey()) {
        try { return await groqChat(messages, opts); }
        catch (e) {
            groqError = e;
            console.error(`AI: Groq failed (${statusOf(e) || e.code || e.message})${isBlocked(e) ? ' - this host\'s network is blocked by Groq, not a key problem' : ''}`);
        }
    }
    const backups = [['Gemini', geminiChat, 'GEMINI_API_KEY'], ['OpenRouter', openRouterChat, 'OPENROUTER_API_KEY']].filter(b => envValue(b[2]));
    for (const [name, fn] of backups) {
        try { const t = await fn(messages, opts); console.log(`AI: answered by ${name}`); return t; }
        catch (e) { console.error(`AI: ${name} failed (${statusOf(e) || e.code || e.message})`); if (!groqError) groqError = e; }
    }
    if (groqError) throw groqError;
    throw new Error('GROQ_API_KEY is not set');
}

// One friendly sentence for any AI error (the real reason, not a guess)
function explainError(e) {
    const st = statusOf(e);
    if (!hasKey() || e?.message === 'GROQ_API_KEY is not set') return '❌ The AI is not set up yet. The owner needs to add *GROQ_API_KEY* to the .env file.';
    if (isBlocked(e)) return '⚠️ The AI service (Groq) is refusing connections from this bot\'s host network, so it is *not* your key. Owner: add a free *GEMINI_API_KEY* to .env as a backup, or move the bot to another host.';
    if (st === 401) return '❌ The AI key was rejected. Check the key in your .env file.';
    if (st === 403) return '❌ The AI service refused the request (403). Check that your key and project are allowed to use it.';
    if (st === 404 || e?.response?.data?.error?.code === 'model_not_found') return '❌ No AI model is available for this key. In the Groq console, check that your project has access to a chat model.';
    if (st === 429) return '⏳ The AI is busy right now (rate limit). Please try again in a minute.';
    if (e?.code === 'ECONNABORTED') return '⌛ The AI took too long to answer. Please try again.';
    return '❌ Failed to get a response. Please try again later.';
}

module.exports = { chat, hasKey, hasGroqKey, getKey, rawChat, listModelIds, envValue, clearModelCache, isBlocked, explainError };
