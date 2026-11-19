import { Chess } from './vendor/chess.js';
import { PUZZLES } from './puzzles.js';
import { createBoard, sound, playFor } from './board.js';

const $ = (id) => document.getElementById(id);
const PREFIX = 'multichess-v1-';
const _ph = new URLSearchParams(location.search).get('peerhost');
const PEER_OPTS = _ph ? { host: _ph.split(':')[0], port: +_ph.split(':')[1], path: '/', secure: false } : {};
const show = (id) => { document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden')); $(id).classList.remove('hidden'); };
const status = (t) => { $('status').textContent = t; };
const esc = (s) => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

// ---------- state ----------
let peer = null, isHost = false, myId = null, hostConn = null;
const conns = new Map();            // host: peerId -> conn
let players = [];                   // [{id,name,score,solved}]
let settings = null;                // host: {rounds, diff, time}
let game = null;                    // host: {queue, round, endsAt, solvedOrder, timer}
let cur = null;                     // current round as seen by everyone

$('name').value = localStorage.getItem('mc-name') || '';
const myName = () => ($('name').value.trim() || 'Player').slice(0, 16);

// ---------- networking ----------
function send(msg) {                // client -> host, or host -> self
  if (isHost) onHostMsg(myId, msg); else hostConn?.open && hostConn.send(msg);
}
function broadcast(msg) {
  for (const c of conns.values()) if (c.open) c.send(msg);
  onClientMsg(msg);
}
const code5 = () => Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

function hostRoom() {
  localStorage.setItem('mc-name', myName());
  settings = { rounds: +$('rounds').value, diff: $('diff').value, time: +$('time').value };
  const code = code5();
  status('Creating room…');
  peer = new Peer(PREFIX + code, PEER_OPTS);
  peer.on('open', (id) => {
    isHost = true; myId = id;
    players = [{ id, name: myName(), score: 0, solved: false }];
    $('codeOut').textContent = code;
    $('startBtn').classList.remove('hidden'); $('waitMsg').classList.add('hidden');
    renderLobby(); show('lobby'); status('Hosting ' + code);
  });
  peer.on('connection', (c) => {
    c.on('data', (m) => onHostMsg(c.peer, m));
    c.on('open', () => conns.set(c.peer, c));
    c.on('close', () => { conns.delete(c.peer); players = players.filter(p => p.id !== c.peer); syncPlayers(); maybeEndRound(); });
  });
  peer.on('error', (e) => { if (e.type === 'unavailable-id') { peer.destroy(); hostRoom(); } else status('Error: ' + e.type); });
}

function joinRoom(code) {
  code = code.trim().toUpperCase();
  if (code.length !== 5) return status('Enter a 5 character code');
  localStorage.setItem('mc-name', myName());
  status('Connecting…');
  peer = new Peer(PEER_OPTS);
  peer.on('open', (id) => {
    myId = id;
    hostConn = peer.connect(PREFIX + code, { reliable: true });
    hostConn.on('open', () => { hostConn.send({ t: 'join', name: myName() }); $('codeOut').textContent = code; show('lobby'); status('Connected to ' + code); });
    hostConn.on('data', onClientMsg);
    hostConn.on('close', () => { status('Host left the room'); });
  });
  peer.on('error', (e) => status(e.type === 'peer-unavailable' ? 'Room not found' : 'Error: ' + e.type));
}

// ---------- host logic ----------
function syncPlayers() { broadcast({ t: 'players', players }); }

function onHostMsg(from, m) {
  if (m.t === 'join') {
    if (game) { conns.get(from)?.send({ t: 'full', reason: 'Game already in progress' }); return; }
    if (!players.find(p => p.id === from)) players.push({ id: from, name: String(m.name).slice(0, 16), score: 0, solved: false });
    syncPlayers();
  } else if (m.t === 'solved' && game && cur && m.round === cur.round) {
    const p = players.find(p => p.id === from);
    if (!p || p.solved) return;
    p.solved = true;
    const rank = game.solvedOrder.push(from) - 1;
    const left = Math.max(0, game.endsAt - Date.now()) / 1000;
    const pts = Math.max(40, 100 - rank * 20) + Math.round(left / settings.time * 50);
    p.score += pts; p.last = pts;
    syncPlayers(); maybeEndRound();
  }
}

function pickPuzzles() {
  const shuffle = (a) => a.map(v => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map(x => x[1]);
  let pool;
  if (settings.diff === 'mix') {
    const m1 = shuffle(PUZZLES.m1), m2 = shuffle(PUZZLES.m2), n = settings.rounds, half = Math.ceil(n / 2);
    pool = [...m1.slice(0, half), ...m2.slice(0, n - half)];   // easy first, then harder
  } else pool = shuffle(PUZZLES[settings.diff]).slice(0, settings.rounds);
  return pool;
}

function startGame() {
  players.forEach(p => { p.score = 0; p.solved = false; p.last = 0; });
  game = { queue: pickPuzzles(), round: 0, solvedOrder: [], timer: null };
  nextRound();
}

function nextRound() {
  if (game.round >= game.queue.length) { broadcast({ t: 'over', players }); game = null; return; }
  const pz = game.queue[game.round];
  game.round++; game.solvedOrder = [];
  game.endsAt = Date.now() + settings.time * 1000;
  players.forEach(p => { p.solved = false; p.last = 0; });
  broadcast({ t: 'round', round: game.round, total: game.queue.length, pz, ms: settings.time * 1000, players });
  clearTimeout(game.timer);
  game.timer = setTimeout(endRound, settings.time * 1000 + 300);
}
function maybeEndRound() { if (game && cur && !cur.ended && players.length && players.every(p => p.solved)) endRound(); }
function endRound() {
  if (!game || cur?.ended) return;
  clearTimeout(game.timer);
  broadcast({ t: 'roundEnd', round: game.round, players });
  setTimeout(nextRound, 3500);
}

// ---------- client logic ----------
function onClientMsg(m) {
  if (m.t === 'players') { players = m.players; renderLobby(); renderScores(); }
  else if (m.t === 'full') status(m.reason);
  else if (m.t === 'round') { players = m.players; startPuzzle(m); }
  else if (m.t === 'roundEnd') { players = m.players; if (cur) { cur.ended = true; revealSolution(); } renderScores(); }
  else if (m.t === 'over') { players = m.players; cur = null; clearInterval(tick); renderFinal(); show('results'); }
}

function renderLobby() {
  $('lobbyList').innerHTML = players.map(p => `<li class="${p.id === myId ? 'me' : ''}">${esc(p.name)}${p.id === players[0]?.id ? ' <span class="muted">host</span>' : ''}</li>`).join('');
}
function renderScores() {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  $('scoreList').innerHTML = sorted.map(p => `<li class="${p.id === myId ? 'me' : ''}"><span>${esc(p.name)} ${p.solved ? '<span class="done">✓ +' + p.last + '</span>' : ''}</span><b>${p.score}</b></li>`).join('');
}
function renderFinal() {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  $('finalList').innerHTML = sorted.map((p, i) => `<li class="${p.id === myId ? 'me' : ''}"><span>${['🥇', '🥈', '🥉'][i] || i + 1 + '.'} ${esc(p.name)}</span><b>${p.score}</b></li>`).join('');
  $('againBtn').classList.toggle('hidden', !isHost);
}

// ---------- puzzle play ----------
let tick = null;
function startPuzzle(m) {
  window.__mc = () => cur;
  const chess = new Chess(m.pz.fen);
  cur = { round: m.round, pz: m.pz, chess, step: 0, me: chess.turn(), done: false, ended: false, lockUntil: 0, endsAt: Date.now() + m.ms };
  const n = Math.ceil(m.pz.sol.length / 2);
  $('roundLbl').textContent = `Round ${m.round}/${m.total}`;
  $('taskLbl').textContent = `${cur.me === 'w' ? 'White' : 'Black'} to move · mate in ${n}`;
  feedback('');
  clearInterval(tick);
  tick = setInterval(() => { $('timer').textContent = Math.max(0, Math.ceil((cur.endsAt - Date.now()) / 1000)) + 's'; }, 200);
  board.set(chess, cur.me === 'b'); sound.start(); renderScores(); show('game');
}

function feedback(t, cls = '') { const f = $('feedback'); f.textContent = t; f.className = cls; }

const board = createBoard($('board'), {
  canInteract: () => cur && !cur.done && !cur.ended && Date.now() >= cur.lockUntil && cur.chess.turn() === cur.me,
  onMove: (from, to) => tryMove(from, to),
});

function tryMove(from, to) {
  const ch = cur.chess, expected = cur.pz.sol[cur.step];
  const promo = expected && expected.slice(0, 4) === from + to && expected[4] ? expected[4] : 'q';
  const mv = ch.move({ from, to, promotion: promo });
  const finalStep = cur.step === cur.pz.sol.length - 1;
  // final move: any checkmate counts. earlier moves: must match the unique key move.
  const ok = finalStep ? ch.isCheckmate() : mv.lan === expected;
  if (!ok) {
    ch.undo(); cur.lockUntil = Date.now() + 2000;
    board.snapBack(from); sound.wrong();
    feedback('✗ Not it. 2s penalty', 'bad');
    setTimeout(() => { if (cur && !cur.done && !cur.ended) feedback(''); }, 2000);
    return;
  }
  cur.step++; board.animate(mv); playFor(mv, ch);
  if (finalStep) {
    cur.done = true; feedback('✓ Checkmate! Waiting for others…', 'good');
    setTimeout(sound.solved, 150);
    send({ t: 'solved', round: cur.round });
    return;
  }
  feedback('✓ Good move…', 'good');
  const round = cur.round;
  setTimeout(() => {                       // opponent reply
    if (!cur || cur.round !== round || cur.ended) return;
    const r = ch.move(cur.pz.sol[cur.step]); cur.step++; board.animate(r); playFor(r, ch);
    feedback('Now finish it.');
  }, 550);
}

function revealSolution() {
  if (cur.done) { feedback('Round over', 'good'); return; }
  // play out the remaining solution so everyone learns it
  const ch = cur.chess; let san = [];
  const r = cur.round;
  const stepper = () => {
    if (!cur || cur.round !== r || cur.step >= cur.pz.sol.length) { feedback('Solution: ' + san.join(' '), 'bad'); return; }
    const mv = ch.move(cur.pz.sol[cur.step]); san.push(mv.san); cur.step++; board.animate(mv); playFor(mv, ch);
    setTimeout(stepper, 700);
  };
  stepper();
}

// ---------- UI wiring ----------
$('hostBtn').onclick = hostRoom;
$('joinBtn').onclick = () => joinRoom($('codeIn').value);
$('codeIn').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom($('codeIn').value); });
$('startBtn').onclick = startGame;
$('againBtn').onclick = startGame;
const syncMute = () => { $('muteBtn').textContent = sound.muted ? '🔇' : '🔊'; };
$('muteBtn').onclick = () => { sound.toggle(); syncMute(); };
syncMute();
$('homeBtn').onclick = () => { location.href = location.pathname; };
$('copyBtn').onclick = async () => {
  const url = `${location.origin}${location.pathname}?room=${$('codeOut').textContent}${_ph ? '&peerhost=' + _ph : ''}`;
  try { await navigator.clipboard.writeText(url); $('copyBtn').textContent = 'Copied!'; } catch { prompt('Copy this link', url); }
  setTimeout(() => $('copyBtn').textContent = 'Copy invite link', 1500);
};
const qRoom = new URLSearchParams(location.search).get('room');
if (qRoom) { $('codeIn').value = qRoom.toUpperCase(); $('joinBtn').textContent = 'Join ' + qRoom.toUpperCase(); }

// keep phone screens awake during a game (backgrounding a phone drops the WebRTC link)
let wake = null;
async function keepAwake() { try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => wake = null); } } catch {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !$('game').classList.contains('hidden')) keepAwake(); });
$('board').addEventListener('pointerdown', keepAwake, { once: true });
['hostBtn', 'joinBtn', 'startBtn'].forEach(id => $(id).addEventListener('click', keepAwake));
