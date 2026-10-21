// commands/groq-config.js
// Centralized Groq/OpenAI API key loader. Reads GROQ_API_KEY from environment.
// Usage: const {GROQ_API_KEY, getAuthHeader} = require('./groq-config');

// Load .env in local development. Ensure dotenv is installed if you rely on .env files.
try { require('dotenv').config(); } catch (e) { /* dotenv optional */ }

const GROQ_API_KEY = process.env.GROQ_API_KEY;

function getAuthHeader() {
  if (!GROQ_API_KEY) {
    // Fail fast in dev, but don't crash in production if you prefer a different behavior
    console.warn('GROQ_API_KEY is not set. Set it in your environment or .env file.');
  }
  return { Authorization: `Bearer ${GROQ_API_KEY}` };
}

module.exports = { GROQ_API_KEY, getAuthHeader };
