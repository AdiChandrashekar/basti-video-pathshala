/**
 * Basti Video Pathshala: backend (bound to the monitoring Google Sheet).
 *
 *   GET  ?a=boot      -> categories + playlists (small, loaded on every visit)
 *   GET  ?a=schools   -> block -> schools list (loaded only on the school picker)
 *   GET  ?a=pl&id=..  -> videos of one playlist
 *   POST {d, now, s:[...]} -> watch-session snapshots, appended to the Log sheet
 *
 * The Log is folded into Sessions and the dashboard tabs every 15 minutes
 * by compact() in Reports.gs.
 */

const SH = {
  CONFIG: 'Config',
  SCHOOLS: 'Schools',
  PLAYLISTS: 'Playlists',
  VIDEOS: 'Videos',
  LOG: 'Log',
  SESSIONS: 'Sessions',
};

const LOG_HEADERS = ['received', 'device', 'skew_ms', 'session_id', 'school', 'video', 'playlist',
  'start_ms', 'last_ms', 'watched_s', 'muted_s', 'hidden_s', 'max_pos_s', 'duration_s'];

const DEFAULT_CONFIG = [
  ['CHANNEL', '@TicTacLearnHindi', 'YouTube channel handle whose playlists are shown'],
  ['SCHOOL_START', '07:30', 'Plays starting before this time are flagged "off-hours"'],
  ['SCHOOL_END', '15:00', 'Plays starting after this time are flagged "off-hours"'],
  ['OFF_DAYS', 'Sun', 'Comma-separated weekdays flagged "off-hours" (Sun,Mon,...)'],
  ['MIN_PLAY_SEC', '30', 'A video counts as "played" after this many seconds'],
  ['INACTIVE_DAYS', '3', 'Inactive tab lists schools with no plays in this many days'],
];

// Built from the NIPUN Plus school master by dev/build-schools.js.
const SCHOOLS_CSV_URL = 'https://raw.githubusercontent.com/AdiChandrashekar/basti-video-pathshala/main/data/schools-basti.csv';

/* ---------------- web endpoints ---------------- */

function doGet(e) {
  const p = (e && e.parameter) || {};
  let out;
  try {
    if (p.a === 'boot') out = withVersion_(getBoot_(), p.v);
    else if (p.a === 'schools') out = withVersion_(getSchools_(), p.v);
    else if (p.a === 'pl') out = getPlaylist_(String(p.id || ''));
    else out = { ok: true, service: 'video-pathshala' };
  } catch (err) {
    out = { error: String(err && err.message || err) };
  }
  return json_(out);
}

function doPost(e) {
  const now = Date.now();
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ error: 'bad json' });
  }
  const device = str_(body.d, 40);
  const skew = now - num_(body.now, now);
  const list = Array.isArray(body.s) ? body.s.slice(0, 50) : [];
  const sheet = sheet_(SH.LOG);
  const ids = [];
  list.forEach(function (s) {
    if (!s || !s.id) return;
    // appendRow is atomic, so concurrent posts never overwrite each other. It also guesses types
    // whatever the column format, so text gets a leading ' to keep codes like 0955… intact.
    sheet.appendRow([new Date(now), "'" + device, skew, "'" + str_(s.id, 40), "'" + str_(s.sc, 30),
      "'" + str_(s.v, 20), "'" + str_(s.p, 40), num_(s.st, 0), num_(s.ls, 0), clamp_(s.w, 86400), clamp_(s.m, 86400),
      clamp_(s.h, 86400), clamp_(s.mx, 86400), clamp_(s.du, 86400)]);
    ids.push(s.id);
  });
  return json_({ ok: true, ids: ids });
}

/* ---------------- data served to the page ---------------- */

