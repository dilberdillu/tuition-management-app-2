// Assistant chat. The conversation lives in this tab only (sessionStorage) and is sent with each question.
(function () {
  const form = document.getElementById('chat-form');
  if (!form) return;
  const log = document.getElementById('chat-log');
  const empty = document.getElementById('chat-empty');
  const input = document.getElementById('chat-input');
  const send = document.getElementById('chat-send');
  const clear = document.getElementById('chat-clear');
  const KEY = 'tm_chat';

  let messages = [];
  try { messages = JSON.parse(sessionStorage.getItem(KEY)) || []; } catch (e) { messages = []; }
  const save = () => sessionStorage.setItem(KEY, JSON.stringify(messages));

  // Replies are shown as plain text (never HTML); drop markdown markers the model sometimes adds anyway.
  const tidy = (text) => text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s+/gm, '');

  function bubble(role, text) {
    const div = document.createElement('div');
    div.className = `chat-msg chat-${role}`;
    div.textContent = role === 'assistant' ? tidy(text) : text;
    if (role === 'assistant') {
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'link-btn chat-copy';
      copy.textContent = 'Copy';
      copy.addEventListener('click', () => {
        navigator.clipboard.writeText(tidy(text)).then(() => {
          copy.textContent = 'Copied';
          setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
        });
      });
      div.appendChild(copy);
    }
    log.appendChild(div);
    return div;
  }

  function refresh() {
    empty.classList.toggle('hidden', messages.length > 0);
    clear.classList.toggle('hidden', messages.length === 0);
  }

  const scrollDown = () => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });

  // Grow the box with its text, up to the CSS max-height.
  const fit = () => { input.style.height = 'auto'; input.style.height = `${input.scrollHeight + 2}px`; };

  async function ask(text) {
    messages.push({ role: 'user', content: text });
    save();
    bubble('user', text);
    refresh();
    const waiting = bubble('typing', 'Thinking…');
    scrollDown();
    send.disabled = true;
    try {
      const res = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });
      if (res.redirected || res.status === 401) { window.location = '/login?next=/chat'; return; }
      const data = await res.json().catch(() => ({}));
      waiting.remove();
      if (!res.ok || !data.reply) throw new Error(data.error || 'Something went wrong. Please try again.');
      messages.push({ role: 'assistant', content: data.reply });
      save();
      bubble('assistant', data.reply);
    } catch (err) {
      waiting.remove();
      // Take the unanswered question back so it can be sent again.
      messages.pop();
      save();
      log.lastElementChild.remove();
      bubble('error', err.message || 'Could not reach the app. Check the internet connection.');
      input.value = text;
      fit();
      refresh();
    } finally {
      send.disabled = false;
      scrollDown();
    }
  }

  messages.forEach((m) => bubble(m.role, m.content));
  refresh();
  if (messages.length) window.scrollTo(0, document.body.scrollHeight);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || send.disabled) return;
    log.querySelectorAll('.chat-error').forEach((el) => el.remove());
    input.value = '';
    fit();
    ask(text);
  });

  // Enter sends on a computer; on phones Enter adds a new line and the Send button sends.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  input.addEventListener('input', fit);

  document.querySelectorAll('[data-ask]').forEach((btn) => {
    btn.addEventListener('click', () => ask(btn.dataset.ask));
  });

  clear.addEventListener('click', () => {
    messages = [];
    save();
    log.querySelectorAll('.chat-msg').forEach((el) => el.remove());
    refresh();
    input.focus();
  });
})();
