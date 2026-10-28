/**
 * Pulls the channel's playlists and videos from the YouTube Data API into the
 * Playlists and Videos sheets. Runs daily at 3 am and from the sheet menu.
 *
 * Edits made in the Playlists sheet (show, category, order, display_title) are
 * kept across refreshes; only new playlists get the defaults below.
 */

const PLAYLIST_HEADERS = ['show', 'category', 'order', 'playlist_id', 'display_title', 'video_count',
  'first_video', 'youtube_title'];

const CAT_NIPUN = 'NIPUN: भाषा और गणित की नींव';
const CAT_CLASS = 'कक्षा अनुसार (Nursery – कक्षा 3)';
const CAT_MATHS_GRADE = 'गणित: कक्षा अनुसार';
const CAT_MATHS_TOPIC = 'गणित: विषय अनुसार';
const CAT_SCIENCE = 'विज्ञान / पर्यावरण (EVS)';
const CAT_ORDER = [CAT_NIPUN, CAT_CLASS, CAT_MATHS_GRADE, CAT_MATHS_TOPIC, CAT_SCIENCE];
const EARLY_CLASSES = ['nursery', 'lkg', 'ukg', 'class 1', 'class 2', 'class 3'];

function refreshCatalog() {
  const started = Date.now();
  const channelId = channelId_(config_().CHANNEL);

  const playlists = [];
  let token;
  do {
    const r = YouTube.Playlists.list('snippet,contentDetails', { channelId: channelId, maxResults: 50, pageToken: token });
    playlists.push.apply(playlists, r.items || []);
    token = r.nextPageToken;
  } while (token);

  // playlist id -> [[position, videoId, title]]
  const items = {};
  const ids = {};
  playlists.forEach(function (pl) {
    const list = items[pl.id] = [];
    let t;
    do {
      const r = YouTube.PlaylistItems.list('snippet,status', { playlistId: pl.id, maxResults: 50, pageToken: t });
      (r.items || []).forEach(function (it) {
        const vid = it.snippet && it.snippet.resourceId && it.snippet.resourceId.videoId;
        if (!vid || (it.status && it.status.privacyStatus !== 'public')) return;
        list.push([it.snippet.position, vid, it.snippet.title]);
        ids[vid] = true;
      });
      t = r.nextPageToken;
    } while (t);
    if (Date.now() - started > 5 * 60 * 1000) throw new Error('Catalog refresh ran out of time');
  });

  // Durations, and drop videos that cannot be played inside our page.
  const info = {};
  const all = Object.keys(ids);
  for (let i = 0; i < all.length; i += 50) {
    const r = YouTube.Videos.list('contentDetails,status', { id: all.slice(i, i + 50).join(','), maxResults: 50 });
    (r.items || []).forEach(function (v) {
      if (v.status && v.status.embeddable && v.status.privacyStatus === 'public') {
        info[v.id] = isoSeconds_(v.contentDetails.duration);
      }
    });
  }

  const videoRows = [];
  const counts = {};
  const firsts = {};
  playlists.forEach(function (pl) {
    let pos = 0;
    items[pl.id].sort(function (a, b) { return a[0] - b[0]; }).forEach(function (x) {
      if (!(x[1] in info)) return;
      videoRows.push([pl.id, pos++, x[1], shortTitle_(x[2]), info[x[1]]]);
      if (!firsts[pl.id]) firsts[pl.id] = x[1];
    });
    counts[pl.id] = pos;
  });

  const kept = {};
  values_(SH.PLAYLISTS).forEach(function (r) { if (r[3]) kept[r[3]] = r; });
  const plRows = playlists.map(function (pl, i) {
    const title = pl.snippet.title;
    const old = kept[pl.id];
    const d = defaults_(title, i);
    return [old ? old[0] : d.show, old ? old[1] : d.category, old ? old[2] : d.order, pl.id,
      old ? old[4] : shortTitle_(title), counts[pl.id] || 0, firsts[pl.id] || '', title];
  });
  plRows.sort(function (a, b) { return a[2] - b[2]; });

  writeAll_(SH.PLAYLISTS, PLAYLIST_HEADERS, plRows);
  writeAll_(SH.VIDEOS, ['playlist_id', 'position', 'video_id', 'title', 'duration_s'], videoRows);
  bumpVersion();
  Logger.log('Catalog: %s playlists, %s videos in %ss', plRows.length, videoRows.length,
    Math.round((Date.now() - started) / 1000));
}

function channelId_(handle) {
  handle = String(handle || '').trim();
  if (/^UC[\w-]{22}$/.test(handle)) return handle;
  const r = YouTube.Channels.list('id', { forHandle: handle.replace(/^@?/, '@') });
  if (!r.items || !r.items.length) throw new Error('YouTube channel not found: ' + handle);
  return r.items[0].id;
}

/** Category, visibility and order for a playlist seen for the first time. */
function defaults_(title, index) {
  const t = title.trim().toLowerCase();
  let cat = CAT_NIPUN;
  let sub = index;
  let show = true;
  let m;
  if (EARLY_CLASSES.indexOf(t) >= 0) {
    cat = CAT_CLASS;
    sub = EARLY_CLASSES.indexOf(t);
  } else if ((m = t.match(/^grade (\d+) maths/))) {
    cat = CAT_MATHS_GRADE;
    sub = Number(m[1]);
  } else if (/maths course/.test(t)) {
    cat = CAT_MATHS_TOPIC;
  } else if ((m = t.match(/^grade (\d+) (science|evs)/))) {
    cat = CAT_SCIENCE;
    sub = Number(m[1]);
  }
  // Classes 9-10 and promotional lists are outside basic schools' scope.
  if (/brand ambassadors|exam playlist|(grade|class) (9|10)\b/.test(t)) show = false;
  return { show: show, category: cat, order: (CAT_ORDER.indexOf(cat) + 1) * 1000 + sub };
}

/** "Triangles | Maths Course | TicTacLearn Hindi" -> "Triangles" */
function shortTitle_(title) {
  const s = String(title).split('|')[0].trim();
  return s || String(title).trim();
}

function isoSeconds_(iso) {
  const m = String(iso || '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (Number(m[1] || 0) * 86400) + (Number(m[2] || 0) * 3600) + (Number(m[3] || 0) * 60) + Number(m[4] || 0);
}

/** Replaces a sheet's data rows (keeps the header). */
function writeAll_(name, headers, rows) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name) || ensureSheet_(name, headers);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
}
