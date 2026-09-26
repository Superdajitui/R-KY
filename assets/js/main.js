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
        ---------------------------------------------------------
        只列【自己带 transform 动画、同时又会被首屏退场改 transform】的元素：
        .hero__word--bottom 和 .hero__portrait 需要清理；
        .hero__eyebrow 顺手一起（无害）。
        KERRY 不在这里 —— 它现在是逐个字母入场的，
        动的是每个字母自己的 transform，父层的 transform 留给退场用，
        两者互不干扰。底部三件套同理，只动 opacity，不需要清理。
     --------------------------------------------------------- */
  $$('.hero__eyebrow, .hero__word--bottom, .hero__portrait').forEach(el => {
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
     3b. 跑马灯
     纯 CSS 匀速循环（合成器跑，几乎不耗 CPU），这里【不插手】。
     ---------------------------------------------------------
     曾经叠过一层"跟滚动速度挂钩"的偏移 + 斜切：滚动时把整条带子推走
     最多 90px、松手再弹回来。问题在于基础速度只有约 29px/s，
     而那个偏移能在 100ms 内变化 90px —— 相当于瞬间快了三十倍再弹回去，
     在电脑上看着就是"一滚一跳"。
     跑马灯要的是**连续**，所以这层响应整个去掉了；
     现在唯一影响它的只有页面本身的滚动。
     --------------------------------------------------------- */

  const damp = (cur, target, dt, tau) => cur + (target - cur) * (1 - Math.exp(-dt / tau));

  /* 调试出口：控制台里 __scrub() 可以看到引擎缓存的坐标、区间和当前值。
     排查"滚动动效触发时机不对"这类问题时，光看 --p 分不清是
     "缓存的坐标过期了"还是"动画没跑完" —— 这三样摆在一起就一目了然。
     只读，不改状态；体积也就几十字节。 */
  window.__scrub = () => scrubEls.map(it => ({
    el: (it.el.className || it.el.tagName).toString().slice(0, 28),
    cachedDocTop: it.top,
    actualDocTop: layoutTop(it.el),
    fromPx: it.fromPx,
    toPx: it.toPx,
    target: it.target,
    cur: it.cur,
  }));

  /* ---------------------------------------------------------
     3c. 每帧只做一次「先全部算完，再统一写」
     读-写-读-写来回穿插会触发多次强制重排，是滚动掉帧最常见的来源。
     --------------------------------------------------------- */
  let rafId = 0;
  let lastT = 0;

  function paint() {
    for (const it of scrubEls) {
      const v = it.cur.toFixed(4);
      // 【只在数值真的变了才写】
      //
      // --p 是可继承的自定义属性：每写一次，浏览器就要重算这个元素
      // 及其**整棵子树**的样式。而滚动时绝大多数元素此刻在视口外，
      // 进度恒定是 0 或 1 —— 每帧重写它们纯属白烧。
      // 实测（tools/perf-scroll.mjs，CPU 降速 6x 滚 240 帧）：
      // 整个滚动动效占了主线程开销的 61%（104ms → 关掉后 40ms），
      // 其中样式重算 37ms → 5ms。省掉无变化的写入是最大的一笔。
      if (v !== it.painted) {
        it.painted = v;
        it.el.style.setProperty('--p', v);
      }
      if (it.blur) {
        // 动画走完就把模糊摘掉：留着的话每帧都要过一遍滤镜，白烧 GPU
        const done = it.cur > 0.995;
        if (done !== it.done) { it.done = done; it.el.classList.toggle('is-done', done); }
      }
    }
    if (heroEl) {
      const hv = heroCur.toFixed(4);
      if (hv !== heroPainted) {
        heroPainted = hv;
        heroEl.style.setProperty('--hero-p', hv);
      }
    }
  }

  let heroCur = 0;
  let heroPainted = null;

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

    let busy = Math.abs(heroCur - heroTarget) > 0.0008;
    for (const it of scrubEls) {
      it.cur = damp(it.cur, it.target, dt, 85);
      if (Math.abs(it.target - it.cur) > 0.0008) busy = true;
      else it.cur = it.target;
    }

    paint();
    // 追平之后就把循环停掉，不为了几个数字常驻空转
    if (busy) rafId = requestAnimationFrame(frame);
    else { rafId = 0; paint(); }
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
    // 开场页被完全盖住之后，直接从渲染树里摘掉。
    // 它是一个 position:fixed 的全屏层（还带视差），合成器会一直保留着它；
    // 而此刻 main 早已把它盖满，留着只是白占显存和每帧的合成开销。
    // 用 visibility 而不是 display：不影响布局，也能让合成器丢掉这一层。
    document.body.classList.toggle('past-welcome', y > vh * 1.02);
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

    // 位置缓存会在布局变化后过期，而过期的缓存会让【所有】动效的触发时机整体偏移。
    // 实测踩到过：联系区标题的缓存坐标比真实值大 189px，
    // 表现就是"邮箱按钮都露出来了，标题还差 2% 没显示完"，而且时有时无 ——
    // 因为字体换入 / 懒加载图片落地 / 内容增删的时机每次都不一样。
    //
    // 与其去猜是哪一个引起的，不如直接盯着"页面高度"这个总账：
    // 高度一变就重新量。ResizeObserver 正好干这个。
    // （measure() 只读布局、只写 --p 这类不影响布局的属性，不会自激。）
    if (window.ResizeObserver) {
      let rot = 0;
      new ResizeObserver(() => {
        clearTimeout(rot);
        rot = setTimeout(measure, 120);
      }).observe(document.documentElement);
    }

    // 这几个时机也各补一次：字体换入之后行高会变，
    // 首屏图加载完页面高度也会变。
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
     7. 导航悬停的"乱码"效果 —— 已移除
     ---------------------------------------------------------
     原来鼠标移上去，标签会逐字从随机拉丁字母/符号里"解码"出来。
     这个效果在长英文单词上好看，但导航标签是【两个字的中文】，
     实测逐帧是这样（12 帧、每帧 30ms）：

       技<   技I   技C   技*   技O   技5   技能  技能 …

     前一半时间都显示成「技V」这种"一个汉字 + 一个乱码字母"，
     看着不像效果，像一个错字。用户就是这么反馈的。

     导航本来就有一套完整的悬停反馈（文字变霓虹、药丸底色、
     下划线从中间展开），乱码是叠在上面多余的一层，
     去掉之后反而干净。要recover的话，把随机字符表换成汉字、
     并且只在 4 字以上的标签上启用，才不会像错字。
     --------------------------------------------------------- */

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
     11. 欢迎页：标题逐字弹起 + 纯色区流体
     ---------------------------------------------------------
     两个效果共用【一个】 rAF 循环。它们都只在欢迎页可见时才有意义，
     拆成两个循环就是两倍的每帧开销，还得各写一遍启停判断。

     停止条件不是可选项：欢迎页滚过去之后只是 visibility:hidden，
     DOM 和它的合成层都还在。不主动停，这个循环会一直空转到用户关掉标签页。
     这里有两道闸：滚过一屏就整体复位并停；鼠标停住 2.2s 之后
     流体自己收力、弹簧收敛，也就没有"还在动"的理由了。

     手机上整个不启动：逐字缩放要重绘十几个上百像素的大字，
     流体是四层上千万像素的图层 —— 都不是手机该干的事。

     流体为什么不用"真"流体（feTurbulence 位移、或者 canvas 解纳维-斯托克斯）：
     那些每一帧都要重新过滤整屏像素。这个站已经因为手机上全屏混合模式
     卡过一次，那还只是静态的。这里的做法全程只有 transform，
     合成器就能完成，主线程每帧只写几个数字。
     --------------------------------------------------------- */
  const fluid   = $('#fluid');
  const titleEl = $('.welcome__title');
  const bodyEl  = $('.welcome__body');

  if (welcome && fluid && titleEl && bodyEl && !isTouch && !reduce) {
    /* ── 拆字 ──
       行内元素不吃 transform，不拆成 inline-block 就谈不上"逐字"。
       只在真能跑动效的时候拆：拆了却没脚本接着驱动，等于白改一遍 DOM。 */
    const chars = [];
    for (const line of $$('.welcome__line > span', titleEl)) {
      const text = line.dataset.text || line.textContent;
      line.textContent = '';
      line.classList.add('is-split');   // 让整行那层退位，描边填充下沉到每个字
      for (const ch of text) {          // for...of 按码点走，不会把字拆成半个
        const s = document.createElement('span');
        s.className = 'welcome__ch';
        s.dataset.text = ch;            // 填充那层要用 attr(data-text)
        s.textContent = ch;
        line.appendChild(s);
        chars.push({ el: s, cx: 0, cy: 0, sc: 1, v: 0, wrote: 1 });
      }
    }

    /* 弹簧参数和站里其它地方同源：ω=20、ζ=0.45 ——
       就是 CSS 里 --sp-pop 那条（tools/gen-spring.mjs 0.45 20 540）。
       同一个性格，标题弹起来的节奏才和导航、按钮是一套的。 */
    const CH_AMP = .16;      // 最大放大到 1.16，与导航项一致
    let CH_K = 400;          // ω²（let 是为了下面那个测试钩子）
    let CH_C = 18;           // 2ζω
    let radius = 320;

    /* 每个字相对 .welcome__body 的位置。
       不能直接用 offsetLeft —— 那是相对 offsetParent 的，而【两行的
       offsetParent 并不一样】：镂空那行本身是 position:relative
       （它原来的填充层需要），于是第二行的字认那一行为父、offsetTop 从 0 起算。
       实测偏差是整整一行的高度：第二行的字被算到 y=141，实际在 542。
       影响半径就完全照着一个错位置在算 —— 鼠标正悬在字上，
       算出来的距离却有 250px，效果几乎看不见（实测最大只到 1.006）。

       所以沿 offsetParent 链一路累加到共同祖先，中间谁定位过都不影响。
       offsetLeft/offsetTop 是布局值、不受 transform 影响，
       所以字在缩放过程中重量也不会自己追着自己跑。 */
    function offsetIn(el, root) {
      let x = 0, y = 0, n = el;
      while (n && n !== root) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
      return { x, y };
    }

    function measure() {
      const b = bodyEl.getBoundingClientRect();
      for (const c of chars) {
        const o = offsetIn(c.el, bodyEl);
        c.cx = b.left + o.x + c.el.offsetWidth / 2;
        c.cy = b.top + o.y + c.el.offsetHeight / 2;
      }
      // 影响半径跟着字号走。字号是 clamp 出来的（手机 55px / 桌面 152px），
      // 写死 px 的话小屏上会"一次弹起一整行"，就谈不上逐个了。
      if (chars[0]) radius = Math.max(120, chars[0].el.offsetHeight * 2.1);
    }

    /* 四团色斑，刚度递减 —— 这就是"尾迹"的全部来源：
       快的先到、慢的拖在后面，中间拉开的那一段看着就是流体。

       sz 是各自的大小：一大三小。全用同一个尺寸、又都往鼠标上聚，
       四团会叠成一块规规矩矩的圆 —— 那是"跟着鼠标的影子"，不是液体。
       有大小差、有错位，轮廓才有内部结构。

       阻尼比统一 0.55（过冲约 12%）：有一点回弹，但不会荡成布丁。

       ⚠ 改 c 之前先算一下 c·dt：这里的积分是半隐式欧拉，
       c·dt ≥ 1 时速度会每帧翻号，整个弹簧直接发散。
       dt 上限锁在 1/30，所以 c 必须小于 30；现在最大是 22.8，留了余量。
       （这个边界是真踩到的：写自检时把 c 调到 80 想造一个"过阻尼"的对照组，
        结果字根本没动 —— 不是过阻尼，是数值发散。） */
    const K  = [430, 220, 125, 82];
    const SZ = [1, .78, .6, .46];
    const blobs = $$('i', fluid).map((el, i) => ({
      el, x: 0, y: 0, vx: 0, vy: 0,
      k: K[i], c: 2 * .55 * Math.sqrt(K[i]), sz: SZ[i],
      // 静止时也各自错开，免得塌成一团；错位量比半径小得多，
      // 这样它们仍然是一个整体，只是边缘毛糙、会呼吸
      ox: [0, 86, -70, 118][i],
      oy: [0, -62, 78, -40][i],
      ph: i * 1.9,
      wrote: '',
    }));

    const mouse = { x: 0, y: 0, has: false };
    let inside = false;
    let activity = 0;                    // 鼠标刚动过是 1，停一会儿衰减到 0
    let lastMove = -1e9;
    let running = false, lastT = 0;

    // 滚过一屏 / 标签页切走就整体复位
    const live = () => window.scrollY < innerHeight * .98 && !document.hidden;

    function reset() {
      for (const c of chars) {
        c.sc = 1; c.v = 0;
        if (c.wrote !== 1) { c.el.style.transform = ''; c.wrote = 1; }
      }
      for (const b of blobs) { b.vx = b.vy = 0; if (b.wrote) { b.wrote = ''; } }
      fluid.classList.remove('is-live');
      mouse.has = false; inside = false;
    }

    function frame(now) {
      const dt = Math.min((now - lastT) / 1000, 1 / 30) || 1 / 60;
      lastT = now;

      if (!live()) { reset(); running = false; return; }

      // 鼠标停住之后流体收力，弹簧收敛完循环就自己停 —— 不留空转
      activity += ((now - lastMove > 2200 ? 0 : 1) - activity) * (1 - Math.exp(-dt / .45));
      if (activity < .01) activity = 0;

      // 流体还"活着"就一直跑，别在漂移途中把循环停掉
      let moving = activity > 0;

      // ── 标题逐字 ──
      for (const c of chars) {
        let target = 1;
        if (inside) {
          const d = Math.hypot(mouse.x - c.cx, mouse.y - c.cy);
          if (d < radius) {
            const f = 1 - d / radius;
            target = 1 + CH_AMP * f * f;      // 平方衰减：正下方最弹，边缘几乎不动
          }
        }
        c.v += ((target - c.sc) * CH_K - c.v * CH_C) * dt;
        c.sc += c.v * dt;

        const settled = Math.abs(c.sc - target) < 4e-4 && Math.abs(c.v) < 4e-3;
        if (settled) { c.sc = target; c.v = 0; }
        else moving = true;

        // 只在值真的变了才写。写一次就是一次重绘，
        // 十几个大字每帧无条件重绘，桌面也会掉帧。
        if (Math.abs(c.sc - c.wrote) > 6e-4) {
          if (c.sc === 1) c.el.style.transform = '';
          else c.el.style.transform = 'scale(' + c.sc.toFixed(4) + ')';
          c.wrote = c.sc;
        }
      }

      // ── 流体 ──
      const t = now / 1000;
      for (const b of blobs) {
        // 鼠标停住之后靠这两个不同周期的慢正弦继续游，让流体一直是活的；
        // activity 一收，它们就慢慢停到鼠标旁边
        const tx = mouse.x + b.ox + Math.sin(t * .31 + b.ph) * 54 * activity;
        const ty = mouse.y + b.oy + Math.cos(t * .23 + b.ph * 1.4) * 46 * activity;
        b.tx = tx; b.ty = ty;

        b.vx += ((tx - b.x) * b.k - b.vx * b.c) * dt;
        b.vy += ((ty - b.y) * b.k - b.vy * b.c) * dt;
        b.x += b.vx * dt; b.y += b.vy * dt;

        /* 收敛到亚像素之后直接吸附、速度清零。
           不做这一步，循环会永远停不下来：半隐式欧拉在平衡点附近
           位置收敛到 0.05px 了，速度却吊在 0.6~3.2px/s 下不去
           （一帧只移动 0.05px，肉眼就是静止的）。
           实测就是卡在这里：残余距离全都小于 0.13px，循环却还在跑。 */
        let goal = Math.hypot(tx - b.x, ty - b.y);
        const sp = Math.hypot(b.vx, b.vy);
        if (goal < .2 && sp < 8) {
          b.x = tx; b.y = ty; b.vx = b.vy = 0; goal = 0;
        }
        if (goal > 0) moving = true;

        // 按速度沿运动方向拉长、垂直方向压扁 —— 水滴被甩出去就是这个形状。
        // 这就是"流体"读起来像液体的地方：一个正圆跟着鼠标走只会像光斑。
        // 再乘上各自的大小 sz，四团才有大小差。
        const st = Math.min(sp / 2600, .34);
        const tf = 'translate3d(' + b.x.toFixed(1) + 'px,' + b.y.toFixed(1) + 'px,0)' +
          ' rotate(' + Math.atan2(b.vy, b.vx).toFixed(3) + 'rad)' +
          ' scale(' + (b.sz * (1 + st)).toFixed(3) + ',' + (b.sz * (1 - st * .72)).toFixed(3) + ')';
        if (tf !== b.wrote) { b.el.style.transform = tf; b.wrote = tf; }
      }

      if (moving) requestAnimationFrame(frame);
      else running = false;
    }

    function kick() {
      if (running || !live()) return;
      running = true;
      lastT = performance.now();
      requestAnimationFrame(frame);
    }

    /* 进入时把四团直接摆到指针旁边，不从视口中心飞过来。
       第一次进入和"离开后从别处再进来"都算，否则会看到一条横穿屏幕的拖影。 */
    function place(x, y) {
      for (const b of blobs) {
        b.x = x + b.ox; b.y = y + b.oy; b.vx = b.vy = 0; b.wrote = '';
      }
    }

    welcome.addEventListener('pointerenter', (e) => {
      inside = true;
      mouse.x = e.clientX; mouse.y = e.clientY; mouse.has = true;
      place(e.clientX, e.clientY);
      fluid.classList.add('is-live');
      lastMove = performance.now();
      kick();
    }, { passive: true });

    welcome.addEventListener('pointermove', (e) => {
      if (!mouse.has) {
        mouse.has = true;
        place(e.clientX, e.clientY);
        fluid.classList.add('is-live');
      }
      mouse.x = e.clientX; mouse.y = e.clientY;
      inside = true;
      lastMove = performance.now();
      kick();
    }, { passive: true });

    welcome.addEventListener('pointerleave', () => { inside = false; kick(); }, { passive: true });

    // 字体换入会改变标题的排版（子集字体和回退字体的字宽不一样），
    // 位置必须重量一次，否则影响半径会照着旧的字号算。
    measure();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    addEventListener('load', measure);
    let rt = 0;
    addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(measure, 150); });

    /* 调试钩子，和 __scrub() 一套思路：
       让测试能直接问"循环还跑着吗"，而不是靠帧率间接猜。
       "鼠标停住之后要自己停下来"这件事，只有问得出来才验得了。 */
    window.__welcomeFx = () => ({
      running,
      activity: +activity.toFixed(3),
      inside,
      radius: Math.round(radius),
      chars: chars.map(c => +c.sc.toFixed(4)),
      blobs: blobs.map(b => [Math.round(b.x), Math.round(b.y)]),
      // 还差多远、还剩多快 —— "循环为什么不停"这种问题，只有这两个数说得清
      residual: blobs.map(b => +Math.hypot(b.tx - b.x, b.ty - b.y).toFixed(3)),
      speed: blobs.map(b => +Math.hypot(b.vx, b.vy).toFixed(3)),
    });

    /* 再开一个口子给测试把弹簧的阻尼调大。
       弹簧参数在闭包里，从外面没有任何别的办法造出一个"不弹"的对照组 ——
       而没有对照组，"放大是 Q 弹的"这条断言就没法证明它真的会失败，
       等于一句自我感觉良好的空话。生产路径不会碰它。 */
    window.__welcomeFx.damp = (k, c) => { CH_K = k; CH_C = c; };
  }

  /* ---------------------------------------------------------
     10. 杂项
     --------------------------------------------------------- */
  $('#year').textContent = new Date().getFullYear();

  // 占位链接不要跳走
  $$('a[href="#"]').forEach(a => a.addEventListener('click', e => e.preventDefault()));
})();
