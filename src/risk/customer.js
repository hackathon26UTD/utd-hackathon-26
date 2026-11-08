// Customer-safe wording for an assessment. The customer side may only show what this returns:
// no device ids, evidence ids, operator notes, other customers, raw readings, occupancy or damage claims.
import { HAZARD_LABEL, levelIndex } from './config.js';
import { agoText, toMs } from './device.js';

const STATUS = {
  critical: ['urgent', 'Your box reported a serious condition. If anyone is in danger, call 911 now. We cannot confirm that anyone has been sent.'],
  elevated: ['needs_attention', 'Your box reported a condition worth checking. If something looks wrong where you are, contact local emergency services.'],
  watch: ['needs_attention', 'Your box reported something to keep an eye on. This is not an emergency alert.'],
  normal: ['normal', 'Your box is reporting normally. Nothing was flagged in its latest readings.'],
  unknown: ['no_recent_signal', 'We have no recent readings from your box, so we cannot say how things are right now.'],
};

/** customerView(assessment, now?) -> {status, statusText, conditions:[{label,text}]} */
export function customerView(a, now = new Date()) {
  const nowMs = toMs(now);
  const [status, statusText] = STATUS[a?.status] || STATUS.unknown;
  const conditions = (a?.reasons || []).filter((r) => levelIndex(r.level) >= levelIndex('watch') || r.ruleId === 'offline').slice(0, 5).map((r) => {
    const stale = r.evidence?.some((e) => e.stale);
    const ago = r.observedAt && r.ruleId !== 'offline' ? ` ${agoText(nowMs - toMs(r.observedAt))}` : '';
    return {
      label: HAZARD_LABEL[r.hazard] || 'Box',
      text: r.ruleId === 'offline' ? 'We have not heard from your box recently.' : `${r.cust}${ago}.${stale ? ' This is the last report and may be out of date.' : ''}`,
    };
  });
  return { status, statusText, conditions };
}
