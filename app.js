'use strict';

/* ================= utils ================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.random() * a.length | 0];
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const store = {
  get(k, d) { try { const v = localStorage.getItem('eh_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('eh_' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
};
const vib = p => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* ignore */ } };

/* ================= text normalisation & dictionary ================= */
const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
function norm(s) {
  return String(s || '')
    .replace(/[֑-ׇ]/g, '')          // niqqud / cantillation
    .replace(/["'`׳״\-־.,]/g, '')
    .replace(/\s+/g, ' ').trim()
    .split('').map(c => FINALS[c] || c).join('');
}
// loose key: tolerant to ktiv male/haser (ו/י) and spaces
function wkey(s) {
  const n = norm(s).replace(/ /g, '');
  return n ? n[0] + n.slice(1).replace(/[וי]/g, '') : '';
}

// stricter key for "did two players write the same thing": only collapses doubled ו/י (עגבניה = עגבנייה, but טל ≠ טלי)
function dupKey(s) {
  return norm(s).replace(/ /g, '').replace(/יי+/g, 'י').replace(/וו+/g, 'ו');
}

const DICT = {}, KEYS = {};
CATS.forEach(c => {
  DICT[c.id] = {}; KEYS[c.id] = new Set();
  c.raw.split('|').forEach(part => {
    const [L, ws] = part.split(':');
    const arr = ws.split(',').map(s => s.trim()).filter(Boolean);
    DICT[c.id][L] = arr;
    arr.forEach(w => KEYS[c.id].add(wkey(w)));
  });
});

/** status of an answer: empty | wrong | valid (in dictionary) | unknown (accepted, not in dictionary) */
function check(ans, cat, letter) {
  const n = norm(ans);
  if (!n) return 'empty';
  if (n[0] !== letter || n.replace(/ /g, '').length < 2) return 'wrong';
  return KEYS[cat].has(wkey(n)) ? 'valid' : 'unknown';
}

/* ================= constants ================= */
const AVATARS = ['🦊', '🐼', '🐯', '🦁', '🐸', '🐵', '🐨', '🐙', '🦄', '🐧', '🐶', '🐱', '🐰', '🦉'];
const BOT_AVATARS = ['🤖', '👾', '🛸', '🧠', '🎲', '🦾'];
const COLORS = ['#ff8fab', '#ffc078', '#ffe066', '#8ce99a', '#63e6be', '#74c0fc', '#91a7ff', '#e599f7', '#ffa8a8', '#66d9e8'];
const BOT_NAMES = ['רובי', 'ביפ', 'פיקסל', 'נובה', 'טורבו', 'זיגי', 'מקס', 'צ׳יפי'];
const LEVELS = {
  easy:   { name: 'קל',     fill: [.45, .7], time: [.75, .98], pool: 5,   stops: false },
  medium: { name: 'בינוני', fill: [.72, .92], time: [.55, .8], pool: 14,  stops: true },
  hard:   { name: 'קשה',    fill: [.92, 1],  time: [.35, .58], pool: 999, stops: true }
};
const DEFAULTS = { cats: ['country', 'city', 'animal', 'plant', 'object', 'name', 'job'], rounds: 5, timer: 90, stopRule: true, hardLetters: false };
const GRACE = 5;
const MAX_PLAYERS = 8;

/* ================= sound ================= */
const Sfx = {
  ctx: null, on: store.get('sound', true),
  init() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* no audio */ } }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(f, d = .12, type = 'sine', v = .12, delay = 0, slide = 0) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + delay, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + d + .03);
  },
  click() { this.tone(620, .06, 'triangle', .07); },
  tick() { this.tone(950, .035, 'square', .03); },
  land() { [523, 659, 784].forEach((f, i) => this.tone(f, .28, 'triangle', .12, i * .07)); },
  stop() { this.tone(260, .4, 'sawtooth', .1, 0, 120); this.tone(196, .45, 'square', .05, .04); },
  warn() { this.tone(1250, .07, 'sine', .07); },
  good() { this.tone(880, .1, 'triangle', .09); this.tone(1320, .16, 'triangle', .07, .08); },
  win() { [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone(f, .3, 'triangle', .11, i * .13)); }
};

/* ================= ui helpers ================= */
let current = 'home';
function show(id) {
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === 's-' + id));
  current = id;
}
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}
function modal(html, buttons = [{ label: 'סגור', cls: 'btn-yellow' }]) {
  $('#modalBody').innerHTML = html;
  const box = $('#modalBtns'); box.innerHTML = '';
  buttons.forEach(b => {
    const el = document.createElement('button');
    el.className = 'btn ' + (b.cls || 'btn-ghost'); el.textContent = b.label;
    el.onclick = () => { closeModal(); b.fn && b.fn(); };
    box.appendChild(el);
  });
  $('#modal').classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); }
const modalOpen = () => !$('#modal').classList.contains('hidden');

function showRules() {
  modal(`<h3>📖 איך משחקים ארץ עיר?</h3>
  <p>בכל סיבוב מוגרלת אות. צריך למצוא לכל קטגוריה מילה שמתחילה באות הזאת — מהר ככל האפשר!</p>
  <ul>
    <li><b>15 נקודות</b> — רק אתם עניתם בקטגוריה.</li>
    <li><b>10 נקודות</b> — תשובה שאף אחד אחר לא כתב.</li>
    <li><b>5 נקודות</b> — תשובה שגם שחקן אחר כתב.</li>
    <li><b>0</b> — ריק, אות שגויה או תשובה שנפסלה.</li>
  </ul>
  <p><b>✋ עצור!</b> — מי שממלא את כל השדות ראשון יכול לעצור. לשאר נשארות ${GRACE} שניות להשלים.</p>
  <p>בסוף כל סיבוב אפשר ללחוץ על תשובה כדי לפסול או לאשר אותה. תשובה עם <b>?</b> היא תשובה שלא נמצאה במאגר — תחליטו ביחד אם היא תקפה.</p>
  <p><b>מול המחשב:</b> קל — עונה על חלק ולא עוצר · בינוני — עונה על רוב ולפעמים עוצר · קשה — מהיר מאוד!</p>`);
}

/* ================= background ================= */
function buildBg() {
  const bg = $('#bg'); let h = '';
  for (let i = 0; i < 18; i++) {
    const size = rnd(40, 120) | 0, dur = rnd(18, 40), delay = -rnd(0, 40);
    h += `<span style="right:${rnd(-5, 95)}%;font-size:${size}px;animation-duration:${dur}s;animation-delay:${delay}s">${pick(LETTERS)}</span>`;
  }
  bg.innerHTML = h;
}

/* ================= state ================= */
let ROLE = 'local';      // local | host | client
let SETUP = null;        // {mode, players, settings}
let G = null;            // game
let R = null;            // round
let PLAY = null;         // the current answering session on this device
let CL = null;           // client lobby info

const pub = p => ({ id: p.id, name: p.name, type: p.type === 'bot' ? 'bot' : 'human', avatar: p.avatar, color: p.color, level: p.level || null });
const myName = () => store.get('name', '') || 'אני';
const myAvatar = () => store.get('avatar', AVATARS[0]);

