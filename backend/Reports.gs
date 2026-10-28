/**
 * Every 15 minutes: folds the raw Log into one row per watch session
 * (Sessions), adds the server-side checks (flags), and rebuilds the
 * dashboard tabs the officer reads.
 */

const SESSION_HEADERS = ['session_id', 'date', 'start', 'block', 'udise', 'school', 'video_id', 'video',
  'playlist', 'watched_min', 'reported_min', 'video_min', 'completed', 'muted_min', 'hidden_min', 'device',
  'clock_off_min', 'flags', 'start_ms', 'last_ms'];
const S = {};
SESSION_HEADERS.forEach(function (h, i) { S[h] = i; });

const IST_MS = 5.5 * 3600 * 1000;

function compact() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    syncVersion_();
    const cfg = config_();
    const schools = schoolMap_();
    const names = nameMaps_();

    const log = sheet_(SH.LOG);
    const nLog = log.getLastRow() - 1;
    const logRows = nLog > 0 ? log.getRange(2, 1, nLog, LOG_HEADERS.length).getValues() : [];
    // Snapshots are cumulative, so the newest one per session wins.
    const latest = {};
    logRows.forEach(function (r) {
      const sid = String(r[3]);
      if (!latest[sid] || Number(r[8]) >= Number(latest[sid][8])) latest[sid] = r;
    });

    const sh = sheet_(SH.SESSIONS);
    const n = Math.max(0, sh.getLastRow() - 1);
    const rows = n > 0 ? sh.getRange(2, 1, n, SESSION_HEADERS.length).getValues() : [];
    const index = {};
    rows.forEach(function (r, i) { index[String(r[S.session_id])] = i; });
    let firstChanged = rows.length;
    Object.keys(latest).forEach(function (sid) {
      const row = sessionRow_(latest[sid], schools, names);
      const i = index[sid];
      if (i === undefined) {
        index[sid] = rows.length;
        rows.push(row);
      } else if (row[S.last_ms] >= Number(rows[i][S.last_ms])) {
        rows[i] = row;
        firstChanged = Math.min(firstChanged, i);
      }
    });

    applyFlags_(rows, cfg, schools);
    if (rows.length) {
      if (firstChanged < rows.length) {
        sh.getRange(2 + firstChanged, 1, rows.length - firstChanged, SESSION_HEADERS.length)
          .setValues(rows.slice(firstChanged));
      }
      sh.getRange(2, S.flags + 1, rows.length, 1).setValues(rows.map(function (r) { return [r[S.flags]]; }));
    }
    SpreadsheetApp.flush();

    // Only now drop the processed log rows; rows appended meanwhile sit below them.
    if (nLog > 0) {
      if (log.getMaxRows() - 1 <= nLog) log.insertRowsAfter(log.getMaxRows(), 1);
      log.deleteRows(2, nLog);
    }

    buildReports_(rows, cfg, schools);
  } finally {
    lock.releaseLock();
  }
}

function sessionRow_(r, schools, names) {
  const skew = Number(r[2]) || 0;
  const start = Number(r[7]) + skew;
  const last = Math.max(Number(r[8]) + skew, start);
  const reported = Number(r[9]) || 0;
  // Never credit more watching than the time that actually passed.
  const watched = Math.min(reported, (last - start) / 1000 + 15);
  const udise = udise_(r[4]);
  const sc = schools[udise];
  const dur = Number(r[13]) || 0;
  const t = ist_(start);
  return [String(r[3]), t.slice(0, 10), t.slice(11, 16), sc ? sc[0] : '', udise, sc ? sc[1] : '(unknown school)',
    String(r[5]), names.v[String(r[5])] || '', names.p[String(r[6])] || '', min_(watched), min_(reported),
    // Completed = reached the end AND most of it was actually watched (not skipped to the end).
    min_(dur), dur && Number(r[12]) >= 0.9 * dur && watched >= 0.7 * dur ? 'Y' : 'N', min_(r[10]), min_(r[11]), String(r[1]),
    Math.round(skew / 60000), '', start, last];
}

