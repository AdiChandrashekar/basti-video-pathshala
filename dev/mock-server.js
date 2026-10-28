// Local test server: serves web/ and fakes the Apps Script API at /mock.
// Run:  node dev/mock-server.js   then open http://localhost:8787
// Every POST the page sends is printed and appended to dev/mock-posts.jsonl.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8787;
const WEB = path.join(__dirname, '..', 'web');
const POSTS = path.join(__dirname, 'mock-posts.jsonl');

// Real videos from the "1-10 के पहाड़े" playlist, reused for every mock playlist.
const VIDEOS = [['MKlSSY3r6gU', 462], ['nPHY4IUL5ZM', 462], ['EFeteoDTFfg', 418], ['IHcfjgFIGzo', 604],
  ['S4owlQ6FTKs', 443], ['LTdjCCyoPIE', 336], ['xFbHHx5Smz4', 116], ['cWjSEsbj97s', 277], ['L4Vjhs1k-iA', 448],
  ['RQcIUYwLbI4', 396], ['_v7oAsXabXE', 95]].map((v, i) => [v[0], 'पहाड़ा ' + (i + 1) + ' (नमूना वीडियो)', v[1]]);

const BOOT = {
  v: 'mock1',
  cats: [
    { n: 'NIPUN: भाषा और गणित की नींव', p: [
      ['PLOVkzUS5mUupu7tIOhXzkeIqP1b5wUvXu', '1-10 के पहाड़े', 11, VIDEOS[0][0]],
      ['PLOVkzUS5mUupCQKKA8I8mCbVv8eyh3Sn_', 'DG1 (developmental goal 1) NIPUN Bharat guidelines', 11, VIDEOS[1][0]],
      ['PLOVkzUS5mUupOIPbNDnq6W35LMftx94hT', 'हिन्दी कहानी', 11, VIDEOS[2][0]],
      ['PLOVkzUS5mUurpUmCyw-oE5QzHP5fxMrDi', 'Counting Series', 11, VIDEOS[3][0]],
      ['PLOVkzUS5mUurPnAZQzZqkSDMvxz03zBt1', 'भाषा की समझ', 11, VIDEOS[4][0]],
    ] },
    { n: 'कक्षा अनुसार (Nursery – कक्षा 3)', p: [
      ['PLOVkzUS5mUuqY7wFsmpkWRt_5mJP8ISDU', 'Nursery', 11, VIDEOS[5][0]],
      ['PLOVkzUS5mUurpknsLaxN95Sn_dzfo-_kd', 'Class 1', 11, VIDEOS[6][0]],
    ] },
    { n: 'गणित: कक्षा अनुसार', p: [['PLOVkzUS5mUur-e6ENnpAhzjsCdPszOyF2', 'Grade 1 Maths', 11, VIDEOS[7][0]]] },
  ],
};

// The real Basti list, built by dev/build-schools.js.
const SCHOOLS = { v: 'mock-' + fs.statSync(path.join(__dirname, '..', 'data', 'schools-basti.csv')).mtimeMs, b: {} };
fs.readFileSync(path.join(__dirname, '..', 'data', 'schools-basti.csv'), 'utf8').split('\n').slice(1).filter(Boolean)
  .forEach((line) => {
    const m = line.match(/^([^,]+),([^,]+),"?(.*?)"?$/);
    (SCHOOLS.b[m[2]] = SCHOOLS.b[m[2]] || []).push([m[1], m[3].replace(/""/g, '"')]);
  });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/mock') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        fs.appendFileSync(POSTS, body + '\n');
        const j = JSON.parse(body);
        console.log('POST', new Date().toISOString(), j.s.map((s) => `${s.v} school=${s.sc} watched=${s.w}s muted=${s.m}s`).join(' | '));
        send(res, { ok: true, ids: j.s.map((s) => s.id) });
      });
      return;
    }
    const a = url.searchParams.get('a');
    const v = url.searchParams.get('v');
    const data = a === 'boot' ? BOOT : a === 'schools' ? SCHOOLS : a === 'pl' ? { id: url.searchParams.get('id'), v: VIDEOS } : { ok: true };
    return send(res, data.v && v === data.v ? { v, same: true } : data);
  }
  const file = path.join(WEB, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  if (!file.startsWith(WEB) || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log('http://localhost:' + PORT));

function send(res, obj) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}
