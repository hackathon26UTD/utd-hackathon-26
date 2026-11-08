// HomeBeacon email templates. Each takes plain data and returns {subject, preheader, html, text}.
// Rules: short plain sentences, unknown stays unknown, nothing implies safe entry, occupancy, damage,
// coverage or dispatch, and every dynamic value is escaped by the layout. Subjects carry no untrusted text
// except one cleaned device label in operator mail.
import { button, callout, clean, h1, kv, list, p, renderLayout, safeUrl, stat, PROTOTYPE_NOTE } from './layout.js';

const when = (value) => {
  const d = value ? new Date(value) : null;
  return d && Number.isFinite(d.getTime()) ? d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'Unknown';
};
const ago = (value, now) => {
  const d = value ? new Date(value) : null, n = now ? new Date(now) : new Date();
  if (!d || !Number.isFinite(d.getTime()) || !Number.isFinite(n.getTime())) return 'Unknown';
  const min = Math.round((n - d) / 60000);
  if (min < 0) return 'Unknown';
  if (min < 1) return 'Under 1 minute ago';
  if (min < 90) return `${min} minutes ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} hours ago`;
  return `${Math.round(min / 1440)} days ago`;
};
const label = (v, fallback, max = 60) => clean(v, max) || fallback;
const tag = (d) => (d.exercise ? '[Exercise] ' : '');

export const HELP_COPY = {
  review_queued: {
    subject: 'Your device is in the review queue',
    status: 'Review queued',
    line: 'Your device is in the review queue. A person will look at it.',
    todo: ['You do not need to do anything right now.', 'Check your device page for new updates.', 'If you think someone is in danger, call emergency services.'],
  },
  follow_up_assigned: {
    subject: 'A team member will follow up',
    status: 'Follow-up assigned',
    line: 'A team member has been assigned to follow up.',
    todo: ['Keep your phone nearby if you chose to be contacted.', 'Check your device page for new updates.', 'If you think someone is in danger, call emergency services.'],
  },
  help_on_the_way: {
    subject: 'Help status: on the way',
    status: 'Help on the way',
    line: 'The team marked this as help on the way. A person set this status.',
    todo: ['Follow any instructions from emergency services.', 'Check your device page for new updates.', 'This email is not a promise of arrival time.'],
  },
  resolved: {
    subject: 'The team marked this as resolved',
    status: 'Resolved',
    line: 'The team marked this as resolved.',
    todo: ['Resolved is a team label. It does not confirm your home is safe to enter.', 'If something still looks wrong, contact the team or call emergency services.'],
  },
};
export const HELP_EMAIL_STATUSES = Object.keys(HELP_COPY);

const T = {};

// 1. Customer welcome / device claimed
T.welcome = (d, o) => {
  const name = label(d.contactName, 'there', 40), device = label(d.nickname, 'My HomeBeacon', 40);
  const consent = d.consent === true;
  return renderLayout({
    ...o, subject: `${tag(d)}Welcome to HomeBeacon`, preheader: `${device} is linked to your account.`,
    blocks: [
      h1(`Welcome, ${name}`),
      p(d.linked === false ? 'Your account is ready. Link a device when you have its serial number and pairing code.' : `${device} is now linked to your account.`),
      p('Your device page shows what it last reported and when. If it has not reported recently, the page says there is no recent signal. That means unknown, not safe.'),
      kv(d.linked === false ? [['Response team contact', consent ? 'Allowed' : 'Not allowed'], ['Created', when(d.linkedAt)]] : [['Device name', device], ['Response team contact', consent ? 'Allowed' : 'Not allowed'], ['Linked', when(d.linkedAt)]]),
      p(consent ? 'You said the response team may contact you. You can change this on your account page.' : 'You said the response team may not contact you. You can change this on your account page.'),
      button('Open your device page', safeUrl(o.origin, '/customer')),
      p('If you did not link this device, change your password and contact the team.', { muted: true, small: true }),
      callout(PROTOTYPE_NOTE),
    ],
  });
};

// 2. Customer help-status update
T['help-status'] = (d, o) => {
  const copy = HELP_COPY[d.status];
  if (!copy) throw new TypeError('Unsupported help status.');
  const device = label(d.nickname, 'your device', 40);
  return renderLayout({
    ...o, subject: `${tag(d)}HomeBeacon: ${copy.subject}`, preheader: `${copy.status} for ${device}.`,
    blocks: [
      h1(copy.status),
      p(copy.line),
      kv([['Device', device], ['Status', copy.status, d.status === 'resolved' ? 'ok' : undefined], ['Updated', when(d.updatedAt)]]),
      list(copy.todo, 'What to do'),
      button('Open your device page', safeUrl(o.origin, '/customer')),
      p('This update shows a status a person chose. It does not describe current conditions at your home.', { muted: true, small: true }),
      callout(PROTOTYPE_NOTE),
    ],
  });
};