/** Server-side checks. Flags never block anything; they only point the officer at rows worth a look. */
function applyFlags_(rows, cfg, schools) {
  const from = hhmm_(cfg.SCHOOL_START, 0);
  const to = hhmm_(cfg.SCHOOL_END, 24 * 60);
  const offDays = String(cfg.OFF_DAYS || '').toLowerCase().split(/[\s,]+/).filter(String);
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  const byDevice = {};
  const deviceSchools = {};
  rows.forEach(function (r, i) {
    const f = [];
    const date = dateStr_(r[S.date]);
    const start = hhmm_(timeStr_(r[S.start]), 0);
    const w = Number(r[S.watched_min]);
    if (!schools[udise_(r[S.udise])]) f.push('unknown school');
    if (start < from || start > to || offDays.indexOf(days[new Date(date + 'T00:00:00Z').getUTCDay()]) >= 0) {
      f.push('off-hours');
    }
    if (Math.abs(Number(r[S.clock_off_min])) > 15) f.push('device clock wrong');
    if (Number(r[S.reported_min]) - w > 1) f.push('time over-reported');
    if (w >= 1 && Number(r[S.muted_min]) > w / 2) f.push('mostly muted');
    if (w >= 1 && Number(r[S.hidden_min]) > w / 2) f.push('screen hidden');
    r[S.flags] = f;

    const dev = String(r[S.device]);
    (byDevice[dev] = byDevice[dev] || []).push(i);
    const k = dev + '|' + date;
    (deviceSchools[k] = deviceSchools[k] || {})[udise_(r[S.udise])] = true;
  });

  // One device cannot play two videos at once.
  Object.keys(byDevice).forEach(function (dev) {
    const list = byDevice[dev].sort(function (a, b) { return rows[a][S.start_ms] - rows[b][S.start_ms]; });
    let end = -Infinity;
    let endIdx = -1;
    list.forEach(function (i) {
      const r = rows[i];
      if (Number(r[S.start_ms]) < end - 60000) {
        addFlag_(r, 'overlapping plays');
        addFlag_(rows[endIdx], 'overlapping plays');
      }
      if (Number(r[S.last_ms]) > end) { end = Number(r[S.last_ms]); endIdx = i; }
    });
  });

  rows.forEach(function (r) {
    const k = String(r[S.device]) + '|' + dateStr_(r[S.date]);
    if (Object.keys(deviceSchools[k]).length > 1) addFlag_(r, 'device used by several schools');
    r[S.flags] = r[S.flags].join(', ');
  });
}

function addFlag_(r, f) {
  if (r[S.flags].indexOf(f) < 0) r[S.flags].push(f);
}

/* ---------------- dashboard tabs ---------------- */

function buildReports_(rows, cfg, schools) {
  const minPlay = (Number(cfg.MIN_PLAY_SEC) || 30) / 60;
  const inactiveDays = Number(cfg.INACTIVE_DAYS) || 3;
  const today = ist_(Date.now()).slice(0, 10);
  const week = dayRange_(today, 7);
  const recent = dayRange_(today, inactiveDays);

  const sc = {};
  Object.keys(schools).forEach(function (id) {
    sc[id] = { block: schools[id][0], name: schools[id][1], tv: 0, tm: 0, wv: 0, wm: 0, av: 0, am: 0,
      days: {}, last: '', flags: 0 };
  });
  const vids = {};
  const daily = {};
  const flagged = [];

  rows.forEach(function (r) {
    const date = dateStr_(r[S.date]);
    const m = Number(r[S.watched_min]) || 0;
    const play = m >= minPlay ? 1 : 0;
    const id = udise_(r[S.udise]);
    const s = sc[id];
    if (s) {
      s.am += m; s.av += play;
      if (date === today) { s.tm += m; s.tv += play; }
      if (week[date]) { s.wm += m; s.wv += play; }
      if (play) { s.days[date] = true; if (date > s.last) s.last = date; }
      if (r[S.flags]) s.flags++;
    }
    if (play) {
      const v = vids[r[S.video_id]] = vids[r[S.video_id]] || { t: r[S.video], p: r[S.playlist], n: 0, sc: {}, m: 0, c: 0 };
      v.n++; v.m += m; v.sc[id] = true; if (r[S.completed] === 'Y') v.c++;
      const d = daily[date] = daily[date] || { sc: {}, n: 0, m: 0 };
      d.sc[id] = true; d.n++; d.m += m;
    }
    if (r[S.flags]) flagged.push(r);
  });

  const blocks = {};
  Object.keys(sc).forEach(function (id) {
    const s = sc[id];
    const b = blocks[s.block] = blocks[s.block] || { total: 0, today: 0, week: 0, never: 0, tm: 0, wm: 0 };
    b.total++;
    if (s.tv) b.today++;
    if (s.wv) b.week++;
    if (!s.last) b.never++;
    b.tm += s.tm; b.wm += s.wm;
  });
  const blockRows = Object.keys(blocks).sort().map(function (k) {
    const b = blocks[k];
    return [k, b.total, b.today, b.week, b.never, b.total ? Math.round(b.week / b.total * 100) + '%' : '', r1_(b.tm), r1_(b.wm)];
  });
  writeReport_('Blocks', 0, 'Block summary', ['Block', 'Schools', 'Active today', 'Active in last 7 days',
    'Never used', '% active (7 days)', 'Minutes today', 'Minutes (7 days)'], blockRows);

  const ids = Object.keys(sc).sort(function (a, b) {
    return sc[a].block.localeCompare(sc[b].block) || sc[a].wm - sc[b].wm || sc[a].name.localeCompare(sc[b].name);
  });
  writeReport_('Schools activity', 1, 'Per school (least active first within each block)',
    ['Block', 'UDISE', 'School', 'Videos today', 'Minutes today', 'Videos (7 days)', 'Minutes (7 days)',
      'Videos (all)', 'Minutes (all)', 'Days active', 'Last active', 'Flagged plays'],
    ids.map(function (id) {
      const s = sc[id];
      return [s.block, id, s.name, s.tv, r1_(s.tm), s.wv, r1_(s.wm), s.av, r1_(s.am),
        Object.keys(s.days).length, s.last || 'never', s.flags];
    }));

  const inactive = ids.filter(function (id) {
    return !Object.keys(sc[id].days).some(function (d) { return recent[d]; });
  });
  writeReport_('Inactive', 2, 'Schools with no video played in the last ' + inactiveDays + ' day(s): ' + inactive.length,
    ['Block', 'UDISE', 'School', 'Last active', 'Minutes (all)'],
    inactive.map(function (id) { const s = sc[id]; return [s.block, id, s.name, s.last || 'never', r1_(s.am)]; }));

  writeReport_('Videos played', 3, 'Most played videos', ['Video', 'Playlist', 'Plays', 'Schools', 'Minutes',
    '% watched to the end'],
    Object.keys(vids).sort(function (a, b) { return vids[b].n - vids[a].n; }).slice(0, 2000).map(function (k) {
      const v = vids[k];
      return [v.t || k, v.p, v.n, Object.keys(v.sc).length, r1_(v.m), Math.round(v.c / v.n * 100) + '%'];
    }));

  writeReport_('Daily', 4, 'Day by day', ['Date', 'Schools active', 'Videos played', 'Minutes'],
    Object.keys(daily).sort().reverse().slice(0, 120).map(function (d) {
      return [d, Object.keys(daily[d].sc).length, daily[d].n, r1_(daily[d].m)];
    }));

  writeReport_('Flags', 5, 'Plays the server checks marked for a look (newest first)',
    ['Date', 'Start', 'Block', 'School', 'Video', 'Watched (min)', 'Flags'],
    flagged.sort(function (a, b) { return b[S.start_ms] - a[S.start_ms]; }).slice(0, 2000).map(function (r) {
      return [dateStr_(r[S.date]), timeStr_(r[S.start]), r[S.block], r[S.school], r[S.video], r[S.watched_min], r[S.flags]];
    }));
}