function makeHuman(name, i, avatar) {
  return { id: uid(), name, type: 'human', avatar: avatar || AVATARS[i % AVATARS.length], color: COLORS[i % COLORS.length] };
}
function addBot(level = 'medium') {
  const used = SETUP.players.map(p => p.name);
  const name = BOT_NAMES.find(n => !used.includes(n)) || ('מחשב ' + (SETUP.players.length + 1));
  const n = SETUP.players.filter(p => p.type === 'bot').length;
  SETUP.players.push({ id: 'bot-' + uid(), name, type: 'bot', level, avatar: BOT_AVATARS[n % BOT_AVATARS.length], color: COLORS[(n * 3 + 2) % COLORS.length] });
}

/* ================= setup screen ================= */
function openSetup(mode, keep) {
  if (!keep || !SETUP || SETUP.mode !== mode) {
    const settings = { ...DEFAULTS, ...store.get('settings', {}) };
    settings.cats = (settings.cats || DEFAULTS.cats).filter(c => CAT_BY_ID[c]);
    if (settings.cats.length < 3) settings.cats = [...DEFAULTS.cats];
    SETUP = { mode, players: [], settings };
    if (mode === 'solo') {
      SETUP.players.push({ ...makeHuman(myName(), 0, myAvatar()), me: true });
      addBot('easy'); addBot('medium');
    } else if (mode === 'local') {
      const names = store.get('localNames', ['שחקן 1', 'שחקן 2']);
      names.slice(0, MAX_PLAYERS).forEach((n, i) => SETUP.players.push(makeHuman(n, i)));
      if (SETUP.players.length < 2) SETUP.players.push(makeHuman('שחקן 2', 1));
    } else if (mode === 'online') {
      SETUP.players.push({ id: Net.myId, name: myName(), type: 'human', avatar: myAvatar(), color: COLORS[0], me: true });
    }
  }
  $('#setupTitle').textContent = { solo: 'מול המחשב', local: 'כמה שחקנים', online: 'חדר אונליין' }[mode];
  $('#roomCard').classList.toggle('hidden', mode !== 'online');
  if (mode === 'online') $('#roomCode').textContent = Net.code;
  $('#addHuman').classList.toggle('hidden', mode !== 'local');
  renderSetup();
  show('setup');
}

function renderSetup() {
  renderPlayers();
  const s = SETUP.settings;
  $('#catChips').innerHTML = CATS.map(c =>
    `<button class="chip ${s.cats.includes(c.id) ? 'on' : ''}" style="--c:${c.color}" data-cat="${c.id}">${c.icon} ${c.name}</button>`).join('');
  $('#catCount').textContent = `${s.cats.length} נבחרו`;
  $$('#s-setup .seg[data-key]').forEach(seg => {
    const key = seg.dataset.key, vals = seg.dataset.vals.split(','), labels = (seg.dataset.labels || seg.dataset.vals).split(',');
    seg.innerHTML = vals.map((v, i) => `<button class="${String(s[key]) === v ? 'on' : ''}" data-v="${v}">${labels[i]}</button>`).join('');
  });
  $$('#s-setup .switch').forEach(sw => sw.classList.toggle('on', !!s[sw.dataset.key]));
  $('#stopNote').textContent = SETUP.mode === 'local' && SETUP.players.filter(p => p.type === 'human').length > 1
    ? 'במשחק בתורות על מכשיר אחד כל שחקן מקבל את כל הזמן' : '';
}

function renderPlayers() {
  const humans = SETUP.players.filter(p => p.type === 'human').length;
  $('#playersList').innerHTML = SETUP.players.map((p, i) => {
    const editable = p.type === 'human' && (SETUP.mode === 'local' || p.me);
    const removable = !p.me && !(p.type === 'human' && humans <= 1);
    return `<div class="p-row" data-i="${i}">
      <button class="p-av" style="--pc:${p.color}" data-a="av" aria-label="החלף דמות">${p.avatar}</button>
      ${editable
        ? `<input class="inp p-name" data-a="name" value="${esc(p.name)}" maxlength="14" autocomplete="off">`
        : `<div class="p-name-static">${esc(p.name)}${p.me ? ' <small>(את/ה)</small>' : ''}</div>`}
      ${p.type === 'bot' ? `<div class="seg small">${Object.entries(LEVELS).map(([k, l]) => `<button class="${p.level === k ? 'on' : ''}" data-a="lvl" data-l="${k}">${l.name}</button>`).join('')}</div>`
        : p.type === 'remote' ? '<span class="tag">🌐 מחובר</span>' : ''}
      ${removable ? '<button class="icon-btn small" data-a="rm" aria-label="הסר">✕</button>' : ''}
    </div>`;
  }).join('');
  const full = SETUP.players.length >= MAX_PLAYERS;
  $('#addBot').disabled = full; $('#addHuman').disabled = full;
}

function setupChanged() { if (ROLE === 'host' && !G) broadcastLobby(); }
let lobbyT;
function broadcastLobby() {
  clearTimeout(lobbyT);
  lobbyT = setTimeout(() => !G && Net.broadcast({ t: 'lobby', code: Net.code, players: SETUP.players.map(pub), settings: SETUP.settings }), 120);
}

function bindSetup() {
  const list = $('#playersList');
  list.addEventListener('click', e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const i = +b.closest('.p-row').dataset.i, p = SETUP.players[i];
    const a = b.dataset.a;
    if (a === 'av') {
      if (p.type === 'remote') return;
      const set = p.type === 'bot' ? BOT_AVATARS : AVATARS;
      p.avatar = set[(set.indexOf(p.avatar) + 1) % set.length];
      if (p.me) store.set('avatar', p.avatar);
      Sfx.click();
    } else if (a === 'rm') {
      if (p.type === 'remote') { Net.sendTo(p.id, { t: 'kicked' }); setTimeout(() => Net.dropConn(p.id), 300); }
      SETUP.players.splice(i, 1);
    } else if (a === 'lvl') {
      p.level = b.dataset.l; Sfx.click();
    } else return;
    renderPlayers(); renderSetup(); setupChanged();
  });
  list.addEventListener('input', e => {
    if (e.target.dataset.a !== 'name') return;
    const p = SETUP.players[+e.target.closest('.p-row').dataset.i];
    p.name = e.target.value.slice(0, 14);
    if (p.me) store.set('name', p.name.trim());
    setupChanged();
  });
  $('#addBot').onclick = () => { if (SETUP.players.length >= MAX_PLAYERS) return; addBot('medium'); Sfx.click(); renderSetup(); setupChanged(); };
  $('#addHuman').onclick = () => {
    if (SETUP.players.length >= MAX_PLAYERS) return;
    const n = SETUP.players.filter(p => p.type === 'human').length;
    SETUP.players.push(makeHuman('שחקן ' + (n + 1), SETUP.players.length)); Sfx.click(); renderSetup();
  };
  $('#catChips').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    const cats = SETUP.settings.cats, id = b.dataset.cat;
    if (cats.includes(id)) { if (cats.length <= 3) return toast('צריך לפחות 3 קטגוריות'); cats.splice(cats.indexOf(id), 1); }
    else cats.splice(CATS.findIndex(c => c.id === id), 0, id);
    SETUP.settings.cats = CATS.map(c => c.id).filter(c => cats.includes(c));
    Sfx.click(); renderSetup(); setupChanged();
  });
  $('#s-setup').addEventListener('click', e => {
    const b = e.target.closest('.seg[data-key] button');
    if (b) { SETUP.settings[b.parentElement.dataset.key] = Number(b.dataset.v); Sfx.click(); renderSetup(); setupChanged(); }
    const sw = e.target.closest('.switch');
    if (sw) { SETUP.settings[sw.dataset.key] = !SETUP.settings[sw.dataset.key]; Sfx.click(); renderSetup(); setupChanged(); }
  });
  $('#startGame').onclick = startGame;
  $('#shareRoom').onclick = () => {
    const text = `בואו לשחק איתי ארץ עיר! 🌍 קוד החדר: ${Net.code}`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('ההזמנה הועתקה ✔'), () => toast('קוד החדר: ' + Net.code));
    else toast('קוד החדר: ' + Net.code);
  };
}

