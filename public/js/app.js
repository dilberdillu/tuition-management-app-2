// Small progressive enhancements. Every page works without JavaScript.
(function () {
  // Selects that submit their form on change (month pickers, filters).
  document.querySelectorAll('[data-autosubmit]').forEach((el) => {
    el.addEventListener('change', () => el.form.submit());
  });

  // Forms that need a confirmation, e.g. cancelling a receipt.
  document.querySelectorAll('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      if (!window.confirm(form.dataset.confirm)) e.preventDefault();
    });
  });

  // Prevent double submits on slow connections.
  document.querySelectorAll('form[method="post"]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      if (e.defaultPrevented) return;
      form.querySelectorAll('button[type="submit"], button:not([type])').forEach((b) => {
        setTimeout(() => { b.disabled = true; }, 0);
      });
    });
  });

  // Live filter for lists: <input data-filter="#list"> filters children with data-search.
  document.querySelectorAll('[data-filter]').forEach((input) => {
    const list = document.querySelector(input.dataset.filter);
    if (!list) return;
    const items = Array.from(list.querySelectorAll('[data-search]'));
    const empty = document.querySelector(input.dataset.empty);
    let batch = '';
    const apply = () => {
      const q = input.value.trim().toLowerCase();
      let shown = 0;
      items.forEach((item) => {
        const ok = (!q || item.dataset.search.includes(q)) && (!batch || item.dataset.batch === batch);
        item.classList.toggle('hidden', !ok);
        if (ok) shown += 1;
      });
      if (empty) empty.classList.toggle('hidden', shown > 0);
    };
    input.addEventListener('input', apply);
    document.querySelectorAll('[data-batch-chip]').forEach((chip) => {
      chip.addEventListener('click', () => {
        batch = chip.dataset.batchChip;
        document.querySelectorAll('[data-batch-chip]').forEach((c) => c.classList.toggle('active', c === chip));
        apply();
      });
    });
    apply();
  });

  // Quick amount buttons on the collect screen.
  document.querySelectorAll('[data-amount]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById('amount');
      input.value = btn.dataset.amount;
      input.focus();
    });
  });

  // Payment links: copy, or open the phone's share sheet (WhatsApp, SMS...) where available.
  const copyText = (btn, text) => {
    navigator.clipboard.writeText(text).then(() => {
      const label = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = label; }, 1500);
    });
  };
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', () => copyText(btn, document.querySelector(btn.dataset.copy).value));
  });
  document.querySelectorAll('[data-share]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = document.querySelector(btn.dataset.share).value;
      if (navigator.share) navigator.share({ title: btn.dataset.shareTitle, url }).catch(() => {});
      else copyText(btn, url);
    });
  });

  // Attendance: live present/absent counts and "mark all" buttons.
  const attForm = document.getElementById('attForm');
  if (attForm) {
    const boxes = Array.from(attForm.querySelectorAll('input[name="present"]'));
    const update = () => {
      const p = boxes.filter((b) => b.checked).length;
      document.getElementById('presentCount').textContent = p;
      document.getElementById('absentCount').textContent = boxes.length - p;
    };
    boxes.forEach((b) => b.addEventListener('change', update));
    document.querySelectorAll('[data-mark-all]').forEach((btn) => {
      btn.addEventListener('click', () => {
        boxes.forEach((b) => { b.checked = btn.dataset.markAll === 'P'; });
        update();
      });
    });
    update();
  }
})();
