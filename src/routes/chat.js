const express = require('express');
const chat = require('../chat');
const analytics = require('../analytics');

const router = express.Router();

router.get('/chat', (req, res) => {
  res.render('chat', { title: 'Assistant', enabled: chat.enabled, maxChars: chat.MAX_CHARS });
});

// Called by public/js/chat.js with the whole conversation; answers with the assistant's reply.
router.post('/chat', express.json({ limit: '64kb' }), async (req, res) => {
  if (!chat.enabled) return res.status(503).json({ error: 'The assistant is not set up yet.' });
  const messages = chat.cleanMessages(req.body && req.body.messages);
  if (!messages) return res.status(400).json({ error: 'Type a question first.' });
  if (!chat.allow(req.session.user.username)) {
    return res.status(429).json({ error: 'Too many questions in the last hour. Please try again later.' });
  }
  try {
    const answer = await chat.reply(messages);
    // Never the text of the conversation: only its size and cost.
    analytics.track(req, 'assistant_replied', {
      model: answer.model,
      turns: messages.length,
      prompt_tokens: answer.usage.prompt_tokens,
      completion_tokens: answer.usage.completion_tokens,
    });
    res.json({ reply: answer.text });
  } catch (err) {
    console.error('Assistant failed:', err.message);
    analytics.track(req, 'assistant_failed', { status: err.status || null });
    const busy = err.status === 429;
    res.status(502).json({
      error: busy ? 'The assistant is busy. Please try again in a minute.' : 'The assistant is not answering right now. Please try again.',
    });
  }
});

module.exports = router;
