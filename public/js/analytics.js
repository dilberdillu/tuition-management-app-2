// PostHog page views, clicks and session replay for staff pages. Loaded only when POSTHOG_KEY is set.
// All page text and form inputs are masked, so student names, phones and amounts never leave the browser.
(function () {
  const cfg = document.currentScript.dataset;
  if (!window.posthog || !cfg.key) return;

  // The student search box puts names in the address (?q=...). Remove it from every URL we send.
  const scrub = (value) => {
    if (typeof value !== 'string' || !/[?&]q=/.test(value)) return value;
    try {
      const url = new URL(value, window.location.origin);
      url.searchParams.delete('q');
      return url.toString();
    } catch (e) {
      return value.replace(/([?&])q=[^&#]*&?/, '$1');
    }
  };
  const scrubAll = (obj) => {
    if (!obj) return;
    Object.keys(obj).forEach((key) => { obj[key] = scrub(obj[key]); });
  };

  window.posthog.init(cfg.key, {
    api_host: cfg.host,
    person_profiles: 'identified_only',
    capture_pageview: true,
    capture_pageleave: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    session_recording: { maskAllInputs: true, maskTextSelector: '*' },
    before_send: (event) => {
      if (event) [event.properties, event.$set, event.$set_once].forEach(scrubAll);
      return event;
    },
  });
  window.posthog.register({ app_env: cfg.env });
  if (cfg.user && window.posthog.get_distinct_id() !== cfg.user) window.posthog.identify(cfg.user);

  // Shared phones: forget who was logged in, so the next person's visits aren't mixed in.
  document.querySelectorAll('form[action="/logout"]').forEach((form) => {
    form.addEventListener('submit', () => window.posthog.reset());
  });
})();