function getBoot_() {
  const key = 'boot:' + ver_();
  const hit = getBig_(key);
  if (hit) return hit;
  const rows = values_(SH.PLAYLISTS);
  const cats = {};
  const order = {};
  rows.forEach(function (r) {
    // show, category, order, playlist_id, display_title, video_count, first_video, youtube_title
    if (r[0] !== true && String(r[0]).toUpperCase() !== 'TRUE') return;
    if (!r[3] || !Number(r[5])) return;
    const c = String(r[1] || 'अन्य');
    if (!cats[c]) { cats[c] = []; order[c] = Number(r[2]) || 9999; }
    order[c] = Math.min(order[c], Number(r[2]) || 9999);
    cats[c].push({ o: Number(r[2]) || 9999, x: [String(r[3]), String(r[4]), Number(r[5]), String(r[6])] });
  });
  const out = {
    cats: Object.keys(cats)
      .sort(function (a, b) { return order[a] - order[b]; })
      .map(function (c) {
        return { n: c, p: cats[c].sort(function (a, b) { return a.o - b.o; }).map(function (x) { return x.x; }) };
      }),
  };
  out.v = hash_(out);
  putBig_(key, out);
  return out;
}

function getSchools_() {
  const key = 'schools:' + ver_();
  const hit = getBig_(key);
  if (hit) return hit;
  const blocks = {};
  values_(SH.SCHOOLS).forEach(function (r) {
    // udise, block, school_name
    const id = udise_(r[0]);
    const block = String(r[1]).trim();
    if (!id || !block) return;
    (blocks[block] = blocks[block] || []).push([id, String(r[2]).trim()]);
  });
  Object.keys(blocks).forEach(function (b) {
    blocks[b].sort(function (x, y) { return x[1].localeCompare(y[1]); });
  });
  const out = { b: blocks };
  out.v = hash_(out);
  putBig_(key, out);
  return out;
}

function getPlaylist_(id) {
  const cache = CacheService.getScriptCache();
  const prefix = 'pl:' + ver_() + ':';
  const hit = cache.get(prefix + id);
  if (hit) return JSON.parse(hit);
  // Miss: build every playlist at once so the next requests are cached too.
  const all = {};
  values_(SH.VIDEOS).forEach(function (r) {
    // playlist_id, position, video_id, title, duration_s
    const p = String(r[0]);
    (all[p] = all[p] || []).push([Number(r[1]), String(r[2]), String(r[3]), Number(r[4]) || 0]);
  });
  const put = {};
  Object.keys(all).forEach(function (p) {
    const v = all[p].sort(function (a, b) { return a[0] - b[0]; }).map(function (x) { return x.slice(1); });
    const s = JSON.stringify({ id: p, v: v });
    if (s.length < 95000) put[prefix + p] = s;
  });
  cache.putAll(put, 21600);
  return { id: id, v: all[id] ? all[id].sort(function (a, b) { return a[0] - b[0]; }).map(function (x) { return x.slice(1); }) : [] };
}

/** Lets the page skip re-downloading data it already has. */
function withVersion_(data, clientVer) {
  return clientVer && clientVer === data.v ? { v: data.v, same: true } : data;
}

/* ---------------- sheet menu, setup, triggers ---------------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Video Pathshala')
    .addItem('Update dashboard now', 'compact')
    .addItem('Refresh playlists from YouTube', 'refreshCatalog')
    .addItem('Publish edits to Schools / Playlists', 'bumpVersion')
    .addItem('Reload school list from GitHub (replaces Schools tab)', 'loadSchools')
    .addSeparator()
    .addItem('First-time setup', 'setup')
    .addToUi();
}

/** Any edit to Schools or Playlists reaches teachers within a minute. */
function onEdit(e) {
  const name = e && e.range && e.range.getSheet().getName();
  if (name === SH.SCHOOLS || name === SH.PLAYLISTS) bumpVersion();
}

function bumpVersion() {
  PropertiesService.getScriptProperties().setProperty('VER', String(Date.now()));
}

/** Publishes edits that onEdit misses (API writes, other scripts) by fingerprinting the two tabs. */
function syncVersion_() {
  const props = PropertiesService.getScriptProperties();
  const h = hash_([values_(SH.SCHOOLS), values_(SH.PLAYLISTS)]);
  if (props.getProperty('SRC_HASH') === h) return;
  props.setProperty('SRC_HASH', h);
  bumpVersion();
}

