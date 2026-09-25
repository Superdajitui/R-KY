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
    // 等遮罩淡出（.6s）再让欢迎页文字进场，两段动画不打架
    setTimeout(() => document.body.classList.add('is-ready'), 420);
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
     3. 滚动驱动动效（scrub）
     ---------------------------------------------------------
     和 [data-reveal] 的区别，值得说清楚：
       [data-reveal] 是「进视口 → 播一次动画」，一个开关，播完就结束；
       scrub 是「动画进度 = 滚动进度」，0~1 跟着滚动位置连续变化。
     苹果官网那种手感之所以高级，核心就是后者 —— 动画是被滚动【驱动】的，
     可以往回擦、可以停在中间任意一帧，而不是被滚动【触发】一次。

     性能上有两条硬规矩，违反了元素一多就明显掉帧：
     1. 每帧只做算术，不读布局。元素位置在 measure() 里量好缓存，
        滚动时只拿 scrollY 减一减，绝不调 getBoundingClientRect()。
     2. 位置一律用 layoutTop()（累加 offsetTop）而不是 rect。
        因为 rect 是**含 transform** 的，而这些元素自己就带着
        translateY 之类的动画 —— 用 rect 会形成"位置取决于进度、
        进度又取决于位置"的自我反馈，第一次量就偏掉几十像素。
        offsetTop 取的是布局盒，不受 transform 影响，正好是我们要的。

     预设区间用 vh 的倍数表示：
       from = 进度 0 时元素顶边在视口里的位置
       to   = 进度 1 时元素顶边在视口里的位置
     --------------------------------------------------------- */
  const PRESETS = {
    rise:  { from: 1.00, to: 0.30 },   // 块级内容浮起淡入
    blur:  { from: 0.98, to: 0.34 },   // 大标题：多一层轻微模糊，像对上焦
    read:  { from: 0.88, to: 0.34 },   // 段落逐段点亮
    // 标题逐行推上来。终点特意定得比别的预设早（0.52 = 视口中线），
    // 因为页面最底部那个标题——「一起做点 / 好玩的 东西？」——
    // 后面已经没有滚动余量了，终点定太靠上的话它要滚到最后一像素才肯显示完整。
    // 0.52 既留出了余量，视觉上也是"从底边升到屏幕中间就完成"。
    lines: { from: 0.98, to: 0.52 },
    // drive 不配任何 CSS：只负责算进度，画面完全交给元素自己的专属规则。
    // 这样就不会和 [data-scrub="rise"] 那类通用规则抢 opacity / transform
    // （两条同优先级的规则同时写 transform，谁生效取决于书写顺序，很容易踩坑）。
    drive: { from: 0.92, to: 0.40 },   // 技能进度条、联系页光晕
  };

  const scrubEls = [];
  let heroEl = null;

  // 取元素在文档里的【布局】纵坐标：累加 offsetTop。
  // 不受 transform 影响，也不需要 getBoundingClientRect 那样触发重排。
  function layoutTop(el) {
    let y = 0;
    for (let n = el; n; n = n.offsetParent) y += n.offsetTop;
    return y;
  }

  function addScrub(el, opts = {}) {
    const preset = PRESETS[opts.preset] || PRESETS.rise;
    // delay 以 vh 为单位：正数表示"再往下滚一点才开始"，用来做同排元素的错落
    const d = opts.delay || 0;
    scrubEls.push({
      el,
      // data-scrub-from / data-scrub-to 可以覆盖预设区间（单位是 vh 倍数）。
      // 用不着给每个区块都调，只有"必须早点显示完"的地方才需要 ——
      // 联系区那句 CTA 就是：按钮都露出来了它还在半透明，等于自己拆自己的台。
      from: (opts.from ?? preset.from) - d,
      to: (opts.to ?? preset.to) - d,
      blur: opts.preset === 'blur',
      top: 0, h: 1,
      target: 0, cur: 0,
      done: false, active: false,
    });
  }

  // 从元素上读区间覆盖值（没写就是 undefined，交给预设）
  const rangeOf = (el) => ({
    from: el.dataset.scrubFrom !== undefined ? parseFloat(el.dataset.scrubFrom) : undefined,
    to: el.dataset.scrubTo !== undefined ? parseFloat(el.dataset.scrubTo) : undefined,
  });

  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

  function measure() {
    const vh = window.innerHeight;
    // 页面最多能滚多远。这个值决定了"元素最高能升到视口的哪个位置"，
    // 下面每个元素都要用它做一次可达性修正。
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - vh);
    for (const it of scrubEls) {
      it.top = layoutTop(it.el);
      it.h = it.el.offsetHeight || 1;

      // 元素在视口里能到达的最高位置（页面滚到底时它就在那儿）。
      //
      // 为什么必须做这一步：预设的终点是按"元素升到视口上部"设计的，
      // 但页面【最底部】的内容后面已经没有可滚的余量了，永远升不到那个位置。
      // 实测联系页最后一行只能升到视口 69% 处，而 rise 预设要求 30%，
      // 于是它的进度永远卡在 0.44 —— 也就是一直半透明地待在那儿。
      // 修正办法：如果够不着，就把终点改成它实际能到的最低高度，
      // 至少保证"滚到底 = 完全显示"这条铁律成立。
      const highest = it.top - maxScroll;                 // 视口坐标，越小越高
      const fromPx = it.from * vh;
      // 兜一个最小行程，避免元素完全滚不动时除零
      it.toPx = Math.min(Math.max(it.to * vh, highest), fromPx - 80);
      it.fromPx = fromPx;
    }
    heroEl = $('.hero');
    if (heroEl) heroEl.__top = layoutTop(heroEl);
    // 量完之后立刻按当前滚动位置算一遍，避免 resize 后停在旧进度上
    updateTargets(window.scrollY, vh);
    for (const it of scrubEls) it.cur = it.target;
    paint();
  }

  // 只算数，不碰 DOM
  function updateTargets(y, vh) {
    for (const it of scrubEls) {
      const top = it.top - y;                       // 元素顶边此刻在视口里的位置
      const span = it.fromPx - it.toPx;
      it.target = span > 0 ? clamp01((it.fromPx - top) / span) : 0;
    }
  }

  /* ---------------------------------------------------------
     3b. 跑马灯：滚动越快跑得越"用力"
     基础位移仍然交给 CSS 动画（合成器跑，几乎不耗 CPU），
     这里只叠一层跟滚动速度挂钩的偏移 + 轻微斜切，
     松手后自己衰减回 0。这样既有反应，又不用为了它常驻一个 rAF 循环。
     --------------------------------------------------------- */
  const mqInner  = $('.marquee__inner');
  let mqShift = 0;      // 当前偏移（px）
  let mqSkew  = 0;      // 当前斜切（deg）
  let mqTargetShift = 0;
  let mqTargetSkew = 0;

  const damp = (cur, target, dt, tau) => cur + (target - cur) * (1 - Math.exp(-dt / tau));
  const EPS = 0.01;

  /* ---------------------------------------------------------
     3c. 每帧只做一次「先全部算完，再统一写」
     读-写-读-写来回穿插会触发多次强制重排，是滚动掉帧最常见的来源。
     --------------------------------------------------------- */
  let rafId = 0;
  let lastT = 0;
  let lastScrollY = window.scrollY;

  function paint() {
    for (const it of scrubEls) {
      it.el.style.setProperty('--p', it.cur.toFixed(4));
      if (it.blur) {
        // 动画走完就把模糊摘掉：留着的话每帧都要过一遍滤镜，白烧 GPU
        const done = it.cur > 0.995;
        if (done !== it.done) { it.done = done; it.el.classList.toggle('is-done', done); }
      }
    }
    if (heroEl) heroEl.style.setProperty('--hero-p', heroCur.toFixed(4));
    if (mqInner) {
      mqInner.style.transform =
        `translate3d(${mqShift.toFixed(2)}px,0,0) skewX(${mqSkew.toFixed(2)}deg)`;
    }
  }

  let heroCur = 0;

  function frame(now) {
    const dt = Math.min(64, now - lastT) || 16;
    lastT = now;
    const y = window.scrollY;
    const vh = window.innerHeight;

    updateTargets(y, vh);

    // 首屏退场：以"滚过首屏"为 0 点，再滚 0.85 屏到 1。
    // 直接算 scrollY 而不是拿 hero 的位置量 —— 首屏本来就在最上面，
    // 这样 0 点非常明确：欢迎页还没走完时它一直是 0。
    const heroTarget = heroEl ? clamp01((y - heroEl.__top) / (vh * 0.85)) : 0;
    heroCur = damp(heroCur, heroTarget, dt, 90);

    // 滚动速度（px/s）→ 跑马灯的附加偏移与斜切，带阻尼回中
    const dy = y - lastScrollY;
    lastScrollY = y;
    const vel = dt > 0 ? dy / (dt / 1000) : 0;
    mqTargetShift = Math.max(-90, Math.min(90, -vel * 0.045));
    mqTargetSkew  = Math.max(-5, Math.min(5, -vel * 0.006));
    mqShift = damp(mqShift, mqTargetShift, dt, 130);
    mqSkew  = damp(mqSkew, mqTargetSkew, dt, 130);

    let busy = Math.abs(heroCur - heroTarget) > 0.0008
            || Math.abs(mqShift - mqTargetShift) > EPS
            || Math.abs(mqSkew - mqTargetSkew) > EPS;
    for (const it of scrubEls) {
      it.cur = damp(it.cur, it.target, dt, 85);
      if (Math.abs(it.target - it.cur) > 0.0008) busy = true;
      else it.cur = it.target;
    }

    paint();
    // 追平之后就把循环停掉，不为了几个数字常驻空转
    if (busy) rafId = requestAnimationFrame(frame);
    else { rafId = 0; mqShift = mqTargetShift = mqSkew = mqTargetSkew = 0; paint(); }
  }

  function kick() {
    if (reduce) return;
    if (!rafId) { lastT = performance.now(); rafId = requestAnimationFrame(frame); }
  }

  const nav      = $('#nav');
  const progress = $('#progress');
  const welcome  = $('#welcome');

  // 点欢迎页任意位置 = 下滑进入主页。
  // 键盘用户走的是页脚那个 <a href="#hero">，两条路都通。
  welcome?.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;          // 链接自己会处理
    window.scrollTo({ top: window.innerHeight, behavior: 'smooth' });
  });

  let lastY = 0;
  let lastSweepY = 0;
  let ticking = false;

  function onScroll() {
    const y = window.scrollY;
    const vh = window.innerHeight;

    // 进度条
    const max = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.width = (max > 0 ? (y / max) * 100 : 0) + '%';

    // ── 欢迎页 → 主页的切换 ──────────────────────────────
    // 主页是被 margin-top:100svh 推到下方的，所以"滑上来"这件事
    // 完全由滚动位置驱动，这里只负责状态类名和一层视差。
    const leavingWelcome = y > vh * 0.98;
    document.body.classList.toggle('at-welcome', !leavingWelcome);
    // is-hero 一旦加上就不再移除：首屏动画只播一次，
    // 滚回去重看时不该重播
    if (y > vh * 0.55) document.body.classList.add('is-hero');
    if (welcome && !reduce && y < vh * 1.4) {
      const p = Math.min(1, y / vh);
      welcome.style.setProperty('--wy', `${(-y * 0.2).toFixed(1)}px`);
      welcome.style.setProperty('--wo', String(Math.max(0, 1 - p * 1.15)));
    }

    // 导航：吸顶 + 向下滚动时收起
    nav.classList.toggle('is-stuck', y > vh + 40);
    if (y > vh + 320 && y > lastY) nav.classList.add('is-hidden');
    else nav.classList.remove('is-hidden');
    lastY = y;

    // 一次性跨过近一整屏 => 判定为锚点跳转，补一次显现清扫
    if (Math.abs(y - lastSweepY) > vh * 0.9) revealSweep();
    lastSweepY = y;

    // 滚动动效（scrub）走自己的 rAF 循环。
    // 这里只是把它叫醒；它算完、动画追平目标值之后会自己停下来，
    // 不会为了几个数字常驻一个空转的循环。
    kick();
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
     4a. 装配滚动动效
     --------------------------------------------------------- */

  /* 大标题逐行揭示：按 <br> 把标题拆成若干行，每行套一层裁切容器，
     内层从下方推上来（和开场页 .welcome__line 是同一个手法）。
     为什么不按"词"拆：中文没有词间空格，按词根本拆不动；
     而行边界本来就是我们自己用 <br> 写死的，拆得准。

     行结构一变，CSS 的裁切就可能切到汉字上下缘，
     所以 .ln 用 padding + 负 margin 上下各留一点余量，
     负 margin 再把多出来的高度收回去 —— 版面和加动画之前一模一样。 */
  function splitLines(el) {
    const groups = [[]];
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 1 && node.tagName === 'BR') { groups.push([]); continue; }
      groups[groups.length - 1].push(node);
    }
    const lines = groups.filter(g => g.some(n => (n.textContent || '').trim()));
    if (lines.length < 1) return [];
    el.textContent = '';
    return lines.map((nodes, i) => {
      const mask = document.createElement('span');
      mask.className = 'ln';
      const inner = document.createElement('span');
      inner.className = 'ln__in';
      nodes.forEach(n => inner.appendChild(n));
      mask.appendChild(inner);
      el.appendChild(mask);
      // 越靠下的行天然越晚进入视口，错落感由几何自己产生，
      // 不需要再额外加延迟（加了反而会拖成两拍）
      return inner;
    });
  }

  function buildScrub() {
    // 标题行：拆行后每一行单独作为一个 scrub 目标。
    // 区间覆盖要写在标题容器上并由每一行继承 —— 行是拆出来的，
    // 没法单独给某一行加属性。
    $$('[data-scrub="lines"]').forEach(el => {
      const range = rangeOf(el);
      for (const inner of splitLines(el)) {
        addScrub(inner, { preset: 'lines', ...range });
      }
    });

    // 其余元素：data-scrub 直接写预设名
    $$('[data-scrub]').forEach(el => {
      const kind = el.dataset.scrub;
      if (kind === 'lines' || !PRESETS[kind]) return;
      addScrub(el, {
        preset: kind,
        delay: parseFloat(el.dataset.scrubDelay) || 0,
        ...rangeOf(el),
      });
    });

    // 用户要求减少动态效果：不跑动画，但要【明确把所有进度写成 1】。
    // 不能只靠 CSS 那条媒体查询兜着 —— 少写一处就会有内容停在透明状态，
    // 而"关掉动画反而看不到内容"是最糟的结果。
    if (reduce) {
      for (const it of scrubEls) it.el.style.setProperty('--p', '1');
      $('.hero')?.style.setProperty('--hero-p', '0');
      return;
    }

    measure();

    // 字体换进来之后行高会变，位置得重量一次；
    // 首屏图加载完页面高度也会变。这两个时机都不能漏。
    if (document.fonts?.ready) document.fonts.ready.then(measure);
    window.addEventListener('load', measure);

    let rt = 0;
    const onResize = () => { clearTimeout(rt); rt = setTimeout(measure, 140); };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
  }

  /* 兜底：滚动动效是靠 JS 写 --p 才显示的，脚本一旦出错，
     元素会永远停在 --p:0（也就是看不见）。这是绝对不能接受的失败方式，
     所以整个装配过程包在 try 里，出问题就给 <html> 加 .scrub-off，
     由 CSS 把所有动效属性让位给静态内容 —— 动画没了，内容必须在。 */
  try {
    buildScrub();
  } catch (err) {
    console.error('[scrub] 滚动动效初始化失败，已降级为静态显示:', err);
    document.documentElement.classList.add('scrub-off');
  }

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

  // 占位链接不要跳走
  $$('a[href="#"]').forEach(a => a.addEventListener('click', e => e.preventDefault()));
})();
