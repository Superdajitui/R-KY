/* ============================================================
   任恺昱 Kerry R — 交互脚本
   零依赖，全部手写：预加载 / 滚动动效 / 光标 / 跑马灯 / 数字滚动
   ============================================================ */
(() => {
  'use strict';

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const reduce  = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTouch = window.matchMedia('(hover: none), (pointer: coarse)').matches;

  /* ---------------------------------------------------------
     1. 预加载：数字从 00 数到 100，然后揭幕
     --------------------------------------------------------- */
  const loader  = $('#loader');
  const loaderN = $('#loaderNum');
  const loaderB = $('#loaderBar');
  const DUR = reduce ? 150 : 1250;
  const t0 = performance.now();

  document.body.classList.add('is-locked');

  function finishLoad() {
    loader.classList.add('is-done');
    document.body.classList.remove('is-locked');
    document.body.classList.add('is-ready');
    // 揭幕结束后把遮罩移出渲染树，避免它继续参与合成
    loader.addEventListener('transitionend', () => loader.remove(), { once: true });
  }

  function tick(now) {
    const p = Math.min(1, (now - t0) / DUR);
    const e = 1 - Math.pow(1 - p, 3);           // easeOutCubic
    const v = Math.round(e * 100);
    loaderN.textContent = String(v).padStart(2, '0');
    loaderB.style.width = v + '%';
    p < 1 ? requestAnimationFrame(tick) : finishLoad();
  }
  requestAnimationFrame(tick);

  /* ---------------------------------------------------------
     2. 入场动画结束后交还 transform 控制权，让视差能接管
        （CSS 动画优先级高于内联样式，不清理的话视差会被压住）
     --------------------------------------------------------- */
  $$('.hero__eyebrow, .hero__word, .hero__portrait, .hero__foot').forEach(el => {
    el.addEventListener('animationend', () => {
      el.style.animation = 'none';
      el.style.opacity = '1';
    }, { once: true });
  });

  /* ---------------------------------------------------------
     3. 滚动：进度条 / 导航吸顶与隐藏 / 视差
     --------------------------------------------------------- */
  const nav      = $('#nav');
  const progress = $('#progress');
  const pEls = $$('[data-parallax]').map(el => ({
    el,
    f: parseFloat(el.dataset.parallax) || 0,
  }));

  let lastY = 0;
  let lastSweepY = 0;
  let ticking = false;

  function onScroll() {
    const y = window.scrollY;

    // 进度条
    const max = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.width = (max > 0 ? (y / max) * 100 : 0) + '%';

    // 导航：吸顶 + 向下滚动时收起
    nav.classList.toggle('is-stuck', y > 40);
    if (y > 320 && y > lastY) nav.classList.add('is-hidden');
    else nav.classList.remove('is-hidden');
    lastY = y;

    // 一次性跨过近一整屏 => 判定为锚点跳转，补一次显现清扫
    if (Math.abs(y - lastSweepY) > window.innerHeight * 0.9) revealSweep();
    lastSweepY = y;

    // 视差（只在首屏范围内计算，滚出去就停）
    if (!reduce && y < window.innerHeight * 1.15) {
      for (const { el, f } of pEls) {
        el.style.transform = `translateY(${(y * f).toFixed(2)}px)`;
      }
    }
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  }, { passive: true });
  onScroll();

  // 直接带 #hash 打开时，同样补一次
  if (location.hash) setTimeout(revealSweep, 120);

  /* ---------------------------------------------------------
     4. 滚动进场：IntersectionObserver
     --------------------------------------------------------- */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      // 同组元素错开一点形成节奏，但必须封顶 ——
      // 一批里可能有几十个元素，不封顶会累积出 2 秒以上的延迟，看起来像没渲染
      el.style.transitionDelay = Math.min(i, 4) * 80 + 'ms';
      el.classList.add('is-in');
      const counter = el.querySelector('[data-count]');
      if (counter) runCount(counter);
      io.unobserve(el);
    });
  }, { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });

  $$('[data-reveal]').forEach(el => io.observe(el));
  $$('.skills__list li').forEach(el => io.observe(el));

  /* ---------------------------------------------------------
     4b. 兜底清扫：锚点跳转（点导航直接跳到「联系」）会整段跨过
         中间版块，那些元素从未进入过视口，IntersectionObserver
         不会回调，它们就会永远停在 opacity:0。
         所以检测到「大跨度滚动」时，把已经在视口上方的元素直接放出来。
     --------------------------------------------------------- */
  function revealSweep() {
    const vh = window.innerHeight;
    const batch = (sel, extra) => {
      $$(sel).forEach(el => {
        if (el.getBoundingClientRect().top < vh) {
          el.classList.add('is-in');
          io.unobserve(el);
          if (extra) extra(el);
        }
      });
    };
    batch('[data-reveal]:not(.is-in)', el => {
      const c = el.querySelector('[data-count]');
      if (c && c.textContent === '0') runCount(c);
    });
    batch('.skills__list li:not(.is-in)');
  }

  /* ---------------------------------------------------------
     5. 数字滚动
     --------------------------------------------------------- */
  function runCount(el) {
    const target = parseFloat(el.dataset.count) || 0;
    if (reduce) { el.textContent = target; return; }
    const dur = 1400;
    const start = performance.now();
    (function step(now) {
      const p = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - p, 4);
      el.textContent = Math.round(e * target);
      if (p < 1) requestAnimationFrame(step);
    })(start);
  }

  /* ---------------------------------------------------------
     6. 自定义光标（插值跟随，不是硬跟手）
     --------------------------------------------------------- */
  const cursor = $('#cursor');
  if (cursor && !isTouch && !reduce) {
    let mx = innerWidth / 2, my = innerHeight / 2;
    let cx = mx, cy = my;

    window.addEventListener('mousemove', (e) => {
      mx = e.clientX; my = e.clientY;
      cursor.classList.add('is-on');
    }, { passive: true });

    document.addEventListener('mouseleave', () => cursor.classList.remove('is-on'));

    (function follow() {
      cx += (mx - cx) * 0.18;
      cy += (my - cy) * 0.18;
      cursor.style.transform = `translate3d(${cx.toFixed(2)}px, ${cy.toFixed(2)}px, 0)`;
      requestAnimationFrame(follow);
    })();

    // 悬停到可点元素上时放大
    document.addEventListener('mouseover', (e) => {
      const hit = e.target.closest('a, button, [data-cursor]');
      if (hit) cursor.classList.add('is-lg');
    });
    document.addEventListener('mouseout', (e) => {
      const hit = e.target.closest('a, button, [data-cursor]');
      if (hit) cursor.classList.remove('is-lg');
    });
  }

  /* ---------------------------------------------------------
     7. 导航文字乱码效果（悬停时）
     --------------------------------------------------------- */
  const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#*<>/\\';

  function scramble(el) {
    if (reduce) return;
    const target = el.dataset.orig || (el.dataset.orig = el.textContent);
    // 锁住宽度，避免中文和拉丁字符宽度差导致导航抖动
    if (!el.dataset.w) {
      el.dataset.w = '1';
      el.style.display = 'inline-block';
      el.style.width = el.getBoundingClientRect().width + 'px';
    }
    clearInterval(el._t);
    let frame = 0;
    const total = 12;
    el._t = setInterval(() => {
      frame++;
      const revealed = (frame / total) * target.length;
      el.textContent = Array.from(target).map((ch, i) => {
        if (i < revealed || ch === ' ') return ch;
        return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      }).join('');
      if (frame >= total) { clearInterval(el._t); el.textContent = target; }
    }, 30);
  }

  $$('[data-scramble]').forEach(el => {
    const host = el.closest('a') || el;
    host.addEventListener('mouseenter', () => scramble(el));
  });

  /* ---------------------------------------------------------
     8. 磁吸按钮：鼠标靠近时轻微吸附
     --------------------------------------------------------- */
  if (!isTouch && !reduce) {
    $$('.btn').forEach(btn => {
      btn.addEventListener('mousemove', (e) => {
        const r = btn.getBoundingClientRect();
        const x = (e.clientX - r.left - r.width / 2) / r.width;
        const y = (e.clientY - r.top - r.height / 2) / r.height;
        btn.style.transform = `translate(${x * 10}px, ${y * 8}px)`;
      });
      btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
    });
  }

  /* ---------------------------------------------------------
     9. 移动端菜单
     --------------------------------------------------------- */
  const burger = $('#burger');
  const menu   = $('#menu');

  function setMenu(open) {
    menu.classList.toggle('is-open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
    document.body.classList.toggle('is-locked', open);
  }

  burger?.addEventListener('click', () => setMenu(!menu.classList.contains('is-open')));
  $$('a', menu).forEach(a => a.addEventListener('click', () => setMenu(false)));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.classList.contains('is-open')) setMenu(false);
  });

  /* ---------------------------------------------------------
     9b. 人物照片兜底
     照片是这个页面的主角，一旦加载失败不能只是留一片空白让人猜。
     这里做两级处理：WebP 失败退回 PNG，PNG 也失败就显示可见提示。
     --------------------------------------------------------- */
  const portraitImg = $('.hero__portrait img');
  if (portraitImg) {
    portraitImg.addEventListener('error', function onErr() {
      const src = portraitImg.getAttribute('src') || '';
      if (!src.endsWith('portrait.png')) {
        // 第一级：退回 PNG
        console.warn('[portrait] 加载失败，退回 PNG:', src);
        portraitImg.removeEventListener('error', onErr);
        portraitImg.src = 'assets/img/portrait.png';
        return;
      }
      // 第二级：都失败了，让问题可见
      console.error('[portrait] 照片加载失败，请检查 assets/img/ 是否存在');
      const box = document.createElement('div');
      box.style.cssText =
        'position:absolute;left:50%;top:50%;translate:-50% -50%;z-index:9;' +
        'padding:1.2rem 1.6rem;border:1px dashed #d2ff00;border-radius:12px;' +
        'background:rgba(17,17,18,.92);color:#d2ff00;font-size:.85rem;' +
        'line-height:1.7;text-align:center;max-width:min(90vw,420px)';
      box.innerHTML =
        '<b>照片没能加载</b><br>' +
        '请确认 <code>assets/img/portrait.png</code> 存在。<br>' +
        '若你是用 file:// 直接打开的，建议改用根目录的<br>' +
        '<code>打开网站.bat</code> 启动本地预览。';
      $('.hero__portrait')?.appendChild(box);
    });
  }

  /* ---------------------------------------------------------
     10. 杂项
     --------------------------------------------------------- */
  $('#year').textContent = new Date().getFullYear();

  // 注：人物图上的悬停效果已改为 WebGL 流体，见 assets/js/fluid.js

  // 占位链接不要跳走
  $$('a[href="#"]').forEach(a => a.addEventListener('click', e => e.preventDefault()));
})();
