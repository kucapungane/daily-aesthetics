// 每日美學課程: entrances, the deck of leaves, the practice timer, the index preview, the drifting photograph.
(() => {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // the web fonts load as a print sheet so they never hold up the first paint; switch them on now
  for (const l of document.querySelectorAll('link[data-webfonts]')) l.media = 'all';

  // entrances: the parts of each section arrive in turn, once, as it enters
  const reveal = [...document.querySelectorAll('[data-reveal]')];
  const show = (el) => el.classList.add('is-in');
  if (still || !('IntersectionObserver' in window)) reveal.forEach(show);
  else {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const parent = e.target.parentElement;
        const sibs = [...parent.querySelectorAll(':scope > [data-reveal]')];
        e.target.style.setProperty('--delay', `${Math.max(0, sibs.indexOf(e.target)) * 80}ms`);
        show(e.target); io.unobserve(e.target);
      }
    }, { rootMargin: '0px 0px -8% 0px' });
    reveal.forEach((el) => io.observe(el));
    // nothing stays hidden if the observer never fires (print, odd embeds)
    setTimeout(() => reveal.forEach(show), 4000);
  }

  // the deck: a spine opens its leaf and folds the open one back
  for (const deck of document.querySelectorAll('[data-deck]')) {
    deck.addEventListener('click', (ev) => {
      const spine = ev.target.closest('[data-spine]'); if (!spine) return;
      for (const c of deck.querySelectorAll('[data-card]')) { c.classList.remove('is-open'); c.querySelector('[data-spine]')?.setAttribute('aria-expanded', 'false'); }
      const card = spine.closest('[data-card]'); card.classList.add('is-open'); spine.setAttribute('aria-expanded', 'true');
      card.querySelector('.deck-face a')?.focus({ preventScroll: true });
    });
  }

  // the practice timer: 看, 做, 回顧, one after the other
  for (const box of document.querySelectorAll('[data-practice]')) {
    const steps = [...box.querySelectorAll('[data-step]')];
    let timer = null, active = null;
    const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const stop = () => { clearInterval(timer); timer = null; };
    const label = (step, text) => { const b = step.querySelector('[data-go]'); b.textContent = text; };
    steps.forEach((step, i) => {
      const total = Number(step.dataset.seconds); let left = total;
      const clock = step.querySelector('[data-clock]'); const go = step.querySelector('[data-go]');
      go.hidden = false;
      step.reset = () => { left = total; clock.textContent = fmt(left); step.classList.remove('is-running', 'is-done'); label(step, '開始'); };
      go.addEventListener('click', () => {
        if (active === step && timer) { stop(); step.classList.remove('is-running'); label(step, '繼續'); return; }
        if (active && active !== step) { stop(); active.classList.remove('is-running'); if (!active.classList.contains('is-done')) label(active, '繼續'); }
        if (step.classList.contains('is-done')) step.reset();
        active = step; step.classList.add('is-running'); label(step, '暫停');
        timer = setInterval(() => {
          left -= 1; clock.textContent = fmt(Math.max(0, left));
          if (left > 0) return;
          stop(); step.classList.remove('is-running'); step.classList.add('is-done'); label(step, '再做一次');
          navigator.vibrate?.([200, 100, 200]);
          const next = steps[i + 1];
          if (next) { next.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' }); next.querySelector('[data-go]').focus({ preventScroll: true }); }
        }, 1000);
      });
    });
  }

  // the index: pointing at a row shows its first picture in the frame
  for (const index of document.querySelectorAll('[data-index]')) {
    const frame = index.querySelector('.index-frame'); const img = frame?.querySelector('img');
    if (!img) continue;
    const point = (row) => { const src = row?.dataset.preview; if (!src) return; if (img.getAttribute('src') !== src) img.src = src; frame.classList.add('is-showing'); };
    index.addEventListener('pointerover', (ev) => point(ev.target.closest('.index-row')));
    index.addEventListener('focusin', (ev) => point(ev.target.closest('.index-row')));
    index.addEventListener('pointerleave', () => frame.classList.remove('is-showing'));
    point(index.querySelector('.index-row'));
  }

  // the film loops silently, and downloads only when it comes near the screen; under reduced motion it
  // stays on its poster frame and never downloads
  for (const v of document.querySelectorAll('video[data-film][data-src]')) {
    if (still) continue;
    const start = () => { if (!v.src) { v.src = v.dataset.src; v.load(); } v.play().catch(() => {}); };
    if (!('IntersectionObserver' in window)) { start(); continue; }
    new IntersectionObserver((entries) => {
      for (const e of entries) { if (e.isIntersecting) start(); else if (v.src) v.pause(); }
    }, { rootMargin: '300px 0px' }).observe(v);
  }

  // the photograph behind the slips drifts with the scroll
  const photo = document.querySelector('.sources-photo');
  if (photo && !still) {
    const sec = photo.parentElement; let ticking = false;
    const update = () => {
      ticking = false;
      const r = sec.getBoundingClientRect(); const p = Math.min(1, Math.max(0, (innerHeight - r.top) / (innerHeight + r.height)));
      photo.style.setProperty('--drift', (1.14 - p * 0.1).toFixed(4));
    };
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }
})();
