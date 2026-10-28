// Builds data/schools-basti.csv (udise, block, school_name) from the NIPUN Plus school master.
// Usage: node dev/build-schools.js ../nipunplus/analysis/output/schools.csv

const fs = require('fs');
const path = require('path');

const src = process.argv[2];
const lines = fs.readFileSync(src, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);

function parse(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

const head = parse(lines[0]);
const col = (n) => head.indexOf(n);
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s(.\-/])([a-z])/g, (m, a, b) => a + b.toUpperCase());
// Same block names as the Basti NIPUN dashboard: urban Basti Sadar is folded into Basti Sadar.
const block = (b) => b.replace(/\s*\((R|U)\)\s*$/, '').trim();

const rows = lines.slice(1).map(parse)
  .filter((r) => r[col('district')] === 'BASTI')
  .map((r) => [r[col('udise_code')].padStart(11, '0'), block(r[col('block')]), titleCase(r[col('school_name')].trim())])
  .sort((a, b) => a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]));

const csv = 'udise,block,school_name\n' + rows.map((r) => r.map((x) => /[",]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x).join(',')).join('\n') + '\n';
const out = path.join(__dirname, '..', 'data', 'schools-basti.csv');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, csv);
const counts = {};
rows.forEach((r) => { counts[r[1]] = (counts[r[1]] || 0) + 1; });
console.log(rows.length + ' schools ->', out);
console.log(counts);
