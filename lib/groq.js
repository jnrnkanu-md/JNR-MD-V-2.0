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

const BASE = 'https://api.groq.com/openai/v1';
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

const hasKey = () => !!getKey();

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
async function chat(messages, { maxTokens = 300, temperature = 0.8 } = {}) {
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

module.exports = { chat, hasKey, getKey, rawChat, listModelIds, envValue, clearModelCache };
