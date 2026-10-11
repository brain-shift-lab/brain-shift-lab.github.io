/**
 * Echo Grid — backend (Google Apps Script, standalone project)
 *
 * Writes into the existing "Signal Shift Data" spreadsheet, in three tabs of its own:
 *   eg_scores  leaderboard, best score per device (arcade all-time, daily per date)
 *   eg_runs    research mode, one summary row per session
 *   eg_trials  research mode, one row per trial (join to eg_runs on runId)
 * Signal Shift's tabs (scores, runs, trials) are never read or touched.
 *
 * Setup: paste the spreadsheet ID below, run setup() once, then
 * Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 */

const SHEET_ID = 'PASTE_SPREADSHEET_ID_HERE'; // the long ID in the Signal Shift Data URL: /spreadsheets/d/<ID>/edit

const TAB = {scores:'eg_scores', runs:'eg_runs', trials:'eg_trials'};
const COLS = {
  scores: ['device', 'name', 'mode', 'date', 'score', 'level', 'maxN', 'acc', 'dprime', 'trials', 'bosses', 'updatedAt'],
  runs: ['pid', 'session', 'runId', 'startedAt', 'n', 'acc', 'dprime', 'hitRate', 'faRate', 'rtMedian', 'rtMean', 'lureFA', 'nonLureFA',
    'dP1', 'dP2', 'dP2d', 'dS2d', 'dP3d', 'dS3d', 'dualCost', 'receivedAt'],
  trials: ['runId', 'pid', 'session', 'mode', 'block', 'blockIdx', 'trial', 'level', 'n', 'dual', 'soa', 'stimMs', 'pos', 'sym',
    'posTarget', 'symTarget', 'posLure', 'symLure', 'posResp', 'symResp', 'posRT', 'symRT', 'posCorrect', 'symCorrect', 'warmup', 'practice', 'ts']
};
// Columns stored as text (written with a leading apostrophe so Sheets never turns them into formulas, dates or numbers)
const TEXT = new Set(['device', 'name', 'mode', 'date', 'updatedAt', 'pid', 'session', 'runId', 'startedAt', 'receivedAt', 'block', 'ts']);

const MAX_TRIALS_PER_POST = 800;
const RATE_LIMIT_S = 5;

/* ---------- entry points ---------- */
function doGet(e){
  try{
    const p = (e && e.parameter) || {};
    if(p.action === 'leaderboard') return out(leaderboard(p));
    if(p.action === 'ping') return out({ok:true, game:'echo-grid', today:bkkDay(0)});
    return out({ok:false, error:'unknown action'});
  }catch(err){ return out({ok:false, error:String(err && err.message || err)}); }
}

function doPost(e){
  try{
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if(body.action === 'score') return out(submitScore(body));
    if(body.action === 'research') return out(saveResearch(body));
    return out({ok:false, error:'unknown action'});
  }catch(err){ return out({ok:false, error:String(err && err.message || err)}); }
}

/** Run once from the editor: creates the three tabs and asks for permission. */
function setup(){
  Object.keys(TAB).forEach(k => sheet(k));
  Logger.log('Echo Grid tabs ready in: ' + book().getName());
}

/* ---------- leaderboard ---------- */
function leaderboard(p){
  const kind = p.kind === 'arcade' ? 'arcade' : 'daily';
  const date = kind === 'daily' ? validDay(p.date) : '';
  const device = String(p.device || '');
  const rows = readRows('scores')
    .filter(r => r.mode === kind && (kind === 'arcade' || r.date === date))
    .sort((a, b) => b.score - a.score);
  const top = rows.slice(0, 50).map(r => ({
    name:r.name, score:r.score, level:r.level === '' ? '' : r.level, maxN:r.maxN === '' ? '' : r.maxN,
    acc:r.acc === '' ? '' : r.acc, me: device !== '' && r.device === device
  }));
  return {ok:true, kind, date, total:rows.length, rows:top};
}