/* ================= game flow ================= */
function startGame() {
  if (current !== 'setup' && current !== 'final') return;   // guard against double-tap
  Sfx.init();
  const s = SETUP;
  s.players.forEach(p => { p.name = (p.name || '').trim() || (p.type === 'bot' ? 'מחשב' : 'שחקן'); });
  if (s.settings.cats.length < 3) return toast('בחרו לפחות 3 קטגוריות');
  if (s.players.length < 2) return toast(s.mode === 'online' ? 'חכו שחברים יצטרפו, או הוסיפו שחקן מחשב' : s.mode === 'solo' ? 'הוסיפו לפחות שחקן מחשב אחד' : 'צריך לפחות 2 שחקנים');
  store.set('settings', s.settings);
  if (s.mode === 'local') store.set('localNames', s.players.filter(p => p.type === 'human').map(p => p.name));
  G = {
    mode: s.mode, players: s.players.map(p => ({ ...p })), settings: { ...s.settings, cats: [...s.settings.cats] },
    roundNo: 0, used: [], history: [], meId: (s.players.find(p => p.me) || {}).id
  };
  if (ROLE === 'host') { clearTimeout(lobbyT); Net.broadcast({ t: 'start' }); }
  nextRound();
}

function pickLetter() {
  const pool = LETTERS.filter(l => G.settings.hardLetters || !HARD_LETTERS.includes(l));
  let avail = pool.filter(l => !G.used.includes(l));
  if (!avail.length) { G.used = []; avail = pool; }
  const l = pick(avail); G.used.push(l); return l;
}

function botPlan(bot, letter, dur) {
  const lv = LEVELS[bot.level] || LEVELS.medium, cats = G.settings.cats;
  const finish = dur * rnd(...lv.time);
  const n = Math.round(cats.length * rnd(...lv.fill));
  const items = [];
  shuffle(cats.slice()).forEach((cat, i) => {
    if (i >= n) return;
    const words = DICT[cat][letter] || [];
    if (!words.length) return;
    items.push({ cat, w: pick(words.slice(0, lv.pool)) });
  });
  items.forEach((it, i) => { it.t = finish * (i + 1) / items.length * (i === items.length - 1 ? 1 : rnd(.82, 1)); });
  items.sort((a, b) => a.t - b.t);
  return { items, finish, full: items.length === cats.length };
}

function nextRound() {
  G.roundNo++;
  const letter = pickLetter(), dur = G.settings.timer;
  const seats = G.players.filter(p => p.type === 'human');
  R = { n: G.roundNo, letter, dur, answers: {}, plans: {}, progress: {}, realtime: seats.length === 1, stopping: false, finished: false, cut: Infinity, queue: [] };
  G.players.filter(p => p.type === 'bot').forEach(b => { R.plans[b.id] = botPlan(b, letter, dur || 100); });
  if (ROLE === 'host') {
    R.pending = new Set(G.players.filter(p => p.type === 'remote' && !p.left).map(p => p.id));
    Net.broadcast({ t: 'round', n: R.n, total: G.settings.rounds, letter, dur, stopRule: G.settings.stopRule, cats: G.settings.cats, players: G.players.map(pub) });
  }
  const myR = R;
  runSpin(letter, R.n, G.settings.rounds).then(() => {
    if (R !== myR) return;
    if (R.realtime) startPlay(seats[0]);
    else { R.queue = seats.map(p => p.id); nextTurn(); }
  });
}

let spinId = 0;
function runSpin(letter, n, total) {
  const my = ++spinId;   // a newer spin (or quitting) cancels this one
  show('spin');
  $('#spinRound').textContent = `סיבוב ${n} מתוך ${total}`;
  const tile = $('#spinTile'), hint = $('#spinHint');
  tile.classList.remove('land'); hint.textContent = 'מגרילים אות...';
  return new Promise(res => {
    let i = 0, delay = 45;
    const step = () => {
      if (my !== spinId) return;
      if (i >= 20) {
        tile.textContent = letter; void tile.offsetWidth; tile.classList.add('land');
        Sfx.land(); vib(40);
        hint.innerHTML = `האות היא <b>${letter}</b>!`;
        setTimeout(res, 1150); return;
      }
      let l; do { l = pick(LETTERS); } while (l === tile.textContent);
      tile.textContent = l; Sfx.tick(); i++; delay *= 1.085;
      setTimeout(step, delay);
    };
    step();
  });
}

function nextTurn() {
  const id = R.queue.shift();
  if (!id) { R.cut = R.dur || Infinity; return finishRound(); }
  const p = G.players.find(x => x.id === id);
  $('#passAv').textContent = p.avatar; $('#passAv').style.setProperty('--pc', p.color);
  $('#passName').textContent = p.name; $('#passLetter').textContent = R.letter;
  $('#passReady').onclick = () => { if (current !== 'pass') return; Sfx.click(); startPlay(p); };
  show('pass');
}

/* ---------- answering ---------- */
function startPlay(p) {
  const cats = G.settings.cats, L = R.letter;
  PLAY = { pid: p.id, R, t0: performance.now(), el: 0, ended: false, lastProg: -1, lastCast: 0, lastSec: -1, oppsHtml: '' };
  PLAY.stopMode = !!(G.settings.stopRule && R.realtime);
  $('#playLetter').textContent = L;
  $('#playRound').textContent = `סיבוב ${R.n} מתוך ${G.settings.rounds}`;
  $('#playPlayer').textContent = `${p.avatar} ${p.name}`;
  $('#answers').innerHTML = cats.map((id, i) => {
    const c = CAT_BY_ID[id];
    return `<label class="ans" style="--c:${c.color}"><span class="ans-ic">${c.icon}</span>
      <span class="ans-body"><div class="ans-name">${c.name}</div>
      <input data-cat="${id}" dir="rtl" lang="he" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
        enterkeyhint="${i < cats.length - 1 ? 'next' : 'done'}" maxlength="28" placeholder="${c.name} ב־${L}..."></span></label>`;
  }).join('');
  $('#opps').classList.toggle('hidden', !R.realtime);
  $('#opps').innerHTML = '';
  $('#stopBtn').disabled = false;
  $('#timer').classList.remove('warn');
  updateStopBtn();
  show('play');
  $('#answersScroll').scrollTop = 0;
  if (matchMedia('(pointer:fine)').matches) setTimeout(() => { const f = $('#answers input'); f && f.focus(); }, 350);
  requestWakeLock();
  PLAY.iv = setInterval(playTick, 200);
  playTick();
}

