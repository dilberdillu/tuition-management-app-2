// Usage analytics with PostHog (server-side events). Turned off when POSTHOG_KEY is not set.
// Never send personal data: no student or parent names, phone numbers or per-student balances.
// Staff are identified by their login name; events carry classes, payment modes, amounts and counts.
const { PostHog } = require('posthog-node');
const config = require('./config');

const enabled = Boolean(config.posthog.key);
const client = enabled ? new PostHog(config.posthog.key, { host: config.posthog.host }) : null;
// Lets PostHog filter out events from testing on a laptop.
const appEnv = config.isProd ? 'production' : 'development';

// Analytics must never break a request, so every call swallows its own errors.
function send(distinctId, event, properties, anonymous) {
  if (!client) return;
  try {
    client.capture({
      distinctId,
      event,
      properties: { ...properties, app_env: appEnv, ...(anonymous ? { $process_person_profile: false } : {}) },
    });
  } catch (err) {
    console.error('Analytics capture failed:', err.message);
  }
}

// An event done by the logged-in staff member (or an anonymous visitor, e.g. a failed login).
function track(req, event, properties = {}) {
  const user = req.session && req.session.user;
  send(user ? user.username : 'anonymous', event, properties, !user);
}

// An event with no staff member behind it: a parent paying, or a Dodo webhook.
// Keyed by the pay link so the steps of one payment can be followed without knowing who paid.
function trackPayLink(linkId, event, properties = {}) {
  send(`pay_link_${linkId}`, event, { ...properties, pay_link_id: linkId }, true);
}

function captureException(err, req) {
  if (!client) return;
  try {
    const user = req && req.session && req.session.user;
    client.captureException(err, user ? user.username : undefined, { path: req && req.path });
  } catch (e) {
    console.error('Analytics exception capture failed:', e.message);
  }
}

// Send queued events before the process exits (systemd stop / restart).
async function shutdown() {
  if (client) await client.shutdown();
}

module.exports = { enabled, track, trackPayLink, captureException, shutdown };
