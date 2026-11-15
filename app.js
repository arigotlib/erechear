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
const vib = p => { try { if (store.get('vibrate', true) && navigator.vibrate) navigator.vibrate(p); } catch (e) { /* ignore */ } };

/* ================= text normalisation & dictionary ================= */
const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
function norm(s) {
  return String(s || '')
    .replace(/[֑-ׇ]/g, '')          // niqqud / cantillation
    .replace(/["'`׳״\-־.,]/g, '')
    .replace(/\s+/g, ' ').trim()
    .split('').map(c => FINALS[c] || c).join('');
}
/* Answer matching, three levels (most to least exact):
   strict — spaces ignored, doubled ו/י collapsed      (עגבניה = עגבנייה, but טל ≠ טלי)
   loose  — also ignores ו/י/א inside the word and a final ה (ליכטנשטיין = ליכטינשטין, גבון = גיבאון)
   fuzzy  — loose key within 1 typo of a dictionary word (2 for long words)
   Two answers count as "the same" when they resolve to the same dictionary word (or, if neither is
   in the dictionary, have the same loose key). */
const strictKey = s => norm(s).replace(/ /g, '').replace(/יי+/g, 'י').replace(/וו+/g, 'ו');
function looseKey(s) {
  const n = strictKey(s);
  return n ? (n[0] + n.slice(1).replace(/[ויא]/g, '')).replace(/(.)ה$/, '$1') : '';
}
function lev(a, b, max) {             // Levenshtein distance with early exit
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const DICT = {}, IDX = {};
CATS.forEach(c => {
  DICT[c.id] = {};
  const ix = IDX[c.id] = { strict: new Map(), loose: new Map(), byLetter: {} };
  c.raw.split('|').forEach(part => {
    const [L, ws] = part.split(':');
    // "שוודיה=שבדיה" = synonyms: first form is the canonical one (and what the computer writes)
    const groups = ws.split(',').map(s => s.split('=').map(x => x.trim()).filter(Boolean)).filter(g => g.length);
    DICT[c.id][L] = groups.map(g => g[0]);
    ix.byLetter[L] = [];
    groups.forEach(g => g.forEach(form => {
      ix.byLetter[L].push({ w: g[0], lk: looseKey(form) });
      if (!ix.strict.has(strictKey(form))) ix.strict.set(strictKey(form), g[0]);
      if (!ix.loose.has(looseKey(form))) ix.loose.set(looseKey(form), g[0]);
    }));
  });
});

/** -> { st: empty|wrong|valid|unknown, canon: identity for duplicate detection, match: dictionary word } */
function resolve(ans, cat, letter) {
  const n = norm(ans);
  if (!n) return { st: 'empty' };
  if (n[0] !== letter || n.replace(/ /g, '').length < 2) return { st: 'wrong' };
  const sk = strictKey(n), lk = looseKey(n), ix = IDX[cat];
  if (ix) {
    let w = ix.strict.get(sk) || ix.loose.get(lk);
    if (!w && lk.length >= 4) {
      const max = lk.length >= 7 ? 2 : 1;
      let best = null, bd = max + 1;
      for (const c of ix.byLetter[letter] || []) { const d = lev(lk, c.lk, max); if (d < bd) { bd = d; best = c.w; } }
      w = best;
    }
    if (w) return { st: 'valid', canon: 'd:' + strictKey(w), match: w };
  }
  return { st: 'unknown', canon: 'u:' + lk };
}
const check = (ans, cat, letter) => resolve(ans, cat, letter).st;

/* ================= categories: built-in + player-made ================= */
const CAT_ICONS = ['⭐', '🎬', '📺', '🎵', '⚽', '🏀', '🚗', '👕', '🏷️', '🎮', '📚', '🧪', '🗺️', '🏞️', '🌊', '🍰', '🍹', '🧸', '💼', '🎨', '🦸', '👑', '🎭', '🔤', '❤️', '🐉', '🚀', '🏛️', '🌟', '🎯'];
const CAT_COLORS = ['#ffd43b', '#ffa8a8', '#a5d8ff', '#b2f2bb', '#eebefa', '#ffc078', '#99e9f2', '#d0bfff', '#c0eb75', '#fcc2d7'];
const CUSTOM_RE = /^c_[a-z0-9]{1,16}$/;
let CUSTOM_CATS = [];              // this device's own categories (saved)
const REMOTE_CATS = {};            // categories received from an online host
function loadCustomCats() {
  const raw = store.get('customCats', []);
  CUSTOM_CATS = (Array.isArray(raw) ? raw : []).map(cleanCatDef).filter(Boolean);
}
function cleanCatDef(c) {
  if (!c || !CUSTOM_RE.test(c.id)) return null;
  const name = String(c.name || '').trim().slice(0, 16);
  if (!name) return null;
  return {
    id: c.id, name, custom: true,
    icon: typeof c.icon === 'string' && c.icon.length <= 8 ? c.icon : '⭐',
    color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : CAT_COLORS[0]
  };
}
const allCats = () => [...CATS, ...CUSTOM_CATS];
function getCat(id) {
  return CAT_BY_ID[id] || CUSTOM_CATS.find(c => c.id === id) || REMOTE_CATS[id] || null;
}
/** definitions of the custom categories in a list (sent to online players) */
const customDefs = ids => ids.map(getCat).filter(c => c && c.custom).map(({ id, name, icon, color }) => ({ id, name, icon, color }));
function registerRemoteCats(defs) {
  (Array.isArray(defs) ? defs.slice(0, 60) : []).map(cleanCatDef).filter(Boolean).forEach(c => { REMOTE_CATS[c.id] = c; });
}

/* ================= constants ================= */
/* players are shown as a monogram (first letter of the name) on a chosen tone */
const TONES = {
  gold: '#c9a96e', ivory: '#e8dfcf', sage: '#9fb09a', rose: '#c79c98', sky: '#93a8c2',
  plum: '#a594b4', sand: '#cbb595', slate: '#8f99a4', jade: '#7fa497', rust: '#b88566'
};
const AVATARS = Object.keys(TONES);
const BOT_AVATARS = ['slate', 'jade', 'sky', 'plum', 'sand', 'rust'];
const toneOf = a => TONES[a] || TONES.ivory;
const initialOf = name => (String(name || '').trim()[0] || '·');
function avHTML(p, cls = '') {
  return `<span class="av ${cls} ${p.type === 'bot' ? 'is-bot' : ''}" style="--t:${toneOf(p.avatar)}">${esc(initialOf(p.name))}</span>`;
}
const tonePicker = sel => AVATARS.map(a => `<button class="tone ${a === sel ? 'on' : ''}" data-av="${a}" style="--t:${TONES[a]}" aria-label="${a}"></button>`).join('');

/* thin line icons for the built-in categories; player-made categories get a serif monogram */
const ICON_PATHS = {
  country: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5M12 3.5C9.4 5.9 8.2 8.7 8.2 12s1.2 6.1 3.8 8.5"/>',
  city: '<path d="M3.5 20.5h17M5 20.5V9.5l5-2.5v13.5M10 20.5V4.5l5.5 2.5v13.5M15.5 20.5v-8l4 1.5v6.5"/><path d="M7 12h1M7 15h1M12.5 9h1M12.5 12h1M12.5 15h1"/>',
  animal: '<circle cx="6.8" cy="9.3" r="1.7"/><circle cx="10.2" cy="6.3" r="1.7"/><circle cx="13.8" cy="6.3" r="1.7"/><circle cx="17.2" cy="9.3" r="1.7"/><path d="M12 11.5c-2.9 0-5.3 3.3-5.3 5.5 0 1.5 1.2 2.5 2.6 2.5 1.1 0 1.7-.5 2.7-.5s1.6.5 2.7.5c1.4 0 2.6-1 2.6-2.5 0-2.2-2.4-5.5-5.3-5.5z"/>',
  plant: '<path d="M6 19.5c0-8.3 5.6-14 14-14 0 8.4-5.7 14-14 14z"/><path d="M4 21.5l2-2M6 19.5c2.6-3.8 5.6-6.6 9.5-8.7"/>',
  object: '<path d="M8 3.5h8l3 7.5H5z"/><path d="M12 11v8.5M8.5 20.5h7"/>',
  name: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5c1.4-3.7 4.3-5.7 7.5-5.7s6.1 2 7.5 5.7"/>',
  job: '<rect x="3.5" y="7.5" width="17" height="12" rx="1.5"/><path d="M9 7.5V5.2c0-.4.3-.7.7-.7h4.6c.4 0 .7.3.7.7v2.3M3.5 12.5h17"/>',
  food: '<path d="M7 3.5v17M4.8 3.5v4.8a2.2 2.2 0 0 0 4.4 0V3.5M17.2 20.5V3.5c-2.4 1.6-3.2 4.6-3.2 8h3.2"/>'
};
function catIcon(c) {
  if (c && ICON_PATHS[c.id]) return `<svg class="ci" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[c.id]}</svg>`;
  return `<span class="ci mono">${esc(initialOf(c && c.name))}</span>`;
}
const COLORS = ['#ff8fab', '#ffc078', '#ffe066', '#8ce99a', '#63e6be', '#74c0fc', '#91a7ff', '#e599f7', '#ffa8a8', '#66d9e8'];
const BOT_NAMES = ['רובי', 'ביפ', 'פיקסל', 'נובה', 'טורבו', 'זיגי', 'מקס', 'צ׳יפי'];
const LEVELS = {
  easy:   { name: 'קל',     fill: [.45, .7], time: [.75, .98], pool: 5,   stops: false },
  medium: { name: 'בינוני', fill: [.72, .92], time: [.55, .8], pool: 14,  stops: true },
  hard:   { name: 'קשה',    fill: [.92, 1],  time: [.35, .58], pool: 999, stops: true }
};
const DEFAULTS = { cats: ['country', 'city', 'animal', 'plant', 'object', 'name', 'job'], rounds: 5, timer: 90, stopRule: true, hardLetters: false, style: 'classic', listTime: 60 };
const TIMER_PRESETS = [45, 60, 90, 120, 0];   // online rooms use only these, so everyone plays by the same clock
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
  // soft, low-volume sine tones: a bell-like palette rather than arcade beeps
  click() { this.tone(660, .08, 'sine', .045); },
  tick() { this.tone(1400, .03, 'sine', .018); },
  land() { [392, 494, 587, 784].forEach((f, i) => this.tone(f, 1.1, 'sine', .06, i * .06)); },
  stop() { this.tone(220, .7, 'sine', .09, 0, 165); this.tone(330, .5, 'sine', .04, .03); },
  warn() { this.tone(988, .12, 'sine', .035); },
  good() { this.tone(784, .35, 'sine', .05); this.tone(1175, .5, 'sine', .035, .09); },
  win() { [392, 523, 659, 784, 1046].forEach((f, i) => this.tone(f, 1.4, 'sine', .055, i * .16)); }
};

/* ================= ui helpers ================= */
let current = 'home';
function show(id) {
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === 's-' + id));
  current = id;
  if (id === 'home') renderHomeProfile();
}
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}
let modalSeq = 0;
function modal(html, buttons = [{ label: 'סגור', cls: 'btn-yellow' }]) {
  const seq = ++modalSeq;
  $('#modalBody').innerHTML = html;
  const box = $('#modalBtns'); box.innerHTML = '';
  buttons.forEach(b => {
    const el = document.createElement('button');
    el.className = 'btn ' + (b.cls || 'btn-ghost'); el.textContent = b.label;
    // fn returning false keeps the dialog open; a fn that opened another dialog keeps that one
    el.onclick = () => { const r = b.fn ? b.fn() : undefined; if (r !== false && modalSeq === seq) closeModal(); };
    box.appendChild(el);
  });
  $('#modal').classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); }
