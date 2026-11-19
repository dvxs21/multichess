// Board view: fixed 8x8 square grid + absolutely positioned piece layer.
// Tap-to-move and drag-to-move, animated moves, synthesized wooden sounds.

// ---------- pieces: minimal flat SVG, viewBox 45x45 ----------
const BASE = '<rect x="10" y="33" width="25" height="6" rx="2"/>';
const SHAPES = {
  p: '<circle cx="22.5" cy="14.5" r="5.5"/><path d="M15.5 33Q16.5 23.5 22.5 21.5Q28.5 23.5 29.5 33Z"/>' + BASE,
  r: '<path d="M13 9h4v3.5h3V9h5v3.5h3V9h4v8l-3 3v13H16V20l-3-3Z"/>' + BASE,
  n: '<path d="M15 33l2.5-9C13 22.5 11 19.5 13 16.5L20 10l1-4.5 3.5 3.5C31.5 11 34 20 31.5 33Z"/><circle cx="21" cy="14.5" r="1.3" class="eye"/>' + BASE,
  b: '<circle cx="22.5" cy="6.5" r="2.2"/><path d="M22.5 9C29 13 30.5 19.5 27 24.5l1 8.5H17l1-8.5C14.5 19.5 16 13 22.5 9Z"/><path d="M25.5 14l-4.5 5" class="cut"/>' + BASE,
  q: '<circle cx="11" cy="13" r="2.2"/><circle cx="22.5" cy="9" r="2.2"/><circle cx="34" cy="13" r="2.2"/><path d="M13 33l-2-17 6.5 7.5 5-11 5 11 6.5-7.5-2 17Z"/>' + BASE,
  k: '<path d="M22.5 5v10M18.5 9h8" class="cross"/><path d="M14 33l-1-13q9.5-5.5 19 0l-1 13Z"/>' + BASE,
};
const svg = (type, color) => `<svg viewBox="0 0 45 45" class="pz ${color}">${SHAPES[type]}</svg>`;