function filledCount() {
  return $$('#answers input').filter(i => { const st = check(i.value, i.dataset.cat, R.letter); return st === 'valid' || st === 'unknown'; }).length;
}
function collectAnswers() {
  const a = {}; $$('#answers input').forEach(i => { if (i.value.trim()) a[i.dataset.cat] = i.value.trim().slice(0, 28); }); return a;
}
function updateStopBtn() {
  const btn = $('#stopBtn'), total = G.settings.cats.length, n = filledCount();
  if (PLAY.stopMode) {
    btn.textContent = n >= total ? '✋ עצור!' : `✋ עצור! (${n}/${total})`;
    btn.classList.toggle('btn-red', n >= total); btn.classList.toggle('btn-ghost', n < total);
  } else {
    btn.textContent = `✔ סיימתי (${n}/${total})`;
    btn.classList.add('btn-red'); btn.classList.remove('btn-ghost');
  }
}

function playTick() {
  if (!PLAY || PLAY.ended) return;
  const el = (performance.now() - PLAY.t0) / 1000; PLAY.el = el;
  const ring = $('#timerRing'), C = 125.66;
  if (R.dur) {
    const rem = Math.max(0, R.dur - el), sec = Math.ceil(rem);
    ring.style.strokeDashoffset = C * (1 - rem / R.dur);
    $('#timerTxt').textContent = sec;
    $('#timer').classList.toggle('warn', rem <= 10);
    if (rem <= 10 && sec !== PLAY.lastSec && rem > 0) { PLAY.lastSec = sec; Sfx.warn(); }
    if (rem <= 0) {
      if (ROLE !== 'client') return endPlay('time');
      if (el > R.dur + 3) return endPlay('collect');   // host didn't answer in time — submit anyway
    }
  } else {
    ring.style.strokeDashoffset = 0;
    $('#timerTxt').textContent = Math.floor(el / 60) + ':' + String(Math.floor(el % 60)).padStart(2, '0');
  }
  if (ROLE !== 'client' && R.realtime) {
    const bots = G.players.filter(p => p.type === 'bot');
    bots.forEach(b => { R.progress[b.id] = R.plans[b.id].items.filter(i => i.t <= el).length; });
    if (PLAY.stopMode && !R.stopping) {
      const b = bots.find(b => { const pl = R.plans[b.id]; return pl.full && LEVELS[b.level].stops && el >= pl.finish; });
      if (b) triggerStop(b);
    }
  }
  const n = filledCount();
  R.progress[PLAY.pid] = n;
  if (ROLE === 'host' && el - PLAY.lastCast > 1) { PLAY.lastCast = el; Net.broadcast({ t: 'progs', p: R.progress }); }
  if (ROLE === 'client' && n !== PLAY.lastProg) { PLAY.lastProg = n; Net.send({ t: 'prog', n }); }
  if (R.realtime) renderOpps();
}

function renderOpps() {
  const total = G.settings.cats.length;
  const html = G.players.filter(p => p.id !== PLAY.pid).map(p => {
    const n = R.progress[p.id] || 0;
    return `<div class="opp ${p.left ? 'left' : ''}"><span class="o-av" style="--pc:${p.color}">${p.avatar}</span>${esc(p.name)}<span class="o-bar"><i style="width:${n / total * 100}%"></i></span></div>`;
  }).join('');
  if (html !== PLAY.oppsHtml) { PLAY.oppsHtml = html; $('#opps').innerHTML = html; }
}

function onStopBtn() {
  if (!PLAY || PLAY.ended) return;
  Sfx.init();
  const total = G.settings.cats.length;
  if (PLAY.stopMode) {
    if (R.stopping) return;
    if (filledCount() < total) { toast('כדי לעצור צריך למלא את כל השדות'); vib(60); return; }
    if (ROLE === 'client') { Net.send({ t: 'stop' }); $('#stopBtn').disabled = true; return; }
    triggerStop(G.players.find(p => p.id === PLAY.pid));
  } else {
    if (filledCount() < total) {
      modal('<h3>לסיים עכשיו?</h3><p>יש עוד שדות ריקים. בטוחים שסיימתם?</p>', [
        { label: 'כן, סיימתי', cls: 'btn-red', fn: () => endPlay('done') }, { label: 'עוד רגע' }]);
    } else endPlay('done');
  }
}

/** host/local: someone said stop */
function triggerStop(by) {
  if (!PLAY || PLAY.ended || R.stopping) return;
  R.stopping = true; R.stopAt = PLAY.el;
  if (ROLE === 'host') Net.broadcast({ t: 'stop', by: by.name, byId: by.id });
  beginGrace(by.name, by.id === PLAY.pid);
}
function beginGrace(name, self) {
  R.stopping = true;
  Sfx.stop(); vib([120, 60, 120]);
  const st = $('#stamp'); st.classList.remove('go'); void st.offsetWidth; st.classList.add('go');
  $('#stopBtn').disabled = true;
  $('#stopBannerTxt').textContent = self ? 'עצרת! השאר משלימים...' : `✋ ${name} אמר/ה עצור! מהר להשלים`;
  let left = GRACE; $('#stopCount').textContent = left;
  $('#stopBanner').classList.add('show');
  PLAY.graceIv = setInterval(() => {
    left--; $('#stopCount').textContent = Math.max(0, left); Sfx.warn();
    if (left <= 0) { clearInterval(PLAY.graceIv); if (ROLE !== 'client') endPlay('stop'); else setTimeout(() => endPlay('collect'), 1500); }
  }, 1000);
}
function hideBanner() { $('#stopBanner').classList.remove('show'); }

function endPlay(reason) {
  if (!PLAY || PLAY.ended) return;
  PLAY.ended = true; clearInterval(PLAY.iv); clearInterval(PLAY.graceIv); hideBanner(); releaseWakeLock();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  const ans = collectAnswers();
  if (ROLE === 'client') {
    Net.send({ t: 'answers', a: ans });
    showCollect('מחכים לשאר השחקנים...', false);
    return;
  }
  R.answers[PLAY.pid] = ans;
  if (!R.realtime) { if (reason === 'time') { Sfx.stop(); toast('⏰ נגמר הזמן!'); } return nextTurn(); }
  if (reason === 'stop') R.cut = R.stopAt + GRACE;
  else if (reason === 'time') R.cut = R.dur;
  else R.cut = R.dur || Infinity;
  if (reason === 'time') { Sfx.stop(); toast('⏰ נגמר הזמן!'); }
  if (ROLE === 'host') {
    if (reason !== 'done') Net.broadcast({ t: 'collect' });
    waitRemote(reason);
  } else finishRound();
}

function showCollect(txt, hostBtn) {
  $('#collectTxt').textContent = txt;
  $('#collectNow').classList.toggle('hidden', !hostBtn);
  show('collect');
}

function waitRemote(reason) {
  const check = () => {
    if (R.finished) return;
    const missing = [...R.pending].filter(id => !R.answers[id] && !(G.players.find(p => p.id === id) || {}).left);
    if (!missing.length) finishRound();
  };
  R.checkPending = check;
  showCollect('אוספים תשובות...', reason === 'done');
  const forceEnd = () => { Net.broadcast({ t: 'collect' }); clearTimeout(R.waitTo); R.waitTo = setTimeout(finishRound, 4000); };
  $('#collectNow').onclick = forceEnd;
  if (reason === 'done') { if (R.dur) R.waitTo = setTimeout(forceEnd, Math.max(1, R.dur - PLAY.el + 2) * 1000); }
  else R.waitTo = setTimeout(finishRound, 6000);
  check();
}

