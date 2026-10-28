(function () {
  'use strict';

  var C = window.APP_CONFIG;
  var MIN_SEC = 30;            // a play is recorded once this much has been watched
  var FLUSH_MS = 3 * 60 * 1000;

  /* ---------- small helpers ---------- */

  function $(s) { return document.querySelector(s); }
  function get(k, d) {
    try { var v = localStorage.getItem('vp_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
  }
  function set(k, v) {
    try { localStorage.setItem('vp_' + k, JSON.stringify(v)); } catch (e) { dropPlaylistCache(); }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid() {
    var a = new Uint8Array(12);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function api(params) {
    var q = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    return fetch(C.api + '?' + q).then(function (r) { return r.json(); });
  }
  function localDate(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function hm(ts) {
    var d = new Date(ts);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  var MONTHS = ['जन', 'फ़र', 'मार्च', 'अप्रै', 'मई', 'जून', 'जुला', 'अग', 'सित', 'अक्टू', 'नव', 'दिस'];
  function when(ts) {
    var d = new Date(ts);
    if (localDate(ts) === localDate(Date.now())) return 'आज ' + hm(ts);
    if (localDate(ts) === localDate(Date.now() - 864e5)) return 'कल';
    return d.getDate() + ' ' + MONTHS[d.getMonth()];
  }
  function dur(s) {
    s = Math.round(s || 0);
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }
  function thumb(vid, size) { return 'https://i.ytimg.com/vi/' + vid + '/' + (size || 'mqdefault') + '.jpg'; }
  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3500);
  }

  /* ---------- state ---------- */

  var device = get('device') || uid();
  set('device', device);
  var school = get('school');          // {id, name, block}
  var boot = get('boot');              // {v, cats:[{n, p:[[id, title, count, firstVid]]}]}
  var seen = get('seen', {});          // videoId -> [lastPlayedTs, playlistId]
  var outbox = get('outbox', {});      // sessionId -> snapshot not yet confirmed by the server

  /* ---------- header ---------- */

  function renderHeader() {
    $('#brand').innerHTML = esc(C.title) + '<span>&nbsp;· ' + esc(C.district) + '</span>';
    document.title = C.title;
    var b = $('#schoolBtn');
    b.hidden = !school;
    if (school) b.innerHTML = '<span>' + esc(school.name) + '</span><b>बदलें</b>';
    renderToday();
  }

  function today() {
    var t = get('today');
    return t && t.d === localDate(Date.now()) ? t : { d: localDate(Date.now()), n: 0, s: 0 };
  }

  function renderToday() {
    var el = $('#today');
    if (!school) { el.hidden = true; return; }
    var t = today();
    // The video playing right now is always in the outbox; only older unsent records count as pending.
    var pending = Object.keys(outbox).filter(function (k) { return !cur || k !== cur.s.id; }).length;
    el.hidden = false;
    el.innerHTML = '<span>आज इस डिवाइस पर</span>' +
      '<span class="stat"><b>' + t.n + '</b> वीडियो</span>' +
      '<span class="stat"><b>' + Math.round(t.s / 60) + '</b> मिनट</span>' +
      '<span class="sync">' + (pending ? '⏳ ' + pending + ' रिकॉर्ड इंटरनेट मिलने पर भेजे जाएँगे' : '✓ रिकॉर्ड भेजा जा चुका है') + '</span>';
  }

  $('#schoolBtn').addEventListener('click', function () { location.hash = '#/setup'; });

  /* ---------- routing ---------- */

  function route() {
    window.scrollTo(0, 0);
    var h = location.hash.replace(/^#\/?/, '').split('/');
    if (!school || h[0] === 'setup') return viewSetup();
    if (h[0] === 'p' && h[1]) return viewPlaylist(decodeURIComponent(h[1]));
    viewHome();
  }
  window.addEventListener('hashchange', function () {
    if (!/^#\/p\//.test(location.hash)) stopPlayer();
    route();
  });

  /* ---------- school picker ---------- */

  function viewSetup() {
    stopPlayer();
    var v = $('#view');
    var data = get('schools');
    function draw(d) {
      if (!d || !d.b) { v.innerHTML = '<p class="muted center">विद्यालयों की सूची लोड हो रही है…</p>'; return; }
      var blocks = Object.keys(d.b).sort();
      var cur = (school && d.b[school.block]) ? school.block : null;
      v.innerHTML =
        '<h2>अपना ब्लॉक और विद्यालय चुनें</h2>' +
        '<p class="muted">यह केवल एक बार चुनना है। इसी से रिकॉर्ड होगा कि आपके विद्यालय में कौन-से वीडियो चलाए गए।</p>' +
        '<div class="picks" id="blocks">' + blocks.map(function (b) {
          return '<button class="pick" data-b="' + esc(b) + '"' + (b === cur ? ' aria-pressed="true"' : '') + '>' +
            esc(b) + '<small>' + d.b[b].length + ' विद्यालय</small></button>';
        }).join('') + '</div>' +
        '<div id="schoolPick"></div>';
      v.querySelector('#blocks').addEventListener('click', function (e) {
        var btn = e.target.closest('.pick');
        if (!btn) return;
        v.querySelectorAll('#blocks .pick').forEach(function (x) { x.setAttribute('aria-pressed', String(x === btn)); });
        drawSchools(d, btn.getAttribute('data-b'));
      });
      if (cur) drawSchools(d, cur, true);
    }
    function drawSchools(d, block, quiet) {
      var list = d.b[block];
      var box = $('#schoolPick');
      box.innerHTML = '<h2 style="margin-top:1.2rem">' + esc(block) + ': विद्यालय चुनें</h2>' +
        '<input class="search" id="q" type="search" placeholder="विद्यालय का नाम या UDISE कोड लिखें" autocomplete="off">' +
        '<div class="picks schoolList" id="sl"></div>';
      var q = box.querySelector('#q');
      function fill() {
        var s = q.value.trim().toLowerCase();
        var hits = list.filter(function (x) { return !s || x[1].toLowerCase().indexOf(s) >= 0 || x[0].indexOf(s) >= 0; });
        box.querySelector('#sl').innerHTML = hits.slice(0, 300).map(function (x) {
          return '<button class="pick" data-id="' + esc(x[0]) + '">' + esc(x[1]) + '<small>UDISE ' + esc(x[0]) + '</small></button>';
        }).join('') || '<p class="muted">कोई विद्यालय नहीं मिला</p>';
      }
      q.addEventListener('input', fill);
      box.querySelector('#sl').addEventListener('click', function (e) {
        var btn = e.target.closest('.pick');
        if (!btn) return;
        var id = btn.getAttribute('data-id');
        var hit = list.filter(function (x) { return x[0] === id; })[0];
        school = { id: id, name: hit[1], block: block };
        set('school', school);
        renderHeader();
        toast('✓ ' + hit[1]);
        location.hash = '#/';
        route();
      });
      fill();
      if (!quiet) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    draw(data);
    api({ a: 'schools', v: data ? data.v : '' }).then(function (r) {
      if (r.error) throw new Error(r.error);
      if (r.same) return;
      set('schools', r);
      if (/^#?\/?(setup)?$/.test(location.hash) || location.hash === '#/setup') draw(r);
    }).catch(function () {
      if (!data) v.innerHTML = '<p class="muted center">इंटरनेट से जुड़ने के बाद पेज दोबारा खोलें।</p>';
    });
  }

  /* ---------- home: categories and playlists ---------- */

  function seenCount(plId) {
    var n = 0;
    for (var k in seen) if (seen[k][1] === plId) n++;
    return n;
  }

  function viewHome() {
    var v = $('#view');
    if (!boot) { v.innerHTML = '<p class="muted center">वीडियो सूची लोड हो रही है…</p>'; return; }
    var ci = Math.min(get('cat', 0), boot.cats.length - 1);
    var cat = boot.cats[ci];
    v.innerHTML =
      '<h1>आज क्या सीखें?</h1>' +
      '<p class="lede">श्रेणी चुनें, फिर कोई प्लेलिस्ट खोलें।</p>' +
      '<div class="chips" role="toolbar">' + boot.cats.map(function (c, i) {
        return '<button class="chip" data-c="' + i + '" aria-pressed="' + (i === ci) + '">' + esc(c.n) + '</button>';
      }).join('') + '</div>' +
      '<div class="grid">' + (cat ? cat.p : []).map(function (p) {
        var s = seenCount(p[0]);
        return '<button class="card" data-p="' + esc(p[0]) + '">' +
          '<img class="thumb" loading="lazy" alt="" src="' + thumb(p[3]) + '">' +
          '<div class="t">' + esc(p[1]) + '</div>' +
          '<div class="m"><span>' + p[2] + ' वीडियो</span>' + (s ? '<span class="seen">✓ ' + s + ' चलाए</span>' : '') + '</div>' +
          '</button>';
      }).join('') + '</div>';
    v.querySelector('.chips').addEventListener('click', function (e) {
      var b = e.target.closest('.chip');
      if (!b) return;
      set('cat', Number(b.getAttribute('data-c')));
      viewHome();
    });
    v.querySelector('.grid').addEventListener('click', function (e) {
      var b = e.target.closest('.card');
      if (b) location.hash = '#/p/' + encodeURIComponent(b.getAttribute('data-p'));
    });
    var active = v.querySelector('.chip[aria-pressed="true"]');
    // Scroll only the chip row (scrollIntoView would also move the page).
    if (active) active.parentNode.scrollLeft = active.offsetLeft - active.parentNode.offsetLeft - 16;
  }

  function plMeta(id) {
    var out = null;
    (boot ? boot.cats : []).forEach(function (c) { c.p.forEach(function (p) { if (p[0] === id) out = p; }); });
    return out;
  }

  /* ---------- playlist page ---------- */

  var list = null;   // {id, title, v:[[videoId, title, durationSec]]}
  var idx = -1;

  function viewPlaylist(id) {
    if (list && list.id !== id) stopPlayer();
    loadYT();
    var v = $('#view');
    var meta = plMeta(id);
    var cached = get('pl_' + id);
    function draw(pl) {
      if (!pl) { v.innerHTML = '<p class="muted center">वीडियो लोड हो रहे हैं…</p>'; return; }
      list = { id: id, title: meta ? meta[1] : '', v: pl.v };
      v.innerHTML =
        '<div class="plHead">' +
          '<a class="btn ghost" href="#/">← वापस</a>' +
          '<h1>' + esc(list.title) + ' <span class="muted">' + list.v.length + ' वीडियो</span></h1>' +
          '<button class="btn" id="playAll">▶ शुरू से चलाएँ</button>' +
          (firstUnseen() > 0 ? '<button class="btn ghost" id="resume">▶ आगे से चलाएँ</button>' : '') +
        '</div>' +
        (list.v.length > 12 ? '<input class="search" id="f" type="search" placeholder="इस सूची में खोजें" autocomplete="off">' : '') +
        '<div class="rows" id="rows"></div>';
      drawRows('');
      var f = v.querySelector('#f');
      if (f) f.addEventListener('input', function () { drawRows(f.value.trim().toLowerCase()); });
      v.querySelector('#playAll').addEventListener('click', function () { play(0); });
      var r = v.querySelector('#resume');
      if (r) r.addEventListener('click', function () { play(firstUnseen()); });
      v.querySelector('#rows').addEventListener('click', function (e) {
        var b = e.target.closest('.row');
        if (b) play(Number(b.getAttribute('data-i')));
      });
    }
    draw(cached);
    api({ a: 'pl', id: id }).then(function (r) {
      if (r.error || !r.v) throw new Error(r.error);
      set('pl_' + id, r);
      var changed = !cached || JSON.stringify(cached.v) !== JSON.stringify(r.v);
      if (changed && location.hash === '#/p/' + encodeURIComponent(id) && idx < 0) draw(r);
      else if (changed && list && list.id === id) list.v = r.v;
    }).catch(function () {
      if (!cached) v.innerHTML = '<p class="muted center">इंटरनेट से जुड़ने के बाद दोबारा कोशिश करें।</p><p class="center"><a class="btn ghost" href="#/">← वापस</a></p>';
    });
  }

  function firstUnseen() {
    if (!list) return 0;
    for (var i = 0; i < list.v.length; i++) if (!seen[list.v[i][0]]) return i;
    return 0;
  }

  function drawRows(filter) {
    var box = $('#rows');
    if (!box || !list) return;
    box.innerHTML = list.v.map(function (x, i) {
      if (filter && x[1].toLowerCase().indexOf(filter) < 0) return '';
      var s = seen[x[0]];
      return '<button class="row' + (i === idx ? ' playing' : '') + '" data-i="' + i + '">' +
        '<img loading="lazy" alt="" src="' + thumb(x[0], 'default') + '">' +
        '<div><div><span class="n">' + (i + 1) + '.</span>' + esc(x[1]) + '</div><div class="m"><span>' + dur(x[2]) + '</span>' +
        (s ? '<span class="seen">✓ ' + when(s[0]) + '</span>' : '') + '</div></div></button>';
    }).join('');
  }

  /* ---------- YouTube player ---------- */

  var yt = null;
  var ytReady = false;
  var ytLoading = null;
  var pendingPlay = null;
  var upnextTimer = null;

  function loadYT() {
    if (ytLoading) return ytLoading;
    ytLoading = new Promise(function (resolve) {
      window.onYouTubeIframeAPIReady = resolve;
      var s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      document.head.appendChild(s);
    });
    return ytLoading;
  }

  function play(i) {
    if (!list || !list.v[i]) return;
    clearUpnext();
    endSession();
    idx = i;
    var vid = list.v[i];
    $('#playerWrap').hidden = false;
    $('#nowTitle').textContent = (i + 1) + '. ' + vid[1];
    $('#prevBtn').disabled = i === 0;
    $('#nextBtn').disabled = i >= list.v.length - 1;
    drawRows(($('#f') && $('#f').value.trim().toLowerCase()) || '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    startSession(vid, list.id);
    if (yt && ytReady) {
      yt.loadVideoById(vid[0]);
      return;
    }
    pendingPlay = vid[0];
    loadYT().then(function () {
      if (yt) return;
      yt = new YT.Player('yt', {
        host: 'https://www.youtube-nocookie.com',
        videoId: pendingPlay,
        playerVars: { autoplay: 1, rel: 0, playsinline: 1, iv_load_policy: 3, modestbranding: 1, fs: 1 },
        events: {
          onReady: function () {
            ytReady = true;
            if (pendingPlay && yt.getVideoData && yt.getVideoData().video_id !== pendingPlay) yt.loadVideoById(pendingPlay);
            yt.playVideo();
          },
          onStateChange: onState,
          onError: onYtError,
        },
      });
    });
  }

  function onState(e) {
    tick();
    if (e.data === 0) {          // ended
      endSession();
      if (list && idx < list.v.length - 1) showUpnext();
    } else if (e.data === 2) {   // paused
      flush();
    }
  }

  function onYtError() {
    toast('यह वीडियो नहीं चल सका। अगला वीडियो चलाया जा रहा है।');
    if (cur) cur = null;
    if (list && idx < list.v.length - 1) setTimeout(function () { play(idx + 1); }, 2500);
  }

  function showUpnext() {
    var el = $('#upnext');
    var n = 8;
    var next = list.v[idx + 1];
    function draw() {
      el.innerHTML = '<span>अगला वीडियो ' + n + ' सेकंड में: <b>' + esc(next[1]) + '</b></span>' +
        '<button class="btn" id="unGo">▶ अभी चलाएँ</button><button class="btn ghost" id="unStop" style="color:#fff">रोकें</button>';
      el.querySelector('#unGo').onclick = function () { play(idx + 1); };
      el.querySelector('#unStop').onclick = clearUpnext;
    }
    el.hidden = false;
    draw();
    upnextTimer = setInterval(function () {
      n--;
      if (n <= 0) play(idx + 1); else draw();
    }, 1000);
  }

  function clearUpnext() {
    clearInterval(upnextTimer);
    upnextTimer = null;
    $('#upnext').hidden = true;
  }

  function stopPlayer() {
    clearUpnext();
    endSession();
    if (yt && ytReady && yt.stopVideo) yt.stopVideo();
    $('#playerWrap').hidden = true;
    idx = -1;
  }

  $('#prevBtn').addEventListener('click', function () { if (idx > 0) play(idx - 1); });
  $('#nextBtn').addEventListener('click', function () { if (list && idx < list.v.length - 1) play(idx + 1); });
  $('#closeBtn').addEventListener('click', function () { stopPlayer(); drawRows(''); });

  /* ---------- watch tracking ----------
   * One session per video play. Watched time grows only while the player is
   * actually playing (measured from the video's own clock, so seeking ahead
   * does not count). Snapshots are cumulative, so resending one is harmless.
   */

  var cur = null;   // {s: snapshot, wall, pos, counted}

  function startSession(vid, plId) {
    cur = {
      s: { id: uid(), sc: school.id, v: vid[0], p: plId, st: Date.now(), ls: Date.now(), w: 0, m: 0, h: 0, mx: 0, du: vid[2] || 0 },
      wall: performance.now(), pos: 0, counted: false,
    };
  }

  function tick() {
    if (!cur || !yt || !ytReady || !yt.getPlayerState) return;
    var now = performance.now();
    var wall = (now - cur.wall) / 1000;
    cur.wall = now;
    var pos = yt.getCurrentTime() || 0;
    var moved = pos - cur.pos;
    cur.pos = pos;
    if (yt.getPlayerState() !== 1 || moved <= 0 || moved > wall * 2.2 + 1) return;
    var add = Math.min(moved, wall + 0.5);
    var s = cur.s;
    s.w += add;
    if (yt.isMuted() || yt.getVolume() === 0) s.m += add;
    if (document.hidden) s.h += add;
    s.mx = Math.max(s.mx, pos);
    s.ls = Date.now();
    if (!s.du && yt.getDuration) s.du = Math.round(yt.getDuration());

    if (cur.counted) {
      var t = today(); t.s += add; set('today', t);
      queue(s);
    } else if (s.w >= Math.min(MIN_SEC, (s.du || MIN_SEC) * 0.8)) {
      cur.counted = true;
      var t2 = today(); t2.n += 1; t2.s += s.w; set('today', t2);
      seen[s.v] = [Date.now(), s.p];
      set('seen', seen);
      queue(s);
      flush();
    }
    renderToday();
  }

  function endSession() {
    if (!cur) return;
    tick();
    var done = cur;
    cur = null;
    if (done.counted) { queue(done.s); flush(); }
  }

  var lastSave = 0;
  function queue(s) {
    outbox[s.id] = { id: s.id, sc: s.sc, v: s.v, p: s.p, st: s.st, ls: s.ls, w: Math.round(s.w), m: Math.round(s.m),
      h: Math.round(s.h), mx: Math.round(s.mx), du: s.du };
    if (Date.now() - lastSave > 10000 || !cur) { set('outbox', outbox); lastSave = Date.now(); }
  }

  var sending = false;
  var lastFlush = Date.now();
  function payload() {
    var batch = Object.keys(outbox).slice(0, 30).map(function (k) { return outbox[k]; });
    return { d: device, now: Date.now(), s: batch };
  }

  function flush() {
    lastFlush = Date.now();
    if (sending || !Object.keys(outbox).length || navigator.onLine === false) return;
    sending = true;
    var body = payload();
    fetch(C.api, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        if (!r.ok) return;
        body.s.forEach(function (s) {
          if (outbox[s.id] && outbox[s.id].ls === s.ls) delete outbox[s.id];
        });
        set('outbox', outbox);
      })
      .catch(function () {})
      .then(function () { sending = false; renderToday(); });
  }

  /** Last-chance send when the tab is closed or hidden; the outbox keeps it until confirmed. */
  function beacon() {
    if (cur && cur.counted) { tick(); queue(cur.s); }
    set('outbox', outbox);
    if (!Object.keys(outbox).length || !navigator.sendBeacon) return;
    try { navigator.sendBeacon(C.api, new Blob([JSON.stringify(payload())], { type: 'text/plain;charset=utf-8' })); } catch (e) {}
  }

  setInterval(function () {
    tick();
    if (Date.now() - lastFlush > FLUSH_MS) flush();
  }, 1000);
  window.addEventListener('online', flush);
  window.addEventListener('pagehide', beacon);
  document.addEventListener('visibilitychange', function () { if (document.hidden) beacon(); });

  /* ---------- start ---------- */

  function dropPlaylistCache() {
    try {
      Object.keys(localStorage).forEach(function (k) { if (k.indexOf('vp_pl_') === 0) localStorage.removeItem(k); });
    } catch (e) {}
  }

  if (location.hostname === 'localhost') {
    window.__vp = { cur: function () { return cur; }, yt: function () { return yt; }, outbox: outbox };
  }

  renderHeader();
  route();
  api({ a: 'boot', v: boot ? boot.v : '' }).then(function (r) {
    if (r.error || r.same) return;
    boot = r;
    set('boot', r);
    if (!/^#\/(p|setup)/.test(location.hash) && school) viewHome();
  }).catch(function () {
    if (!boot && school) $('#view').innerHTML = '<p class="muted center">इंटरनेट से जुड़ने के बाद पेज दोबारा खोलें।</p>';
  });
  flush();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
