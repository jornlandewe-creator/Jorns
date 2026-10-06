#!/usr/bin/env node
// Showcase opnieuw renderen voor een bestaande capture-map: node showcase.js "<map>"
const path = require('path');
const { renderShowcase } = require('./lib/showcase');
const dir = process.argv[2];
if (!dir) { console.log('Gebruik: node showcase.js "<capture-map>" [--max-subframes 14]'); process.exit(1); }
const cfg = {};
for (let i = 3; i < process.argv.length; i += 2) cfg[process.argv[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = isNaN(+process.argv[i + 1]) ? process.argv[i + 1] : +process.argv[i + 1];
renderShowcase(path.resolve(dir), cfg).then((r) => console.log(`Klaar: ${r.file} (${r.duration}s)`)).catch((e) => { console.error(e); process.exit(1); });
