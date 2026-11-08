// Small DOM helpers shared by the command center panels.

// Replace an element's HTML only when it changed, and never while the operator is typing inside it.
// Keeps keyboard focus on the same item (matched by data-key) when a list is redrawn by a live update.
export function setHtml(el, html) {
  if (!el || el.dataset.html === html) return false;
  const active = document.activeElement;
  if (active && el.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return false;
  const key = active && el.contains(active) ? active.getAttribute('data-key') || active.id : null;
  el.innerHTML = html;
  el.dataset.html = html;
  if (key) (el.querySelector(`[data-key="${CSS.escape(key)}"]`) || (active.id && el.querySelector('#' + CSS.escape(active.id))))?.focus({ preventScroll: true });
  return true;
}

export function timeText(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Unknown' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function dateTimeText(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Unknown' : d.toLocaleString();
}

export function toast(text, { error = false } = {}) {
  const box = document.querySelector('#toasts');
  if (!box) return;
  const el = document.createElement('p');
  el.className = 'toast' + (error ? ' bad' : '');
  el.textContent = text;
  box.append(el);
  setTimeout(() => el.remove(), error ? 7000 : 4000);
}

export function announce(text) {
  const el = document.querySelector('#announce');
  if (!el) return;
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 50);
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
