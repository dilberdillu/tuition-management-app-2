// Staff AI assistant through OpenRouter (https://openrouter.ai). Turned off when OPENROUTER_API_KEY is not set.
// It only sees what staff type into the chat: no student records, fees or phone numbers are sent.
const config = require('./config');

const enabled = Boolean(config.openrouter.apiKey);
const { model } = config.openrouter;
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_MESSAGES = 20; // most recent turns sent with each question
const MAX_CHARS = 2000; // per message
const MAX_REPLY_TOKENS = 700;
const TIMEOUT_MS = 45 * 1000;

function systemPrompt() {
  return `You are the assistant inside the staff app of ${config.center.name}, a tuition centre in India for classes 8 to 10 (divisions A to D).
You help the staff with:
- writing short notices and messages for parents and students (fee reminders, holidays, exam dates, meetings),
- questions about teaching, study plans and exam preparation for classes 8 to 10,
- how to use this app.

How the app works:
- Home: today's collection, this month's collection, total pending fees and today's attendance.
- Collect fee (₹ button): search a student, the amount owed is filled in, pick Cash, UPI, Bank or Cheque and save. A PDF receipt can be downloaded straight away.${config.dodo.apiKey ? ' "Send online payment link instead" creates a link the parent can pay by UPI or card.' : ''}
- Every class has one fixed monthly fee, charged automatically each month. Payments settle the oldest month first. Fees are changed in Settings.
- Students: add or edit students and see each student's pending amount, month-by-month fees, receipts and attendance.
- Attendance: pick a class, everyone starts as present, tap the absentees and save.
- Reports: collections for any date range, filtered by class and payment mode, with CSV export.
- Settings (gear icon): monthly fee per class and changing the password. A receipt can be cancelled from its page but never deleted.

You cannot see any student records, fees or attendance. If asked about a particular student or amount, say so and point to the right page of the app. Never make up names, numbers or dates.
Reply in the language the staff member writes in. Keep answers short and simple; they are read on a phone. Use plain text: no markdown, no ** or #, no tables. Use "-" for lists. Amounts are in Indian rupees (₹).`;
}

// The browser keeps the conversation and sends it with every question. Returns null if it isn't valid.
function cleanMessages(input) {
  if (!Array.isArray(input) || input.length === 0) return null;
  const messages = input.slice(-MAX_MESSAGES).map((m) => ({
    role: m && m.role === 'assistant' ? 'assistant' : 'user',
    content: m && typeof m.content === 'string' ? m.content.trim().slice(0, MAX_CHARS) : '',
  }));
  const last = messages[messages.length - 1];
  if (last.role !== 'user' || !last.content) return null;
  return messages.filter((m) => m.content);
}

// Simple in-memory limit per staff login, so a stuck page or a shared login can't run up the bill.
const usage = new Map();
const LIMIT = 60;
const WINDOW_MS = 60 * 60 * 1000;

function allow(username) {
  const now = Date.now();
  const u = usage.get(username);
  if (!u || now - u.start > WINDOW_MS) { usage.set(username, { count: 1, start: now }); return true; }
  if (u.count >= LIMIT) return false;
  u.count += 1;
  return true;
}

async function reply(messages) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openrouter.apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'Tuition Manager',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt() }, ...messages],
      max_tokens: MAX_REPLY_TOKENS,
      temperature: 0.4,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.error) {
    const err = new Error(`OpenRouter ${res.status}: ${(data && data.error && data.error.message) || res.statusText}`);
    err.status = res.status;
    throw err;
  }
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text || !text.trim()) throw new Error('OpenRouter returned an empty reply');
  return { text: text.trim(), model: data.model || model, usage: data.usage || {} };
}

module.exports = { enabled, model, cleanMessages, allow, reply, MAX_CHARS };