// ---------- sound: wooden knocks via WebAudio, no files ----------
let ctx = null, muted = false;
try { muted = localStorage.getItem('mc-mute') === '1'; } catch {}
function ac() {
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
function knock(vol, freq, delay = 0) {
  const a = ac(); if (!a || muted) return;
  const t = a.currentTime + delay;
  // short filtered noise = the "clack" of wood
  const len = Math.floor(a.sampleRate * 0.06), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
  const src = a.createBufferSource(); src.buffer = buf;
  const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 4;
  const g = a.createGain(); g.gain.setValueAtTime(vol, t);
  src.connect(bp).connect(g).connect(a.destination); src.start(t);
  // low body "thunk" of the board
  const o = a.createOscillator(), og = a.createGain();
  o.frequency.setValueAtTime(freq / 8, t); o.frequency.exponentialRampToValueAtTime(freq / 16, t + 0.08);
  og.gain.setValueAtTime(vol * 0.6, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  o.connect(og).connect(a.destination); o.start(t); o.stop(t + 0.12);
}
function tone(freq, start, dur, vol = 0.15, type = 'sine') {
  const a = ac(); if (!a || muted) return;
  const t = a.currentTime + start, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}
export const sound = {
  move: () => knock(0.9, 1500),
  capture: () => { knock(1, 1100); knock(0.7, 1700, 0.045); },
  check: () => { knock(0.9, 1500); tone(880, 0.05, 0.25, 0.08, 'triangle'); },
  solved: () => { tone(659, 0, 0.18); tone(988, 0.12, 0.35); },
  wrong: () => tone(150, 0, 0.25, 0.18, 'square'),
  start: () => { knock(0.6, 2000); knock(0.6, 2000, 0.12); },
  get muted() { return muted; },
  toggle() { muted = !muted; try { localStorage.setItem('mc-mute', muted ? '1' : '0'); } catch {} return muted; },
  unlock: () => ac(),
};
export function playFor(mv, chess) {
  if (chess.inCheck()) sound.check(); else if (mv.captured) sound.capture(); else sound.move();
}

// ---------- board ----------
const FILES = 'abcdefgh';
export function createBoard(root, { canInteract, onMove }) {
  root.innerHTML = '<div class="squares"></div><div class="pieces"></div>';
  const sqLayer = root.firstChild, pcLayer = root.lastChild;
  let chess = null, flip = false, sel = null, last = null;
  const els = new Map();          // square -> piece element
  const sqEls = new Map();

  const xy = (sq) => { const f = FILES.indexOf(sq[0]), r = +sq[1]; return flip ? [7 - f, r - 1] : [f, 8 - r]; };
  const place = (el, sq) => { const [x, y] = xy(sq); el.style.transform = `translate(${x * 100}%, ${y * 100}%)`; };
  const sqAt = (cx, cy) => {
    const b = root.getBoundingClientRect(); const x = Math.floor((cx - b.left) / b.width * 8), y = Math.floor((cy - b.top) / b.height * 8);
    if (x < 0 || x > 7 || y < 0 || y > 7) return null;
    return flip ? FILES[7 - x] + (y + 1) : FILES[x] + (8 - y);
  };

  function buildSquares() {
    sqLayer.innerHTML = ''; sqEls.clear();
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const sq = flip ? FILES[7 - x] + (y + 1) : FILES[x] + (8 - y);
      const d = document.createElement('div');
      d.className = 'sq ' + ((x + y) % 2 ? 'd' : 'l');
      if (x === 0) d.insertAdjacentHTML('beforeend', `<span class="coord r">${sq[1]}</span>`);
      if (y === 7) d.insertAdjacentHTML('beforeend', `<span class="coord f">${sq[0]}</span>`);
      sqLayer.appendChild(d); sqEls.set(sq, d);
    }
  }
  function mk(sq, pc) {
    const el = document.createElement('div');
    el.className = 'piece'; el.dataset.k = pc.color + pc.type; el.innerHTML = svg(pc.type, pc.color);
    place(el, sq); pcLayer.appendChild(el); els.set(sq, el); return el;
  }
  function sync() {             // make the piece layer match chess exactly (no animation)
    for (const [sq, el] of els) { const pc = chess.get(sq); if (!pc || el.dataset.k !== pc.color + pc.type) { el.remove(); els.delete(sq); } }
    for (const row of chess.board()) for (const pc of row) if (pc && !els.has(pc.square)) mk(pc.square, pc);
  }
  function highlight() {
    const targets = sel ? chess.moves({ square: sel, verbose: true }) : [];
    for (const [sq, d] of sqEls) {
      const t = targets.find(m => m.to === sq);
      d.classList.toggle('sel', sq === sel);
      d.classList.toggle('last', !!last && (last.from === sq || last.to === sq));
      d.classList.toggle('hint', !!t);
      d.classList.toggle('cap', !!t && !!chess.get(sq));
    }
  }

  const api = {
    set(c, f) { chess = c; flip = f; sel = null; last = null; buildSquares(); pcLayer.innerHTML = ''; els.clear(); sync(); highlight(); },
    // call AFTER chess.move(mv); slides the piece(s)
    animate(mv, instant = false) {
      const el = els.get(mv.from);
      if (el) {
        els.delete(mv.from);
        const victim = els.get(mv.to); if (victim) { victim.classList.add('gone'); setTimeout(() => victim.remove(), 160); els.delete(mv.to); }
        if (mv.flags.includes('e')) { const epSq = mv.to[0] + mv.from[1]; els.get(epSq)?.remove(); els.delete(epSq); }
        if (instant) el.classList.add('instant');
        place(el, mv.to); els.set(mv.to, el);
        if (instant) requestAnimationFrame(() => el.classList.remove('instant'));
        if (mv.flags.match(/[kq]/)) {
          const r = mv.to[1], [rf, rt] = mv.flags.includes('k') ? ['h' + r, 'f' + r] : ['a' + r, 'd' + r];
          const rook = els.get(rf); if (rook) { els.delete(rf); place(rook, rt); els.set(rt, rook); }
        }
        if (mv.promotion) setTimeout(() => sync(), 180);
      }
      last = mv; sel = null; sync(); highlight();
    },
    clearSel() { sel = null; highlight(); },
    snapBack(sq) { const el = els.get(sq); if (el) place(el, sq); sel = null; highlight(); },
  };

  // ---------- input: tap and drag through pointer events ----------
  let drag = null;   // {from, el, startX, startY, moved}
  root.addEventListener('pointerdown', (e) => {
    sound.unlock();
    if (!chess || !canInteract()) return;
    const sq = sqAt(e.clientX, e.clientY); if (!sq) return;
    const pc = chess.get(sq);
    if (sel && sq !== sel && chess.moves({ square: sel, verbose: true }).some(m => m.to === sq)) {
      const from = sel; sel = null; highlight(); onMove(from, sq, false); return;
    }
    if (pc && pc.color === chess.turn()) {
      const already = sel === sq;
      sel = sq; highlight();
      const el = els.get(sq);
      drag = { from: sq, el, x: e.clientX, y: e.clientY, moved: false, already };
      root.setPointerCapture(e.pointerId);
      e.preventDefault();
    } else { sel = null; highlight(); }
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
    drag.moved = true;
    const b = root.getBoundingClientRect(), s = b.width / 8;
    drag.el.classList.add('dragging');
    drag.el.style.transform = `translate(${e.clientX - b.left - s / 2}px, ${e.clientY - b.top - s / 2}px) scale(1.15)`;
  });
  const end = (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    d.el.classList.remove('dragging');
    if (!d.moved) { if (d.already) { sel = null; highlight(); } return; }   // plain tap: keep selection
    const to = sqAt(e.clientX, e.clientY);
    const legal = to && to !== d.from && chess.moves({ square: d.from, verbose: true }).some(m => m.to === to);
    if (legal) { sel = null; highlight(); onMove(d.from, to, true); }
    else { d.el.classList.add('instant'); place(d.el, d.from); requestAnimationFrame(() => d.el.classList.remove('instant')); }
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  return api;
}
