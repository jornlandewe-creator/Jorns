const { chromium } = require('playwright');
const { installHelpers } = require('./inpage');
const { sleep, log } = require('./util');

async function launch(cfg) {
  const args = ['--disable-smooth-scrolling', '--hide-scrollbars', '--force-color-profile=srgb', '--autoplay-policy=no-user-gesture-required'];
  const opts = { headless: !cfg.headed, args };
  if (process.env.CHROME_PATH) {
    opts.executablePath = process.env.CHROME_PATH;
    opts.args.push('--no-sandbox', '--no-zygote', '--use-gl=angle', '--use-angle=swiftshader');
  }
  const browser = await chromium.launch(opts);
  const context = await browser.newContext({
    viewport: { width: cfg.width, height: cfg.height },
    deviceScaleFactor: cfg.scale,
    locale: 'nl-NL',
    timezoneId: 'Europe/Amsterdam',
    reducedMotion: 'no-preference',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  });
  return { browser, context };
}

const COOKIE_SELECTORS = [
  '#onetrust-accept-btn-handler', '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', '#CybotCookiebotDialogBodyButtonAccept',
  '.cky-btn-accept', '#cn-accept-cookie', '.cmplz-accept', '[data-cookiefirst-action="accept"]', '#didomi-notice-agree-button',
  '.cc-allow', '.cc-accept', '#accept-cookies', '.js-cookie-accept', '[data-cookie-accept]', '#cookie-accept', '.cookie-accept',
  'button[data-testid="uc-accept-all-button"]', '.iubenda-cs-accept-btn', '#wt-cli-accept-all-btn', '.moove-gdpr-infobar-allow-all',
];
const ACCEPT_TEXT = /^(alle(s)? (cookies )?(accepteren|toestaan|akkoord)|accepteer( alle)?( cookies)?|accepteren|akkoord|ik ga akkoord|toestaan|alles toestaan|ja,? (ik ga akkoord|prima)|oké?|ok|accept( all)?( cookies)?|allow all|agree|i agree|got it|prima)$/i;

async function dismissCookies(page) {
  for (let round = 0; round < 2; round++) {
    let clicked = false;
    for (const sel of COOKIE_SELECTORS) {
      const el = await page.$(sel).catch(() => null);
      if (el && (await el.isVisible().catch(() => false))) {
        await el.click({ timeout: 1500 }).catch(() => {});
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      clicked = await page.evaluate((src) => {
        const re = new RegExp(src, 'i');
        const scopes = [...document.querySelectorAll('[id*=cookie i],[class*=cookie i],[id*=consent i],[class*=consent i],[class*=gdpr i],[id*=cmp i],[class*=cmp i],[aria-label*=cookie i],[role=dialog]')];
        for (const s of scopes) {
          for (const b of s.querySelectorAll('button,a,[role=button],input[type=button],input[type=submit]')) {
            const t = (b.innerText || b.value || '').replace(/\s+/g, ' ').trim();
            if (re.test(t) && b.getBoundingClientRect().width > 0) { b.click(); return true; }
          }
        }
        return false;
      }, ACCEPT_TEXT.source).catch(() => false);
    }
    // iframes (bv. Sourcepoint)
    if (!clicked) {
      for (const f of page.frames()) {
        if (f === page.mainFrame()) continue;
        if (!/consent|cookie|cmp|privacy/i.test(f.url())) continue;
        const ok = await f.evaluate((src) => {
          const re = new RegExp(src, 'i');
          for (const b of document.querySelectorAll('button,a,[role=button]')) { const t = (b.innerText || '').trim(); if (re.test(t)) { b.click(); return true; } }
          return false;
        }, ACCEPT_TEXT.source).catch(() => false);
        if (ok) { clicked = true; break; }
      }
    }
    if (clicked) await sleep(700);
    else break;
  }
}

const HIDE_CSS = `
  #hubspot-messages-iframe-container, .intercom-lightweight-app, #intercom-container, .intercom-launcher, #tawkchat-container, [id^=tawk], .trengo-vue-iframe, #trengo-web-widget, [id*=trengo], .crisp-client, #crisp-chatbox, .drift-frame-controller, #launcher, iframe[title*=chat i], iframe[src*=chat], .zsiq_floatmain, #zsiq_float, .fb_dialog, .grecaptcha-badge, #CybotCookiebotDialog, #onetrust-banner-sdk, #onetrust-consent-sdk, .cky-consent-container, .cmplz-cookiebanner, #cookie-notice, #usercentrics-root, .cc-window, [class*=cookie-banner], [id*=cookie-banner], [class*=cookiebar], [id*=cookiebar] { display:none !important; visibility:hidden !important; }
  html { scroll-behavior: auto !important; }
`;

async function preparePage(page, url, cfg, opts = {}) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    log('  ! laden duurde lang, ga toch verder: ' + e.message.split('\n')[0]);
  }
  await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
  await dismissCookies(page);
  if (cfg.hideWidgets) await page.addStyleTag({ content: HIDE_CSS }).catch(() => {});
  await page.evaluate(installHelpers);
  await page.evaluate(() => {
    document.querySelectorAll('img[loading=lazy]').forEach((i) => (i.loading = 'eager'));
    document.querySelectorAll('img[data-src]:not([src]), img[data-lazy-src]').forEach((i) => { const s = i.getAttribute('data-src') || i.getAttribute('data-lazy-src'); if (s) i.src = s; });
    document.querySelectorAll('video').forEach((v) => { v.muted = true; v.play && v.play().catch(() => {}); });
  }).catch(() => {});
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
  await sleep(opts.settle ?? 900);
}

async function ensureHelpers(page) {
  await page.evaluate(installHelpers).catch(() => {});
}

async function scrollTo(page, y) {
  await page.evaluate((y) => window.scrollTo({ top: y, left: 0, behavior: 'instant' }), y);
}

async function waitImages(page, ms = 4000) {
  await page.evaluate(async (ms) => {
    const t0 = performance.now();
    const imgs = [...document.images].filter((i) => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
    while (performance.now() - t0 < ms && imgs.some((i) => !i.complete)) await new Promise((r) => setTimeout(r, 100));
  }, ms).catch(() => {});
}

module.exports = { launch, preparePage, ensureHelpers, dismissCookies, scrollTo, waitImages };
