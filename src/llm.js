const config = require('./config');
const logger = require('./logger');

// Picks the right API key for the chosen provider.
function getApiKey() {
  if (config.llmProvider === 'groq') {
    return process.env.GROQ_API_KEY || config.llmApiKey || '';
  }
  return config.llmApiKey || '';
}

function isConfigured() {
  return Boolean(getApiKey());
}

function describe() {
  return { provider: config.llmProvider, model: config.llmModel, configured: isConfigured() };
}

function extractJson(text) {
  const cleaned = String(text || '').replace(/```json|```/g, '').trim();
  const start = cleaned.search(/[\[{]/);
  const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
  if (start === -1 || end === -1 || end < start) throw new Error('Model output contained no JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function post(url, headers, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.llmTimeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`LLM request timed out after ${config.llmTimeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const providers = {
  anthropic: async (system, user) => {
    const data = await post(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': getApiKey(), 'anthropic-version': '2023-06-01' },
      { model: config.llmModel, max_tokens: 4000, system, messages: [{ role: 'user', content: user }] }
    );
    return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  },
  openai: async (system, user) => {
    const data = await post(
      `${config.openaiBaseUrl}/chat/completions`,
      { Authorization: `Bearer ${getApiKey()}` },
      {
        model: config.llmModel,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
      }
    );
    return data.choices && data.choices[0] ? data.choices[0].message.content : '';
  },
  gemini: async (system, user) => {
    const data = await post(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.llmModel)}:generateContent?key=${encodeURIComponent(getApiKey())}`,
      {},
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { responseMimeType: 'application/json' }
      }
    );
    const parts = data.candidates && data.candidates[0] && data.candidates[0].content ? data.candidates[0].content.parts : [];
    return parts.map((p) => p.text || '').join('');
  },
  groq: async (system, user) => {
    const data = await post(
      'https://api.groq.com/openai/v1/chat/completions',
      { Authorization: `Bearer ${getApiKey()}` },
      {
        model: config.llmModel,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `${system}\n\nRespond with valid JSON only.` },
          { role: 'user', content: user }
        ]
      }
    );
    return data.choices && data.choices[0] ? data.choices[0].message.content : '';
  }
};

async function askJson({ system, user, projectId, task }) {
  if (!isConfigured()) throw new Error('No LLM API key configured');
  const call = providers[config.llmProvider];
  if (!call) throw new Error(`Unsupported LLM provider "${config.llmProvider}"`);
  const started = Date.now();
  logger.info('llm.request', { projectId, task, provider: config.llmProvider, model: config.llmModel, promptChars: system.length + user.length });
  try {
    const raw = await call(system, user);
    const parsed = extractJson(raw);
    logger.info('llm.response', { projectId, task, ms: Date.now() - started, responseChars: raw.length });
    return parsed;
  } catch (err) {
    logger.error('llm.failure', { projectId, task, ms: Date.now() - started, message: err.message.replace(getApiKey(), '[redacted]') });
    throw err;
  }
}

module.exports = { askJson, isConfigured, describe, extractJson };