function writeReport_(name, position, title, headers, rows) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name, position);
    sh.setFrozenRows(2);
  }
  sh.clearContents();
  sh.getRange(1, 1).setValue(title + '   ·   updated ' + ist_(Date.now()).replace('T', ' ').slice(0, 16))
    .setFontWeight('bold');
  sh.getRange(2, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#eef2f7');
  if (rows.length) sh.getRange(3, 1, rows.length, headers.length).setValues(rows);
}

/* ---------------- helpers ---------------- */

/** udise -> [block, school name] */
function schoolMap_() {
  const m = {};
  values_(SH.SCHOOLS).forEach(function (r) {
    const id = udise_(r[0]);
    if (id) m[id] = [String(r[1]).trim(), String(r[2]).trim()];
  });
  return m;
}

function nameMaps_() {
  const v = {};
  const p = {};
  values_(SH.VIDEOS).forEach(function (r) { v[String(r[2])] = String(r[3]); });
  values_(SH.PLAYLISTS).forEach(function (r) { p[String(r[3])] = String(r[4]); });
  return { v: v, p: p };
}

/** UP UDISE codes start with 09; a sheet that stored one as a number drops that zero. */
function udise_(v) {
  const s = String(v == null ? '' : v).trim();
  return /^\d{10}$/.test(s) ? '0' + s : s;
}

/** India has no daylight saving, so IST is a fixed offset. "yyyy-mm-ddTHH:MM:SS" */
function ist_(ms) {
  return new Date(Number(ms) + IST_MS).toISOString().slice(0, 19);
}

function dateStr_(v) {
  return v instanceof Date ? ist_(v.getTime()).slice(0, 10) : String(v);
}

function timeStr_(v) {
  return v instanceof Date ? Utilities.formatDate(v, 'Asia/Kolkata', 'HH:mm') : String(v);
}

function hhmm_(s, dflt) {
  const m = String(s || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : dflt;
}

function dayRange_(today, n) {
  const out = {};
  const t = new Date(today + 'T00:00:00Z').getTime();
  for (let i = 0; i < n; i++) out[new Date(t - i * 86400000).toISOString().slice(0, 10)] = true;
  return out;
}

function min_(sec) {
  return Math.round((Number(sec) || 0) / 6) / 10;
}

function r1_(x) {
  return Math.round(x * 10) / 10;
}
