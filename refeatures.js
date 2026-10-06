#!/usr/bin/env node
// Key features opnieuw zoeken voor een bestaande capture: node refeatures.js "<capture-map>"
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib/browser');
const { captureFeatures } = require('./lib/extra');
const dir = path.resolve(process.argv[2] || '.');
(async () => {
  const cf = path.join(dir, 'website-reference-context.json');
  const ctx = JSON.parse(fs.readFileSync(cf, 'utf8'));
  const cfg = { width: 1920, height: 1080, scale: 2, hideWidgets: true, features: 6 };
  const { browser, context } = await launch(cfg);
  const page = await context.newPage();
  fs.rmSync(path.join(dir, 'features'), { recursive: true, force: true });
  const analyses = ctx.pages.map((p) => ({ url: p.url, pageNo: p.page }));
  const f = await captureFeatures(page, cfg, analyses, { out: dir });
  ctx.key_features = f; ctx.key_feature_groups = f.groups || [];
  fs.writeFileSync(cf, JSON.stringify(ctx, null, 1));
  await browser.close();
  const a = path.join(dir, 'showcase', '_assets', 'assets.json'); if (fs.existsSync(a)) fs.rmSync(a);
  console.log(`${f.length} features en ${(f.groups || []).length} groepen opgeslagen`);
})().catch((e) => { console.error(e); process.exit(1); });
