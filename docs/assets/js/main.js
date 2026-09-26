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
     11. 欢迎页：标题逐字弹起 + 纯色区水波纹
     ---------------------------------------------------------
     两个效果的性质完全不同，用的机制也就不同：

       逐字弹起 —— 弹簧是每帧积分出来的，交给不合成器，必须走 rAF。
                   但它只在鼠标悬停时跑，收敛之后就自己停。
       水波纹   —— 一圈圈各自独立的短动画，交给 Web Animations 驱动，
                   JS 只在"该冒一个波纹"的时候跑一次。
                   这里【没有】常驻的 rAF 循环，也没有每帧重算的状态。

     水波纹的触发有两种，对应两种观感：
       · 鼠标不动 —— 随机位置自己冒，像雨点落在水面上
       · 鼠标移动 —— 沿路径留下波纹往外晕开，按走过的距离触发而不是按时间

     停止条件不是可选项：欢迎页滚过去之后只是 visibility:hidden，
     DOM 和它的合成层都还在。所以滚过一屏要复位、灭火，
     波纹的自动生成也要停下来（否则它会一直往一个看不见的层里画）。

     手机上整个不启动：逐字缩放要重绘十几个上百像素的大字，
     波纹是一池子几百像素的图层 —— 都不是手机该干的事。

     为什么不用"真"流体（feTurbulence 位移、或者 canvas 解纳维-斯托克斯）：
     那些每一帧都要重新过滤整屏像素。这个站已经因为手机上全屏混合模式
     卡过一次，那还只是静态的。这里的环把剖面烘进渐变，
     全程只有 transform + opacity，合成器就能完成。
     --------------------------------------------------------- */
  const wave    = $('#wave');
  const waveDeep = $('#waveDeep');
  const titleEl = $('.welcome__title');
  const bodyEl  = $('.welcome__body');

  if (welcome && wave && waveDeep && titleEl && bodyEl && !isTouch && !reduce) {
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

    /* ══════════ 水面：深水层 + 表面涟漪 ══════════
       由 Web Animations 驱动：JS 只在"该冒一个波纹"的时候跑一次，
       扩散和淡出全交给合成器。这里【没有】常驻的 rAF 循环 ——
       波纹是一圈圈各自独立的短动画，不是每帧重算的状态。

       池子复用而不是每次新建元素：新建会带来 GC 抖动，
       而且元素数量没有上限的话，鼠标甩一下就能刷出上百个图层。 */
    const pool = $$('i', wave);
    const deepPool = $$('i', waveDeep);
    const isRunning = el => el.__a && el.__a.playState === 'running';
    const aliveCount = () => pool.reduce((n, el) => n + (isRunning(el) ? 1 : 0), 0);

    /* 挑一个可以用的环。
       池子满了【不能把新的丢掉】—— 实测踩到过：
       鼠标快速扫过时，正在跑的恰好是自动冒出来的那几圈，
       被丢掉的却正是尾迹，扫完一看路径上只有稀稀拉拉三圈。
       改成复用"最接近散尽"的那一圈（它的透明度已经很低，掐掉看不出来）。 */
    function pick(from) {
      let best = null, bestP = -1;
      for (const el of from) {
        if (!isRunning(el)) return el;                     // 有空位就直接用
        const p = el.__a.effect.getComputedTiming().progress ?? 1;
        if (p > bestP) { bestP = p; best = el; }
      }
      return best;
    }

    /* 起一圈波纹。
       rot / squash 是给"高级感"加的：完美正圆一眼就是程序画的。
       真实水面上的涟漪永远是略扁的、朝向随机的，
       所以每个环都带一个随机旋转 + 一点椭圆度 —— 叠在一起就没有"同心圆阵列"的机械感。 */
    function ring(x, y, dur, grow, peak, ease) {
      const el = pick(pool);
      if (!el) return;
      if (el.__a) { el.__a.cancel(); el.__a = null; }
      const rot = (Math.random() * 360).toFixed(1);
      const squash = (.9 + Math.random() * .17).toFixed(3);   // 0.90~1.07
      const at = s => ({ transform: 'translate3d(' + x.toFixed(1) + 'px,' +
        y.toFixed(1) + 'px,0) rotate(' + rot + 'deg)' +
        ' scale(' + s.toFixed(3) + ',' + (s * squash).toFixed(3) + ')' });
      /* 三个关键帧：几乎从零开始 → 快速铺开一点并达到最亮 → 铺到最大、淡尽。
         中段放在 16%：真实的水波是"先猛地弹开、之后慢慢失去能量"，
         峰值放太靠后会显得迟钝。 */
      const a = el.animate([
        Object.assign(at(grow * .07), { opacity: 0 }),
        Object.assign(at(grow * .38), { opacity: peak, offset: .16 }),
        Object.assign(at(grow), { opacity: 0 }),
      ], { duration: dur, easing: ease || 'cubic-bezier(.16,.6,.28,1)', fill: 'forwards' });
      el.__a = a;
      /* 跑完立刻 cancel：效果撤掉后元素回到 CSS 的 opacity:0，
         终点本来就是 0，所以看不出任何跳变 ——
         但这样就【不会留着一条 fill:forwards 的动画】继续参与合成。
         不 cancel 的话，一次浏览下来会攒下几百条已完成动画。 */
      a.onfinish = () => { a.cancel(); if (el.__a === a) el.__a = null; };
    }

    /* ── 深水层：极慢、极大、极淡的暗涌 ──
       它自己成一个节奏，跟鼠标没有任何关系。
       它存在的唯一意义是让表面涟漪"有底" ——
       少了它，那些圈就是浮在纯色上的贴纸。 */
    let deepT = 0;
    function scheduleDeep(delay) {
      clearTimeout(deepT);
      deepT = setTimeout(() => {
        if (!live()) { deepT = 0; return; }
        const el = pick(deepPool);
        if (el) {
          if (el.__a) { el.__a.cancel(); el.__a = null; }
          const x = innerWidth * (.12 + Math.random() * .76);
          const y = innerHeight * (.12 + Math.random() * .76);
          const grow = 1.35 + Math.random() * .75;          // 铺到 1200~1900px
          const at = s => ({ transform: 'translate3d(' + x.toFixed(0) + 'px,' +
            y.toFixed(0) + 'px,0) scale(' + s.toFixed(3) + ')' });
          const a = el.animate([
            Object.assign(at(grow * .34), { opacity: 0 }),
            Object.assign(at(grow * .62), { opacity: .5, offset: .42 }),
            Object.assign(at(grow), { opacity: 0 }),
          ], { duration: 6200 + Math.random() * 4800,
            easing: 'cubic-bezier(.3,.5,.4,1)', fill: 'forwards' });
          el.__a = a;
          a.onfinish = () => { a.cancel(); if (el.__a === a) el.__a = null; };
        }
        scheduleDeep();
      }, delay || (2600 + Math.random() * 3400));
    }

    /* ── 鼠标不动时自己冒：像雨点落在水面上 ──
       位置、间隔、大小、时长全都随机 —— 全都一样就成了节拍器。 */
    let idleT = 0;
    let lastTrail = -1e9;
    function scheduleIdle(delay) {
      clearTimeout(idleT);
      idleT = setTimeout(() => {
        if (!live()) { idleT = 0; return; }            // 停掉，滚回来时由 scroll 重新点火
        /* 鼠标正在滑动就跳过这一拍：此刻池子应该留给尾迹用。
           不然自动冒的那几圈会跟尾迹抢位置，扫描出来的路径是断的。 */
        if (performance.now() - lastTrail < 700) { scheduleIdle(320); return; }
        // 视口里随机一点，四边留余量，免得波纹还没铺开就被裁掉
        const x = innerWidth * (.06 + Math.random() * .88);
        const y = innerHeight * (.08 + Math.random() * .84);
        ring(x, y, 2200 + Math.random() * 1200, .5 + Math.random() * .45,
          .40 + Math.random() * .18);
        // 偶尔再来一滴挨着的，像先后落下的两个雨点
        if (Math.random() < .34) {
          setTimeout(() => {
            if (!live()) return;
            ring(x + (Math.random() - .5) * 190, y + (Math.random() - .5) * 150,
              2000 + Math.random() * 1100, .42 + Math.random() * .35,
              .34 + Math.random() * .16);
          }, 160 + Math.random() * 280);
        }
        scheduleIdle();
      }, delay || (520 + Math.random() * 640));
    }

    /* ── 鼠标移动：沿着路径留下波纹往外晕开 ──
       按【走过的距离】触发，不按时间 —— 手停着不动不该冒波纹，
       甩得快就该一路留下更多。 */
    const STEP = 62;
    let last = null;
    function trail(x, y) {
      lastTrail = performance.now();
      if (!last) { last = { x, y }; return; }
      // 隔了很久没动（切窗口回来之类）就直接接管，不补一串横穿屏幕的波纹
      if (Math.hypot(x - last.x, y - last.y) > 900) { last = { x, y }; return; }
      let guard = 0;
      let d = Math.hypot(x - last.x, y - last.y);
      while (d >= STEP && guard++ < 4) {
        const k = STEP / d;
        const px = last.x + (x - last.x) * k;
        const py = last.y + (y - last.y) * k;
        ring(px, py, 1500 + Math.random() * 700, .62 + Math.random() * .4,
          .44 + Math.random() * .18,
          // 尾迹用一条更"冲"的缓动：它是被手指划出来的，前段该更急
          'cubic-bezier(.12,.55,.25,1)');
        last = { x: px, y: py };
        d = Math.hypot(x - last.x, y - last.y);
      }
    }

    /* ══════════ 标题逐字：这一部分仍然需要 rAF ══════════
       弹簧是每帧积分出来的，没法交给合成器。但它只在鼠标悬停时跑，
       而且收敛之后就自己停。 */

    const mouse = { x: 0, y: 0, has: false };
    let inside = false;
    let running = false, lastT = 0;

    // 滚过一屏 / 标签页切走就别再动了
    const live = () => window.scrollY < innerHeight * .98 && !document.hidden;

    function reset() {
      for (const c of chars) {
        c.sc = 1; c.v = 0;
        if (c.wrote !== 1) { c.el.style.transform = ''; c.wrote = 1; }
      }
      for (const el of pool) { if (el.__a) { el.__a.cancel(); el.__a = null; } }
      for (const el of deepPool) { if (el.__a) { el.__a.cancel(); el.__a = null; } }
      mouse.has = false; inside = false;
    }

    function frame(now) {
      const dt = Math.min((now - lastT) / 1000, 1 / 30) || 1 / 60;
      lastT = now;

      if (!live()) { reset(); running = false; return; }

      /* 循环停不停的判据：这一帧有没有真的写出【新画面】。
         不用"速度小于多少、距离小于多少"这种绝对阈值 ——
         那些值与机器相关（半隐式欧拉在平衡点附近的下限跟帧长有关），
         本地和线上能差三倍，于是线上循环一直不停、本地全绿。 */
      /* 续跑判据：还有字没落定就继续。
         【不能】用"这一帧有没有写出新画面"来判断 ——
         写入阈值是 6e-4，而弹簧慢下来之后每帧位移会小于这个数：
         于是某一帧什么都没写，循环就停了，字却还差着 0.026
         （实测停在 scale 0.974 不动，看起来像"移开鼠标后没完全缩回去"）。
         写入阈值管的是"要不要重绘"，落定判据管的是"算完没有"，两件事不能合并。 */
      let moving = false;

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

        const settled = Math.abs(c.sc - target) < 8e-4 && Math.abs(c.v) < 8e-3;
        if (settled) { c.sc = target; c.v = 0; }
        else moving = true;

        // 只在值真的变了才写。写一次就是一次重绘，
        // 十几个大字每帧无条件重绘，桌面也会掉帧。
        // 另外回到 1 时必须把内联样式清掉，不能因为"差值小于阈值"就留一个 scale(1.0002)。
        const needClear = c.sc === 1 && c.wrote !== 1;
        if (needClear || Math.abs(c.sc - c.wrote) > 6e-4) {
          c.el.style.transform = c.sc === 1 ? '' : 'scale(' + c.sc.toFixed(4) + ')';
          c.wrote = c.sc;
        }
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

    welcome.addEventListener('pointerenter', (e) => {
      inside = true;
      mouse.x = e.clientX; mouse.y = e.clientY; mouse.has = true;
      last = { x: e.clientX, y: e.clientY };   // 别从上次离开的地方补一串
      kick();
    }, { passive: true });

    welcome.addEventListener('pointermove', (e) => {
      mouse.has = true; inside = true;
      mouse.x = e.clientX; mouse.y = e.clientY;
      trail(e.clientX, e.clientY);
      kick();
    }, { passive: true });

    welcome.addEventListener('pointerleave', () => { inside = false; kick(); }, { passive: true });

    /* 滚过一屏之后要复位 —— 这件事不能只挂在 frame 里的那道闸上：
       循环很可能早就自己停了，停了就没人再进 frame，复位也就永远不会发生，
       放大态会一直留在 DOM 上（欢迎页已经 visibility:hidden，看不见，
       但滚回来就会看到几个字还是大的）。
       水波纹的自动生成也在这里一起点火／灭火。 */
    addEventListener('scroll', () => {
      if (live()) {
        if (!idleT) scheduleIdle();
        if (!deepT) scheduleDeep();
      } else {
        clearTimeout(idleT); idleT = 0;
        clearTimeout(deepT); deepT = 0;
        if (mouse.has || chars.some(c => c.sc !== 1) || aliveCount()) reset();
        running = false;
      }
    }, { passive: true });

    // 字体换入会改变标题的排版（子集字体和回退字体的字宽不一样），
    // 位置必须重量一次，否则影响半径会照着旧的字号算。
    measure();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    addEventListener('load', measure);
    let rt = 0;
    addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(measure, 150); });

    // 开场先等预加载遮罩走完（1.25s 动画 + 淡出 + 0.42s），别在遮罩背后空放波纹。
    // 深水层更晚一点 —— 水面应该先静一下，再慢慢"活"过来。
    scheduleIdle(2600);
    scheduleDeep(3800);

    /* 调试钩子，和 __scrub() 一套思路：
       让测试能直接问"循环还跑着吗、还有几圈波纹在跑"，
       而不是靠帧率或截图间接猜。 */
    window.__welcomeFx = () => ({
      running,
      inside,
      radius: Math.round(radius),
      chars: chars.map(c => +c.sc.toFixed(4)),
      rings: aliveCount(),
      deep: deepPool.reduce((n, el) => n + (isRunning(el) ? 1 : 0), 0),
      ringPos: pool.filter(el => el.__a && el.__a.playState === 'running')
        .map(el => {
          const m = el.style.transform.match(/translate3d\(([-\d.]+)px,\s*([-\d.]+)px/);
          return m ? [Math.round(+m[1]), Math.round(+m[2])] : null;
        }).filter(Boolean),
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
