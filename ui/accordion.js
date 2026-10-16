// Expandable block: header button + body that animates its height (grid rows 0fr -> 1fr). Collapsed content is inert.
export function createAccordion({ id, bodyId, title, headerExtra = null, open = false, onToggle = () => {} }) {
  const el = document.createElement('section');
  el.className = 'acc'; el.id = id;
  el.innerHTML = `<div class="acc-head"><button type="button" class="acc-btn" id="${id}-toggle" aria-controls="${bodyId}"><span class="chev" aria-hidden="true"></span><span class="acc-title">${title}</span></button></div>
    <div class="acc-wrap"><div class="acc-body" id="${bodyId}"><div class="acc-inner"></div></div></div>`;
  const btn = el.querySelector('.acc-btn'), body = el.querySelector('.acc-body');
  if (headerExtra) el.querySelector('.acc-head').appendChild(headerExtra);
  const setOpen = (v) => {
    el.classList.toggle('open', v);
    btn.setAttribute('aria-expanded', String(v));
    body.inert = !v; body.setAttribute('aria-hidden', String(!v));
  };
  btn.addEventListener('click', () => { const v = !el.classList.contains('open'); setOpen(v); onToggle(v); });
  el.setOpen = setOpen;
  el.inner = el.querySelector('.acc-inner');
  setOpen(open);
  return el;
}