/* ---------- scoring ---------- */
function finishRound() {
  if (!R || R.finished) return;
  R.finished = true; clearTimeout(R.waitTo);
  G.players.filter(p => p.type === 'bot').forEach(b => {
    const a = {}; R.plans[b.id].items.forEach(i => { if (i.t <= R.cut) a[i.cat] = i.w; }); R.answers[b.id] = a;
  });
  const res = { n: R.n, letter: R.letter, cats: [...G.settings.cats], cells: {}, totals: {} };
  G.players.forEach(p => {
    res.cells[p.id] = {};
    res.cats.forEach(c => {
      const a = ((R.answers[p.id] || {})[c] || '').trim();
      const st = check(a, c, R.letter);
      res.cells[p.id][c] = { a, st, ok: st === 'valid' || st === 'unknown', pts: 0, kind: 'zero' };
    });
  });
  recalc(res);
  G.history.push(res);
  showResults(res);
}

function recalc(res) {
  res.totals = {}; G.players.forEach(p => { res.totals[p.id] = 0; });
  res.cats.forEach(c => {
    const oks = G.players.filter(p => res.cells[p.id][c].ok), cnt = {};
    oks.forEach(p => { const k = dupKey(res.cells[p.id][c].a); cnt[k] = (cnt[k] || 0) + 1; });
    G.players.forEach(p => {
      const cell = res.cells[p.id][c];
      if (!cell.ok) { cell.pts = 0; cell.kind = 'zero'; return; }
      if (oks.length === 1 && G.players.length > 1) { cell.pts = 15; cell.kind = 'solo'; }
      else if (cnt[dupKey(cell.a)] > 1) { cell.pts = 5; cell.kind = 'dup'; }
      else { cell.pts = 10; cell.kind = 'uniq'; }
      res.totals[p.id] += cell.pts;
    });
  });
}

function standings() {
  const last = G.history[G.history.length - 1];
  return G.players.map(p => ({
    id: p.id, total: G.history.reduce((s, h) => s + (h.totals[p.id] || 0), 0), last: last ? (last.totals[p.id] || 0) : 0
  })).sort((a, b) => b.total - a.total);
}

function showResults(res) {
  const isLast = G.roundNo >= G.settings.rounds;
  const std = standings();
  renderResults(res, G.players, std, { editable: true, isLast });
  Sfx.good();
  if (ROLE === 'host') Net.broadcast({ t: 'results', res, players: G.players.map(pub), std, isLast });
}

const medal = i => ['🥇', '🥈', '🥉'][i] || (i + 1);

function renderResults(res, players, std, o) {
  $('#resTitle').textContent = `תוצאות סיבוב ${res.n}`;
  $('#resLetter').textContent = res.letter;
  const P = Object.fromEntries(players.map(p => [p.id, p]));
  $('#resCats').innerHTML = res.cats.map((c, ci) => {
    const cat = CAT_BY_ID[c];
    return `<div class="res-card" style="--c:${cat.color};animation-delay:${ci * 60}ms"><div class="res-h"><span>${cat.icon}</span>${cat.name}</div>
      ${players.map(p => {
        const cell = (res.cells[p.id] || {})[c] || { a: '', st: 'empty', ok: false, pts: 0, kind: 'zero' };
        const why = cell.st === 'wrong'
          ? (norm(cell.a)[0] === res.letter ? 'קצר מדי' : 'לא מתחיל באות ' + res.letter)
          : (!cell.ok && cell.a ? 'נפסל' : '');
        return `<div class="res-row ${o.editable && cell.a && cell.st !== 'wrong' ? 'tap' : ''} ${cell.ok ? '' : 'no'} st-${cell.st}" data-pid="${p.id}" data-cat="${c}">
          <span class="r-av" style="--pc:${p.color}">${p.avatar}</span>
          <span class="r-main"><div class="r-name">${esc(p.name)}</div>
          <div class="r-ans">${cell.a ? esc(cell.a) : '<i>—</i>'}${cell.st === 'unknown' && cell.ok ? '<sup title="לא נמצא במאגר">?</sup>' : ''}</div>
          ${why ? `<div class="r-why">${why}</div>` : ''}</span>
          <span class="pts k-${cell.ok ? cell.kind : 'zero'}">${cell.pts}</span></div>`;
      }).join('')}</div>`;
  }).join('');
  $('#standings').innerHTML = std.map((s, i) => {
    const p = P[s.id] || { name: '?', avatar: '❔', color: '#888' };
    return `<div class="std-row" style="animation-delay:${i * 70}ms"><span class="rank">${medal(i)}</span>
      <span class="r-av" style="--pc:${p.color}">${p.avatar}</span><span class="std-name">${esc(p.name)}</span>
      <span class="std-plus">+${s.last}</span><span class="std-total">${s.total}</span></div>`;
  }).join('');
  $('#resHint').textContent = o.editable ? 'לחצו על תשובה כדי לפסול או לאשר אותה' : 'המארח יכול לפסול תשובות ולהמשיך לסיבוב הבא';
  const nb = $('#nextBtn');
  nb.classList.toggle('hidden', !o.editable);
  nb.textContent = o.isLast ? 'לתוצאות הסופיות 🏆' : 'לסיבוב הבא ←';
  $('#resCats').dataset.editable = o.editable ? '1' : '';
  show('results');
  $('#s-results .scroll').scrollTop = 0;
}

function bindResults() {
  $('#resCats').addEventListener('click', e => {
    if (!$('#resCats').dataset.editable || !G) return;
    const row = e.target.closest('.res-row'); if (!row) return;
    const res = G.history[G.history.length - 1];
    const cell = res.cells[row.dataset.pid][row.dataset.cat];
    if (!cell.a) return;
    if (cell.st === 'wrong') return toast(norm(cell.a)[0] === res.letter ? 'התשובה קצרה מדי' : `התשובה לא מתחילה באות ${res.letter}`);
    cell.ok = !cell.ok; recalc(res); Sfx.click();
    const y = $('#s-results .scroll').scrollTop;
    renderResults(res, G.players, standings(), { editable: true, isLast: G.roundNo >= G.settings.rounds });
    $('#s-results .scroll').scrollTop = y;
    if (ROLE === 'host') Net.broadcast({ t: 'results', res, players: G.players.map(pub), std: standings(), isLast: G.roundNo >= G.settings.rounds });
  });
  $('#nextBtn').onclick = () => {
    if (current !== 'results' || !G) return;   // guard against double-tap
    Sfx.click();
    if (G.roundNo >= G.settings.rounds) showFinal(); else nextRound();
  };
}

/* ---------- final ---------- */
function showFinal() {
  const std = standings();
  renderFinal(std, G.players, false);
  if (ROLE === 'host') Net.broadcast({ t: 'final', std, players: G.players.map(pub) });
}

