/** @OnlyCurrentDoc */
/**
 * Signal Shift — Google Sheets backend (Google Apps Script web app)
 *
 * Sheets created automatically in this spreadsheet:
 *   scores  – every leaderboard submission (arcade + daily challenge)
 *   runs    – one summary row per research-mode session
 *   trials  – one row per trial of every research-mode session
 *
 * Deploy: Deploy > New deployment > Web app
 *         Execute as: Me   ·   Who has access: Anyone
 * Then paste the /exec URL into config.js on the website.
 */

const TZ = 'Asia/Bangkok';
const HEADERS = {
  scores: ['receivedAt', 'mode', 'date', 'name', 'device', 'score', 'level', 'acc', 'rtMedian', 'switchCost', 'trials', 'bosses'],
  runs: ['receivedAt', 'pid', 'session', 'runId', 'startedAt', 'n', 'acc', 'rtMedian', 'rtMean', 'pure', 'repeat', 'switch',
         'congruent', 'incongruent', 'memory', 'switchCost', 'mixingCost', 'congruency', 'commission', 'omission', 'dprime'],
  trials: ['runId', 'pid', 'session', 'mode', 'block', 'blockIdx', 'trial', 'level', 'rule', 'prevRule', 'transition', 'color', 'shape',
           'nogo', 'congruent', 'memMatch', 'correctResp', 'resp', 'rt', 'correct', 'timeout', 'deadline', 'cti', 'practice', 'warmup', 'ts']
};

/** Run once from the editor to create the sheets and grant permissions. */
function setup() {
  Object.keys(HEADERS).forEach(sheet_);
  return 'ok';
}

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    if (p.action === 'leaderboard') return json_(leaderboard_(p.kind, p.date, p.device));
    return json_({ok: true, service: 'signal-shift', today: today_()});
  } catch (err) {
    return json_({ok: false, error: String(err && err.message || err)});
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'score') return json_(score_(body));
    if (body.action === 'research') return json_(research_(body));
    return json_({ok: false, error: 'unknown action'});
  } catch (err) {
    return json_({ok: false, error: String(err && err.message || err)});
  }
}

/* ---------- leaderboard ---------- */
function score_(b) {
  const mode = b.mode === 'daily' ? 'daily' : b.mode === 'arcade' ? 'arcade' : null;
  if (!mode) throw new Error('bad mode');
  const name = cleanName_(b.name);
  if (!name) throw new Error('name required');
  const device = String(b.device || '');
  if (!/^[a-z0-9]{6,32}$/i.test(device)) throw new Error('bad device');
  const trials = int_(b.trials, 0, 3000);
  const level = mode === 'arcade' ? int_(b.level, 1, 999) : '';
  const score = int_(b.score, 0, 1e9);
  // Plausibility cap: at most ~3,000 points per trial at ×8 combo, plus level and boss bonuses
  const cap = trials * 3200 + (mode === 'arcade' ? 500 * level * (level + 1) / 2 + 3000 * 40 : 0);
  if (score > cap) throw new Error('score rejected');
  let date = today_();
  if (mode === 'daily') {
    const yesterday = Utilities.formatDate(new Date(Date.now() - 864e5), TZ, 'yyyy-MM-dd');
    if (b.date !== date && b.date !== yesterday) throw new Error('daily date expired');
    date = b.date;
  }
  const cache = CacheService.getScriptCache();
  if (cache.get('rl_' + device)) throw new Error('too fast, wait a few seconds');
  cache.put('rl_' + device, '1', 5);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    sheet_('scores').appendRow([new Date(), mode, safe_(date), safe_(name), safe_(device), score, level,
      num_(b.acc), num_(b.rtMedian), num_(b.switchCost), trials, int_(b.bosses || 0, 0, 999)]);
  } finally { lock.releaseLock(); }
  cache.remove(cacheKey_(mode, date));

  const all = bests_(mode, date);
  const rank = all.findIndex(r => r.device === device) + 1;
  return {ok: true, rank: rank, total: all.length};
}

function leaderboard_(kind, date, device) {
  const mode = kind === 'arcade' ? 'arcade' : 'daily';
  const d = mode === 'daily' && /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? String(date) : today_();
  const key = cacheKey_(mode, d);
  const cache = CacheService.getScriptCache();
  let rows = null;
  const hit = cache.get(key);
  if (hit) rows = JSON.parse(hit);
  else {
    rows = bests_(mode, d).slice(0, 50);
    cache.put(key, JSON.stringify(rows), 30);
  }
  return {ok: true, kind: mode, date: d, rows: rows.map(r => ({
    name: r.name, score: r.score, level: r.level, acc: r.acc, me: !!device && r.device === device
  }))};
}

/** Best score per device for one board. */
function bests_(mode, date) {
  const sh = sheet_('scores');
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const vals = sh.getRange(2, 1, n, HEADERS.scores.length).getValues();
  const best = {};
  vals.forEach(v => {
    const m = v[1], dt = v[2] instanceof Date ? Utilities.formatDate(v[2], TZ, 'yyyy-MM-dd') : String(v[2]);
    if (m !== mode || (mode === 'daily' && dt !== date)) return;
    const dev = String(v[4]), sc = Number(v[5]) || 0;
    if (!best[dev] || sc > best[dev].score) {
      best[dev] = {name: String(v[3]).replace(/^'/, ''), device: dev, score: sc, level: v[6], acc: v[7]};
    } else if (best[dev]) {
      best[dev].name = String(v[3]).replace(/^'/, ''); // latest chosen name wins
    }
  });
  return Object.keys(best).map(k => best[k]).sort((a, b) => b.score - a.score);
}

/* ---------- research data ---------- */
function research_(b) {
  const s = b.summary || {};
  const trials = Array.isArray(b.trials) ? b.trials : [];
  if (!s.pid || !s.runId) throw new Error('missing pid or runId');
  if (trials.length > 1000) throw new Error('too many trials');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    sheet_('runs').appendRow([new Date()].concat(HEADERS.runs.slice(1).map(k => safe_(s[k]))));
    if (trials.length) {
      const rows = trials.map(t => [safe_(s.runId)].concat(HEADERS.trials.slice(1).map(k => safe_(t[k]))));
      const sh = sheet_('trials');
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEADERS.trials.length).setValues(rows);
    }
  } finally { lock.releaseLock(); }
  return {ok: true, trials: trials.length};
}

/* ---------- helpers ---------- */
function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(HEADERS[name]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS[name].length).setFontWeight('bold');
  }
  return sh;
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function cacheKey_(mode, date) { return 'lb_' + mode + '_' + (mode === 'daily' ? date : 'all'); }
function cleanName_(s) { return String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16); }
function int_(v, lo, hi) { const n = Math.round(Number(v)); if (!isFinite(n) || n < lo || n > hi) throw new Error('bad number'); return n; }
function num_(v) { const n = Number(v); return v === '' || v === null || v === undefined || !isFinite(n) ? '' : n; }
/** Store text exactly as typed: the leading apostrophe stops formulas and auto-conversion (e.g. "017" or dates). */
function safe_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  return "'" + String(v).slice(0, 200);
}
