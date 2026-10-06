#!/usr/bin/env node
// Preview opnieuw renderen voor een bestaande capture-map: node preview.js "<map>"
const path = require('path');
const { renderPreview } = require('./lib/preview');
const dir = process.argv[2];
if (!dir) { console.log('Gebruik: node preview.js "<capture-map>"'); process.exit(1); }
const cfg = {};
for (let i = 3; i < process.argv.length; i += 2) cfg[process.argv[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = isNaN(+process.argv[i + 1]) ? process.argv[i + 1] : +process.argv[i + 1];
renderPreview(path.resolve(dir), cfg).then((r) => console.log(`Klaar: ${r.file} (${r.duration}s · ${r.shots.join(' → ')})`)).catch((e) => { console.error(e); process.exit(1); });
