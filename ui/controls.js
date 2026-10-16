import { attachTooltip, TOOLTIPS } from './tooltip.js';

export function createToggle({ id, label, tip, onClick }) {
  const b = document.createElement('button');
  b.type = 'button'; b.id = id; b.className = 'toggle'; b.textContent = label;
  b.setAttribute('aria-pressed', 'false');
  if (tip) { b.dataset.tooltip = tip; attachTooltip(b, TOOLTIPS[tip]); }
  b.addEventListener('click', () => onClick());
  b.setPressed = (v) => b.setAttribute('aria-pressed', String(Boolean(v)));
  return b;
}

// A button that opens a list of items. Items are always in the DOM (hidden via CSS until opened).
export function createMenu({ buttonId, menuId, itemClass, items, tip, onPick, radio = false, up = false }) {
  const wrap = document.createElement('div');
  wrap.className = up ? 'menu up' : 'menu';
  const btn = document.createElement('button');
  btn.type = 'button'; btn.id = buttonId; btn.className = 'menu-btn';
  const list = document.createElement('div');
  list.id = menuId; list.className = 'menu-list'; list.setAttribute('role', 'menu');
  items.forEach((it, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = itemClass; b.textContent = it.label; b.setAttribute('role', radio ? 'menuitemradio' : 'menuitem');
    if (radio) b.setAttribute('aria-checked', 'false');
    b.dataset.index = String(i); b.dataset.id = it.id;
    b.addEventListener('click', () => { wrap.classList.remove('open'); onPick(it.id, i); });
    list.appendChild(b);
  });
  btn.addEventListener('click', (e) => { e.stopPropagation(); wrap.classList.toggle('open'); });
  window.addEventListener('click', () => wrap.classList.remove('open'));
  wrap.append(btn, list);
  if (tip) { btn.dataset.tooltip = tip; attachTooltip(btn, TOOLTIPS[tip]); }
  wrap.setLabel = (t) => { btn.textContent = t; };
  wrap.setActive = (id) => { for (const b of list.children) b.setAttribute('aria-checked', String(b.dataset.id === String(id))); }; // the checked item gets a tick (radio menus)
  return wrap;
}

// Row of mutually exclusive small buttons (e.g. filter slope 6/12/24/48).
export function createSegmented({ id, label, options, labels = {}, tip, onPick }) {
  const el = document.createElement('div');
  el.className = 'seg'; el.id = id;
  el.innerHTML = `<div class="knob-label">${label}</div><div class="seg-row"></div>`;
  const row = el.querySelector('.seg-row');
  for (const o of options) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = labels[o] || String(o); b.dataset.value = String(o); b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => onPick(o));
    row.appendChild(b);
  }
  if (tip) { el.dataset.tooltip = tip; attachTooltip(el, TOOLTIPS[tip]); }
  el.setValue = (v) => { for (const b of row.children) b.setAttribute('aria-pressed', String(Number(b.dataset.value) === v)); };
  return el;
}