const modalOpen = () => !$('#modal').classList.contains('hidden');

function showRules() {
  modal(`<h3>איך משחקים ארץ עיר</h3>
  <p>בכל סיבוב מוגרלת אות. צריך למצוא לכל קטגוריה מילה שמתחילה באות הזאת — מהר ככל האפשר!</p>
  <ul>
    <li><b>15 נקודות</b> — רק אתם עניתם בקטגוריה.</li>
    <li><b>10 נקודות</b> — תשובה שאף אחד אחר לא כתב.</li>
    <li><b>5 נקודות</b> — תשובה שגם שחקן אחר כתב.</li>
    <li><b>0</b> — ריק, אות שגויה או תשובה שנפסלה.</li>
  </ul>
  <p><b>עצור:</b> מי שממלא את כל השדות ראשון יכול לעצור. לשאר נשארות ${GRACE} שניות להשלים.</p>
  <p><b>מצב רשימות:</b> בכל קטגוריה בתורה יש זמן קצוב לכתוב כמה שיותר מילים. כל מילה ששום שחקן אחר לא כתב שווה 10 נקודות, ומילה שגם מישהו אחר כתב נפסלת.</p>
  <p><b>פסילת תשובות:</b> בסוף כל סיבוב לוחצים על תשובה כדי לפסול אותה. באונליין כל שחקן מצביע, ותשובה נפסלת כשרוב השחקנים חושבים שהיא לא נכונה. תשובה עם <b>?</b> לא נמצאה במאגר, אז תחליטו ביחד.</p>
  <p><b>כתיב שונה:</b> המשחק מזהה את אותה תשובה גם בכתיב קצת שונה (ליכטנשטיין = ליכטינשטין) וגם עם שגיאת הקלדה קטנה.</p>
  <p><b>מול המחשב:</b> קל — עונה על חלק ולא עוצר · בינוני — עונה על רוב ולפעמים עוצר · קשה — מהיר מאוד!</p>`);
}

/* ================= background ================= */
function buildBg() { /* the background is pure CSS (ink, grain, vignette) */ }

/* ================= state ================= */
let ROLE = 'local';      // local | host | client
let SETUP = null;        // {mode, players, settings}
let G = null;            // game
let R = null;            // round
let PLAY = null;         // the current answering session on this device
let CL = null;           // client lobby info

const pub = p => ({ id: p.id, name: p.name, type: p.type === 'bot' ? 'bot' : 'human', avatar: p.avatar, color: p.color, level: p.level || null });
const myName = () => store.get('name', '') || 'אני';
const myAvatar = () => { const a = store.get('avatar', 'gold'); return TONES[a] ? a : 'gold'; };

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
    settings.cats = (settings.cats || DEFAULTS.cats).filter(c => CAT_BY_ID[c] || CUSTOM_CATS.some(x => x.id === c));
    if (settings.cats.length < 3) settings.cats = [...DEFAULTS.cats];
    if (mode === 'online') {             // online: classic style, fixed clock
      settings.style = 'classic';
      if (!TIMER_PRESETS.includes(settings.timer)) settings.timer = 90;
    }
    SETUP = { mode, players: [], settings };
    if (mode === 'solo') {
      SETUP.players.push({ ...makeHuman(myName(), 0, myAvatar()), me: true });
      addBot('easy'); addBot('medium');
    } else if (mode === 'local') {
      const names = store.get('localNames', [store.get('name', '') || 'שחקן 1', 'שחקן 2']);
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
  $('#catChips').innerHTML = allCats().map(c =>
    `<span class="chip-wrap"><button class="chip ${s.cats.includes(c.id) ? 'on' : ''}" data-cat="${c.id}">${catIcon(c)}${esc(c.name)}</button>${c.custom ? `<button class="chip-x" data-del="${c.id}" aria-label="מחק קטגוריה">×</button>` : ''}</span>`).join('')
    + '<button class="chip chip-add" id="addCat">+ קטגוריה משלכם</button>';
  $('#catCount').textContent = `${s.cats.length} נבחרו`;
  const online = SETUP.mode === 'online';
  $$('#s-setup .seg[data-key]').forEach(seg => {
    const key = seg.dataset.key, vals = seg.dataset.vals.split(','), labels = (seg.dataset.labels || seg.dataset.vals).split(',');
    let h = vals.map((v, i) => `<button class="${String(s[key]) === v ? 'on' : ''}" data-v="${v}">${labels[i]}</button>`).join('');
    if (seg.dataset.custom && !online) {          // free choice of time (not online)
      const isCustom = !vals.includes(String(s[key]));
      h += `<button class="${isCustom ? 'on' : ''}" data-custom="${key}">⏱ ${isCustom ? fmtSec(s[key]) : 'אחר'}</button>`;
    }
    seg.innerHTML = h;
  });
  $$('#s-setup .switch').forEach(sw => sw.classList.toggle('on', !!s[sw.dataset.key]));
  const lists = s.style === 'lists';
  $('#optStyle').classList.toggle('hidden', online);
  $('#optTimer').classList.toggle('hidden', lists);
  $('#optListTime').classList.toggle('hidden', !lists);
  $('#optStop').classList.toggle('hidden', lists);
  $('#styleNote').textContent = lists
    ? 'בכל קטגוריה בתורה: כמה שיותר מילים בזמן קצוב. מילה שמישהו אחר כתב נפסלת.'
    : 'מילה אחת לכל קטגוריה, כולן ביחד';
  $('#stopNote').textContent = SETUP.mode === 'local' && SETUP.players.filter(p => p.type === 'human').length > 1
    ? 'במשחק בתורות על מכשיר אחד כל שחקן מקבל את כל הזמן' : '';
}