function submitScore(b){
  const mode = b.mode === 'arcade' ? 'arcade' : b.mode === 'daily' ? 'daily' : null;
  if(!mode) throw new Error('bad mode');
  const device = String(b.device || '');
  if(!/^[a-z0-9]{6,24}$/i.test(device)) throw new Error('bad device');
  const name = String(b.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
  if(!name) throw new Error('name required');
  const score = int(b.score, 0, 1e9), trials = int(b.trials, 1, 5000), level = mode === 'arcade' ? int(b.level, 1, 999) : '';
  const maxN = int(b.maxN || 0, 0, 20), bosses = int(b.bosses || 0, 0, 200);
  const acc = num(b.acc, 0, 1), dprime = num(b.dprime, -10, 10);
  const date = mode === 'daily' ? String(b.date || '') : '';
  if(mode === 'daily' && date !== bkkDay(0) && date !== bkkDay(1)) throw new Error('daily date closed');

  // soft anti-cheat: the best score the client's own formula could give for this many trials
  const L = level || 1, bossN = Math.floor(L / 5) + 1;
  const cap = trials * 2 * 350 * 8 * Math.max(1, Math.min(maxN || 2, 12)) + 250 * L * (L + 1) + 1500 * bossN * (bossN + 1);
  if(score > cap) throw new Error('score rejected');

  const cache = CacheService.getScriptCache(), rk = 'eg_rl_' + device;
  if(cache.get(rk)) throw new Error('too fast');
  cache.put(rk, '1', RATE_LIMIT_S);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try{
    const sh = sheet('scores');
    const rows = readRows('scores');
    const idx = rows.findIndex(r => r.device === device && r.mode === mode && r.date === date);
    const rec = {device, name, mode, date, score, level, maxN, acc, dprime, trials, bosses, updatedAt:new Date().toISOString()};
    if(idx === -1) appendRows(sh, 'scores', [rec]);
    else if(score > rows[idx].score) writeRow(sh, 'scores', idx + 2, rec);
    else sh.getRange(idx + 2, COLS.scores.indexOf('name') + 1).setValue("'" + name); // keep best score, refresh the name
    const pool = readRows('scores').filter(r => r.mode === mode && r.date === date);
    const mine = Math.max(score, idx === -1 ? 0 : rows[idx].score);
    return {ok:true, rank: pool.filter(r => r.score > mine).length + 1, total: pool.length, best: mine};
  } finally { lock.releaseLock(); }
}

/* ---------- research ---------- */
function saveResearch(b){
  const s = b.summary || {}, trials = Array.isArray(b.trials) ? b.trials : [];
  const runId = String(s.runId || '');
  if(!/^[a-z0-9]{4,40}$/i.test(runId)) throw new Error('bad runId');
  if(!String(s.pid || '').trim()) throw new Error('pid required');
  if(trials.length > MAX_TRIALS_PER_POST) throw new Error('too many trials');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try{
    const runs = sheet('runs');
    const ids = runs.getLastRow() > 1 ? runs.getRange(2, COLS.runs.indexOf('runId') + 1, runs.getLastRow() - 1, 1).getValues().map(r => String(r[0])) : [];
    if(ids.indexOf(runId) !== -1) return {ok:true, duplicate:true}; // already saved (retry after a timeout)
    appendRows(runs, 'runs', [Object.assign({}, s, {runId, receivedAt:new Date().toISOString()})]);
    if(trials.length) appendRows(sheet('trials'), 'trials', trials.map(t => Object.assign({}, t, {runId})));
    return {ok:true, trials:trials.length};
  } finally { lock.releaseLock(); }
}

/* ---------- sheet helpers ---------- */
function book(){
  if(!SHEET_ID || SHEET_ID.indexOf('PASTE') === 0) throw new Error('SHEET_ID not set');
  return SpreadsheetApp.openById(SHEET_ID);
}
function sheet(key){
  const ss = book();
  let sh = ss.getSheetByName(TAB[key]);
  if(!sh){
    sh = ss.insertSheet(TAB[key]);
    sh.getRange(1, 1, 1, COLS[key].length).setValues([COLS[key]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function readRows(key){
  const sh = sheet(key), n = sh.getLastRow() - 1;
  if(n < 1) return [];
  const cols = COLS[key];
  return sh.getRange(2, 1, n, cols.length).getValues().map(v => {
    const o = {}; cols.forEach((c, i) => { o[c] = TEXT.has(c) ? String(v[i]) : v[i]; }); return o;
  });
}
function cell(col, v){
  if(v === null || v === undefined) return '';
  if(TEXT.has(col)) return "'" + String(v).slice(0, 200);
  if(typeof v === 'number') return isFinite(v) ? v : '';
  if(typeof v === 'boolean') return v ? 1 : 0;
  const s = String(v);
  if(s === '') return '';
  return isFinite(+s) ? +s : "'" + s.slice(0, 200); // unexpected text never becomes a formula
}
function toRow(key, o){ return COLS[key].map(c => cell(c, o[c])); }
function appendRows(sh, key, objs){
  if(!objs.length) return;
  const rows = objs.map(o => toRow(key, o));
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, COLS[key].length).setValues(rows);
}
function writeRow(sh, key, rowNum, o){ sh.getRange(rowNum, 1, 1, COLS[key].length).setValues([toRow(key, o)]); }

/* ---------- small utils ---------- */
function out(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function bkkDay(daysAgo){ return new Date(Date.now() + 7 * 3600e3 - daysAgo * 864e5).toISOString().slice(0, 10); }
function validDay(d){ d = String(d || ''); return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : bkkDay(0); }
function int(v, lo, hi){ const n = Math.round(Number(v)); if(!isFinite(n) || n < lo || n > hi) throw new Error('bad number'); return n; }
function num(v, lo, hi){ if(v === '' || v === null || v === undefined) return ''; const n = Number(v); return isFinite(n) && n >= lo && n <= hi ? n : ''; }
