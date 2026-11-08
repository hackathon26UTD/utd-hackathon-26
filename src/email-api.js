// POST /api/ops/email-test  {template, to?, dryRun?}
// Operator only (admin key). Sends a synthetic sample tagged as an exercise. Sink addresses only
// (delivered@, bounced@, complained@resend.dev) unless the address is listed in EMAIL_TEST_ALLOWLIST.
import { isAdmin } from './auth.js';
import { emailConfig, isEmail, isSink, sendEmail } from './email.js';
import { renderEmail, TEMPLATES } from './email-templates/index.js';
import { sampleFor } from './email-templates/samples.js';

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function emailTestHandler({ request, env = {}, data }, deps = {}) {
  if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);
  if (!isAdmin(request, env)) return reply({ error: 'Sign in to use this.' }, 401);
  if (data?.operator?.role === 'demo') return reply({ error: 'Demo accounts cannot send email.' }, 403);
  let body;
  try { const text = await request.text(); if (text.length > 2048) return reply({ error: 'Request is too large.' }, 413); body = text ? JSON.parse(text) : {}; } catch { return reply({ error: 'Request must be valid JSON.' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: 'Request must be a JSON object.' }, 400);
  const template = body.template ?? 'welcome';
  if (!TEMPLATES.includes(template)) return reply({ error: `template must be one of ${TEMPLATES.join(', ')}` }, 400);
  const cfg = emailConfig(env);
  const to = String(body.to ?? 'delivered@resend.dev').trim().toLowerCase();
  if (!isEmail(to)) return reply({ error: 'Enter a valid recipient.' }, 400);
  if (!isSink(to) && !cfg.testAllowlist.includes(to)) return reply({ error: 'Test mail goes to Resend sink addresses only (delivered@resend.dev, bounced@resend.dev, complained@resend.dev).' }, 403);
  const mail = renderEmail(template, sampleFor(template, { exercise: true }), { origin: cfg.origin });
  if (body.dryRun === true) return reply({ dryRun: true, template, subject: mail.subject, htmlBytes: mail.html.length, textBytes: mail.text.length });
  if (!cfg.enabled) return reply({ sent: false, reason: cfg.hasKey ? 'disabled' : 'no_key' }, 503);
  const result = await sendEmail(env, { to, subject: mail.subject, html: mail.html, text: mail.text, template: `test:${template}`, idempotencyKey: `test:${template}:${crypto.randomUUID()}` }, deps);
  return reply({ sent: result.ok, template, status: result.status ?? null, attempts: result.attempts, reason: result.reason || null }, result.ok ? 200 : 502);
}