function renderPlayers() {
  const humans = SETUP.players.filter(p => p.type === 'human').length;
  $('#playersList').innerHTML = SETUP.players.map((p, i) => {
    const editable = p.type === 'human' && (SETUP.mode === 'local' || p.me);
    const removable = !p.me && !(p.type === 'human' && humans <= 1);
    return `<div class="p-row" data-i="${i}">
      <button class="av-btn" data-a="av" aria-label="החלף גוון">${avHTML(p)}</button>
      ${editable
        ? `<input class="inp p-name" data-a="name" value="${esc(p.name)}" maxlength="14" autocomplete="off">`
        : `<div class="p-name-static">${esc(p.name)}${p.me ? ' <small>את/ה</small>' : ''}</div>`}
      ${p.type === 'bot' ? `<div class="seg small">${Object.entries(LEVELS).map(([k, l]) => `<button class="${p.level === k ? 'on' : ''}" data-a="lvl" data-l="${k}">${l.name}</button>`).join('')}</div>`
        : p.type === 'remote' ? '<span class="tag">מחובר</span>' : ''}
      ${removable ? '<button class="icon-btn small" data-a="rm" aria-label="הסר">×</button>' : ''}
    </div>`;
  }).join('');
  const full = SETUP.players.length >= MAX_PLAYERS;
  $('#addBot').disabled = full; $('#addHuman').disabled = full;
}

function setupChanged() { if (ROLE === 'host' && !G) broadcastLobby(); }
let lobbyT;
function broadcastLobby() {
  clearTimeout(lobbyT);
  lobbyT = setTimeout(() => !G && Net.broadcast({
    t: 'lobby', code: Net.code, players: SETUP.players.map(pub),
    settings: { ...SETUP.settings, custom: customDefs(SETUP.settings.cats) }, quick: SETUP.quick ? quickInfo() : null
  }), 120);
}

function bindSetup() {
  const list = $('#playersList');
  list.addEventListener('click', e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const i = +b.closest('.p-row').dataset.i, p = SETUP.players[i];
    const a = b.dataset.a;
    if (a === 'av') {
      if (p.type === 'remote') return;
      p.avatar = AVATARS[(AVATARS.indexOf(p.avatar) + 1) % AVATARS.length];
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
    if (e.target.closest('#addCat')) return openAddCat();
    const del = e.target.closest('[data-del]');
    if (del) return confirmDeleteCat(del.dataset.del);
    const b = e.target.closest('.chip[data-cat]'); if (!b) return;
    const cats = SETUP.settings.cats, id = b.dataset.cat;
    if (cats.includes(id)) { if (cats.length <= 3) return toast('צריך לפחות 3 קטגוריות'); cats.splice(cats.indexOf(id), 1); }
    else cats.push(id);
    SETUP.settings.cats = allCats().map(c => c.id).filter(c => cats.includes(c));
    Sfx.click(); renderSetup(); setupChanged();
  });
  $('#s-setup').addEventListener('click', e => {
    const b = e.target.closest('.seg[data-key] button');
    if (b && b.dataset.custom) return askCustomTime(b.dataset.custom);
    if (b) {
      const v = b.dataset.v;
      SETUP.settings[b.parentElement.dataset.key] = /^\d+$/.test(v) ? Number(v) : v;
      Sfx.click(); renderSetup(); setupChanged();
    }
    const sw = e.target.closest('.switch');
    if (sw) { SETUP.settings[sw.dataset.key] = !SETUP.settings[sw.dataset.key]; Sfx.click(); renderSetup(); setupChanged(); }
  });
  $('#startGame').onclick = startGame;
  $('#shareRoom').onclick = () => {
    const text = `בואו לשחק איתי ארץ עיר. קוד החדר: ${Net.code}`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('ההזמנה הועתקה'), () => toast('קוד החדר: ' + Net.code));
    else toast('קוד החדר: ' + Net.code);
  };
}