// 3. Operator critical-incident alert
T['critical-incident'] = (d, o) => {
  const stale = d.stale === true || d.freshness === 'stale';
  const facts = Array.isArray(d.facts) ? d.facts.slice(0, 10) : [];
  const known = facts.filter((f) => f.known !== false), unknown = facts.filter((f) => f.known === false);
  const device = label(d.deviceName, 'Unnamed device', 50);
  const link = safeUrl(o.origin, `/command-center${d.deviceId && /^[0-9a-f]{24}$/.test(String(d.deviceId)) ? `?device=${d.deviceId}` : ''}`);
  return renderLayout({
    ...o, subject: `${tag(d)}HomeBeacon ${stale ? 'last known critical' : 'critical'}: ${device}`,
    preheader: stale ? 'Last known critical evidence. Current conditions are unknown.' : 'A device reported a critical condition. Review needed.',
    blocks: [
      h1(stale ? 'Last known critical condition' : 'Critical condition reported'),
      callout(stale ? 'This evidence is stale. Current conditions are unknown. Stale does not mean safe.' : 'A device reported this. A person needs to review it. Nothing here confirms safety, occupancy or that help was sent.', stale ? 'unknown' : 'critical'),
      kv([
        ['Device', device], ['Region', label(d.region, 'Unknown', 30)],
        ['Observed', when(d.observedAt)], ['Age', ago(d.observedAt, d.now)],
        ['Freshness', stale ? 'Stale: current conditions unknown' : 'Recent', stale ? 'critical' : undefined],
        ['Source', label(d.source, 'Unknown', 40)],
      ]),
      known.length ? list(known.map((f) => `${label(f.label, 'Reading', 40)}: ${label(f.value, 'Unknown', 60)}`), 'What we see') : p('No readings came with this alert.'),
      unknown.length ? list(unknown.map((f) => `${label(f.label, 'Reading', 40)}: unknown`), 'Unknown') : p('', { small: true }),
      button('Open the device in the command center', link),
      callout(PROTOTYPE_NOTE),
    ].filter((b) => !(b.t === 'p' && !b.text)),
  });
};

// 4. Operator digest
T.digest = (d, o) => {
  const c = d.counts || {};
  const n = (v) => (Number.isFinite(v) ? String(v) : 'Unknown');
  const stale = Array.isArray(d.staleDevices) ? d.staleDevices.slice(0, 12) : [];
  const feeds = Array.isArray(d.feeds) ? d.feeds.slice(0, 12) : [];
  return renderLayout({
    ...o, subject: `${tag(d)}HomeBeacon digest: ${label(d.periodLabel, 'latest', 30)}`,
    preheader: `${n(c.critical)} critical, ${n(c.stale)} with no recent signal.`,
    blocks: [
      h1('Operations digest'),
      p(`Period: ${label(d.periodLabel, 'latest', 40)}. Generated ${when(d.now)}.`, { muted: true }),
      stat([[n(c.devices), 'Devices'], [n(c.critical), 'Critical'], [n(c.watch), 'Watch'], [n(c.stale), 'No signal']]),
      stale.length ? list(stale.map((s) => `${label(s.name, 'Unnamed', 40)}: ${s.lastSeen ? 'last seen ' + ago(s.lastSeen, d.now) : 'never reported or time unknown'}`), 'Devices with no recent signal (state unknown)') : p('No devices are past the stale limit.'),
      feeds.length ? kv(feeds.map((f) => [label(f.name, 'Feed', 40), `${label(f.status, 'unknown', 20)}${f.note ? ': ' + label(f.note, '', 60) : ''}`, f.status === 'down' ? 'critical' : undefined])) : p('Feed health was not included.'),
      button('Open the command center', safeUrl(o.origin, '/command-center')),
      callout('Counts are what devices reported. A device with no recent signal is unknown, not safe.'),
    ],
  });
};

// 5. Account notice (password changed, recovery code used). No codes, no links that sign in.
const NOTICE = {
  password_changed: ['Your password was changed', 'Your HomeBeacon password was changed.'],
  recovery_used: ['Your recovery code was used', 'A recovery code was used to reset your password. That code no longer works.'],
  sign_in: ['New sign-in to your account', 'Your account was signed in to.'],
};
T['account-notice'] = (d, o) => {
  const [title, line] = NOTICE[d.kind] || NOTICE.sign_in;
  return renderLayout({
    ...o, subject: `${tag(d)}HomeBeacon: ${title}`, preheader: line,
    blocks: [
      h1(title), p(line),
      kv([['When', when(d.at)], ['Account type', label(d.role, 'Account', 20)]]),
      p('If this was you, no action is needed.'),
      p('If this was not you, reset your password now and contact the team. We never ask for your password or recovery code by email.'),
      button('Go to sign in', safeUrl(o.origin, d.role === 'operator' ? '/login' : '/customer')),
      callout(PROTOTYPE_NOTE),
    ],
  });
};

// 6. Device message delivery receipt (optional)
const RECEIPT = { delivered: 'was picked up by the device', shown: 'was shown on the device screen', acked: 'was confirmed on the device' };
T.receipt = (d, o) => {
  const device = label(d.deviceName, 'device', 40), state = RECEIPT[d.state] ? d.state : 'delivered';
  return renderLayout({
    ...o, subject: `${tag(d)}HomeBeacon: message ${state === 'acked' ? 'confirmed' : state} on ${device}`, preheader: `A message ${RECEIPT[state]}.`,
    blocks: [
      h1('Message delivery receipt'),
      p(`A message ${RECEIPT[state]}.`),
      kv([['Device', device], ['Message title', label(d.title, 'Untitled', 20)], ['Status', state === 'acked' ? 'Confirmed' : state === 'shown' ? 'Shown' : 'Delivered'], ['Time', when(d.at)]]),
      p('This confirms the device handled the message. It does not confirm that anyone read it.', { muted: true, small: true }),
      callout(PROTOTYPE_NOTE),
    ],
  });
};

export const TEMPLATES = Object.keys(T);
export const AUDIENCE = { welcome: 'customer', 'help-status': 'customer', 'critical-incident': 'operator', digest: 'operator', 'account-notice': 'either', receipt: 'customer' };

/** renderEmail('welcome', data, {origin}) -> {subject, preheader, html, text}. Throws on unknown template. */
export function renderEmail(name, data = {}, { origin } = {}) {
  if (!Object.hasOwn(T, name)) throw new TypeError(`Unknown email template: ${name}`);
  return T[name](data, { origin, exercise: data.exercise === true });
}
