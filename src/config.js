const path = require('path');

const config = {
  get port() { return Number(process.env.PORT || 3000); },
  get dbPath() { return process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db'); },
  get secret() { return process.env.SESSION_SECRET || 'dev-secret-change-me'; },
  get llmProvider() { return (process.env.LLM_PROVIDER || 'anthropic').toLowerCase(); },
  get llmApiKey() {
    const byProvider = {
      anthropic: process.env.ANTHROPIC_API_KEY,
      openai: process.env.OPENAI_API_KEY,
      gemini: process.env.GEMINI_API_KEY
    };
    return byProvider[this.llmProvider] || '';
  },
  get llmModel() {
    const defaults = { anthropic: 'claude-sonnet-5-5', openai: 'gpt-4o-mini', gemini: 'gemini-2.0-flash' };
    return process.env.LLM_MODEL || defaults[this.llmProvider] || '';
  },
  get openaiBaseUrl() { return (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''); },
  get llmTimeoutMs() { return Number(process.env.LLM_TIMEOUT_MS || 60000); },
  get demoEmail() { return process.env.DEMO_EMAIL || 'reviewer@example.com'; },
  get demoPassword() { return process.env.DEMO_PASSWORD || 'Review@123'; },
  get maxRows() { return Number(process.env.MAX_ROWS || 5000); },
  get logStdout() { return process.env.LOG_STDOUT !== 'false'; }
};

module.exports = config;