function setup() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone('Asia/Kolkata');
  ensureSheet_(SH.CONFIG, ['key', 'value', 'meaning'], function (sh) {
    sh.getRange('B:B').setNumberFormat('@');
    sh.getRange(2, 1, DEFAULT_CONFIG.length, 3).setValues(DEFAULT_CONFIG);
  });
  ensureSheet_(SH.SCHOOLS, ['udise', 'block', 'school_name'], function (sh) {
    sh.getRange('A:A').setNumberFormat('@');
  });
  if (sheet_(SH.SCHOOLS).getLastRow() < 2) loadSchools();
  ensureSheet_(SH.PLAYLISTS, PLAYLIST_HEADERS);
  ensureSheet_(SH.VIDEOS, ['playlist_id', 'position', 'video_id', 'title', 'duration_s']);
  // Text columns, so UDISE codes keep their leading 0 and dates stay as typed.
  ensureSheet_(SH.LOG, LOG_HEADERS, function (sh) { sh.getRange('B:G').setNumberFormat('@'); });
  ensureSheet_(SH.SESSIONS, SESSION_HEADERS, function (sh) {
    sh.getRange('A:I').setNumberFormat('@');
    sh.getRange('P:R').setNumberFormat('@');
  });

  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('compact').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('refreshCatalog').timeBased().everyDays(1).atHour(3).create();

  const first = ss.getSheetByName('Sheet1');
  if (first && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);

  refreshCatalog();
  compact();
}

/** Replaces the Schools tab with the list published in the repo. */
function loadSchools() {
  const csv = UrlFetchApp.fetch(SCHOOLS_CSV_URL).getContentText('UTF-8');
  const rows = Utilities.parseCsv(csv).slice(1).filter(function (r) { return r[0] && r[1]; })
    .map(function (r) { return [udise_(r[0]), r[1].trim(), r[2].trim()]; });
  const sh = sheet_(SH.SCHOOLS);
  sh.getRange('A:A').setNumberFormat('@');
  writeAll_(SH.SCHOOLS, ['udise', 'block', 'school_name'], rows);
  bumpVersion();
  Logger.log('Loaded %s schools', rows.length);
}

function ensureSheet_(name, headers, init) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (sh) return sh;
  sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  if (init) init(sh);
  return sh;
}

/* ---------------- helpers ---------------- */

function sheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Missing sheet "' + name + '". Run Video Pathshala > First-time setup.');
  return sh;
}

/** Data rows (without the header) of a sheet. */
function values_(name) {
  const sh = sheet_(name);
  const n = sh.getLastRow() - 1;
  return n > 0 ? sh.getRange(2, 1, n, sh.getLastColumn()).getValues() : [];
}

function config_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('cfg');
  if (hit) return JSON.parse(hit);
  const cfg = {};
  DEFAULT_CONFIG.forEach(function (r) { cfg[r[0]] = r[1]; });
  values_(SH.CONFIG).forEach(function (r) { if (r[0]) cfg[String(r[0]).trim()] = String(r[1]).trim(); });
  cache.put('cfg', JSON.stringify(cfg), 600);
  return cfg;
}

function ver_() {
  return PropertiesService.getScriptProperties().getProperty('VER') || '0';
}

/** CacheService values are capped at 100 KB, so large values are split into chunks. */
function putBig_(key, obj) {
  const s = JSON.stringify(obj);
  const size = 90000;
  const parts = {};
  let n = 0;
  for (let i = 0; i < s.length; i += size) parts[key + ':' + n++] = s.slice(i, i + size);
  parts[key] = String(n);
  CacheService.getScriptCache().putAll(parts, 21600);
}

function getBig_(key) {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(key));
  if (!n) return null;
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(key + ':' + i);
  const got = cache.getAll(keys);
  let s = '';
  for (let i = 0; i < n; i++) {
    if (got[keys[i]] == null) return null;
    s += got[keys[i]];
  }
  return JSON.parse(s);
}

function hash_(obj) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(obj), Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(bytes).slice(0, 12);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function str_(v, max) {
  return v == null ? '' : String(v).slice(0, max);
}

function num_(v, dflt) {
  const n = Number(v);
  return isFinite(n) ? n : dflt;
}

function clamp_(v, max) {
  const n = Math.round(num_(v, 0));
  return Math.max(0, Math.min(max, n));
}
