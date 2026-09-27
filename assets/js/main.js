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
      // 整块上浮压到 0.09：逐字散开已经把"往上飞"这件事做足了。
      // 两层都按原来的 0.2 叠起来，字会整体冲出屏幕顶端，
      // 反而看不清"散开"这个动作本身 —— 两个位移叠在一起就只剩位移了。
      welcome.style.setProperty('--wy', `${(-y * 0.09).toFixed(1)}px`);
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
  const shardCv = $('#shards');
  const titleEl = $('.welcome__title');
  const bodyEl  = $('.welcome__body');

  /* 两道闸门分开：
     · 逐字（散开 + 悬停）—— 散开只是十个字的 transform + opacity，纯合成器操作，
       手机上完全跑得起；被挡住的只有【悬停】那部分，因为触屏根本没有 hover。
     · 背景箔片 —— 一个每帧重绘的 canvas，属于"按设备给量"的东西：
       数量在第 12 节里按设备分档，并且会按实测帧时自动降级。 */
  const canChars = !!(welcome && shardCv && titleEl && bodyEl && !reduce);
  const canPointer = !isTouch;

  if (canChars) {
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
        const i = chars.length;
        chars.push({
          el: s, cx: 0, cy: 0, h: 120, sc: 1, v: 0, tf: '',
          i,
          /* 散开的方向和幅度按序号算出来，不用随机数：
             刷新一次变一个样会显得没设计过；而且【奇偶反向】——
             相邻的字往两边飞，读起来才是"炸开"，
             同向的话像一阵风吹过，就散了。 */
          sx: (i % 2 ? 1 : -1) * (.3 + ((i * 37) % 100) / 100 * 1.0),
          rot: (i % 2 ? 1 : -1) * (5 + ((i * 53) % 100) / 100 * 12),
        });
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
        c.h = c.el.offsetHeight;        // 散开的位移量按字高算，跟着字号走
      }
      // 影响半径跟着字号走。字号是 clamp 出来的（手机 55px / 桌面 152px），
      // 写死 px 的话小屏上会"一次弹起一整行"，就谈不上逐个了。
      if (chars[0]) radius = Math.max(120, chars[0].el.offsetHeight * 2.1);
    }


    /* ══════════ 标题逐字：这一部分仍然需要 rAF ══════════
       弹簧是每帧积分出来的，没法交给合成器。但它只在鼠标悬停时跑，
       而且收敛之后就自己停。 */

    /* ══════════ 揭幕：整屏文字散开飞走 ══════════
       这是全站唯一一个"编排过的时刻"（见下面 frame 里的说明）。
       进度由【滚动位置】驱动，和悬停弹簧共用同一个写入点 ——
       两个效果都要写 transform，分开写必然互相覆盖。 */
    const SCAT_VH = .55;        // 散开占 0 → 0.55 屏
    const SCAT_STAGGER = .045;  // 每个字晚启动一点，形成"依次飞走"的波
    let scat = 0;               // 当前进度（阻尼跟随，滚轮再快也不会跳）

    const mouse = { x: 0, y: 0, has: false };
    let inside = false;
    let running = false, lastT = 0;

    // 滚过一屏 / 标签页切走就别再动了
    const live = () => window.scrollY < innerHeight * .98 && !document.hidden;

    function reset() {
      for (const c of chars) {
        c.sc = 1; c.v = 0;
        if (c.tf !== '') { c.el.style.transform = ''; c.el.style.opacity = ''; c.tf = ''; }
      }
      scat = 1;                 // 已经滚过欢迎页，进度就停在"完全散开"
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

      /* ── 揭幕进度 ──
         阻尼跟随（τ=80ms），所以滚轮一格一格地跳，字也是连续飞的。
         到位之后精确吸附，循环才能停。 */
      const st = Math.min(1, Math.max(0, window.scrollY / (innerHeight * SCAT_VH)));
      if (Math.abs(st - scat) > .0015) {
        scat += (st - scat) * (1 - Math.exp(-dt / .08));
        moving = true;
      } else scat = st;

      const span = Math.max(.15, 1 - SCAT_STAGGER * (chars.length - 1));

      for (const c of chars) {
        let target = 1;
        // 只在这块屏还"平"的时候响应悬停：散开之后字已经不在原位，
        // 再按原始坐标算距离就是对着一片空气做弹簧
        if (inside && scat < .15) {
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

        /* 逐字散开：序号越大启动越晚，形成一道从左到右的波。
           smoothstep 让起步和收尾都不生硬；
           淡出只发生在后 60%，前 40% 是"完整地飞出去"——
           一开始就淡会看不清散开这个动作本身。 */
        const lp = Math.min(1, Math.max(0, (scat - c.i * SCAT_STAGGER) / span));
        const e = lp * lp * (3 - 2 * lp);
        const ty = -e * c.h * .95;
        const tx = e * c.sx * c.h;
        const rot = e * c.rot;
        const s = c.sc * (1 - e * .16);
        const op = 1 - Math.max(0, (e - .4) / .6);

        // 只在值真的变了才写。写一次就是一次重绘，
        // 十几个大字每帧无条件重绘，桌面也会掉帧。
        // 回到静止时必须把内联样式清掉，不能留一个 scale(1.0002) 在那儿。
        let tf = '';
        if (e > 0 || c.sc !== 1) {
          tf = 'translate3d(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px,0)' +
            ' rotate(' + rot.toFixed(2) + 'deg) scale(' + s.toFixed(4) + ')';
        }
        if (tf !== c.tf) {
          c.el.style.transform = tf;
          c.el.style.opacity = (e > 0 && op < .999) ? op.toFixed(3) : '';
          c.tf = tf;
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

    // 触屏没有 hover，这三个监听整个不挂 —— 挂了只会让"手指划过时的指针位置"
    // 混进悬停弹簧里，把 scroll 也当成在悬停
    if (canPointer) {
      welcome.addEventListener('pointerenter', (e) => {
        inside = true;
        mouse.x = e.clientX; mouse.y = e.clientY; mouse.has = true;
        kick();
      }, { passive: true });

      welcome.addEventListener('pointermove', (e) => {
        mouse.has = true; inside = true;
        mouse.x = e.clientX; mouse.y = e.clientY;
        kick();
      }, { passive: true });

      welcome.addEventListener('pointerleave', () => { inside = false; kick(); }, { passive: true });
    }

    /* 滚过一屏之后要复位 —— 这件事不能只挂在 frame 里的那道闸上：
       循环很可能早就自己停了，停了就没人再进 frame，复位也就永远不会发生，
       放大态会一直留在 DOM 上（欢迎页已经 visibility:hidden，看不见，
       但滚回来就会看到几个字还是大的）。 */
    addEventListener('scroll', () => {
      if (live()) {
        // 滚动位置驱动逐字散开，所以滚动时也必须把循环叫醒 ——
        // 少了这一句，滚动只会停在一个已经没人更新的画面上
        kick();
      } else {
        if (mouse.has || chars.some(c => c.sc !== 1)) reset();
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

    /* 调试钩子，和 __scrub() 一套思路：
       让测试能直接问"循环还跑着吗、进度到哪了"，
       而不是靠帧率或截图间接猜。 */
    window.__welcomeFx = () => ({
      running,
      inside,
      radius: Math.round(radius),
      scat: +scat.toFixed(4),
      chars: chars.map(c => +c.sc.toFixed(4)),
    });

    /* 再开一个口子给测试把弹簧的阻尼调大。
       弹簧参数在闭包里，从外面没有任何别的办法造出一个"不弹"的对照组 ——
       而没有对照组，"放大是 Q 弹的"这条断言就没法证明它真的会失败，
       等于一句自我感觉良好的空话。生产路径不会碰它。 */
    window.__welcomeFx.damp = (k, c) => { CH_K = k; CH_C = c; };
  }

  /* ---------------------------------------------------------
     12. 欢迎页背景：风中的折叠箔片（照着 reactbits 的 Aero Shards）
     ---------------------------------------------------------
     原版是 WebGPU 组件：vgpu 依赖、WGSL 着色器、三千多个实例，
     外加泛光/颗粒/色散三档后处理。这个站是零依赖的静态站 ——
     把一整套 WebGPU 管线搬进来既不现实、也不符合这个站一贯的取舍，
     而且 WebGPU 到现在都没有广泛支持：搬进来的结果是相当一部分访客
     只看到一片空白。所以这里用 Canvas 2D 复刻它的【观感】。

     复刻的核心是【折过的四边形】：
       · 六个顶点、两个三角面，中间的折痕（z 从 0 抬到 0.34）让两个面的
         法线朝向不同 —— 同一片箔上于是有了明暗两面。这是整个效果的命根子，
         没有折痕就只是几百块飘着的色块。
       · 每帧把六个顶点做三维旋转、再透视投影，按各自法线与光线的夹角着色：
         背光压暗、迎光推向亮色，正对光的才吃高光。
       · 三百多片沿一条风道流动，各自带横向车道偏移和深度（远的更小更暗）。

     性能帐：每片的数学只有几十次浮点，瓶颈在 Canvas 的填充次数上
     （每片两个三角形）。所以数量按设备分档，并且会按【实测帧时】自动降级 ——
     这和原版的运行时降级是同一个思路，只是它的档位在 GPU 侧。
     --------------------------------------------------------- */
  if (shardCv && !reduce) {
    const g2 = shardCv.getContext('2d', { alpha: true });
    if (g2) {
      /* 用户指定的两个颜色（reactbits 那个链接里的 shardColor / accentColor）。
         底色用站里的墨黑，和原版默认的 rgb(18,15,23) 是同一档暗度。 */
      const BASE = [0xae, 0xff, 0x32];
      const HI = [0xcc, 0xff, 0x7f];
      // 光从左上来，和页面里其它高光的方向一致
      const LIGHT = (() => {
        const v = [-0.38, 0.58, 1];
        const m = Math.hypot(...v);
        return v.map(n => n / m);
      })();

      /* 一片箔的局部几何：一条竖脊，两侧各折下去。
         脊上的 z 抬起来（0.34），两侧尖端落到 0 —— 折痕就是这么来的。 */
      const GEO = [
        [0, 1, .34], [-.72, 0, 0], [0, -1, .34],
        [0, 1, .34], [0, -1, .34], [.72, 0, 0],
      ];

      // 按设备给数量：手机少、桌面多。DPR 也夹住，不然高倍屏上填充量翻几倍。
      const isSmall = innerWidth < 820;
      const PRESET = isSmall
        ? { count: 200, dpr: 1.5 }
        : { count: 520, dpr: 2 };
      const DPR = Math.min(devicePixelRatio || 1, PRESET.dpr);

      let W = 0, H = 0, unit = 1, aspect = 1;
      const size = () => {
        W = Math.max(1, Math.round(innerWidth * DPR));
        H = Math.max(1, Math.round(innerHeight * DPR));
        shardCv.width = W; shardCv.height = H;
        // 世界坐标 y ∈ [-1,1] 铺满画面高度，x 按宽高比展开
        unit = H / 2;
        aspect = innerWidth / Math.max(innerHeight, 1);
      };
      size();

      /* 风道：从左到右横穿，带一点上下起伏和前后进深。
         片子在 t=0 和 t=1 两端进出画面，所以看不出接缝。 */
      const pathAt = (t, out) => {
        const w = t * 2 - 1;
        out[0] = w * aspect * 1.18;
        out[1] = Math.sin((t * 1.72 - .2) * Math.PI) * .54 + Math.sin(t * Math.PI * 3) * .12;
        out[2] = Math.cos((t * 2 - .7) * Math.PI) * .22;
        return out;
      };

      const shards = [];
      for (let i = 0; i < PRESET.count; i++) {
        shards.push({
          phase: Math.random(),
          // 横向车道：负几次方让分布中间密、两边疏，和原版的 pow(...,0.72) 一个意思
          lane: Math.sign(Math.random() * 2 - 1) * Math.pow(Math.abs(Math.random() * 2 - 1), .72),
          depth: Math.random() * 2 - 1,
          size: .55 + Math.random() * .95,
          tumble: Math.random() * Math.PI * 2,
          // 翻滚速度分正负：全同向会像一整片在转，不像各自翻飞
          tumbleV: (Math.random() * 2 - 1) * 1.5,
          bright: .82 + Math.random() * .48,
        });
      }

      const pointer = { x: -9, y: -9, px: -9, py: -9, power: 0, active: false };
      // 点击推出的涟漪：年龄越大半径越大、越弱
      const ripples = [];

      const p0 = [0, 0, 0], p1 = [0, 0, 0];
      const f = [0, 0, 0], u = [0, 0, 0], v = [0, 0, 0];
      const pt = [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]];
      const wv = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];

      let travel = 0;
      let last = 0, raf = 0;
      let slow = 0, level = 0;          // 帧时连续偏高就降级
      const COUNT_STEPS = [1, .72, .5];

      const shardLive = () => window.scrollY < innerHeight * .98 && !document.hidden;

      function render(now) {
        raf = 0;
        if (!shardLive()) return;
        const dt = last ? Math.min(.05, (now - last) / 1000) : 1 / 60;
        last = now;
        const t0 = performance.now();

        travel = (travel + dt * .028) % 1;
        for (const r of ripples) r.age += dt;
        while (ripples.length && ripples[0].age > 1.6) ripples.shift();

        // 指针：平滑跟随，松手后力度衰减
        pointer.px += (pointer.x - pointer.px) * Math.min(1, dt * 9);
        pointer.py += (pointer.y - pointer.py) * Math.min(1, dt * 9);
        pointer.power += ((pointer.active ? 1 : 0) - pointer.power) * Math.min(1, dt * 6);

        g2.setTransform(1, 0, 0, 1, 0, 0);
        g2.clearRect(0, 0, W, H);

        const n = Math.round(shards.length * COUNT_STEPS[level]);
        const pointerActive = pointer.power > .02;

        for (let i = 0; i < n; i++) {
          const s = shards[i];
          const t = (s.phase + travel) % 1;
          pathAt(t, p0);
          // 切线用差分算 —— 解析求导没必要，差分的误差在这个尺度上看不出来
          pathAt((t + .002) % 1, p1);
          f[0] = p1[0] - p0[0]; f[1] = p1[1] - p0[1]; f[2] = p1[2] - p0[2];
          let m = Math.hypot(f[0], f[1], f[2]) || 1;
          f[0] /= m; f[1] /= m; f[2] /= m;

          /* 车道偏移：横向铺开。
             宽度包络【不能收到 0】—— 第一版用 (1-|2t-1|)^.5，
             两端归零，于是所有片子在进出口都挤在同一条线上，
             整片看起来只是中间一条带在动，画面上下都是空的。
             现在两端也留 0.5，整幅铺满，中段最宽。 */
          const w = .5 + .5 * (1 - Math.abs(t * 2 - 1)) ** .55;
          const lane = s.lane * 1.15 * w;
          let wx = p0[0] - f[1] * lane;
          let wy = p0[1] + f[0] * lane + s.depth * .12;
          let wz = p0[2] + s.depth * .3;

          // 指针排开：法向推走，越近越强
          const cxp = pointer.px * DPR, cyp = pointer.py * DPR;
          const sx0 = W / 2 + wx * aspect * unit * .5;
          const sy0 = H / 2 - wy * unit * .5;
          if (pointerActive) {
            const dx = (sx0 - cxp) / (150 * DPR), dy = (sy0 - cyp) / (150 * DPR);
            const d2 = dx * dx + dy * dy;
            if (d2 < 1) {
              const push = (1 - d2) * pointer.power * .34;
              const dl = Math.hypot(dx, dy) || 1;
              wx += (dx / dl) * push; wy -= (dy / dl) * push;
            }
          }
          // 点击涟漪：一圈向外扩张的推力
          for (const r of ripples) {
            const rx = (sx0 - r.x * DPR) / (260 * DPR), ry = (sy0 - r.y * DPR) / (260 * DPR);
            const d = Math.hypot(rx, ry);
            const ring = Math.exp(-((d - r.age * 1.9) ** 2) / .012) * (1 - r.age / 1.6);
            if (ring > .02) {
              const dl = d || 1;
              wx += (rx / dl) * ring * .3;
              wy -= (ry / dl) * ring * .3;
            }
          }

          // 正交基：f 是流向，u/v 是横截面上的两个方向
          const ul = Math.hypot(f[1], f[0]) || 1;
          u[0] = -f[1] / ul; u[1] = f[0] / ul; u[2] = 0;
          v[0] = -f[2] * u[1]; v[1] = f[2] * u[0]; v[2] = ul;

          // 绕流向翻滚
          const a = s.tumble + now * .001 * s.tumbleV;
          const ca = Math.cos(a), sa = Math.sin(a);
          const ux = u[0] * ca + v[0] * sa, uy = u[1] * ca + v[1] * sa, uz = u[2] * ca + v[2] * sa;
          const vx = v[0] * ca - u[0] * sa, vy = v[1] * ca - u[1] * sa, vz = v[2] * ca - u[2] * sa;

          // 世界尺寸：近（wz 小）大、远小
          const persp = 1 / Math.max(.62, 1 - wz * .34);
          const sc = s.size * .034 * persp;
          /* sz 比 sx/sy 大：折痕要折得够深，两个面的法线才拉得开，
             同一片箔上才有明显的明暗两面。第一版 sz 和 sy 一样大，
             折角只有 19°，大半箔片看起来就是一块平的色片。 */
          const sx = sc * 1.35, sy = sc * .78, sz = sc * 1.5;

          for (let k = 0; k < 6; k++) {
            const G = GEO[k];
            const lx = G[0] * sx, ly = G[1] * sy, lz = G[2] * sz;
            const X = wx + f[0] * lx + ux * ly + vx * lz;
            const Y = wy + f[1] * lx + uy * ly + vy * lz;
            const Z = wz + f[2] * lx + uz * ly + vz * lz;
            const pp = 1 / Math.max(.62, 1 - Z * .34);
            // 世界 → 屏幕：y 轴翻转（世界向上 = 屏幕向上）
            wv[k][0] = (W / 2 + X * aspect * unit * .5 * pp);
            wv[k][1] = (H / 2 - Y * unit * .5 * pp);
            wv[k][2] = Z;
          }

          for (let tri = 0; tri < 2; tri++) {
            const a0 = wv[tri * 3], b0 = wv[tri * 3 + 1], c0 = wv[tri * 3 + 2];
            // 面法线（屏幕空间够用：这里的透视很弱，差不出可见的偏差）
            const e1x = b0[0] - a0[0], e1y = b0[1] - a0[1];
            const e2x = c0[0] - a0[0], e2y = c0[1] - a0[1];
            const nz = e1x * e2y - e1y * e2x;
            if (nz === 0) continue;
            // 屏幕 y 向下，法线的 z 分量取反才和世界一致
            const nl = Math.hypot(e1x, e1y, nz) || 1;
            const nX = -e1y / nl, nY = -nz / nl, nZ = e2x / nl;
            const lit = Math.max(0, nX * LIGHT[0] + nY * LIGHT[1] + nZ * LIGHT[2]);

            /* 环境光下限给到 .34：第一版是 .16，结果大半箔片掉进近黑，
               整幅读起来是"暗绿的碎屑"，而不是参考那种【发光的箔】。
               高光用 lit² 而不是 lit⁴：四次方太窄，只有正对光的那几片才吃得到，
               中等受光的面全落在中间调上，画面就灰了。 */
            const shade = (.34 + .66 * lit) * s.bright;
            const hi = lit * lit;
            const r = BASE[0] * shade * (1 - hi) + HI[0] * shade * hi;
            const gg = BASE[1] * shade * (1 - hi) + HI[1] * shade * hi;
            const bb = BASE[2] * shade * (1 - hi) + HI[2] * shade * hi;
            g2.fillStyle = 'rgb(' + (r | 0) + ',' + (gg | 0) + ',' + (bb | 0) + ')';
            g2.beginPath();
            g2.moveTo(a0[0], a0[1]);
            g2.lineTo(b0[0], b0[1]);
            g2.lineTo(c0[0], c0[1]);
            g2.closePath();
            g2.fill();
          }
        }

        raf = requestAnimationFrame(render);

        /* 帧时监控必须在【画完之后】量，量的必须是这一段画了多久。
           第一版写成 performance.now() - now（now 是 rAF 的时间戳），
           量到的是"回调什么时候开始"，跟渲染开销没关系 ——
           于是自动降级永远不会触发，慢机器上只会一直掉帧。 */
        const cost = performance.now() - t0;
        slow = cost > 9 ? slow + 1 : Math.max(0, slow - 2);
        if (slow > 20 && level < COUNT_STEPS.length - 1) { level++; slow = 0; }
      }

      const wake = () => { if (!raf && shardLive()) { last = 0; raf = requestAnimationFrame(render); } };

      addEventListener('resize', () => {
        size();
        for (const s of shards) s.phase = Math.random();   // 换尺寸时重新布一次，避免挤成一团
        wake();
      }, { passive: true });
      addEventListener('scroll', () => { wake(); }, { passive: true });
      document.addEventListener('visibilitychange', () => { wake(); });

      if (canPointer) {
        addEventListener('pointermove', (e) => {
          pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true;
        }, { passive: true });
        addEventListener('pointerleave', () => { pointer.active = false; }, { passive: true });
        // 点击推一圈涟漪。欢迎页本身点了会往下滚，所以这圈涟漪是"顺手给一下"
        addEventListener('pointerdown', (e) => {
          if (e.target instanceof Element && e.target.closest('a, button')) return;
          ripples.push({ x: e.clientX, y: e.clientY, age: 0 });
        }, { passive: true });
      }

      /* 第一帧画完再淡入，避免开场先闪一下空画布。
         先画一帧再挂牌，所以这里手动调一次。 */
      last = 0;
      raf = requestAnimationFrame((t) => {
        render(t);
        shardCv.classList.add('is-ready');
      });

      window.__shards = () => ({
        running: !!raf,
        count: Math.round(shards.length * COUNT_STEPS[level]),
        level,
        travel: +travel.toFixed(4),
        ripples: ripples.length,
      });
    }
  }

  /* ---------------------------------------------------------
     10. 杂项
     --------------------------------------------------------- */
  $('#year').textContent = new Date().getFullYear();

  // 占位链接不要跳走
  $$('a[href="#"]').forEach(a => a.addEventListener('click', e => e.preventDefault()));
})();