function renderFinal(std, players, isClient) {
  const P = Object.fromEntries(players.map(p => [p.id, p]));
  const order = [1, 0, 2].filter(i => std[i]);
  const cls = ['first', 'second', 'third'];
  $('#podium').innerHTML = order.map(i => {
    const p = P[std[i].id];
    return `<div class="pod ${cls[i]}" style="animation-delay:${(2 - i) * 180}ms"><span class="p-av" style="--pc:${p.color}">${p.avatar}</span>
      <div class="pod-name">${esc(p.name)}</div><div class="pod-score">${std[i].total}</div><div class="pod-block">${i + 1}</div></div>`;
  }).join('');
  const rest = std.slice(3);
  $('#finalRest').classList.toggle('hidden', !rest.length);
  $('#finalRest').innerHTML = rest.map((s, j) => {
    const p = P[s.id];
    return `<div class="std-row"><span class="rank">${j + 4}</span><span class="r-av" style="--pc:${p.color}">${p.avatar}</span><span class="std-name">${esc(p.name)}</span><span class="std-total">${s.total}</span></div>`;
  }).join('');
  $('#againBtn').classList.toggle('hidden', isClient);
  $('#finalWait').classList.toggle('hidden', !isClient);
  show('final');
  Sfx.win(); vib([60, 40, 60, 40, 160]);
  confetti();
}

function playAgain() {
  if (current !== 'final') return;   // guard against double-tap
  Sfx.click();
  if (ROLE === 'host') {
    cleanupGame();
    SETUP.players = SETUP.players.filter(p => p.type !== 'remote' || Net.conns.has(p.id));
    openSetup('online', true);
    broadcastLobby();
  } else { startGame(); }
}

/* ---------- cleanup / navigation ---------- */
function cleanupGame() {
  if (PLAY) { clearInterval(PLAY.iv); clearInterval(PLAY.graceIv); PLAY.ended = true; }
  if (R) { clearTimeout(R.waitTo); R.finished = true; }
  hideBanner(); releaseWakeLock();
  spinId++;
  PLAY = null; R = null; G = null;
}
function quitToHome() {
  cleanupGame();
  if (ROLE === 'host') { Net.broadcast({ t: 'bye' }); }
  leaveNet();
  show('home');
}
function leaveNet() {
  const was = ROLE; ROLE = 'local';
  if (was === 'local') return;
  // detach now (so a new room can open right away), destroy a moment later so a last "bye" can be delivered
  const old = Net.peer; Net.peer = null; Net.close();
  setTimeout(() => { try { old && old.destroy(); } catch (e) { /* ignore */ } }, 300);
}
function confirmQuit() {
  modal('<h3>לצאת מהמשחק?</h3><p>המשחק הנוכחי יסתיים וההתקדמות תאבד.</p>', [
    { label: 'כן, לצאת', cls: 'btn-red', fn: quitToHome }, { label: 'להמשיך לשחק', cls: 'btn-yellow' }]);
}
function goBack() {
  if (modalOpen()) return closeModal();
  switch (current) {
    case 'home':
      if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App) Capacitor.Plugins.App.exitApp();
      break;
    case 'setup':
      if (ROLE === 'host') modal('<h3>לסגור את החדר?</h3><p>כל השחקנים המחוברים ינותקו.</p>', [
        { label: 'סגור חדר', cls: 'btn-red', fn: quitToHome }, { label: 'ביטול' }]);
      else show('home');
      break;
    case 'online': show('home'); break;
    case 'wait': quitToHome(); break;
    case 'final': quitToHome(); break;
    default: confirmQuit();
  }
}

/* ================= networking (PeerJS / WebRTC) ================= */
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = res; s.onerror = () => { s.remove(); rej(new Error('load ' + src)); };
    document.head.appendChild(s);
  });
}
const Net = {
  PREFIX: 'erechear-he-game-v1-',
  peer: null, conns: new Map(), hostConn: null, code: null, myId: null,
  lib() {
    if (window.Peer) return Promise.resolve();
    return loadScript('https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js')
      .catch(() => loadScript('https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'));
  },
  open(id) {
    return new Promise((res, rej) => {
      const p = id ? new Peer(id) : new Peer();
      let done = false;
      const fail = e => { if (done) return; done = true; try { p.destroy(); } catch (_) { /* */ } rej(e); };
      p.on('open', pid => { if (done) return; done = true; this.peer = p; this.myId = pid; res(pid); });
      p.on('error', e => { if (!done) fail(e); });
      p.on('connection', c => this.onConn(c));
      p.on('disconnected', () => { if (this.peer === p && !p.destroyed) { try { p.reconnect(); } catch (_) { /* */ } } });
      p.on('close', () => { if (this.peer === p) this.peer = null; });
      setTimeout(() => fail({ type: 'timeout' }), 15000);
    });
  },
  async host() {
    await this.lib();
    for (let i = 0; i < 6; i++) {
      const code = String(1000 + (Math.random() * 9000 | 0));
      try { await this.open(this.PREFIX + code); this.code = code; return code; }
      catch (e) { if (e.type !== 'unavailable-id') throw e; }
    }
    throw new Error('no-id');
  },
  onConn(c) {
    c.on('open', () => this.conns.set(c.peer, c));
    c.on('data', d => { if (ROLE === 'host' && d && d.t) Host.msg(c.peer, d, c); });
    c.on('close', () => { if (this.conns.get(c.peer) === c) { this.conns.delete(c.peer); Host.leave(c.peer); } });
    c.on('error', () => {});
  },
  dropConn(id) { const c = this.conns.get(id); if (c) { this.conns.delete(id); try { c.close(); } catch (_) { /* */ } } },
  broadcast(m) { this.conns.forEach(c => { if (c.open) { try { c.send(m); } catch (_) { /* */ } } }); },
  sendTo(id, m) { const c = this.conns.get(id); if (c && c.open) c.send(m); },
  async join(code) {
    await this.lib();
    await this.open(null);
    return new Promise((res, rej) => {
      let done = false;
      const c = this.peer.connect(this.PREFIX + code, { reliable: true });
      c.on('open', () => { if (done) return; done = true; this.hostConn = c; this.code = code; res(); });
      c.on('data', d => { if (ROLE === 'client' && d && d.t) Client.msg(d); });
      c.on('close', () => Client.closed());
      this.peer.on('error', e => { if (!done) { done = true; rej(e); } });
      setTimeout(() => { if (!done) { done = true; rej({ type: 'timeout' }); } }, 12000);
    });
  },
  send(m) { if (this.hostConn && this.hostConn.open) { try { this.hostConn.send(m); } catch (_) { /* */ } } },
  close() {
    try { this.peer && this.peer.destroy(); } catch (_) { /* */ }
    this.peer = null; this.conns.clear(); this.hostConn = null; this.code = null; this.myId = null;
  }
};

