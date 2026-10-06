// Alles in deze functie draait IN de browserpagina (window.__wmc).
// Wordt na elke navigatie opnieuw geinjecteerd.
function installHelpers() {
  if (window.__wmc) return true;
  const W = {};
  const vw = () => innerWidth, vh = () => innerHeight;

  W.cs = (el) => getComputedStyle(el);
  W.abs = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) };
  };
  W.vrect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  };
  W.visible = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) return false;
    let e = el;
    while (e && e.nodeType === 1) {
      const s = getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.05) return false;
      e = e.parentElement;
    }
    return true;
  };
  W.inView = (el, frac = 0.5) => {
    const r = el.getBoundingClientRect();
    const ix = Math.max(0, Math.min(r.right, vw()) - Math.max(r.left, 0));
    const iy = Math.max(0, Math.min(r.bottom, vh()) - Math.max(r.top, 0));
    return r.width * r.height > 0 && (ix * iy) / (r.width * r.height) >= frac;
  };
  W.text = (el, n = 70) => ((el.innerText || el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || '') + '').replace(/\s+/g, ' ').trim().slice(0, n);
  W.cls = (el) => ((el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || '') + '';
  W.sig = (el) => (el.tagName + ' ' + W.cls(el) + ' ' + (el.id || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('data-testid') || '')).toLowerCase();

  W.path = (el) => {
    if (!el || el.nodeType !== 1) return null;
    const okId = (id) => id && /^[A-Za-z][\w-]*$/.test(id) && document.querySelectorAll('#' + CSS.escape(id)).length === 1;
    if (okId(el.id)) return '#' + el.id;
    const parts = [];
    let e = el;
    while (e && e.nodeType === 1 && e !== document.body && e !== document.documentElement) {
      if (okId(e.id)) { parts.unshift('#' + e.id); return parts.join(' > '); }
      let p = e.tagName.toLowerCase();
      const par = e.parentElement;
      if (par) {
        const same = [...par.children].filter((c) => c.tagName === e.tagName);
        if (same.length > 1) p += ':nth-of-type(' + (same.indexOf(e) + 1) + ')';
      }
      parts.unshift(p);
      e = par;
    }
    return 'body > ' + parts.join(' > ');
  };
  W.q = (sel) => { try { return document.querySelector(sel); } catch (e) { return null; } };

  W.motionDecl = (el) => {
    const s = getComputedStyle(el);
    const out = {};
    const durs = s.transitionDuration.split(',').map((d) => parseFloat(d) * (d.includes('ms') ? 1 : 1000));
    if (durs.some((d) => d > 0)) {
      out.transition = { property: s.transitionProperty, duration_ms: Math.round(Math.max(...durs)), easing: s.transitionTimingFunction, delay: s.transitionDelay };
    }
    if (s.animationName && s.animationName !== 'none') {
      out.animation = { name: s.animationName, duration: s.animationDuration, easing: s.animationTimingFunction, iteration: s.animationIterationCount };
    }
    try {
      const anims = el.getAnimations ? el.getAnimations() : [];
      if (anims.length) out.web_animations = anims.slice(0, 4).map((a) => {
        const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {};
        return { type: a.constructor.name, name: a.animationName || a.transitionProperty || a.id || '', duration: t.duration, easing: t.easing, iterations: t.iterations, playState: a.playState };
      });
    } catch (e) {}
    return Object.keys(out).length ? out : null;
  };

  const STYLE_PROPS = ['transform', 'opacity', 'backgroundColor', 'color', 'boxShadow', 'borderColor', 'filter', 'scale', 'translate', 'rotate', 'textDecorationLine', 'outlineColor', 'backgroundSize', 'backgroundPosition', 'letterSpacing', 'clipPath'];
  W.styleSnap = (el) => {
    const s = getComputedStyle(el);
    const o = {};
    for (const p of STYLE_PROPS) o[p] = s[p];
    const r = el.getBoundingClientRect();
    o._w = Math.round(r.width); o._h = Math.round(r.height); o._x = Math.round(r.left); o._y = Math.round(r.top);
    return o;
  };
  // Snapshot van element + belangrijke kinderen (img, svg, ::before kan niet)
  W.deepSnap = (el) => {
    const nodes = [['self', el]];
    [...el.querySelectorAll('img, svg, picture, span, i, [class*=icon], [class*=arrow], [class*=overlay], [class*=image], [class*=img]')].slice(0, 6).forEach((c, i) => nodes.push(['child' + i + ':' + c.tagName.toLowerCase(), c]));
    const o = {};
    nodes.forEach(([k, n]) => (o[k] = W.styleSnap(n)));
    return o;
  };
  W.diffSnap = (a, b) => {
    const ch = [];
    for (const k of Object.keys(a)) {
      if (!b[k]) continue;
      for (const p of Object.keys(a[k])) {
        if (p.startsWith('_')) continue;
        if (a[k][p] !== b[k][p]) ch.push({ node: k, prop: p, from: a[k][p], to: b[k][p] });
      }
      const dw = b[k]._w - a[k]._w, dh = b[k]._h - a[k]._h;
      if (Math.abs(dw) > 1 || Math.abs(dh) > 1) ch.push({ node: k, prop: 'size', from: a[k]._w + 'x' + a[k]._h, to: b[k]._w + 'x' + b[k]._h });
    }
    return ch;
  };

  // ---------- Rollen ----------
  W.isLogo = (el) => {
    const s = W.sig(el) + ' ' + (el.getAttribute('alt') || '').toLowerCase() + ' ' + (el.getAttribute('src') || '').toLowerCase();
    if (/logo/.test(s)) return true;
    const a = el.closest('a');
    if (a && (el.tagName === 'IMG' || el.tagName === 'svg' || el.tagName === 'SVG')) {
      const href = a.getAttribute('href') || '';
      const r = el.getBoundingClientRect();
      if ((href === '/' || href === location.origin + '/' || href === location.origin) && r.top + scrollY < 200) return true;
    }
    return false;
  };
  W.bgIsSolid = (el) => {
    const bg = getComputedStyle(el).backgroundColor;
    const m = bg.match(/rgba?\(([^)]+)\)/);
    if (!m) return false;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return p.length < 4 || p[3] > 0.5;
  };
  W.role = (el) => {
    const tag = el.tagName.toLowerCase();
    const sig = W.sig(el);
    const txt = W.text(el, 200);
    const r = el.getBoundingClientRect();
    const area = r.width * r.height;
    if (W.isLogo(el)) return 'logo';
    if (/(^| )(hamburger|burger|menu-toggle|nav-toggle|navbar-toggler|menu-button|menu-btn|mobile-menu|offcanvas-toggle|toggle-menu|js-menu)/.test(sig) || (el.getAttribute('aria-label') || '').toLowerCase().match(/^(menu|open menu|menu openen|navigatie)/)) return 'menu-toggle';
    if (tag === 'video') return 'video';
    if (/^h1$/.test(tag)) return 'headline';
    if (/^h[23]$/.test(tag)) return 'heading';
    if (/swiper|slick|splide|carousel|glide|flickity|embla|keen-slider|owl-|slider/.test(sig) && area > 60000) return 'slider';
    if (/review|testimonial|rating|kiyoh|trustpilot|klantbeoordeling|stars/.test(sig)) return 'review';
    if ((tag === 'a' || tag === 'button' || el.getAttribute('role') === 'button') && txt.length > 0 && txt.length < 45) {
      const s = getComputedStyle(el);
      const pad = parseFloat(s.paddingLeft) + parseFloat(s.paddingRight);
      if ((W.bgIsSolid(el) || parseFloat(s.borderTopWidth) >= 1) && pad >= 16 && r.height >= 28 && r.height < 110) return 'cta';
      if (el.closest('nav,header,[role=navigation]')) return 'nav-link';
      return 'link';
    }
    if (/badge|sticker|label|tag|ribbon|korting|actie|sale/.test(sig) && area < 40000 && area > 300) return 'badge';
    if (/€\s?\d|\d+,\d{2}\s?€|\d+,-/.test(txt) && txt.length < 40 && area < 60000) return 'price';
    if (tag === 'img' || tag === 'picture' || (getComputedStyle(el).backgroundImage.includes('url(') && area > 20000)) return area > 25000 ? 'image' : 'icon';
    if (tag === 'svg' && area < 12000) return 'icon';
    if (tag === 'nav' || el.getAttribute('role') === 'navigation') return 'nav';
    if (tag === 'form' || tag === 'input' || tag === 'select' || tag === 'textarea') return 'form';
    return 'block';
  };
  const ROLE_W = { logo: 10, 'menu-toggle': 8, headline: 9, cta: 9, slider: 8, image: 7, video: 8, heading: 6, card: 7, review: 6, badge: 6, price: 5, 'nav-link': 4, nav: 4, icon: 2, link: 2, form: 1, block: 1 };

  // Kaarten: herhaalde broertjes met beeld + tekst
  W.cards = () => {
    const out = new Set();
    const parents = new Set();
    document.querySelectorAll('img').forEach((img) => {
      let e = img.parentElement;
      for (let d = 0; d < 5 && e && e !== document.body; d++, e = e.parentElement) {
        const par = e.parentElement;
        if (!par) break;
        const sibs = [...par.children].filter((c) => c.tagName === e.tagName && W.cls(c).split(' ')[0] === W.cls(e).split(' ')[0]);
        const r = e.getBoundingClientRect();
        if (sibs.length >= 2 && r.width > 120 && r.height > 120 && r.width < vw() * 0.7) {
          parents.add(par);
          sibs.forEach((s) => { if (s.querySelector('img') && W.text(s).length > 2) out.add(s); });
          break;
        }
      }
    });
    return [...out];
  };

  W.collectElements = () => {
    const seen = new Set();
    const list = [];
    const add = (el, forcedRole) => {
      if (!el || seen.has(el) || !W.visible(el)) return;
      const r = W.abs(el);
      if (r.w < 8 || r.h < 8) return;
      seen.add(el);
      const role = forcedRole || W.role(el);
      const area = r.w * r.h;
      let imp = (ROLE_W[role] || 1) * 10 + Math.min(30, Math.sqrt(area) / 25);
      const motion = W.motionDecl(el);
      if (motion) imp += 6;
      if (r.y < innerHeight) imp += 5;
      list.push({ el, role, rect: r, text: W.text(el), motion, importance: Math.round(imp) });
    };
    document.querySelectorAll('header img, header svg, [class*=logo], [id*=logo], a[href="/"] img, a[href="/"] svg').forEach((e) => W.isLogo(e) && add(e, 'logo'));
    document.querySelectorAll('h1,h2,h3').forEach((e) => add(e));
    document.querySelectorAll('a,button,[role=button]').forEach((e) => { const ro = W.role(e); if (ro === 'cta' || ro === 'menu-toggle') add(e, ro); });
    W.cards().forEach((e) => add(e, 'card'));
    document.querySelectorAll('img,picture,video').forEach((e) => { const r = e.getBoundingClientRect(); if (r.width * r.height > 25000) add(e); });
    document.querySelectorAll('[class*=swiper],[class*=slick],[class*=splide],[class*=carousel],[class*=glide],[class*=flickity],[class*=embla],[class*=slider]').forEach((e) => { if (W.role(e) === 'slider' && !e.parentElement.closest('[class*=swiper],[class*=slick],[class*=splide],[class*=carousel],[class*=glide],[class*=flickity],[class*=embla],[class*=slider]')) add(e, 'slider'); });
    document.querySelectorAll('[class*=review],[class*=testimonial],[class*=rating],[class*=badge],[class*=sticker],[class*=usp]').forEach((e) => { const r = e.getBoundingClientRect(); if (r.width * r.height < 300000) add(e); });
    document.querySelectorAll('[class*=price],[class*=prijs]').forEach((e) => add(e, 'price'));
    document.querySelectorAll('nav,[role=navigation]').forEach((e) => add(e, 'nav'));
    // elementen met eigen animatie
    try { document.getAnimations().slice(0, 60).forEach((a) => { const t = a.effect && a.effect.target; if (t && t.nodeType === 1) add(t); }); } catch (e) {}
    return list;
  };

  W.sections = () => {
    const VW = vw(), VH = vh();
    const out = [];
    const walk = (el, depth) => {
      for (const c of el.children) {
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK', 'TEMPLATE'].includes(c.tagName)) continue;
        const s = getComputedStyle(c);
        if (s.display === 'none' || s.position === 'fixed') continue;
        const r = W.abs(c);
        if (r.w < VW * 0.8 || r.h < 160) continue;
        const bigKids = [...c.children].filter((k) => {
          const ks = getComputedStyle(k);
          if (ks.position === 'absolute' || ks.position === 'fixed' || ks.display === 'none') return false;
          const kr = W.abs(k);
          return kr.w >= VW * 0.8 && kr.h >= 160;
        });
        const wrapper = bigKids.length === 1 && W.abs(bigKids[0]).h > r.h * 0.85;
        if (depth < 9 && (wrapper || (r.h > VH * 1.5 && bigKids.length >= 2))) walk(c, depth + 1);
        else out.push(c);
      }
    };
    walk(document.body, 0);
    return out.filter((s, i) => !out.some((o, j) => j !== i && o.contains(s))).sort((a, b) => W.abs(a).y - W.abs(b).y);
  };

  W.sectionInfo = (sec) => {
    const r = W.abs(sec);
    const sig = W.sig(sec);
    const imgs = [...sec.querySelectorAll('img,picture,video')].filter(W.visible);
    let imgArea = 0;
    imgs.forEach((i) => { const ir = i.getBoundingClientRect(); imgArea += ir.width * ir.height; });
    [sec, ...sec.querySelectorAll('div,section,figure')].slice(0, 200).forEach((d) => { if (getComputedStyle(d).backgroundImage.includes('url(')) { const dr = d.getBoundingClientRect(); imgArea += dr.width * dr.height * 0.8; } });
    const imgRatio = Math.min(1, imgArea / Math.max(1, r.w * r.h));
    const h1 = sec.querySelector('h1'), h = sec.querySelector('h1,h2,h3');
    const ctas = [...sec.querySelectorAll('a,button')].filter((a) => W.visible(a) && W.role(a) === 'cta').length;
    const cards = W.cards().filter((c) => sec.contains(c)).length;
    const slider = !!sec.querySelector('[class*=swiper],[class*=slick],[class*=splide],[class*=carousel],[class*=glide],[class*=flickity],[class*=embla],[class*=slider]');
    const video = !!sec.querySelector('video');
    const review = /review|testimonial|rating|kiyoh|trustpilot/.test(sig + ' ' + [...sec.querySelectorAll('[class]')].slice(0, 80).map(W.cls).join(' ').toLowerCase());
    const footer = sec.tagName === 'FOOTER' || /footer/.test(sig) || r.y + r.h > document.documentElement.scrollHeight - 50;
    const form = sec.querySelectorAll('input,textarea,select').length > 2;
    const chars = (sec.innerText || '').length;
    const textDensity = chars / Math.max(1, (r.w * r.h) / 10000);
    let anim = 0;
    try { anim = document.getAnimations().filter((a) => a.effect && a.effect.target && sec.contains(a.effect.target)).length; } catch (e) {}
    const bgc = getComputedStyle(sec).backgroundColor;
    let score = imgRatio * 40 + (h1 ? 15 : h ? 8 : 0) + Math.min(2, ctas) * 6 + (cards >= 3 ? 15 : cards * 3) + (slider ? 14 : 0) + (video ? 12 : 0) + (review ? 8 : 0) + Math.min(15, anim * 3);
    if (r.y < 150) score += 20;
    if (footer) score -= 35;
    if (form) score -= 10;
    if (textDensity > 12) score -= 12;
    if (r.h < 260) score -= 10;
    const kind = r.y < 150 ? 'hero' : slider ? 'slider' : review ? 'social-proof' : cards >= 3 ? 'cards/producten' : video ? 'video' : imgRatio > 0.45 ? 'beeld' : footer ? 'footer' : form ? 'formulier' : 'content';
    return { selector: W.path(sec), rect: r, heading: h ? W.text(h, 90) : '', kind, score: Math.round(score), imgRatio: +imgRatio.toFixed(2), ctas, cards, slider, video, review, footer, bg: bgc };
  };

  W.headerHeight = () => {
    let hh = 0;
    document.querySelectorAll('header, nav, [class*=header], [class*=navbar]').forEach((e) => {
      const s = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      if ((s.position === 'fixed' || s.position === 'sticky') && r.top <= 5 && r.width > innerWidth * 0.6 && r.height < 220) hh = Math.max(hh, r.bottom);
    });
    return Math.round(hh);
  };

  // ---------- Hover / klik kandidaten ----------
  W.hoverCandidates = () => {
    const c = new Set();
    document.querySelectorAll('a,button,[role=button]').forEach((e) => { const ro = W.role(e); if (['cta', 'nav-link', 'menu-toggle'].includes(ro)) c.add(e); });
    W.cards().forEach((e) => c.add(e.querySelector('a') && e.querySelector('a').getBoundingClientRect().width > e.getBoundingClientRect().width * 0.8 ? e.querySelector('a') : e));
    document.querySelectorAll('nav li, header li').forEach((li) => { if (li.querySelector('ul,[class*=sub],[class*=dropdown],[class*=mega]')) c.add(li.querySelector('a,button') || li); });
    document.querySelectorAll('[class*=card],[class*=tile],[class*=product-item],[class*=project],figure').forEach((e) => { const r = e.getBoundingClientRect(); if (r.width > 150 && r.height > 150 && r.width < innerWidth * 0.7) c.add(e); });
    return [...c].filter(W.visible).map((e) => ({ selector: W.path(e), role: W.role(e) === 'block' ? 'card' : W.role(e), text: W.text(e, 50), rect: W.abs(e), motion: W.motionDecl(e) }));
  };
  const DANGER = /winkelwagen|winkelmand|cart|bestel|in mijn|koop nu|checkout|afrekenen|betalen|login|inloggen|log in|account|uitloggen|verwijder|delete|verstuur|verzend|submit|aanmelden|inschrijven|subscribe|registreer|offerte aanvragen|bel ons|whatsapp|mailto|tel:/i;
  W.clickCandidates = () => {
    const c = new Map();
    const add = (e, kind) => { if (e && W.visible(e) && !c.has(e)) c.set(e, kind); };
    document.querySelectorAll('button,a,[role=button],[role=tab],summary,[aria-expanded],[aria-controls],[aria-haspopup]').forEach((e) => {
      const sig = W.sig(e);
      const txt = W.text(e);
      const href = e.getAttribute('href');
      if (DANGER.test(txt + ' ' + (href || ''))) return;
      if (e.getAttribute('type') === 'submit' || e.closest('form')) return;
      const nav = href && !href.startsWith('#') && !href.startsWith('javascript') && href !== '';
      const ro = W.role(e);
      if (ro === 'menu-toggle') return add(e, 'menu');
      if (e.getAttribute('role') === 'tab') return add(e, 'tab');
      if (e.tagName === 'SUMMARY') return add(e, 'accordion');
      if (/next|prev|volgende|vorige|arrow|pijl/.test(sig) && e.closest('[class*=swiper],[class*=slick],[class*=splide],[class*=carousel],[class*=glide],[class*=flickity],[class*=embla],[class*=slider]')) return add(e, 'slider');
      if (/next|volgende/.test(sig) && e.getBoundingClientRect().width < 120) return add(e, 'slider');
      if (e.hasAttribute('aria-expanded') || e.hasAttribute('aria-haspopup')) return add(e, e.closest('nav,header') ? 'dropdown' : 'accordion');
      if (/accordion|faq|collapse|toggle/.test(sig) && !nav) return add(e, 'accordion');
      if (/search|zoek/.test(sig) && !nav && e.closest('header')) return add(e, 'search');
      if (e.hasAttribute('aria-controls') && !nav) return add(e, 'panel');
    });
    const out = [...c.entries()].map(([e, kind]) => ({ selector: W.path(e), kind, text: W.text(e, 50), rect: W.abs(e) }));
    const prio = { menu: 0, dropdown: 1, slider: 2, tab: 3, search: 4, panel: 5, accordion: 6 };
    return out.sort((a, b) => prio[a.kind] - prio[b.kind]);
  };

  // Elementen die bij een klik kunnen verschijnen: pool voor motion-tracking
  W.revealPool = (targetSel) => {
    document.querySelectorAll('[data-wmc-pool]').forEach((e) => e.removeAttribute('data-wmc-pool'));
    const pool = new Set();
    const t = W.q(targetSel);
    if (t) {
      (t.getAttribute('aria-controls') || '').split(' ').forEach((id) => { const e = id && document.getElementById(id); if (e) pool.add(e); });
      if (t.nextElementSibling) pool.add(t.nextElementSibling);
      if (t.parentElement && t.parentElement.nextElementSibling) pool.add(t.parentElement.nextElementSibling);
      const sl = t.parentElement && t.parentElement.closest('[class*=swiper],[class*=slick],[class*=splide],[class*=carousel],[class*=glide],[class*=flickity],[class*=embla],[class*=slider]');
      if (sl) sl.querySelectorAll('[class*=wrapper],[class*=track],[class*=list],[class*=container],[class*=slide]').forEach((e, i) => i < 30 && pool.add(e));
    }
    document.querySelectorAll('nav, [class*=menu], [class*=drawer], [class*=offcanvas], [class*=off-canvas], [class*=overlay], [class*=modal], [role=dialog], dialog, [class*=dropdown], [class*=submenu], [class*=sub-menu], [class*=mega], [class*=panel], [class*=collapse], [class*=search]').forEach((e, i) => i < 180 && pool.add(e));
    const arr = [...pool];
    arr.forEach((e, i) => e.setAttribute('data-wmc-pool', i));
    return arr.length;
  };
  W.poolState = () => {
    const o = {};
    document.querySelectorAll('[data-wmc-pool]').forEach((e) => {
      const s = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      o[e.getAttribute('data-wmc-pool')] = { v: W.visible(e) ? 1 : 0, o: +parseFloat(s.opacity).toFixed(3), t: s.transform, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), cp: s.clipPath };
    });
    return o;
  };
  W.startTrack = () => {
    W._track = [];
    const t0 = performance.now();
    const tick = () => {
      if (!W._track) return;
      W._track.push({ t: Math.round(performance.now() - t0), s: W.poolState() });
      if (performance.now() - t0 < 2200) W._trackTimer = setTimeout(tick, 40);
    };
    tick();
  };
  W.stopTrack = () => {
    clearTimeout(W._trackTimer);
    const tr = W._track || [];
    W._track = null;
    if (tr.length < 2) return [];
    const first = tr[0].s, last = tr[tr.length - 1].s;
    const res = [];
    for (const id of Object.keys(last)) {
      const a = first[id], b = last[id];
      if (!a || !b) continue;
      const changed = a.v !== b.v || Math.abs(a.o - b.o) > 0.05 || a.t !== b.t || Math.abs(a.x - b.x) > 3 || Math.abs(a.y - b.y) > 3 || Math.abs(a.w - b.w) > 3 || Math.abs(a.h - b.h) > 3 || a.cp !== b.cp;
      if (!changed) continue;
      let tStart = null, tEnd = null;
      for (let i = 1; i < tr.length; i++) {
        const p = tr[i - 1].s[id], q = tr[i].s[id];
        if (!p || !q) continue;
        const diff = p.v !== q.v || Math.abs(p.o - q.o) > 0.01 || p.t !== q.t || Math.abs(p.x - q.x) > 1 || Math.abs(p.y - q.y) > 1 || Math.abs(p.w - q.w) > 1 || Math.abs(p.h - q.h) > 1 || p.cp !== q.cp;
        if (diff) { if (tStart === null) tStart = tr[i - 1].t; tEnd = tr[i].t; }
      }
      const el = document.querySelector('[data-wmc-pool="' + id + '"]');
      if (!el) continue;
      res.push({
        selector: W.path(el), tag: el.tagName.toLowerCase(), cls: W.cls(el).slice(0, 80), role: W.role(el),
        visible: [a.v, b.v], opacity: [a.o, b.o], transform: [a.t, b.t], dx: b.x - a.x, dy: b.y - a.y, size: [a.w + 'x' + a.h, b.w + 'x' + b.h],
        clip: a.cp !== b.cp ? [a.cp, b.cp] : undefined,
        start_ms: tStart, measured_duration_ms: tStart !== null ? tEnd - tStart : null,
        area_after: b.w * b.h, declared: W.motionDecl(el),
      });
    }
    return res.sort((x, y) => y.area_after - x.area_after).slice(0, 6);
  };

  // ---------- Scroll reveal ----------
  W.revealInit = () => {
    W._rev = [];
    const els = document.querySelectorAll('h1,h2,h3,p,img,picture,a,button,figure,li,[class*=card],[class*=aos],[data-aos],[class*=reveal],[class*=fade],[class*=animate],[class*=wow],[data-scroll],[class*=gsap],section > div');
    let n = 0;
    for (const e of els) {
      if (n > 500) break;
      const r = e.getBoundingClientRect();
      if (r.top + scrollY < innerHeight * 1.05 || r.width < 20 || r.height < 12) continue;
      const s = getComputedStyle(e);
      if (s.display === 'none') continue;
      e.setAttribute('data-wmc-rev', n);
      W._rev.push({ id: n, o: parseFloat(s.opacity), t: s.transform, f: s.filter, cp: s.clipPath, c: W.cls(e), entered: null, done: false });
      n++;
    }
    return n;
  };
  W.revealCheck = (final) => {
    const found = [];
    const now = performance.now();
    for (const it of W._rev || []) {
      if (it.done) continue;
      const e = document.querySelector('[data-wmc-rev="' + it.id + '"]');
      if (!e) { it.done = true; continue; }
      const r = e.getBoundingClientRect();
      const inv = r.top < innerHeight * 0.9 && r.bottom > 0;
      if (inv && it.entered === null) it.entered = now;
      if (it.entered !== null && (now - it.entered > 1100 || final)) {
        it.done = true;
        const s = getComputedStyle(e);
        const o2 = parseFloat(s.opacity);
        const ch = [];
        if (it.o < 0.6 && o2 - it.o > 0.3) ch.push({ prop: 'opacity', from: it.o, to: o2 });
        if (it.t !== s.transform && it.t !== 'none') ch.push({ prop: 'transform', from: it.t, to: s.transform });
        if (it.f !== s.filter && it.f !== 'none') ch.push({ prop: 'filter', from: it.f, to: s.filter });
        if (it.cp !== s.clipPath && it.cp !== 'none') ch.push({ prop: 'clip-path', from: it.cp, to: s.clipPath });
        if (ch.length) {
          const c2 = W.cls(e);
          const added = c2.split(/\s+/).filter((x) => x && !it.c.split(/\s+/).includes(x));
          found.push({ selector: W.path(e), tag: e.tagName.toLowerCase(), role: W.role(e), text: W.text(e, 50), rect: W.abs(e), changes: ch, classes_added: added, declared: W.motionDecl(e), lib: /aos/.test(it.c + c2 + (e.getAttribute('data-aos') ? ' aos' : '')) ? 'AOS' : /wow/.test(it.c) ? 'WOW.js' : /gsap|split/.test(it.c) ? 'GSAP?' : null });
        }
      }
    }
    return found;
  };

  // ---------- Parallax ----------
  W.parallaxTargets = (secSel) => {
    const sec = W.q(secSel);
    if (!sec) return [];
    document.querySelectorAll('[data-wmc-px]').forEach((e) => e.removeAttribute('data-wmc-px'));
    const set = new Set();
    sec.querySelectorAll('img,picture,video,h1,h2,[data-speed],[data-parallax],[data-scroll],[data-scroll-speed],[class*=parallax],[class*=bg],[class*=background]').forEach((e) => set.add(e));
    [...sec.children].forEach((e) => set.add(e));
    [sec, ...sec.querySelectorAll('div,figure')].slice(0, 150).forEach((d) => { const s = getComputedStyle(d); if (s.backgroundImage.includes('url(') || s.backgroundAttachment === 'fixed' || s.position === 'sticky') set.add(d); });
    const arr = [...set].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 60 && r.height > 40; }).slice(0, 30);
    arr.forEach((e, i) => e.setAttribute('data-wmc-px', i));
    return arr.length;
  };
  W.parallaxSample = () => {
    const o = {};
    document.querySelectorAll('[data-wmc-px]').forEach((e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      o[e.getAttribute('data-wmc-px')] = { y: r.top, x: r.left, t: s.transform, o: parseFloat(s.opacity), bp: s.backgroundPosition, ba: s.backgroundAttachment, pos: s.position };
    });
    return { sy: scrollY, o };
  };
  W.pxDescribe = (id) => {
    const e = document.querySelector('[data-wmc-px="' + id + '"]');
    return e ? { selector: W.path(e), tag: e.tagName.toLowerCase(), role: W.role(e), cls: W.cls(e).slice(0, 80), text: W.text(e, 40), attrs: ['data-speed', 'data-parallax', 'data-scroll-speed'].filter((a) => e.hasAttribute(a)).map((a) => a + '=' + e.getAttribute(a)) } : null;
  };

  // ---------- Sliders ----------
  W.sliders = () => {
    const out = [];
    const sl = [...document.querySelectorAll('[class*=swiper],[class*=slick],[class*=splide],[class*=carousel],[class*=glide],[class*=flickity],[class*=embla],[class*=keen],[class*=slider]')].filter((e) => W.visible(e) && e.getBoundingClientRect().width > 250 && e.getBoundingClientRect().height > 120);
    const roots = sl.filter((e) => !sl.some((o) => o !== e && o.contains(e)));
    roots.slice(0, 6).forEach((root) => {
      const track = root.querySelector('[class*=wrapper],[class*=track],[class*=list],[class*=container]') || root.firstElementChild;
      const arrows = [...root.querySelectorAll('button,a,[role=button],[class*=next],[class*=prev],[class*=arrow]')].filter((b) => /next|volgende|arrow|pijl|right/.test(W.sig(b)) && W.visible(b));
      out.push({ selector: W.path(root), track: track ? W.path(track) : null, rect: W.abs(root), next: arrows[0] ? W.path(arrows[0]) : null, slides: root.querySelectorAll('[class*=slide]').length, declared: track ? W.motionDecl(track) : null });
    });
    return out;
  };
  W.trackState = (sel) => {
    const e = W.q(sel);
    if (!e) return null;
    const s = getComputedStyle(e);
    const act = e.querySelector('[class*=active],[class*=current],[aria-current=true]');
    return s.transform + '|' + e.scrollLeft + '|' + (act ? W.path(act) : '') + '|' + (e.firstElementChild ? Math.round(e.firstElementChild.getBoundingClientRect().left) : '');
  };

  // ---------- Links voor extra pagina's ----------
  W.links = () => {
    const o = location.origin;
    const res = new Map();
    document.querySelectorAll('a[href]').forEach((a) => {
      let u;
      try { u = new URL(a.getAttribute('href'), location.href); } catch (e) { return; }
      if (u.origin !== o) return;
      u.hash = '';
      const k = u.href.replace(/\/$/, '');
      if (k === location.href.replace(/#.*$/, '').replace(/\/$/, '')) return;
      if (/\.(pdf|jpg|jpeg|png|zip|docx?|xlsx?)$/i.test(u.pathname)) return;
      const inNav = !!a.closest('nav,header,[role=navigation]');
      const hasImg = !!a.querySelector('img');
      const prev = res.get(k) || { url: u.href, text: '', nav: false, img: false, count: 0 };
      prev.count++;
      prev.nav = prev.nav || inNav;
      prev.img = prev.img || hasImg;
      if (!prev.text) prev.text = W.text(a, 40);
      res.set(k, prev);
    });
    return [...res.values()];
  };

  // ---------- Key features: USP's, aanbod, cijfers, reviews, prijzen ----------
  W.features = () => {
    const KW = [
      ['offer', /gratis|korting|actie|sale|aanbieding|voordeel|nu\s|%|vanaf|free|off\b|deal/i, 22],
      ['trust', /garantie|review|beoordeling|klantwaardering|★|sterren|keurmerk|certific|award|winnaar|beste|nr\.?\s?1|trustpilot|kiyoh|google/i, 24],
      ['service', /bezorg|levering|verzend|montage|installatie|showroom|advies|op maat|binnen \d|dagen|werkdag|24\/7|service|gelegd|legservice/i, 16],
      ['stat', /\d{2,}(\.\d{3})*\+?|\d+[,.]\d\s*(\/\s*10)?|\d+\s*(jaar|klanten|projecten|vloeren|m²|m2)/i, 18],
      ['price', /€\s?\d|\d+,\d{2}|\d+,-/, 14],
    ];
    const seen = new Set();
    const out = [];
    const cand = document.querySelectorAll('h1,h2,h3,h4,p,li,span,strong,b,a,button,div,dt,dd,figcaption,small');
    for (const e of cand) {
      if (!W.visible(e)) continue;
      const txt = (e.innerText || '').replace(/\s+/g, ' ').trim();
      if (txt.length < 2 || txt.length > 90) continue;
      // alleen "blad"-achtige tekstelementen (geen grote containers)
      if (e.children.length > 4) continue;
      const r = e.getBoundingClientRect();
      if (r.width < 20 || r.height < 12 || r.width > innerWidth * 0.7) continue;
      const s = getComputedStyle(e);
      const fs = parseFloat(s.fontSize), fw = parseInt(s.fontWeight) || 400;
      let best = null;
      for (const [kind, re, w] of KW) if (re.test(txt)) { if (!best || w > best.w) best = { kind, w }; }
      if (best && /€/.test(txt) && txt.length < 30) best = { kind: 'price', w: 26 };
      if (best && best.kind === 'stat' && !/\d{2,}(\.\d{3})+|\d+\+|\d+[,.]\d|\d+\s*(jaar|klanten|projecten|vloeren|m²|m2|%)/i.test(txt.replace(/\b(19|20)\d{2}\b/g, '')) && !/^\d{1,4}$/.test(txt.trim())) continue; // jaartallen zijn geen cijfer-USP
      if (!best) continue;
      let score = best.w + Math.min(30, fs * 0.6) + (fw >= 600 ? 6 : 0);
      if (e.closest('footer,nav,[class*=cookie],[class*=footer]')) score -= 40;
      if (/^h[2-3]$/i.test(e.tagName)) score += 6;
      if (e.tagName === 'H1' || e.closest('h1')) score -= 35; // de hero-kop heeft al een eigen shot
      const upper = txt === txt.toUpperCase() && /[A-Z]/.test(txt) && parseFloat(s.letterSpacing) > 1;
      if (upper && best.kind !== 'offer') score -= 10; // eyebrow-tekstjes
      if (best.kind === 'trust' && /\d/.test(txt)) score += 12; // 9,4 · 312 beoordelingen
      if (best.kind === 'price' && e.closest('[class*=card],[class*=product],article,li')) score += 10;
      if (/\d/.test(txt) && fs >= 28) score += 8;
      const top = r.top + scrollY;
      if (top < innerHeight) score += 4;
      if (fs >= 32 && best.kind === 'stat') score += 14;
      const key = txt.toLowerCase().slice(0, 40);
      if (seen.has(key)) continue;
      seen.add(key);
      // groep: dichtstbijzijnde compacte ouder (bijv. USP-item met icoon, stat met label, review-kaart).
      // Nooit de hele rij: staat een ouder vol met gelijke broertjes (3 stats naast elkaar), dan is het item eronder de groep.
      let g = e;
      const isRow = (p) => { const ch = [...p.children].filter((c) => W.visible(c)); if (ch.length < 3 || ch.length > 8) return false; const r0 = ch[0].getBoundingClientRect(); return ch.filter((c) => { const cr = c.getBoundingClientRect(); return c.tagName === ch[0].tagName && Math.abs(cr.height - r0.height) < Math.max(20, r0.height * 0.4) && Math.abs(cr.width - r0.width) < Math.max(30, r0.width * 0.5); }).length >= 3; };
      if (isRow(e)) continue; // een rij gelijke blokken is een groep (featureGroups), geen losse feature
      for (let p = e.parentElement, i = 0; p && i < 4; p = p.parentElement, i++) {
        const pr = p.getBoundingClientRect();
        if (pr.width > innerWidth * 0.62 || pr.height > innerHeight * 0.55) break;
        if (isRow(p)) break;
        if (pr.width >= r.width && pr.height >= r.height) g = p;
        if (/card|item|usp|stat|feature|review|badge|benefit|price/i.test(W.cls(p))) { g = p; break; }
      }
      // tekst van het hele item (getal + label: "37 jaar vakmanschap"), dubbele stukken uit lopende teksten eruit
      let ftxt = txt;
      if (g !== e) { const gt = (g.innerText || '').replace(/\s+/g, ' ').trim(); if (gt.length >= txt.length && gt.length <= 110) ftxt = gt; }
      { const parts = ftxt.split(/\s*[·|•]\s*/), sp = new Set(); const u = parts.filter((p) => { const k = p.toLowerCase().trim(); if (!k || sp.has(k)) return false; sp.add(k); return true; }); if (u.length < parts.length) ftxt = u.join(' · '); }
      if (/^\d{1,4}$/.test(ftxt.trim())) continue; // een los getal zonder label zegt niets
      // visuele opvallendheid van het blok: eigen achtergrond/rand/schaduw, icoon erbij, rij van gelijke broertjes
      if (g !== e) {
        const gs = getComputedStyle(g);
        const bg = gs.backgroundColor, hasBg = bg && !/rgba?\(0, 0, 0, 0\)|transparent/.test(bg);
        if (hasBg || parseFloat(gs.borderRadius) > 6 || (gs.boxShadow && gs.boxShadow !== 'none') || parseFloat(gs.borderWidth) > 0) score += 8;
        if (g.querySelector('svg,img,i[class*=icon],[class*=icon]')) score += 6;
        const sib = g.parentElement ? [...g.parentElement.children].filter((c) => c !== g && c.tagName === g.tagName && Math.abs(c.getBoundingClientRect().width - g.getBoundingClientRect().width) < 30) : [];
        if (sib.length >= 2) score += 8;
      }
      out.push({ el: g, text: ftxt, kind: best.kind, score: Math.round(score), fs });
    }
    // dubbele groepen samenvoegen, variatie in soorten
    const byEl = new Map();
    out.forEach((o) => { const k = byEl.get(o.el); if (!k || o.score > k.score) byEl.set(o.el, o); });
    const list = [...byEl.values()].filter((o) => ![...byEl.values()].some((x) => x !== o && x.el.contains(o.el) && x.score >= o.score));
    list.sort((a, b) => b.score - a.score);
    // eerst van elke soort de beste (variatie), dan aanvullen tot 6
    const picked = [], perKind = {};
    for (const pass of [1, 2]) {
      for (const o of list) {
        if (picked.includes(o) || o.score < 30) continue;
        if (picked.some((x) => x.el.contains(o.el) || o.el.contains(x.el))) continue;
        if ((perKind[o.kind] || 0) >= pass) continue;
        picked.push(o); perKind[o.kind] = (perKind[o.kind] || 0) + 1;
        if (picked.length >= 6) break;
      }
    }
    picked.sort((a, b) => b.score - a.score);
    return picked.map((o) => ({ selector: W.path(o.el), text: o.text, kind: o.kind, score: o.score, rect: W.abs(o.el) }));
  };

  // ---------- Feature-groepen: rij/grid van 3-6 gelijke blokken (USP's, cijfers, reviews, kaarten) ----------
  W.featureGroups = () => {
    const KW = /gratis|korting|garantie|review|beoordel|★|sterren|bezorg|levering|montage|advies|op maat|showroom|service|\d+\+|\d+[,.]\d|€\s?\d|\d+\s*(jaar|klanten|projecten|%)/i;
    const res = [];
    for (const c of document.querySelectorAll('ul,ol,div,section')) {
      if (!W.visible(c) || c.closest('nav,footer,header,[class*=cookie],[class*=menu],[class*=footer]')) continue;
      const kids = [...c.children].filter((k) => W.visible(k) && k.getBoundingClientRect().width > 60 && k.getBoundingClientRect().height > 30);
      if (kids.length < 3 || kids.length > 6) continue;
      const rs = kids.map((k) => k.getBoundingClientRect());
      const w0 = rs[0].width, h0 = rs[0].height;
      if (!rs.every((r) => Math.abs(r.width - w0) < w0 * 0.2 && Math.abs(r.height - h0) < Math.max(40, h0 * 0.35))) continue;
      if (!kids.every((k) => k.tagName === kids[0].tagName)) continue;
      const cr = c.getBoundingClientRect();
      if (cr.height > innerHeight * 0.95 || cr.width < innerWidth * 0.2) continue;
      const texts = kids.map((k) => (k.innerText || '').replace(/\s+/g, ' ').trim());
      if (texts.some((t) => t.length < 2 || t.length > 220)) continue;
      const hits = texts.filter((t) => KW.test(t)).length;
      const icons = kids.filter((k) => k.querySelector('svg,img,[class*=icon]')).length;
      const rowish = rs.filter((r) => Math.abs(r.top - rs[0].top) < 24).length;
      const cardish = kids.filter((k) => { const g = getComputedStyle(k); return (g.backgroundColor && !/rgba?\(0, 0, 0, 0\)/.test(g.backgroundColor)) || parseFloat(g.borderRadius) > 6 || g.boxShadow !== 'none'; }).length;
      let score = hits * 10 + icons * 4 + cardish * 3 + (rowish >= 3 ? 8 : 0) - (c.closest('h1') ? 50 : 0);
      if (score < 18) continue;
      const kind = texts.filter((t) => /\d/.test(t)).length >= kids.length * 0.66 && texts.every((t) => t.length < 60) ? 'stats' : kids.filter((k) => k.querySelector('img') || [...k.querySelectorAll('*')].some((d) => /url\(/.test(getComputedStyle(d).backgroundImage))).length >= 2 ? 'cards' : /review|★|sterren/i.test(texts.join(' ')) ? 'reviews' : 'usp';
      res.push({ el: c, kids, score, kind, texts });
    }
    // geen geneste dubbelen: de beste per boom
    const keep = res.filter((g) => !res.some((o) => o !== g && o.score >= g.score && (o.el.contains(g.el) || g.el.contains(o.el))));
    keep.sort((a, b) => b.score - a.score);
    return keep.slice(0, 3).map((g) => ({ selector: W.path(g.el), items: g.kids.map((k) => W.path(k)), kind: g.kind, score: g.score, texts: g.texts.map((t) => t.slice(0, 60)), rect: W.abs(g.el) }));
  };

  // ---------- Overlays: tags en cursor ----------
  W.drawTags = (tags) => {
    W.clearTags();
    const layer = document.createElement('div');
    layer.id = '__wmc_tags';
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;font:600 15px/1 -apple-system,Helvetica,Arial,sans-serif';
    const colors = ['#ff2d95', '#00d1ff', '#ffd400', '#7cff4f', '#ff7a00', '#b18cff'];
    tags.forEach((t, i) => {
      const c = colors[i % colors.length];
      const b = document.createElement('div');
      b.style.cssText = `position:absolute;left:${t.x}px;top:${t.y}px;width:${t.w}px;height:${t.h}px;border:3px solid ${c};border-radius:4px;box-shadow:0 0 0 1px rgba(0,0,0,.5)`;
      const l = document.createElement('div');
      l.textContent = t.label;
      const ly = t.y > 26 ? -26 : 2;
      l.style.cssText = `position:absolute;left:-3px;top:${ly}px;background:${c};color:#000;padding:5px 7px;border-radius:3px;white-space:nowrap`;
      b.appendChild(l);
      layer.appendChild(b);
    });
    document.body.appendChild(layer);
  };
  W.clearTags = () => { const l = document.getElementById('__wmc_tags'); if (l) l.remove(); };

  W.cursorInstall = () => {
    if (document.getElementById('__wmc_cursor')) return;
    const c = document.createElement('div');
    c.id = '__wmc_cursor';
    c.style.cssText = 'position:fixed;left:0;top:0;width:30px;height:30px;pointer-events:none;z-index:2147483647;transform:translate(-9999px,-9999px);will-change:transform';
    c.innerHTML = '<div id="__wmc_cur_in" style="transform-origin:4px 3px;transition:transform .09s ease-out"><svg width="30" height="30" viewBox="0 0 30 30"><path d="M4 3 L4 24 L9.6 18.8 L13.4 27.2 L17 25.6 L13.3 17.4 L20.8 17.4 Z" fill="#111" stroke="#fff" stroke-width="1.8" stroke-linejoin="round" style="filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))"/></svg></div>';
    document.documentElement.appendChild(c);
  };
  W.cursorTo = (x, y) => { const c = document.getElementById('__wmc_cursor'); if (c) c.style.transform = `translate(${x - 4}px,${y - 3}px)`; };
  W.cursorPress = (down) => {
    const i = document.getElementById('__wmc_cur_in');
    if (i) i.style.transform = down ? 'scale(.82)' : 'scale(1)';
    if (!down) return;
    const c = document.getElementById('__wmc_cursor');
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(c.style.transform);
    if (!m) return;
    const r = document.createElement('div');
    r.style.cssText = `position:fixed;left:${+m[1] + 4 - 18}px;top:${+m[2] + 3 - 18}px;width:36px;height:36px;border-radius:50%;border:2px solid rgba(255,255,255,.95);box-shadow:0 0 0 1px rgba(0,0,0,.25);pointer-events:none;z-index:2147483646;transition:transform .45s cubic-bezier(.2,.7,.3,1),opacity .45s ease-out;transform:scale(.3);opacity:1`;
    document.documentElement.appendChild(r);
    requestAnimationFrame(() => requestAnimationFrame(() => { r.style.transform = 'scale(1.5)'; r.style.opacity = '0'; }));
    setTimeout(() => r.remove(), 600);
  };
  W.cursorHide = () => { const c = document.getElementById('__wmc_cursor'); if (c) c.remove(); };

  window.__wmc = W;
  return true;
}

module.exports = { installHelpers };