/* ---------- free time choice ---------- */
const fmtSec = s => (s >= 60 && s % 60 === 0 ? `${s / 60} דק׳` : s > 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} ש׳`);
function askCustomTime(key) {
  Sfx.click();
  const label = key === 'listTime' ? 'כמה זמן לכל קטגוריה?' : 'כמה זמן לכל סיבוב?';
  const cur = SETUP.settings[key] || 60;
  modal(`<h3>⏱ ${label}</h3>
    <div class="time-pick"><input id="ctMin" class="inp" type="number" inputmode="numeric" min="0" max="15" value="${Math.floor(cur / 60)}"><span>דקות</span>
    <input id="ctSec" class="inp" type="number" inputmode="numeric" min="0" max="59" value="${cur % 60}"><span>שניות</span></div>
    <p class="hint">בין 10 שניות ל־15 דקות</p>`,
  [{ label: 'שמור', cls: 'btn-yellow', fn: () => {
      const t = (parseInt($('#ctMin').value, 10) || 0) * 60 + (parseInt($('#ctSec').value, 10) || 0);
      if (t < 10 || t > 900) { toast('בחרו זמן בין 10 שניות ל־15 דקות'); return false; }
      SETUP.settings[key] = t; store.set('settings', SETUP.settings); renderSetup();
    } },
  { label: 'ביטול' }]);
}

/* ---------- custom categories ---------- */
function openAddCat() {
  Sfx.click();
  const icon = CAT_ICONS[0];
  modal(`<h3>קטגוריה חדשה</h3>
    <p>למשל: סדרות, קבוצות כדורגל, מותגים, זמרים.</p>
    <input id="newCatName" class="inp" maxlength="16" placeholder="שם הקטגוריה" autocomplete="off">
    <p class="hint">המחשב לא מכיר קטגוריות שאתם מוסיפים, ולכן ישאיר אותן ריקות. תשובות בהן מסומנות ב־? ואפשר לפסול אותן בסוף הסיבוב.</p>`,
  [{ label: 'הוסף', cls: 'btn-yellow', keep: true, fn: () => {
      const name = $('#newCatName').value.trim().replace(/\s+/g, ' ');
      if (!name) { toast('כתבו שם לקטגוריה'); $('#newCatName').focus(); return false; }
      if (allCats().some(c => c.name === name)) { toast('כבר יש קטגוריה בשם הזה'); return false; }
      const c = { id: 'c_' + uid().replace(/[^a-z0-9]/g, '').slice(0, 10), name, icon, color: CAT_COLORS[CUSTOM_CATS.length % CAT_COLORS.length], custom: true };
      CUSTOM_CATS.push(c); store.set('customCats', CUSTOM_CATS);
      SETUP.settings.cats.push(c.id);
      store.set('settings', SETUP.settings);
      Sfx.good(); renderSetup(); setupChanged();
      toast(`הקטגוריה "${name}" נוספה ונשמרה`);
    } },
  { label: 'ביטול' }]);
  $('#newCatName').addEventListener('keydown', e => { if (e.key === 'Enter') $('#modalBtns .btn-yellow').click(); });
  setTimeout(() => $('#newCatName').focus(), 100);
}
function confirmDeleteCat(id) {
  const c = getCat(id); if (!c) return;
  modal(`<h3>למחוק את "${esc(c.name)}"?</h3><p>הקטגוריה תימחק מהמכשיר הזה.</p>`, [
    { label: 'מחק', cls: 'btn-red', fn: () => {
      CUSTOM_CATS = CUSTOM_CATS.filter(x => x.id !== id); store.set('customCats', CUSTOM_CATS);
      SETUP.settings.cats = SETUP.settings.cats.filter(x => x !== id);
      if (SETUP.settings.cats.length < 3) SETUP.settings.cats = [...DEFAULTS.cats];
      store.set('settings', SETUP.settings);
      renderSetup(); setupChanged();
    } },
    { label: 'ביטול' }]);
}

/* ================= game flow ================= */
function startGame() {
  if (current !== 'setup' && current !== 'final' && current !== 'quick') return;   // guard against double-tap
  Quick.stopTimer();
  Sfx.init();
  const s = SETUP;
  s.players.forEach(p => { p.name = (p.name || '').trim() || (p.type === 'bot' ? 'מחשב' : 'שחקן'); });
  if (s.settings.cats.length < 3) return toast('בחרו לפחות 3 קטגוריות');
  if (s.players.length < 2) return toast(s.mode === 'online' ? 'חכו שחברים יצטרפו, או הוסיפו שחקן מחשב' : s.mode === 'solo' ? 'הוסיפו לפחות שחקן מחשב אחד' : 'צריך לפחות 2 שחקנים');
  if (s.mode !== 'online') store.set('settings', s.settings);   // online uses fixed clocks: don't overwrite personal choices
  if (s.mode === 'online') s.settings.style = 'classic';
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
    const words = (DICT[cat] && DICT[cat][letter]) || [];   // custom categories: the computer skips them
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
  const lists = G.settings.style === 'lists' && ROLE !== 'host';
  R = { n: G.roundNo, letter, dur, lists, answers: {}, plans: {}, progress: {}, realtime: !lists && seats.length === 1, stopping: false, finished: false, cut: Infinity, queue: [] };
  if (!lists) G.players.filter(p => p.type === 'bot').forEach(b => { R.plans[b.id] = botPlan(b, letter, dur || 100); });
  if (ROLE === 'host') {
    R.pending = new Set(G.players.filter(p => p.type === 'remote' && !p.left).map(p => p.id));
    Net.broadcast({ t: 'round', n: R.n, total: G.settings.rounds, letter, dur, stopRule: G.settings.stopRule, cats: G.settings.cats, custom: customDefs(G.settings.cats), players: G.players.map(pub) });
  }
  const myR = R;
  runSpin(letter, R.n, G.settings.rounds).then(() => {
    if (R !== myR) return;
    if (R.realtime) startPlay(seats[0]);
    else if (R.lists && seats.length === 1) startLists(seats[0]);
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
        hint.innerHTML = `האות היא <b>${letter}</b>`;
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
  $('#passAv').innerHTML = avHTML(p, 'xl');
  $('#passName').textContent = p.name; $('#passLetter').textContent = R.letter;
  $('#passReady').onclick = () => { if (current !== 'pass') return; Sfx.click(); if (R.lists) startLists(p); else startPlay(p); };
  show('pass');
}

/* ---------- answering ---------- */
function startPlay(p) {
  const cats = G.settings.cats, L = R.letter;
  PLAY = { pid: p.id, R, t0: performance.now(), el: 0, ended: false, lastProg: -1, lastCast: 0, lastSec: -1, oppsHtml: '' };
  PLAY.stopMode = !!(G.settings.stopRule && R.realtime);
  $('#playLetter').textContent = L;
  $('#playRound').textContent = `סיבוב ${R.n} מתוך ${G.settings.rounds}`;
  $('#playPlayer').innerHTML = `${avHTML(p, 'xs')}<span>${esc(p.name)}</span>`;
  $('#answers').innerHTML = cats.map((id, i) => {
    const c = getCat(id) || { name: '?', icon: '❔', color: '#999999' };
    return `<label class="ans"><span class="ans-ic">${catIcon(c)}</span>
      <span class="ans-body"><div class="ans-name">${esc(c.name)}</div>
      <input data-cat="${id}" dir="rtl" lang="he" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
        enterkeyhint="${i < cats.length - 1 ? 'next' : 'done'}" maxlength="28" placeholder="${esc(c.name)} ב־${L}..."></span></label>`;
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
    btn.textContent = n >= total ? 'עצור' : `עצור · ${n}/${total}`;
    btn.classList.toggle('ready', n >= total);
  } else {
    btn.textContent = `סיימתי · ${n}/${total}`;
    btn.classList.add('ready');
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
    return `<div class="opp ${p.left ? 'left' : ''}">${avHTML(p, 'xs')}<span class="o-name">${esc(p.name)}</span><span class="o-bar"><i style="width:${n / total * 100}%"></i></span></div>`;
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
  $('#stopBannerTxt').textContent = self ? 'עצרת! השאר משלימים...' : `${name} עצר/ה. השלימו מהר`;
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
  if (!R.realtime) { if (reason === 'time') { Sfx.stop(); toast('נגמר הזמן'); } return nextTurn(); }
  if (reason === 'stop') R.cut = R.stopAt + GRACE;
  else if (reason === 'time') R.cut = R.dur;
  else R.cut = R.dur || Infinity;
  if (reason === 'time') { Sfx.stop(); toast('נגמר הזמן'); }
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

/* ---------- "lists" mode: answering ---------- */
function startLists(p) {
  PLAY = { pid: p.id, R, lists: {}, ci: -1, ended: false, iv: null, lastSec: -1 };
  G.settings.cats.forEach(c => { PLAY.lists[c] = []; });
  $('#listLetter').textContent = R.letter;
  $('#listRound').textContent = `סיבוב ${R.n} מתוך ${G.settings.rounds}`;
  $('#listPlayer').innerHTML = `${avHTML(p, 'xs')}<span>${esc(p.name)}</span>`;
  show('list');
  requestWakeLock();
  nextListCat(false);
}
function nextListCat(timeUp) {
  if (!PLAY || PLAY.ended) return;
  clearInterval(PLAY.iv);
  if (PLAY.ci >= 0) addListWord(true);                 // keep a word that was typed but not added yet
  if (timeUp) { Sfx.stop(); vib(80); }
  PLAY.ci++;
  const cats = G.settings.cats;
  if (PLAY.ci >= cats.length) return endLists();
  const c = getCat(cats[PLAY.ci]) || { name: '?', icon: '❔', color: '#999999' };
  const box = $('#listCat');
  box.style.setProperty('--c', c.color);
  box.classList.remove('pop'); void box.offsetWidth; box.classList.add('pop');
  $('#listCatIc').innerHTML = catIcon(c);
  $('#listCatName').textContent = `${c.name} ב־${R.letter}`;
  $('#listStep').textContent = `קטגוריה ${PLAY.ci + 1} מתוך ${cats.length}`;
  $('#listNext').textContent = PLAY.ci === cats.length - 1 ? 'סיימתי' : 'לקטגוריה הבאה';
  $('#listInput').value = ''; $('#listInput').classList.remove('bad');
  $('#listInput').placeholder = `${c.name} שמתחיל ב־${R.letter}...`;
  renderListChips();
  if (timeUp) toast(`נגמר הזמן. עכשיו: ${c.name}`);
  PLAY.t0 = performance.now(); PLAY.lastSec = -1;
  $('#listTimer').classList.remove('warn');
  PLAY.iv = setInterval(listTick, 200); listTick();
  setTimeout(() => { if (current === 'list') $('#listInput').focus(); }, 250);
}
function listTick() {
  if (!PLAY || PLAY.ended) return;
  const dur = G.settings.listTime, el = (performance.now() - PLAY.t0) / 1000, rem = Math.max(0, dur - el), sec = Math.ceil(rem);
  $('#listRing').style.strokeDashoffset = 125.66 * (1 - rem / dur);
  $('#listTimerTxt').textContent = sec;
  $('#listTimer').classList.toggle('warn', rem <= 5);
  if (rem <= 5 && rem > 0 && sec !== PLAY.lastSec) { PLAY.lastSec = sec; Sfx.warn(); }
  if (rem <= 0) nextListCat(true);
}
function addListWord(silent) {
  const inp = $('#listInput'), v = inp.value.trim().replace(/\s+/g, ' ').slice(0, 28);
  if (!v || !PLAY || PLAY.ended) return;
  const cat = G.settings.cats[PLAY.ci], r = resolve(v, cat, R.letter);
  if (r.st === 'wrong') {
    if (silent) return;
    inp.classList.add('bad'); vib(60);
    return toast(norm(v)[0] === R.letter ? 'קצר מדי' : `המילה צריכה להתחיל ב־${R.letter}`);
  }
  const list = PLAY.lists[cat];
  if (list.some(w => resolve(w, cat, R.letter).canon === r.canon)) {
    if (!silent) { toast('כבר כתבת את זה'); inp.select(); }
    return;
  }
  list.push(v); inp.value = ''; inp.classList.remove('bad');
  if (!silent) { Sfx.click(); vib(15); renderListChips(); }
}
function renderListChips() {
  const cat = G.settings.cats[PLAY.ci], list = PLAY.lists[cat];
  $('#listCount').textContent = list.length;
  $('#listEmpty').classList.toggle('hidden', list.length > 0);
  $('#listChips').innerHTML = list.map((w, i) => ({ w, i })).reverse()
    .map(({ w, i }) => `<span class="w-chip ok">${esc(w)}<button class="w-x" data-i="${i}" aria-label="מחק">×</button></span>`).join('');
}
function endLists() {
  PLAY.ended = true; clearInterval(PLAY.iv); releaseWakeLock();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  R.answers[PLAY.pid] = PLAY.lists;
  if (R.queue.length) nextTurn(); else finishRound();
}
function bindLists() {
  $('#listForm').addEventListener('submit', e => { e.preventDefault(); addListWord(false); $('#listInput').focus(); });
  $('#listInput').addEventListener('input', () => {
    const v = norm($('#listInput').value);
    $('#listInput').classList.toggle('bad', !!v && !!R && v[0] !== R.letter);
  });
  $('#listChips').addEventListener('click', e => {
    const b = e.target.closest('.w-x'); if (!b || !PLAY) return;
    PLAY.lists[G.settings.cats[PLAY.ci]].splice(+b.dataset.i, 1); renderListChips();
  });
  $('#listNext').onclick = () => {
    if (!PLAY || PLAY.ended || current !== 'list') return;
    const last = PLAY.ci === G.settings.cats.length - 1, ci = PLAY.ci, my = PLAY;
    modal(`<h3>${last ? 'לסיים את הסיבוב?' : 'לעבור לקטגוריה הבאה?'}</h3><p>אי אפשר לחזור לקטגוריה הזאת אחר כך.</p>`, [
      { label: last ? 'כן, סיימתי' : 'כן, הלאה', cls: 'btn-teal', fn: () => { if (PLAY === my && PLAY.ci === ci) nextListCat(false); } },
      { label: 'עוד רגע' }]);
  };
}

/* ---------- scoring ---------- */
/** one answer, judged: a=typed text, st=status, canon=identity for duplicates, m=dictionary word it was matched to */
function judge(a, cat, letter) {
  const r = resolve(a, cat, letter);
  const m = r.match && strictKey(r.match) !== strictKey(a) ? r.match : '';
  return { a, st: r.st, canon: r.canon || 'x:' + strictKey(a), m, base: r.st === 'valid' || r.st === 'unknown', rej: false, votes: [], ok: false, pts: 0, kind: 'zero' };
}

function finishRound() {
  if (!R || R.finished) return;
  R.finished = true; clearTimeout(R.waitTo);
  if (R.lists) return finishListsRound();
  G.players.filter(p => p.type === 'bot').forEach(b => {
    const a = {}; R.plans[b.id].items.forEach(i => { if (i.t <= R.cut) a[i.cat] = i.w; }); R.answers[b.id] = a;
  });
  const res = { style: 'classic', n: R.n, letter: R.letter, cats: [...G.settings.cats], cells: {}, totals: {} };
  G.players.forEach(p => {
    res.cells[p.id] = {};
    res.cats.forEach(c => { res.cells[p.id][c] = judge(((R.answers[p.id] || {})[c] || '').trim(), c, R.letter); });
  });
  recalc(res);
  G.history.push(res);
  showResults(res);
}

/* ---------- disputes: direct toggle on one device, majority vote online ---------- */
const isVoting = () => !!G && G.mode === 'online';
function votesNeeded(authorId) {
  const voters = G.players.filter(p => (p.type === 'human' || p.type === 'remote') && !p.left && p.id !== authorId);
  return voters.length ? Math.floor(voters.length / 2) + 1 : Infinity;
}
function cellOk(cell, authorId) {
  if (!cell.base || cell.rej) return false;
  if (!isVoting()) return true;
  cell.vt = votesNeeded(authorId); cell.vn = cell.votes.length;
  return cell.vn < cell.vt;
}

function recalc(res) {
  if (res.style === 'lists') return recalcLists(res);
  res.totals = {}; G.players.forEach(p => { res.totals[p.id] = 0; });
  res.cats.forEach(c => {
    G.players.forEach(p => { const cell = res.cells[p.id][c]; cell.ok = cellOk(cell, p.id); });
    const oks = G.players.filter(p => res.cells[p.id][c].ok), cnt = {};
    oks.forEach(p => { const k = res.cells[p.id][c].canon; cnt[k] = (cnt[k] || 0) + 1; });
    G.players.forEach(p => {
      const cell = res.cells[p.id][c];
      if (!cell.ok) { cell.pts = 0; cell.kind = 'zero'; return; }
      if (oks.length === 1 && G.players.length > 1) { cell.pts = 15; cell.kind = 'solo'; }
      else if (cnt[cell.canon] > 1) { cell.pts = 5; cell.kind = 'dup'; }
      else { cell.pts = 10; cell.kind = 'uniq'; }
      res.totals[p.id] += cell.pts;
    });
  });
}

/* ---------- "lists" mode: as many words as possible per category, only answers nobody else wrote score ---------- */
const LIST_BOT = { easy: { n: [1, 3], pool: 8 }, medium: { n: [3, 6], pool: 22 }, hard: { n: [5, 10], pool: 999 } };
function finishListsRound() {
  G.players.filter(p => p.type === 'bot').forEach(b => {
    const lv = LIST_BOT[b.level] || LIST_BOT.medium, a = {};
    G.settings.cats.forEach(c => {
      const words = (DICT[c] && DICT[c][R.letter]) || [];
      a[c] = shuffle(words.slice(0, lv.pool)).slice(0, Math.round(rnd(...lv.n)));
    });
    R.answers[b.id] = a;
  });
  const res = { style: 'lists', n: R.n, letter: R.letter, cats: [...G.settings.cats], lists: {}, totals: {} };
  G.players.forEach(p => {
    res.lists[p.id] = {};
    res.cats.forEach(c => {
      const seen = new Set();
      res.lists[p.id][c] = ((R.answers[p.id] || {})[c] || []).map(a => judge(String(a).trim(), c, R.letter))
        .filter(it => it.st !== 'empty' && !seen.has(it.canon) && seen.add(it.canon));
    });
  });
  recalc(res);
  G.history.push(res);
  showResults(res);
}
function recalcLists(res) {
  res.totals = {}; G.players.forEach(p => { res.totals[p.id] = 0; });
  res.cats.forEach(c => {
    const cnt = {};
    G.players.forEach(p => res.lists[p.id][c].forEach(it => {
      it.ok = cellOk(it, p.id);
      if (it.ok) cnt[it.canon] = (cnt[it.canon] || 0) + 1;
    }));
    G.players.forEach(p => res.lists[p.id][c].forEach(it => {
      it.dup = it.ok && cnt[it.canon] > 1;
      it.pts = it.ok && !it.dup ? 10 : 0;
      it.kind = !it.ok ? 'zero' : it.dup ? 'dup' : 'uniq';
      res.totals[p.id] += it.pts;
    }));
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
  renderResults(res, G.players, standings(), { act: isVoting() ? 'vote' : 'toggle', host: true, isLast, me: G.meId });
  Sfx.good();
  broadcastResults();
}
function broadcastResults() {
  if (ROLE !== 'host' || !G) return;
  const res = G.history[G.history.length - 1];
  Net.broadcast({ t: 'results', res, players: G.players.map(pub), std: standings(), isLast: G.roundNo >= G.settings.rounds });
}
function refreshResults() {
  const res = G.history[G.history.length - 1];
  const y = $('#s-results .scroll').scrollTop;
  renderResults(res, G.players, standings(), { act: isVoting() ? 'vote' : 'toggle', host: true, isLast: G.roundNo >= G.settings.rounds, me: G.meId });
  $('#s-results .scroll').scrollTop = y;
  broadcastResults();
}

const medal = i => `<span class="rk rk-${i + 1}">${i + 1}</span>`;
const whyWrong = (a, letter) => (norm(a)[0] === letter ? 'קצר מדי' : 'לא מתחיל באות ' + letter);

/** o.act: 'toggle' (one device: tap rejects/restores) | 'vote' (online: tap = my vote) ; o.host: can move on */
function renderResults(res, players, std, o) {
  $('#resTitle').textContent = `תוצאות סיבוב ${res.n}`;
  $('#resLetter').textContent = res.letter;
  const P = Object.fromEntries(players.map(p => [p.id, p]));
  const lists = res.style === 'lists';
  $('#legend').innerHTML = lists
    ? '<span><i class="pts k-uniq">10</i> לכל מילה שרק לך</span><span><i class="pts k-dup">כפול</i> מישהו אחר כתב = 0</span>'
    : '<span><i class="pts k-solo">15</i> רק לך</span><span><i class="pts k-uniq">10</i> תשובה ייחודית</span><span><i class="pts k-dup">5</i> תשובה כפולה</span>';
  const voteTag = (it, pid) => (o.act === 'vote' && it.base && it.vn > 0
    ? `<span class="vote-tag ${(it.votes || []).includes(o.me) ? 'mine' : ''}">פסילה ${it.vn}/${it.vt === Infinity || !it.vt ? '–' : it.vt}</span>` : '');
  $('#resCats').innerHTML = res.cats.map((c, ci) => {
    const cat = getCat(c) || { name: '?', icon: '❔', color: '#999999' };
    const rows = players.map(p => {
      if (lists) {
        const items = ((res.lists || {})[p.id] || {})[c] || [];
        const sum = items.reduce((s, it) => s + it.pts, 0);
        return `<div class="res-row list-row">${avHTML(p, 'sm')}
          <span class="r-main"><div class="r-name">${esc(p.name)} · ${items.length} מילים</div>
          <div class="w-chips">${items.length ? items.map((it, i) => `<button class="w-chip ${it.ok ? (it.dup ? 'dup' : 'ok') : 'no'} ${o.act !== 'none' && it.base ? 'tap' : ''}"
              data-pid="${p.id}" data-cat="${c}" data-i="${i}" title="${it.st === 'wrong' ? whyWrong(it.a, res.letter) : it.m ? 'זוהה כ: ' + esc(it.m) : ''}">${esc(it.a)}${it.st === 'unknown' && it.ok ? '<sup>?</sup>' : ''}${voteTag(it, p.id)}</button>`).join('') : '<i class="none">—</i>'}</div></span>
          <span class="pts k-${sum ? 'uniq' : 'zero'}">${sum}</span></div>`;
      }
      const cell = (res.cells[p.id] || {})[c] || { a: '', st: 'empty', ok: false, pts: 0, kind: 'zero' };
      const why = cell.st === 'wrong' ? whyWrong(cell.a, res.letter)
        : !cell.ok && cell.a ? (o.act === 'vote' ? 'נפסל בהצבעה' : 'נפסל') : cell.m ? 'זוהה כ: ' + esc(cell.m) : '';
      return `<div class="res-row ${o.act !== 'none' && cell.base ? 'tap' : ''} ${cell.ok ? '' : 'no'} st-${cell.st}" data-pid="${p.id}" data-cat="${c}">
        ${avHTML(p, 'sm')}
        <span class="r-main"><div class="r-name">${esc(p.name)}</div>
        <div class="r-ans">${cell.a ? esc(cell.a) : '<i>—</i>'}${cell.st === 'unknown' && cell.ok ? '<sup title="לא נמצא במאגר">?</sup>' : ''}${voteTag(cell, p.id)}</div>
        ${why ? `<div class="r-why ${cell.m && cell.ok ? 'ok' : ''}">${why}</div>` : ''}</span>
        <span class="pts k-${cell.ok ? cell.kind : 'zero'}">${cell.pts}</span></div>`;
    }).join('');
    return `<div class="res-card" style="animation-delay:${ci * 50}ms"><div class="res-h">${catIcon(cat)}<span>${esc(cat.name)}</span></div>${rows}</div>`;
  }).join('');
  $('#standings').innerHTML = std.map((s, i) => {
    const p = P[s.id] || { name: '?', avatar: 'ivory' };
    return `<div class="std-row" style="animation-delay:${i * 70}ms">${medal(i)}
      ${avHTML(p, 'sm')}<span class="std-name">${esc(p.name)}</span>
      <span class="std-plus">+${s.last}</span><span class="std-total">${s.total}</span></div>`;
  }).join('');
  $('#resHint').textContent = o.act === 'vote'
    ? 'חושבים שתשובה לא נכונה? לחצו עליה כדי להצביע. אם רוב השחקנים מסכימים, היא נפסלת.'
    : 'לחצו על תשובה כדי לפסול אותה, ולחצו שוב כדי להחזיר';
  const nb = $('#nextBtn');
  nb.classList.toggle('hidden', !o.host);
  nb.textContent = o.isLast ? 'לתוצאות הסופיות' : 'לסיבוב הבא';
  $('#resCats').dataset.act = o.act;
  const wasOn = current === 'results';
  show('results');
  if (!wasOn) $('#s-results .scroll').scrollTop = 0;
}

/** find the answer a tap refers to: classic cell, or one word in a list */
function itemAt(res, pid, cat, i) {
  if (res.style === 'lists') return (((res.lists || {})[pid] || {})[cat] || [])[i];
  return ((res.cells || {})[pid] || {})[cat];
}
/** host: someone voted against an answer (toggle) */
function applyVote(voterId, pid, cat, i) {
  const res = G && G.history[G.history.length - 1];
  if (!res || !res.cats.includes(cat) || !G.players.some(p => p.id === pid)) return;
  const voter = G.players.find(p => p.id === voterId);
  if (!voter || voter.type === 'bot' || voterId === pid) return;
  const it = itemAt(res, pid, cat, i); if (!it || !it.base) return;
  const k = it.votes.indexOf(voterId);
  if (k >= 0) it.votes.splice(k, 1); else it.votes.push(voterId);
  recalc(res); refreshResults();
}

function bindResults() {
  $('#resCats').addEventListener('click', e => {
    const act = $('#resCats').dataset.act;
    if (!act || act === 'none' || !G) return;
    const el = e.target.closest('.w-chip, .res-row:not(.list-row)'); if (!el) return;
    const pid = el.dataset.pid, cat = el.dataset.cat, i = el.dataset.i != null ? +el.dataset.i : null;
    const letter = $('#resLetter').textContent;
    if (!el.classList.contains('tap')) {     // empty / wrong-letter answers can't be disputed
      if (el.title) toast(el.title);
      else { const w = el.querySelector('.r-why'); if (w && !w.classList.contains('ok')) toast(w.textContent); }
      return;
    }
    if (act === 'vote' && pid === G.meId) return toast('אי אפשר להצביע על התשובה של עצמך');
    if (ROLE === 'client') {
      Sfx.click(); Net.send({ t: 'vote', pid, cat, i });
      return;
    }
    const res = G.history[G.history.length - 1];
    const it = itemAt(res, pid, cat, i); if (!it || !it.a) return;
    if (it.st === 'wrong') return toast(whyWrong(it.a, letter));
    Sfx.click();
    if (act === 'vote') return applyVote(G.meId, pid, cat, i);
    it.rej = !it.rej; recalc(res); refreshResults();
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
  const winner = P[std[0].id];
  const tie = std[1] && std[1].total === std[0].total;
  $('#finalWinner').innerHTML = tie
    ? '<span class="fw-label">תוצאה</span><span class="fw-name">תיקו</span>'
    : `<span class="fw-label">במקום הראשון</span><span class="fw-name">${esc(winner.name)}</span>`;
  $('#podium').innerHTML = order.map(i => {
    const p = P[std[i].id];
    return `<div class="pod ${cls[i]}" style="animation-delay:${(2 - i) * 180}ms">${avHTML(p, i ? 'lg' : 'xl')}
      <div class="pod-name">${esc(p.name)}</div><div class="pod-score">${std[i].total}</div><div class="pod-block"><span>${i + 1}</span></div></div>`;
  }).join('');
  const rest = std.slice(3);
  $('#finalRest').classList.toggle('hidden', !rest.length);
  $('#finalRest').innerHTML = rest.map((s, j) => {
    const p = P[s.id];
    return `<div class="std-row">${medal(j + 3)}${avHTML(p, 'sm')}<span class="std-name">${esc(p.name)}</span><span class="std-total">${s.total}</span></div>`;
  }).join('');
  $('#againBtn').classList.toggle('hidden', isClient);
  $('#finalWait').classList.toggle('hidden', !isClient);
  recordStats(std);
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
    if (SETUP.quick) { Quick.openRoom(); return; }
    openSetup('online', true);
    broadcastLobby();
  } else { startGame(); }
}

/* ---------- cleanup / navigation ---------- */
function cleanupGame() {
  if (PLAY) { clearInterval(PLAY.iv); clearInterval(PLAY.graceIv); PLAY.ended = true; }
  if (R) { clearTimeout(R.waitTo); R.finished = true; }
  hideBanner(); releaseWakeLock();
  spinId++; Quick.stopTimer();
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
    case 'profile': renderHomeProfile(); show('home'); break;
    case 'quick':
      if (Quick.searching) Quick.cancel();
      else quitToHome();
      break;
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
  join(code) { return this.joinId(this.PREFIX + code, 12000).then(() => { this.code = code; }); },
  async joinId(hostId, timeout) {
    await this.lib();
    await this.open(null);
    return new Promise((res, rej) => {
      let done = false;
      const c = this.peer.connect(hostId, { reliable: true });
      c.on('open', () => { if (done) return; done = true; this.hostConn = c; res(); });
      c.on('data', d => { if (ROLE === 'client' && this.hostConn === c && d && d.t) Client.msg(d); });
      c.on('close', () => { if (this.hostConn === c) Client.closed(); });
      this.peer.on('error', e => { if (!done) { done = true; rej(e); } });
      setTimeout(() => { if (!done) { done = true; rej({ type: 'timeout' }); } }, timeout);
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
    type: p.type === 'bot' ? 'bot' : 'human', avatar: ALL_AVATARS.includes(p.avatar) ? p.avatar : 'ivory',
    color: COLOR_RE.test(p.color) ? p.color : '#999999', level: LEVELS[p.level] ? p.level : null
  };
}
const cleanPlayers = a => (Array.isArray(a) ? a.slice(0, MAX_PLAYERS).map(cleanPlayer) : []);
function cleanCats(a) { const c = Array.isArray(a) ? [...new Set(a.slice(0, 60).filter(x => typeof x === 'string' && getCat(x)))] : []; return c.length >= 3 ? c : [...DEFAULTS.cats]; }
function cleanSettings(s) {
  s = s || {};
  return { cats: cleanCats(s.cats), rounds: cleanInt(s.rounds, 1, 20, 5), timer: cleanInt(s.timer, 0, 600, 90), stopRule: !!s.stopRule, hardLetters: !!s.hardLetters };
}
function cleanAnswers(a) {
  const o = {};
  const cats = (G && G.settings && G.settings.cats) || [];
  if (a && typeof a === 'object') cats.forEach(id => { if (typeof a[id] === 'string') o[id] = a[id].slice(0, 28); });
  return o;
}
function cleanItem(x) {
  x = x || {};
  const votes = Array.isArray(x.votes) ? x.votes.filter(v => typeof v === 'string' && ID_RE.test(v)).slice(0, MAX_PLAYERS) : [];
  return {
    a: cleanStr(x.a, 28), st: ST_OK.includes(x.st) ? x.st : 'empty', ok: !!x.ok, base: !!x.base, dup: !!x.dup,
    pts: cleanInt(x.pts, 0, 15, 0), kind: KIND_OK.includes(x.kind) ? x.kind : 'zero', m: cleanStr(x.m, 28),
    votes, vn: votes.length, vt: x.vt == null ? null : cleanInt(x.vt, 1, MAX_PLAYERS, null)
  };
}
function cleanResults(res, players) {
  res = res || {};
  const lists = res.style === 'lists';
  const out = { style: lists ? 'lists' : 'classic', n: cleanInt(res.n, 1, 99, 1), letter: LETTERS.includes(res.letter) ? res.letter : '?', cats: cleanCats(res.cats), cells: {}, lists: {}, totals: {} };
  players.forEach(p => {
    out.cells[p.id] = {}; out.lists[p.id] = {};
    out.cats.forEach(c => {
      if (lists) {
        const arr = (((res.lists || {})[p.id] || {})[c]);
        out.lists[p.id][c] = Array.isArray(arr) ? arr.slice(0, 80).map(cleanItem) : [];
      } else out.cells[p.id][c] = cleanItem(((res.cells || {})[p.id] || {})[c]);
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
        if (SETUP.players.length >= (SETUP.quick ? QUICK_MAX : MAX_PLAYERS)) { conn.send({ t: 'full' }); return; }
        const i = SETUP.players.length;
        if (!ID_RE.test(id)) return;
        const name = cleanStr(d.name, 14).trim() || 'שחקן ' + (i + 1);
        SETUP.players.push({ id, name, type: 'remote', avatar: AVATARS.includes(d.avatar) ? d.avatar : AVATARS[i % AVATARS.length], color: COLORS[i % COLORS.length] });
        if (SETUP.quick) renderQuick(); else renderSetup();
        toast(`${name} הצטרף/ה`); Sfx.good(); vib(30);
        broadcastLobby();
        break;
      }
      case 'stop':
        if (G && R && PLAY && !PLAY.ended && G.settings.stopRule) { const p = G.players.find(x => x.id === id); if (p) triggerStop(p); }
        break;
      case 'prog':
        if (R && !R.finished && G && G.players.some(p => p.id === id)) R.progress[id] = cleanInt(d.n, 0, G.settings.cats.length, 0);
        break;
      case 'vote':
        if (G && R && R.finished) applyVote(id, cleanStr(d.pid, 64), cleanStr(d.cat, 40), d.i == null ? null : cleanInt(d.i, 0, 500, 0));
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
      if (SETUP.quick) renderQuick(); else renderSetup();
      broadcastLobby(); toast(`${sp.name} עזב/ה את החדר`);
    }
  }
};

const Client = {
  msg(d) {
    switch (d.t) {
      case 'lobby':
        if (G) cleanupGame();
        registerRemoteCats(d.settings && d.settings.custom);
        CL = { code: Net.code, players: cleanPlayers(d.players), settings: cleanSettings(d.settings), quick: d.quick ? { left: cleanInt(d.quick.left, -1, 99, -1) } : null };
        if (Quick.searching) { Quick.searching = false; Quick.accepted(); }
        if (CL.quick) { renderQuick(); if (current !== 'quick') show('quick'); }
        else { renderWait(); if (current !== 'wait') show('wait'); }
        break;
      case 'start':
        G = { mode: 'online', players: CL ? CL.players : [], settings: { ...(CL ? CL.settings : DEFAULTS) }, roundNo: 0, history: [], meId: Net.myId };
        break;
      case 'round': {
        if (!LETTERS.includes(d.letter)) return;
        registerRemoteCats(d.custom);
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
        if (R && G && d.p && typeof d.p === 'object') G.players.forEach(p => { if (Object.prototype.hasOwnProperty.call(d.p, p.id)) R.progress[p.id] = cleanInt(d.p[p.id], 0, G.settings.cats.length, 0); });
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
          renderResults(cleanResults(d.res, pl), pl, cleanStd(d.std, pl), { act: 'vote', host: false, isLast: !!d.isLast, me: Net.myId });
          if (!wasOn) Sfx.good();
        }
        break;
      case 'final': {
        const pl = cleanPlayers(d.players);
        renderFinal(cleanStd(d.std, pl), pl, true);
        break;
      }
      case 'busy':
      case 'full':
        if (Quick.searching) { Quick.rejected(); break; }   // quick match: just try the next room
        toast(d.t === 'busy' ? 'המשחק בחדר כבר התחיל — נסו שוב כשיסתיים' : 'החדר מלא'); quitToHome(); show('online');
        break;
      case 'kicked': toast('הוסרת מהחדר'); quitToHome(); break;
      case 'bye': toast('המארח סגר את החדר'); quitToHome(); break;
    }
  },
  closed() {
    if (Quick.searching) { Quick.rejected(); return; }
    if (ROLE !== 'client') return;
    toast('החיבור למארח נותק'); quitToHome();
  }
};

function renderWait() {
  if (!CL) return;
  $('#waitCode').textContent = CL.code || Net.code;
  $('#waitPlayers').innerHTML = (CL.players || []).map(p => `<div class="p-row">${avHTML(p)}
    <div class="p-name-static">${esc(p.name)}${p.id === Net.myId ? ' <small>את/ה</small>' : ''}</div>
    ${p.type === 'bot' ? `<span class="tag">מחשב · ${LEVELS[p.level] ? LEVELS[p.level].name : ''}</span>` : ''}</div>`).join('');
  const s = CL.settings || DEFAULTS;
  $('#waitCats').innerHTML = (s.cats || []).map(id => { const c = getCat(id); return c ? `<span class="chip on">${catIcon(c)}${esc(c.name)}</span>` : ''; }).join('');
  $('#waitInfo').textContent = `${s.rounds} סיבובים · ${s.timer ? s.timer + ' שניות לסיבוב' : 'ללא הגבלת זמן'}${s.stopRule ? ' · עם "עצור!"' : ''}`;
}

function bindOnline() {
  const nameInp = $('#onName');
  const renderAv = () => { $('#onAvatar').innerHTML = tonePicker(myAvatar()); };
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

/* ================= quick match (random players) =================
   No server of our own: quick rooms live on well-known peer ids "…quick-1", "…quick-2"…
   A searcher tries each slot in order: if the id is free it becomes that room's host and waits;
   if it is taken it asks to join; a room that is full or already playing says no -> next slot.
   Everyone searching at the same time therefore ends up in the same (lowest open) room. */
const QUICK_SLOTS = 12, QUICK_MAX = 6, QUICK_COUNTDOWN = 20;
const QUICK_SETTINGS = { cats: [...DEFAULTS.cats], rounds: 5, timer: 90, stopRule: true, hardLetters: false };

const Quick = {
  searching: false, deadline: null, timer: null, _res: null,
  accepted() { if (this._res) { const r = this._res; this._res = null; r(true); } },
  rejected() { if (this._res) { const r = this._res; this._res = null; r(false); } },
  async start() {
    if (this.searching) return;
    Sfx.init();
    this.searching = true; this.deadline = null;
    renderQuick(); show('quick');
    try {
      await Net.lib();
      for (let i = 1; i <= QUICK_SLOTS; i++) {
        if (!this.searching) return;
        const id = Net.PREFIX + 'quick-' + i;
        try {
          await Net.open(id);                                    // free slot -> we host it
          if (!this.searching) { Net.close(); return; }
          this.searching = false; ROLE = 'host'; Net.code = null;
          SETUP = { mode: 'online', quick: true, players: [{ id: Net.myId, name: myName(), type: 'human', avatar: myAvatar(), color: COLORS[0], me: true }], settings: { ...QUICK_SETTINGS, cats: [...QUICK_SETTINGS.cats] } };
          this.openRoom();
          return;
        } catch (e) { if (e.type !== 'unavailable-id') throw e; }
        if (!this.searching) return;
        try {                                                     // taken -> ask to join
          await Net.joinId(id, 6000);
          if (!this.searching) { Net.close(); return; }
          ROLE = 'client';
          const ok = await new Promise(res => {
            this._res = res;
            Net.send({ t: 'join', name: myName(), avatar: myAvatar() });
            setTimeout(() => this.rejected(), 5000);
          });
          if (ok) { this.searching = false; Sfx.good(); vib(40); return; }
        } catch (e) { /* unreachable room -> next */ }
        ROLE = 'local'; Net.close();
      }
      throw new Error('no room');
    } catch (e) {
      if (!this.searching) return;
      this.searching = false; ROLE = 'local'; Net.close();
      toast('לא הצלחנו למצוא משחק — בדקו את החיבור לאינטרנט ונסו שוב');
      show('online');
    }
  },
  cancel() { this.searching = false; this.rejected(); ROLE = 'local'; Net.close(); show('online'); },
  /** host: (re)open the waiting room */
  openRoom() {
    this.deadline = null;
    renderQuick(); show('quick'); broadcastLobby();
    this.stopTimer();
    this.timer = setInterval(() => this.tick(), 1000);
  },
  stopTimer() { clearInterval(this.timer); this.timer = null; },
  tick() {
    if (ROLE !== 'host' || !SETUP || !SETUP.quick || G) return this.stopTimer();
    const n = SETUP.players.length;
    if (n < 2) this.deadline = null;
    else if (!this.deadline) { this.deadline = Date.now() + QUICK_COUNTDOWN * 1000; Sfx.good(); }
    if (n >= QUICK_MAX && this.deadline - Date.now() > 3000) this.deadline = Date.now() + 3000;
    renderQuick(); broadcastLobby();
    if (this.deadline && Date.now() >= this.deadline) { this.stopTimer(); startGame(); }
  }
};
function quickInfo() { return { left: Quick.deadline ? Math.max(0, Math.ceil((Quick.deadline - Date.now()) / 1000)) : -1 }; }

function renderQuick() {
  const radar = $('#s-quick .radar');
  if (Quick.searching) {
    radar.classList.remove('found');
    $('#quickTitle').textContent = 'מחפשים משחק...';
    $('#quickHint').textContent = 'מחפשים שחקנים אחרים שרוצים לשחק עכשיו';
    $('#quickRoom').classList.add('hidden');
    $('#quickStart').classList.add('hidden'); $('#quickBot').classList.add('hidden');
    return;
  }
  const isHost = ROLE === 'host';
  const players = isHost ? SETUP.players.map(pub) : (CL ? CL.players : []);
  const left = isHost ? quickInfo().left : (CL && CL.quick ? CL.quick.left : -1);
  $('#quickRoom').classList.remove('hidden');
  $('#quickPlayers').innerHTML = players.map(p => `<div class="p-row">${avHTML(p)}
    <div class="p-name-static">${esc(p.name)}${p.id === Net.myId ? ' <small>את/ה</small>' : ''}</div>${p.type === 'bot' ? '<span class="tag">מחשב</span>' : ''}</div>`).join('');
  if (players.length < 2) {
    radar.classList.remove('found');
    $('#quickTitle').textContent = 'מחכים לשחקנים נוספים...';
    $('#quickHint').textContent = 'ברגע שמישהו נוסף ילחץ על "משחק מהיר" הוא יצטרף אליכם. רוצים שיהיה מהר יותר? שתפו את המשחק עם חברים!';
  } else {
    radar.classList.add('found');
    $('#quickTitle').innerHTML = left >= 0 ? `המשחק מתחיל בעוד <span class="quick-count">${left}</span>` : 'נמצאו שחקנים!';
    $('#quickHint').textContent = `${players.length} שחקנים בחדר · עד ${QUICK_MAX} שחקנים · 5 סיבובים`;
  }
  $('#quickStart').classList.toggle('hidden', !(isHost && players.length >= 2));
  $('#quickBot').classList.toggle('hidden', !(isHost && players.length < 2));
}

/* ================= profile & stats ================= */
const STATS0 = { games: 0, wins: 0, best: 0, total: 0 };
const getStats = () => ({ ...STATS0, ...store.get('stats', {}) });
function recordStats(std) {
  if (!G || G.mode === 'local' || G.statsDone || !std.length) return;
  const me = std.find(s => s.id === G.meId); if (!me) return;
  G.statsDone = true;
  const st = getStats();
  st.games++;
  if (me.total === std[0].total) st.wins++;   // ties count as a win
  st.best = Math.max(st.best, me.total);
  st.total += me.total;
  store.set('stats', st);
}
function renderHomeProfile() {
  $('#pcAv').innerHTML = avHTML({ name: store.get('name', '') || '?', avatar: myAvatar() }, 'sm');
  $('#pcName').textContent = store.get('name', '') || 'אורח';
}
function renderProfile() {
  $('#profAv').innerHTML = avHTML({ name: store.get('name', '') || '?', avatar: myAvatar() }, 'xxl');
  if (document.activeElement !== $('#profName')) $('#profName').value = store.get('name', '');
  $('#profAvatars').innerHTML = tonePicker(myAvatar());
  const s = getStats();
  const tiles = [
    ['', s.games, 'משחקים'], ['', s.wins, 'ניצחונות'], ['', s.games ? Math.round(s.wins / s.games * 100) + '%' : '—', 'אחוז ניצחון'],
    ['', s.best, 'שיא נקודות'], ['', s.total, 'סה״כ נקודות'], ['', s.games ? Math.round(s.total / s.games) : '—', 'ממוצע למשחק']
  ];
  $('#profStats').innerHTML = tiles.map(([ic, v, l]) => `<div class="stat"><b>${v}</b><span>${ic} ${l}</span></div>`).join('');
  $('#profSound').classList.toggle('on', Sfx.on);
  $('#profVib').classList.toggle('on', store.get('vibrate', true));
}
function bindProfile() {
  $('#profileChip').onclick = () => { Sfx.init(); Sfx.click(); renderProfile(); show('profile'); };
  $('#profName').addEventListener('input', e => { store.set('name', e.target.value.trim().slice(0, 14)); renderProfile(); });
  $('#profAvatars').addEventListener('click', e => {
    const b = e.target.closest('[data-av]'); if (!b) return;
    store.set('avatar', b.dataset.av); Sfx.click(); renderProfile();
  });
  $('#profSound').onclick = () => { Sfx.on = !Sfx.on; store.set('sound', Sfx.on); Sfx.init(); Sfx.click(); renderProfile(); paintSoundBtn(); };
  $('#profVib').onclick = () => { store.set('vibrate', !store.get('vibrate', true)); vib(60); renderProfile(); };
  $('#profReset').onclick = () => modal('<h3>לאפס את הסטטיסטיקות?</h3><p>אי אפשר לבטל את הפעולה.</p>', [
    { label: 'אפס', cls: 'btn-red', fn: () => { store.set('stats', STATS0); renderProfile(); } }, { label: 'ביטול' }]);
}
function welcome() {
  let av = myAvatar();
  modal(`<h3>ברוכים הבאים</h3><p>איך קוראים לך?</p>
    <input id="welName" class="inp" maxlength="14" placeholder="השם שלך" autocomplete="off">
    <p class="hint">בחרו גוון:</p><div class="avatar-pick" id="welAv">${tonePicker(av)}</div>`,
  [{ label: 'יאללה!', cls: 'btn-yellow', fn: () => {
      const n = $('#welName').value.trim().slice(0, 14);
      if (!n) { toast('כתבו את השם שלכם'); return false; }
      store.set('name', n); store.set('avatar', av); renderHomeProfile(); Sfx.init(); Sfx.good();
    } },
  { label: 'אחר כך', fn: () => store.set('welcomed', true) }]);
  $('#welAv').onclick = e => { const b = e.target.closest('[data-av]'); if (!b) return; av = b.dataset.av; $$('#welAv button').forEach(x => x.classList.toggle('on', x === b)); };
  $('#welName').addEventListener('keydown', e => { if (e.key === 'Enter') $('#modalBtns .btn-yellow').click(); });
}

/* ================= wake lock ================= */
let wakeLock = null;
async function requestWakeLock() { try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ } }
function releaseWakeLock() { try { wakeLock && wakeLock.release(); } catch (e) { /* ignore */ } wakeLock = null; }

/* ================= confetti ================= */
function confetti() {
  const cv = $('#confetti'), ctx = cv.getContext('2d');
  const W = cv.width = cv.offsetWidth * devicePixelRatio, H = cv.height = cv.offsetHeight * devicePixelRatio;
  // slow, sparse gold dust instead of confetti
  const dpr = devicePixelRatio || 1;
  const parts = Array.from({ length: 70 }, () => ({
    x: Math.random() * W, y: -Math.random() * H, vx: rnd(-.25, .25) * dpr, vy: rnd(.5, 1.4) * dpr,
    s: rnd(.8, 2.4) * dpr, a: rnd(.35, .9), ph: Math.random() * 6.28
  }));
  const t0 = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, W, H);
    const fade = Math.min(1, (6000 - (t - t0)) / 1500);
    parts.forEach(p => {
      p.x += p.vx + Math.sin(t / 900 + p.ph) * .2 * dpr; p.y += p.vy;
      const tw = .55 + .45 * Math.sin(t / 260 + p.ph);
      ctx.globalAlpha = Math.max(0, p.a * tw * fade);
      ctx.fillStyle = '#d9bf8a';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 6.283); ctx.fill();
    });
    ctx.globalAlpha = 1;
    if (t - t0 < 6000 && current === 'final') requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
  })(t0);
}

const SVG_SOUND_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/></svg>';
const SVG_SOUND_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';
function paintSoundBtn() { const b = $('#soundBtn'); b.innerHTML = Sfx.on ? SVG_SOUND_ON : SVG_SOUND_OFF; b.setAttribute('aria-label', Sfx.on ? 'השתק' : 'הפעל צליל'); }

/* ================= init ================= */
function init() {
  buildBg();
  loadCustomCats();
  paintSoundBtn();
  $('#soundBtn').onclick = () => { Sfx.on = !Sfx.on; store.set('sound', Sfx.on); paintSoundBtn(); Sfx.init(); Sfx.click(); };
  bindProfile(); renderHomeProfile();
  $('#quickBtn').onclick = () => {
    const n = $('#onName').value.trim();
    if (n) store.set('name', n.slice(0, 14));
    if (!store.get('name', '')) { toast('כתבו קודם את השם שלכם'); $('#onName').focus(); return; }
    Quick.start();
  };
  $('#quickStart').onclick = () => { if (ROLE === 'host' && SETUP && SETUP.players.length >= 2) startGame(); };
  $('#quickBot').onclick = () => { if (ROLE !== 'host' || !SETUP) return; addBot('medium'); startGame(); };
  if (!store.get('name', '') && !store.get('welcomed', false)) setTimeout(welcome, 600);

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

  bindSetup(); bindResults(); bindOnline(); bindLists();
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