/* ---------- sanitising everything that arrives over the network ---------- */
const ALL_AVATARS = [...AVATARS, ...BOT_AVATARS];
const COLOR_RE = /^#[0-9a-f]{6}$/i, ID_RE = /^[\w-]{1,64}$/;
const ST_OK = ['empty', 'wrong', 'valid', 'unknown'], KIND_OK = ['zero', 'solo', 'uniq', 'dup'];
const cleanStr = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');
const cleanInt = (v, min, max, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
function cleanPlayer(p) {
  p = p || {};
  return {
    id: ID_RE.test(p.id) ? p.id : 'x-' + uid(), name: cleanStr(p.name, 14).trim() || '?',
    type: p.type === 'bot' ? 'bot' : 'human', avatar: ALL_AVATARS.includes(p.avatar) ? p.avatar : '❔',
    color: COLOR_RE.test(p.color) ? p.color : '#999999', level: LEVELS[p.level] ? p.level : null
  };
}
const cleanPlayers = a => (Array.isArray(a) ? a.slice(0, MAX_PLAYERS).map(cleanPlayer) : []);
function cleanCats(a) { const c = Array.isArray(a) ? [...new Set(a.filter(x => CAT_BY_ID[x]))] : []; return c.length >= 3 ? c : [...DEFAULTS.cats]; }
function cleanSettings(s) {
  s = s || {};
  return { cats: cleanCats(s.cats), rounds: cleanInt(s.rounds, 1, 20, 5), timer: cleanInt(s.timer, 0, 600, 90), stopRule: !!s.stopRule, hardLetters: !!s.hardLetters };
}
function cleanAnswers(a) {
  const o = {};
  if (a && typeof a === 'object') CATS.forEach(c => { if (typeof a[c.id] === 'string') o[c.id] = a[c.id].slice(0, 28); });
  return o;
}
function cleanResults(res, players) {
  res = res || {};
  const out = { n: cleanInt(res.n, 1, 99, 1), letter: LETTERS.includes(res.letter) ? res.letter : '?', cats: cleanCats(res.cats), cells: {}, totals: {} };
  players.forEach(p => {
    out.cells[p.id] = {};
    out.cats.forEach(c => {
      const x = ((res.cells || {})[p.id] || {})[c] || {};
      out.cells[p.id][c] = { a: cleanStr(x.a, 28), st: ST_OK.includes(x.st) ? x.st : 'empty', ok: !!x.ok, pts: cleanInt(x.pts, 0, 15, 0), kind: KIND_OK.includes(x.kind) ? x.kind : 'zero' };
    });
  });
  return out;
}
function cleanStd(std, players) {
  const ids = new Set(players.map(p => p.id));
  return (Array.isArray(std) ? std : []).filter(s => s && ids.has(s.id))
    .map(s => ({ id: s.id, total: cleanInt(s.total, 0, 99999, 0), last: cleanInt(s.last, 0, 999, 0) }));
}

const Host = {
  msg(id, d, conn) {
    switch (d.t) {
      case 'join': {
        if (G) { conn.send({ t: 'busy' }); return; }
        if (!SETUP || SETUP.mode !== 'online') return;
        if (SETUP.players.some(p => p.id === id)) return broadcastLobby();
        if (SETUP.players.length >= MAX_PLAYERS) { conn.send({ t: 'full' }); return; }
        const i = SETUP.players.length;
        if (!ID_RE.test(id)) return;
        const name = cleanStr(d.name, 14).trim() || 'שחקן ' + (i + 1);
        SETUP.players.push({ id, name, type: 'remote', avatar: AVATARS.includes(d.avatar) ? d.avatar : AVATARS[i % AVATARS.length], color: COLORS[i % COLORS.length] });
        renderSetup(); toast(`${name} הצטרף/ה 🎉`); Sfx.good(); vib(30);
        broadcastLobby();
        break;
      }
      case 'stop':
        if (G && R && PLAY && !PLAY.ended && G.settings.stopRule) { const p = G.players.find(x => x.id === id); if (p) triggerStop(p); }
        break;
      case 'prog':
        if (R && !R.finished && G && G.players.some(p => p.id === id)) R.progress[id] = cleanInt(d.n, 0, CATS.length, 0);
        break;
      case 'answers':
        if (R && !R.finished && R.pending && R.pending.has(id)) { R.answers[id] = cleanAnswers(d.a); R.checkPending && R.checkPending(); }
        break;
    }
  },
  leave(id) {
    if (!SETUP) return;
    const sp = SETUP.players.find(x => x.id === id);
    SETUP.players = SETUP.players.filter(x => x.id !== id);
    if (G) {
      const gp = G.players.find(x => x.id === id);
      if (gp) { gp.left = true; toast(`${gp.name} התנתק/ה`); R && R.checkPending && R.checkPending(); }
    } else if (sp) {
      renderSetup(); broadcastLobby(); toast(`${sp.name} עזב/ה את החדר`);
    }
  }
};

const Client = {
  msg(d) {
    switch (d.t) {
      case 'lobby':
        if (G) cleanupGame();
        CL = { code: Net.code, players: cleanPlayers(d.players), settings: cleanSettings(d.settings) };
        renderWait();
        if (current !== 'wait') show('wait');
        break;
      case 'start':
        G = { mode: 'online', players: CL ? CL.players : [], settings: { ...(CL ? CL.settings : DEFAULTS) }, roundNo: 0, history: [], meId: Net.myId };
        break;
      case 'round': {
        if (!LETTERS.includes(d.letter)) return;
        if (PLAY) { clearInterval(PLAY.iv); clearInterval(PLAY.graceIv); PLAY.ended = true; }
        hideBanner();
        if (!G) G = { mode: 'online', history: [], meId: Net.myId, settings: {} };
        const n = cleanInt(d.n, 1, 99, 1), total = cleanInt(d.total, 1, 99, 5), dur = cleanInt(d.dur, 0, 600, 90);
        G.players = cleanPlayers(d.players);
        G.settings = { ...G.settings, cats: cleanCats(d.cats), stopRule: !!d.stopRule, timer: dur, rounds: total };
        G.roundNo = n;
        R = { n, letter: d.letter, dur, answers: {}, progress: {}, realtime: true, stopping: false };
        const myR = R;
        runSpin(d.letter, n, total).then(() => {
          if (R !== myR || R.collected) return;
          startPlay(G.players.find(p => p.id === G.meId) || { id: G.meId, name: myName(), avatar: myAvatar() });
        });
        break;
      }
      case 'progs':
        if (R && G && d.p && typeof d.p === 'object') G.players.forEach(p => { if (p.id in d.p) R.progress[p.id] = cleanInt(d.p[p.id], 0, CATS.length, 0); });
        break;
      case 'stop':
        if (PLAY && PLAY.R === R && !PLAY.ended && !R.stopping) beginGrace(cleanStr(d.by, 14) || '?', d.byId === G.meId);
        break;
      case 'collect':
        if (PLAY && PLAY.R === R && !PLAY.ended) endPlay('collect');
        else if (R && !(PLAY && PLAY.R === R)) { R.collected = true; Net.send({ t: 'answers', a: {} }); }
        break;
      case 'results':
        if (PLAY) { clearInterval(PLAY.iv); clearInterval(PLAY.graceIv); PLAY.ended = true; }
        hideBanner();
        {
          const pl = cleanPlayers(d.players);
          const wasOn = current === 'results';
          renderResults(cleanResults(d.res, pl), pl, cleanStd(d.std, pl), { editable: false, isLast: !!d.isLast });
          if (!wasOn) Sfx.good();
        }
        break;
      case 'final': {
        const pl = cleanPlayers(d.players);
        renderFinal(cleanStd(d.std, pl), pl, true);
        break;
      }
      case 'busy': toast('המשחק בחדר כבר התחיל — נסו שוב כשיסתיים'); quitToHome(); show('online'); break;
      case 'full': toast('החדר מלא'); quitToHome(); show('online'); break;
      case 'kicked': toast('הוסרת מהחדר'); quitToHome(); break;
      case 'bye': toast('המארח סגר את החדר'); quitToHome(); break;
    }
  },
  closed() {
    if (ROLE !== 'client') return;
    toast('החיבור למארח נותק'); quitToHome();
  }
};

function renderWait() {
  if (!CL) return;
  $('#waitCode').textContent = CL.code || Net.code;
  $('#waitPlayers').innerHTML = (CL.players || []).map(p => `<div class="p-row"><span class="p-av" style="--pc:${p.color}">${p.avatar}</span>
    <div class="p-name-static">${esc(p.name)}${p.id === Net.myId ? ' <small>(את/ה)</small>' : ''}</div>
    ${p.type === 'bot' ? `<span class="tag">🤖 ${LEVELS[p.level] ? LEVELS[p.level].name : ''}</span>` : ''}</div>`).join('');
  const s = CL.settings || DEFAULTS;
  $('#waitCats').innerHTML = (s.cats || []).map(id => { const c = CAT_BY_ID[id]; return `<span class="chip on" style="--c:${c.color}">${c.icon} ${c.name}</span>`; }).join('');
  $('#waitInfo').textContent = `${s.rounds} סיבובים · ${s.timer ? s.timer + ' שניות לסיבוב' : 'ללא הגבלת זמן'}${s.stopRule ? ' · עם "עצור!"' : ''}`;
}

function bindOnline() {
  const nameInp = $('#onName');
  const renderAv = () => { $('#onAvatar').innerHTML = AVATARS.map(a => `<button class="${a === myAvatar() ? 'on' : ''}" data-av="${a}">${a}</button>`).join(''); };
  $('#onAvatar').addEventListener('click', e => { const b = e.target.closest('[data-av]'); if (!b) return; store.set('avatar', b.dataset.av); Sfx.click(); renderAv(); });
  nameInp.addEventListener('input', () => store.set('name', nameInp.value.trim()));
  const needName = () => { if (!nameInp.value.trim()) { toast('כתבו את השם שלכם'); nameInp.focus(); return true; } return false; };
  const busy = (btn, on, txt) => { btn.disabled = on; btn.textContent = txt; };
  $('#createRoom').onclick = async () => {
    Sfx.init(); if (needName()) return;
    const btn = $('#createRoom'); busy(btn, true, 'פותחים חדר...');
    try {
      await Net.host(); ROLE = 'host';
      openSetup('online');
    } catch (e) {
      Net.close(); toast('לא הצלחנו לפתוח חדר — בדקו את החיבור לאינטרנט');
    } finally { busy(btn, false, 'צור חדר'); }
  };
  $('#joinRoom').onclick = async () => {
    Sfx.init(); if (needName()) return;
    const code = $('#joinCode').value.replace(/\D/g, '');
    if (code.length !== 4) return toast('קוד החדר הוא 4 ספרות');
    const btn = $('#joinRoom'); busy(btn, true, 'מתחברים...');
    try {
      await Net.join(code); ROLE = 'client';
      CL = { code, players: [], settings: DEFAULTS };
      Net.send({ t: 'join', name: nameInp.value.trim(), avatar: myAvatar() });
      renderWait(); show('wait');
    } catch (e) {
      Net.close();
      toast(e && e.type === 'peer-unavailable' ? 'לא נמצא חדר עם הקוד הזה' : 'החיבור נכשל — בדקו את הקוד והאינטרנט');
    } finally { busy(btn, false, 'הצטרף'); }
  };
  window.__renderAv = renderAv;
}
function openOnline() {
  $('#onName').value = store.get('name', '');
  window.__renderAv();
  show('online');
}

/* ================= wake lock ================= */
let wakeLock = null;
async function requestWakeLock() { try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ } }
function releaseWakeLock() { try { wakeLock && wakeLock.release(); } catch (e) { /* ignore */ } wakeLock = null; }

/* ================= confetti ================= */
function confetti() {
  const cv = $('#confetti'), ctx = cv.getContext('2d');
  const W = cv.width = cv.offsetWidth * devicePixelRatio, H = cv.height = cv.offsetHeight * devicePixelRatio;
  const cols = ['#ffd23f', '#ff6b9d', '#2ee6c5', '#b197fc', '#74c0fc', '#ffa94d'];
  const parts = Array.from({ length: 160 }, () => ({
    x: Math.random() * W, y: -Math.random() * H * .6, vx: rnd(-1.5, 1.5) * devicePixelRatio, vy: rnd(2, 5) * devicePixelRatio,
    s: rnd(6, 12) * devicePixelRatio, r: Math.random() * 6, vr: rnd(-.2, .2), c: pick(cols)
  }));
  const t0 = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, W, H);
    parts.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vy += .03;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
    });
    if (t - t0 < 5000 && current === 'final') requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
  })(t0);
}

/* ================= init ================= */
function init() {
  buildBg();
  const sb = $('#soundBtn');
  const paintSound = () => { sb.textContent = Sfx.on ? '🔊' : '🔇'; };
  paintSound();
  sb.onclick = () => { Sfx.on = !Sfx.on; store.set('sound', Sfx.on); paintSound(); Sfx.init(); Sfx.click(); };

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    Sfx.init();
    const act = b.dataset.act;
    if (act === 'solo' || act === 'local') { ROLE = 'local'; Sfx.click(); openSetup(act); }
    else if (act === 'online') { Sfx.click(); openOnline(); }
    else if (act === 'rules') showRules();
    else if (act === 'back') goBack();
  });
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

  bindSetup(); bindResults(); bindOnline();
  $('#stopBtn').onclick = onStopBtn;
  $('#againBtn').onclick = playAgain;
  $('#homeBtn').onclick = () => { Sfx.click(); quitToHome(); };

  // answers: live validation + Enter moves to next field
  const ans = $('#answers');
  ans.addEventListener('input', e => {
    const i = e.target; if (!i.dataset.cat || !R) return;
    const st = check(i.value, i.dataset.cat, R.letter);
    i.classList.toggle('ok', st === 'valid' || st === 'unknown');
    i.classList.toggle('bad', st === 'wrong' && norm(i.value).length > 0 && norm(i.value)[0] !== R.letter);
    if (PLAY) updateStopBtn();
  });
  ans.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const inputs = $$('#answers input'), idx = inputs.indexOf(e.target);
    if (idx < inputs.length - 1) inputs[idx + 1].focus(); else e.target.blur();
  });
  ans.addEventListener('focusin', e => { if (e.target.tagName === 'INPUT') setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250); });

  document.addEventListener('keydown', e => { if (e.key === 'Escape') goBack(); });

  // Android hardware back button (Capacitor)
  try {
    if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App) Capacitor.Plugins.App.addListener('backButton', goBack);
  } catch (e) { /* ignore */ }

  // desktop launcher ("התחל משחק"): tell the local server we're alive / closing
  if (location.hostname === '127.0.0.1' && location.port === '8777') {
    const ping = () => fetch('/__ping', { cache: 'no-store' }).catch(() => {});
    ping(); setInterval(ping, 5000);
    addEventListener('pagehide', () => { try { navigator.sendBeacon('/__bye'); } catch (e) { /* ignore */ } });
  }

  // PWA offline cache (web only)
  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.Capacitor) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
document.addEventListener('DOMContentLoaded', init);
