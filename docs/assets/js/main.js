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
     原版是 WebGPU 组件：vgpu 依赖、WGSL 着色器、3200~4800 个实例，
     外加泛光/颗粒/色散三档后处理。这个站是零依赖的静态站 ——
     把一整套 WebGPU 管线搬进来等于推倒重来，而且 WebGPU 到现在都没有
     广泛支持：搬进来的结果是相当一部分访客只看到一片空白。
     所以这里用 Canvas 2D 复刻它的【观感】，公式照着原版着色器抄。

     照抄的部分（改了会立刻看出不像，别凭感觉动）：
       · 折过的四边形。六个顶点、两个三角面，折痕把 z 从 0 抬到 0.34，
         两个面的法线于是不同 —— 这是整个效果的命根子，没有折痕就只是
         几百块飘着的色块。（原版 shardVertex()，这里逐字一样）
       · fullPath() 的流线、world → NDC 的投影、1/max(.62,1-z*.34) 的透视。
         投影这里踩过一次：世界坐标里【一个单位铺满整屏】（不是半个），
         少乘这一下整条风道会被压扁一半，画面上下都空着。
       · 车道分布、宽度包络、碎片尺寸分布 —— 原版 vs_main 里那几行。
         尺寸里的 pow(seedScale,12)*1.55 是关键：它甩出极少数大片，
         于是画面同时有"细屑"和"大箔"两层，全用中等尺寸就死板了。
       · pearl 材质的 BRDF：两个 softbox 反射 + 53.8 次方的高光 + 菲涅尔
         + ACES 色调映射。这一块是"发光的箔"和"几百块色片"的分界线 ——
         高光的形状决定了金属感，凭感觉调不出来。
       · 指针力场：沿流向弯曲的高斯。峰值位移只有 ~32px，而且落在离光标
         150px 开外 —— 它靠长尾【把箔片拨开】，从不把一块区域清空。
         第一版写成 (1-d²) 硬边界、推力还大于半径，光标底下才会是个黑洞。
       · 涟漪：sin(age*10)*exp(-age*3.2) 的波，径向推走 + 顺带提亮。

     没搬的：泛光/色散（Canvas 2D 里做不起，而且这个站本来就有一层颗粒
     滤镜）、ASCII/dither（原版的可选效果，默认不开）、GPU 实例化。

     性能帐：每片的数学只有几十次浮点，瓶颈在 Canvas 的填充次数上
     （每片两个三角形）。所以数量按设备分档，并且会按【实测帧时】自动降级 ——
     这和原版的运行时降级是同一个思路，只是它的档位在 GPU 侧。
     --------------------------------------------------------- */
  if (shardCv && !reduce) {
    const g2 = shardCv.getContext('2d', { alpha: true });
    if (g2) {
      const PI = Math.PI;
      const sat = v => (v < 0 ? 0 : v > 1 ? 1 : v);
      const sstep = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
      const mixN = (a, b, t) => a + (b - a) * t;

      /* ---- 颜色 ----
         碎片本体用站里的高亮色 --neon #d2ff00（用户指定"换成网站高亮色"），
         迎光面由 accentColor #ccff7f 按 pearl 的 highlightMix=0.78 混白 ——
         这是原版的算法，不是随手提亮：混白比例决定了高光有多"珍珠"。 */
      const SR = 0xd2 / 255, SG = 0xff / 255, SB = 0x00 / 255;
      const AR = 0xcc / 255, AG = 0xff / 255, AB = 0x7f / 255;
      const HM = .78;
      const HR = mixN(AR, 1, HM), HG = mixN(AG, 1, HM), HB = mixN(AB, 1, HM);

      /* ---- 材质与光：material="pearl" 的预设，光的方向是原版的 [-.38,.58,1] ---- */
      const ROUGH = .46, BRIGHT = .92, GLOW = .54;
      const EXPOSURE = 1.12;                    // 暗底 lightSurface=0 → 1.12
      const SPEC_POW = mixN(92, 9, ROUGH);      // 53.8
      const BROAD_GAIN = mixN(.3, .86, 1 - ROUGH);
      const FRES_GAIN = .15 + GLOW * .16;
      const LL = Math.hypot(-.38, .58, 1);
      const KX = -.38 / LL, KY = .58 / LL, KZ = 1 / LL;
      const SBOX_AR = -.34, SBOX_AY = .28, SBOX_AW = .52 + ROUGH * .3, SBOX_AH = .22 + ROUGH * .3;
      const SBOX_BR = .48, SBOX_BY = -.08, SBOX_BW = .12, SBOX_BH = .72;
      const FACET_NX = .394903, FACET_NZ = .918723;

      /* ---- 流动参数：speed/spread/depth/turbulence/spin 全是默认值 1 ---- */
      const TURB = .36;
      const STRETCH = 1.034;
      const SPEED = .34;                        // flowDistance += dt*speed*.34
      const ROLL_RATE = 2.4;
      const SHARD_W = .0125 * 1.1 * .96;        // shardWorldSize × shardSize × detail

      /* ---- 交互：interaction="repel" / radius 1.5 / strength .5 ----
         原版把 radius 再 ×2 才进 uniform，0.54 已经是换算完的世界单位。 */
      const I_RADIUS = .18 * 1.5 * 2;
      const I_STRENGTH = .5;
      const SHIFT = .36, BEND = .65;
      const PEAK_X = .6455, PEAK_V = .3916;     // x*exp(-1.2x²) 的极值点与极值

      /* ---- 涟漪：原版的 RIPPLE_SPEED / RIPPLE_TAIL ---- */
      const R_SPEED = 4.2, R_TAIL = 1.8;

      /* ---- 分布：用原版的 hashU32，让碎片分布和原版【逐位一致】 ----
         换成 Math.random() 也能跑，但那就不是同一片风了：
         尺寸分布里 pow(seed,12) 那一项的形状完全取决于随机数的分布。 */
      const hashU32 = v => {
        const s = (Math.imul(v, 747796405) + 2891336453) >>> 0;
        const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s), 277803737) >>> 0;
        return ((w >>> 22) ^ w) >>> 0;
      };
      const uf = v => hashU32(v) * (1 / 4294967296);

      /* fullArc：原版 32 项查表。它不是恒等映射（起步比线性慢一点），
         所以碎片在流线上的疏密不是均匀的 —— 省掉这一项，密度的呼吸感就没了。 */
      const ARC = new Float32Array([
        0.000000, 0.028092, 0.055939, 0.083892, 0.112291, 0.141449, 0.171637, 0.203033,
        0.235650, 0.269282, 0.303537, 0.337982, 0.372308, 0.406392, 0.440263, 0.474026,
        0.507794, 0.541636, 0.575553, 0.609470, 0.643257, 0.676761, 0.709855, 0.742465,
        0.774594, 0.806319, 0.837790, 0.869218, 0.900862, 0.933020, 0.965991, 1.000000,
      ]);
      const arcAt = ph => {
        const s = (ph < 0 ? 0 : ph > .999999 ? .999999 : ph) * 31;
        const i = s | 0;
        return ARC[i] + (ARC[i + 1] - ARC[i]) * (s - i);
      };

      /* 折过的四边形：一条竖脊，两侧各折下去。脊上的 z 抬到 0.34，折痕就是这么来的。 */
      const GEO = [
        [0, 1, .34], [-.72, 0, 0], [0, -1, .34],
        [0, 1, .34], [0, -1, .34], [.72, 0, 0],
      ];

      /* 数量按设备给量。原版 medium 档是 3200×1.5=4800 个实例 ——
         WebGPU 里这不算什么，Canvas 2D 每片要两次 fill，账完全不一样。
         但也不能按"每片看起来还行"去给：碎片铺满画面的比例决定了它读起来是
         【发光的箔】还是【撒了一地的绿纸屑】。900 片时覆盖只有 1.2%，
         那个密度下多数碎片退化成"一条细缝"，整幅就散掉了。
         原版那个数量对应的覆盖在百分之十几，这里按帧时余量取到接近一半。
         仍然会按实测帧时自动降级，档位就是下面的 COUNT_STEPS。 */
      const isSmall = innerWidth < 820;
      const PRESET = isSmall ? { count: 800, dpr: 1.5 } : { count: 2600, dpr: 2 };
      const DPR = Math.min(devicePixelRatio || 1, PRESET.dpr);

      let W = 0, H = 0, aspect = 1, pathLen = 1;
      const size = () => {
        W = Math.max(1, Math.round(innerWidth * DPR));
        H = Math.max(1, Math.round(innerHeight * DPR));
        shardCv.width = W; shardCv.height = H;
        aspect = W / Math.max(H, 1);
        pathLen = Math.hypot(2.44 * aspect, Math.sqrt(5));
      };
      size();

      /* 每片只算一次的量。之后每帧只做与相位有关的部分。 */
      const shards = [];
      for (let i = 0; i < PRESET.count; i++) {
        const seedPhase = uf((Math.imul(i, 1664525) + 1013904223) >>> 0);
        const seedLane = uf((Math.imul(i, 2246822519) + 3266489917) >>> 0);
        const seedDepth = uf((Math.imul(i, 668265263) + 374761393) >>> 0);
        const seedScale = uf((Math.imul(i, 1597334677) + 3812015801) >>> 0);
        const looseSeed = uf((Math.imul(i, 3266489917) + 668265263) >>> 0);
        const signed = seedLane * 2 - 1;
        const xMul = mixN(.72, 1.08, seedLane), yMul = mixN(.82, 1.12, seedDepth);
        const local = new Float64Array(18);
        for (let k = 0; k < 6; k++) {
          local[k * 3] = GEO[k][0] * xMul + (seedDepth - .5) * (1 - Math.abs(GEO[k][1] * yMul)) * .16;
          local[k * 3 + 1] = GEO[k][1] * yMul;
          local[k * 3 + 2] = GEO[k][2];
        }
        shards.push({
          seedPhase, seedLane, seedDepth,
          lane: (signed < 0 ? -1 : 1) * Math.pow(Math.abs(signed), .72),
          looseMul: 1 + sstep(.92, 1, looseSeed) * .72,
          depthBase: seedDepth * 2 - 1,
          rollOff: seedLane * 2 * PI,
          rollDir: mixN(-1.5, 1.7, seedDepth),
          // pow(seed,12) 是原版故意留的尾巴：绝大多数碎片很小，偶发一片大的
          sizeBase: SHARD_W * (.46 + seedScale * .58 + Math.pow(seedScale, 12) * 1.55),
          local,
        });
      }

      const pointer = { x: -9, y: -9, presence: 0, active: false };
      const hold = { id: null, amount: 0, vel: 0, phase: 0, t: 0 };
      const ripples = [];

      const px6 = new Float64Array(6), py6 = new Float64Array(6);
      let travel = 0, flowDist = 0;
      let last = 0, raf = 0;
      let level = 0, lastCost = 0;
      let frames = 0, pressure = 0, calm = 0, lastChange = 0;
      const WARMUP = 90;                        // 前 ~1.5s 不计入判据
      const COUNT_STEPS = [1, .72, .5];

      const shardLive = () => window.scrollY < innerHeight * .98 && !document.hidden;

      function render(now) {
        raf = 0;
        if (!shardLive()) return;
        const dt = last ? Math.min(.05, (now - last) / 1000) : 1 / 60;
        last = now;
        const t0 = performance.now();

        flowDist += dt * SPEED;
        travel = (travel + (dt * SPEED) / pathLen) % 1;

        /* 指针：离开时衰减得比进入慢，力场是"缓缓散开"而不是"啪一下没"。
           原版是临界阻尼弹簧，这里指数逼近同一件事，差在看不出。 */
        const pr = pointer.active ? 24 : 12;
        pointer.presence += ((pointer.active ? 1 : 0) - pointer.presence) * Math.min(1, dt * pr);
        if (pointer.presence < .001) pointer.presence = 0;

        const pWorldX = (2 * (pointer.x * DPR) / W - 1) * aspect;
        const pWorldY = 1 - 2 * (pointer.y * DPR) / H;
        // repel 取负；按住聚拢时把力场让出去
        const force = -I_STRENGTH * pointer.presence * (1 - hold.amount);

        /* 按住聚拢：短按仍然只是涟漪，按住超过 0.15s 才开始聚（原版同此）。 */
        const prevT = hold.t;
        hold.t = hold.id === null ? 0 : hold.t + dt;
        const engaging = hold.id !== null && hold.t > .15;
        const step = engaging && prevT < .15 ? hold.t - .15 : dt;
        const want = engaging ? 1 : 0;
        const resp = engaging ? 3.8 : 3.2;
        const dec = Math.exp(-resp * step);
        const o = hold.amount - want;
        const mom = hold.vel + resp * o;
        hold.amount = want + (o + mom * step) * dec;
        hold.vel = (hold.vel - resp * mom * step) * dec;
        if (Math.abs(hold.amount - want) < 1e-4 && Math.abs(hold.vel) < .001) { hold.amount = want; hold.vel = 0; }
        if (hold.amount > 0) hold.phase += dt * (.35 + hold.amount * .5);

        for (const r of ripples) r.age += dt;
        while (ripples.length && ripples[0].age > ripples[0].life) ripples.shift();

        g2.setTransform(1, 0, 0, 1, 0, 0);
        g2.clearRect(0, 0, W, H);

        const n = Math.round(shards.length * COUNT_STEPS[level]);
        const halfW = W / 2, halfH = H / 2;
        // 光跟着指针平移一点，箔面才有"被扫过"的反应（原版 light.w / shape.w）
        const shiftX = (pointer.x * DPR / W - .5) * .38 * pointer.presence;
        const shiftY = (pointer.y * DPR / H - .5) * -.24 * pointer.presence;
        const sAr = SBOX_AR + shiftX * .36, sAy = SBOX_AY + shiftY * .36;
        const sBr = SBOX_BR - shiftX * .2, sBy = SBOX_BY - shiftY * .2;
        const holdAmt = hold.amount, holdPhase = hold.phase;

        for (let i = 0; i < n; i++) {
          const s = shards[i];
          const phase = (s.seedPhase + travel) % 1;
          const t = arcAt(phase);

          // ---- 流线上的位置与切线（fullPath） ----
          const wx0 = mixN(-aspect * 1.22, aspect * 1.22, t);
          const wy0 = Math.sin((t * 1.72 - .2) * PI) * .54 + Math.sin(t * 3 * PI) * .12;
          const wz0 = Math.cos((t * 2 - .7) * PI) * .22;
          const dx0 = aspect * 2.44;
          const dy0 = Math.cos((t * 1.72 - .2) * PI) * 1.72 * PI * .54 + Math.cos(t * 3 * PI) * 3 * PI * .12;
          const dz0 = -Math.sin((t * 2 - .7) * PI) * 2 * PI * .22;
          const dl = Math.sqrt(dx0 * dx0 + dy0 * dy0 + dz0 * dz0) || 1;
          let dxn = dx0 / dl, dyn = dy0 / dl, dzn = dz0 / dl;
          const pnx = -dyn, pny = dxn;          // 横截面里与流向垂直的方向

          // ---- 车道：宽度包络 + 一点流致抖动，少数"散片"甩得更远 ----
          const prof = .46 + Math.pow(Math.max(Math.sin(phase * PI), 0), .72) * .54;
          const flowWave = Math.sin(phase * 37.6991118431 + s.seedDepth * 12);
          const laneW = (s.lane * .56 + flowWave * .055 * TURB) * prof * s.looseMul;
          let rx = wx0 + pnx * laneW;
          let ry = wy0 + pny * laneW;
          let rz = wz0 + s.depthBase + Math.cos(phase * 31.4159265359 + s.seedLane * 8) * .06 * TURB;

          // ---- 指针力场：沿流向弯曲的高斯，长尾、没有硬边界 ----
          if (force < -.0001 || force > .0001) {
            const ox = (pWorldX - rx) / I_RADIUS, oy = (pWorldY - ry) / I_RADIUS;
            const fx = pny, fy = -pnx;
            const along = ox * fx + oy * fy;
            const across = -ox * fy + oy * fx;
            const a2 = along * along;
            const layer = rz / Math.sqrt(1 + rz * rz);
            const bend = (.22 * a2 + .12 * layer * along) / (1 + a2);
            const ca = (across + bend) / (1 + layer * .18);
            const fall = Math.exp(-.28 * a2 - 1.2 * ca * ca);
            const ffx = ox * fall, ffy = oy * fall;
            const proj = ffx * dxn + ffy * dyn;
            const laX = ffx - dxn * proj, laY = ffy - dyn * proj;
            rx += laX * force * SHIFT;
            ry += laY * force * SHIFT;
            // 顺带把流向掰一点：只推位置的话碎片是"平移"过去的，不像被风吹弯
            const bx = dxn + laX * force * BEND, by = dyn + laY * force * BEND;
            const bl = Math.sqrt(bx * bx + by * by + dzn * dzn) || 1;
            dxn = bx / bl; dyn = by / bl; dzn = dzn / bl;
          }

          // ---- 按住聚拢：高斯云，中心密、边缘软，不是一圈硬边 ----
          if (holdAmt > .00001) {
            const radius = Math.sqrt(-2 * Math.log(Math.max(s.seedLane, .0001)));
            const ang = s.seedPhase * 2 * PI + holdPhase * (.3 + s.seedDepth * .18);
            const oX = Math.cos(ang), oY = Math.sin(ang);
            const lay = s.seedDepth * 2 * PI;
            const reach = Math.sqrt((rx - pWorldX) ** 2 + (ry - pWorldY) ** 2);
            const amt = Math.pow(holdAmt, 1 + s.seedDepth * .65 + Math.min(reach, 4) * .12);
            rx += (pWorldX + oX * radius * .2 + Math.sin(lay + holdPhase * .22) * .055 - rx) * amt;
            ry += (pWorldY + oY * radius * .16 + Math.cos(lay * 1.7 - holdPhase * .18) * .055 - ry) * amt;
            rz += ((s.seedDepth - .5) * .42 - rz) * amt;
            const cl = Math.sqrt(oX * oX + oY * oY + Math.sin(lay) ** 2 * .1225) || 1;
            const bx = mixN(dxn, -oY / cl, amt), by = mixN(dyn, oX / cl, amt), bz = mixN(dzn, Math.sin(lay) * .35 / cl, amt);
            const bl = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
            dxn = bx / bl; dyn = by / bl; dzn = bz / bl;
          }

          // ---- 涟漪：一圈向外扩张的波，同时把受波的面提亮 ----
          let rippleLight = 0;
          for (let k = 0; k < ripples.length; k++) {
            const rp = ripples[k];
            const persp = 1 / Math.max(.62, 1 - rz * .34);
            const ddx = rx * persp - rp.x, ddy = ry * persp - rp.y;
            const dist = Math.sqrt(ddx * ddx + ddy * ddy + .0016) - .04;
            const a = rp.age - dist / R_SPEED;
            if (a <= 0 || a >= R_TAIL) continue;
            const wave = Math.sin(a * 10) * Math.exp(-a * 3.2) * sstep(0, .14, a) *
              (1 - sstep(1.4, R_TAIL, a)) * rp.strength * I_STRENGTH;
            if (wave === 0) continue;
            const inv = 1 / (dist + .12);
            const pxw = ddx * inv * wave * .28, pyw = ddy * inv * wave * .28, pzw = wave * .12;
            rx += pxw; ry += pyw; rz += pzw;
            rippleLight += Math.abs(wave);
            const bx = dxn + pxw * .7, by = dyn + pyw * .7, bz = dzn + pzw * .7;
            const bl = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
            dxn = bx / bl; dyn = by / bl; dzn = bz / bl;
          }
          if (rippleLight > 1.5) rippleLight = 1.5;

          // ---- 正交基 + 绕流向翻滚 ----
          const sideX = -dyn, sideY = dxn;
          const facX = -dzn * sideY, facY = dzn * sideX, facZ = dxn * sideY - dyn * sideX;
          const roll = s.rollOff + flowDist * s.rollDir * ROLL_RATE;
          const rc = Math.cos(roll), rs = Math.sin(roll);
          const bsX = sideX * rc + facX * rs, bsY = sideY * rc + facY * rs, bsZ = facZ * rs;
          const bfX = facX * rc - sideX * rs, bfY = facY * rc - sideY * rs, bfZ = facZ * rc;

          // ---- 尺寸：depthScale 近大远小，scaleShape 造出"细屑 + 大箔" ----
          const sizeW = s.sizeBase * mixN(.56, 1.58, sat(rz * .62 + .5));
          const widthW = sizeW * .72, lenW = sizeW * 1.26 * STRETCH;

          const L = s.local;
          for (let k = 0; k < 6; k++) {
            const lx = L[k * 3], ly = L[k * 3 + 1], lz = L[k * 3 + 2];
            const X = rx + dxn * ly * lenW + bsX * lx * widthW + bfX * lz * widthW;
            const Y = ry + dyn * ly * lenW + bsY * lx * widthW + bfY * lz * widthW;
            const Z = rz + dzn * ly * lenW + bsZ * lx * widthW + bfZ * lz * widthW;
            const pp = 1 / Math.max(.62, 1 - Z * .34);
            px6[k] = halfW + (X / aspect) * pp * halfW;
            py6[k] = halfH - Y * pp * halfH;
          }

          // ---- 着色：pearl 材质的 BRDF，逐三角面 ----
          const depthFog = sstep(-.68, .58, rz);
          const dtr = mixN(AR * .52, SR, depthFog);
          const dtg = mixN(AG * .52, SG, depthFog);
          const dtb = mixN(AB * .52, SB, depthFog);
          const bmR = mixN(SR, AR, s.seedLane);
          const bmG = mixN(SG, AG, s.seedLane);
          const bmB = mixN(SB, AB, s.seedLane);
          const fogE = mixN(.42, 1, depthFog) * BRIGHT * EXPOSURE;
          const alpha = mixN(.58, .97, depthFog);
          const aS = alpha.toFixed(3);
          const specDepth = mixN(.82, 1, s.seedDepth);
          const prR = mixN(AR, HR, .18), prG = mixN(AG, HG, .18), prB = mixN(AB, HB, .18);

          // viewDirection / halfDirection 对两个面是同一份
          const vdx = -rx * .08, vdy = -ry * .08;
          const vl = Math.sqrt(vdx * vdx + vdy * vdy + 1) || 1;
          const vnx = vdx / vl, vny = vdy / vl, vnz = 1 / vl;
          const hx0 = KX + vnx, hy0 = KY + vny, hz0 = KZ + vnz;
          const hl = Math.sqrt(hx0 * hx0 + hy0 * hy0 + hz0 * hz0) || 1;
          const hx = hx0 / hl, hy = hy0 / hl, hz = hz0 / hl;
          let c1r = 0, c1g = 0, c1b = 0;

          for (let tri = 0; tri < 2; tri++) {
            const lnx = tri === 0 ? -FACET_NX : FACET_NX;
            const nx = bsX * lnx + bfX * FACET_NZ;
            const ny = bsY * lnx + bfY * FACET_NZ;
            const nz = bsZ * lnx + bfZ * FACET_NZ;

            const dn = nx * KX + ny * KY + nz * KZ;
            const diffuse = dn > 0 ? dn : 0;
            const hn = nx * hx + ny * hy + nz * hz;
            const specular = hn > 0 ? Math.pow(hn, SPEC_POW) : 0;
            const vn = nx * vnx + ny * vny + nz * vnz;
            let fres = 1 - (vn > 0 ? vn : 0);
            fres = fres * fres; fres = fres * fres;
            const facet = mixN(.76, 1, sstep(-.08, .08, nx));

            // reflect(-viewDir, normal)
            const rd = 2 * vn;
            const rxr = rd * nx - vnx, ryr = rd * ny - vny;
            // softbox：exp(-(qx⁴+qy⁴)) —— 方形的柔光箱，两个叠出珍珠那种横竖两道光
            let q1 = (rxr - sAr) / SBOX_AW, q2 = (ryr - sAy) / SBOX_AH;
            if (q1 < 0) q1 = -q1; if (q2 < 0) q2 = -q2;
            q1 *= q1; q2 *= q2;
            const broad = Math.exp(-(q1 * q1 + q2 * q2));
            q1 = (rxr - sBr) / SBOX_BW; q2 = (ryr - sBy) / SBOX_BH;
            if (q1 < 0) q1 = -q1; if (q2 < 0) q2 = -q2;
            q1 *= q1; q2 *= q2;
            const strip = Math.exp(-(q1 * q1 + q2 * q2));

            const lam = (.1 + diffuse * .3) * facet;
            const bGain = broad * BROAD_GAIN * (1 + GLOW * .14);
            const sGain = strip * (.12 + fres * .42);
            const fGain = fres * FRES_GAIN;
            const gGain = (broad * .045 + fres * .075) * GLOW;
            const spec = specular * specDepth;
            let cr = dtr * lam + HR * bGain + AR * sGain + HR * spec + bmR * fGain + AR * gGain;
            let cg = dtg * lam + HG * bGain + AG * sGain + HG * spec + bmG * fGain + AG * gGain;
            let cb = dtb * lam + HB * bGain + AB * sGain + HB * spec + bmB * fGain + AB * gGain;

            if (rippleLight > 0) {
              const g1 = rippleLight * (.85 + fres * .45);
              cr += prR * g1; cg += prG * g1; cb += prB * g1;
            }

            // ACES 色调映射 + 曝光
            cr *= fogE; cg *= fogE; cb *= fogE;
            cr = sat(cr * (2.51 * cr + .03) / (cr * (2.43 * cr + .59) + .14));
            cg = sat(cg * (2.51 * cg + .03) / (cg * (2.43 * cg + .59) + .14));
            cb = sat(cb * (2.51 * cb + .03) / (cb * (2.43 * cb + .59) + .14));
            if (tri === 1) { c1r = cr; c1g = cg; c1b = cb; }

            const a0 = tri * 3;
            g2.fillStyle = 'rgba(' + ((cr * alpha * 255) | 0) + ',' + ((cg * alpha * 255) | 0) +
              ',' + ((cb * alpha * 255) | 0) + ',' + aS + ')';
            g2.beginPath();
            g2.moveTo(px6[a0], py6[a0]);
            g2.lineTo(px6[a0 + 1], py6[a0 + 1]);
            g2.lineTo(px6[a0 + 2], py6[a0 + 2]);
            g2.closePath();
            g2.fill();
          }

          /* 折痕：原版在片元里沿 local.x≈0 加一条窄亮带，两端在 |local.y|>0.78 收掉。
             这里直接把这根脊【描出来】—— 脊就是两个三角面的公共边。
             太小的碎片上这根线不到一个像素，画了也是糊的，所以按屏幕长度跳过。 */
          const egx = px6[2] - px6[0], egy = py6[2] - py6[0];
          if (egx * egx + egy * egy > 9) {
            const cl = .08 + specDepth * .22;
            g2.strokeStyle = 'rgba(' + (((c1r + HR * cl) * alpha * 255) | 0) + ',' +
              (((c1g + HG * cl) * alpha * 255) | 0) + ',' + (((c1b + HB * cl) * alpha * 255) | 0) +
              ',' + aS + ')';
            g2.lineWidth = 1;
            g2.beginPath();
            g2.moveTo(px6[0], py6[0]);
            g2.lineTo(px6[2], py6[2]);
            g2.stroke();
          }
        }

        raf = requestAnimationFrame(render);

        /* 帧时监控必须在【画完之后】量，量的必须是这一段画了多久。
           写成 performance.now() - now（now 是 rAF 的时间戳）量到的是
           "回调什么时候开始"，跟渲染开销没关系 —— 自动降级就永远不会触发。

           降级的判据比"某一帧慢了"严格得多，这里返工过一次：
           第一版是"累计 20 个坏帧就降"，于是在这台机器上跑两次，
           一次落在 2600、一次落在 1300 —— 密度取决于页面加载那一刻的抖动。
           同一个页面刷新两次看到不同密度，比一直用低密度更糟。
           现在：跳过前 1.5s（加载期的抖动不代表稳态）、
           要【连续 1.5s 都超过 12ms】才降（16.7ms 的预算，留 4ms 给别的）、
           两次改动之间有 2.2s 冷却，并且一直很闲时会回升一档。 */
        const cost = performance.now() - t0;
        lastCost = cost;
        frames++;
        if (frames > WARMUP) {
          const nowMs = performance.now();
          if (cost > 12) { pressure++; calm = 0; }
          else if (cost < 7) { calm++; pressure = 0; }
          else pressure = 0;
          if (pressure > 90 && nowMs - lastChange > 2200 && level < COUNT_STEPS.length - 1) {
            level++; pressure = 0; calm = 0; lastChange = nowMs;
          } else if (calm > 720 && nowMs - lastChange > 8000 && level > 0) {
            level--; pressure = 0; calm = 0; lastChange = nowMs;
          }
        }
      }

      const wake = () => { if (!raf && shardLive()) { last = 0; raf = requestAnimationFrame(render); } };

      addEventListener('resize', () => { size(); wake(); }, { passive: true });
      addEventListener('scroll', () => { wake(); }, { passive: true });
      document.addEventListener('visibilitychange', () => { wake(); });

      if (canPointer) {
        addEventListener('pointermove', (e) => {
          pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true;
          wake();
        }, { passive: true });
        addEventListener('pointerleave', () => { pointer.active = false; wake(); }, { passive: true });
        /* 按下推一圈涟漪；按住不放把碎片收拢过来，松手再散开。
           短按仍然只是一圈涟漪 —— 原版也是过了 0.15s 才开始聚。 */
        const pushRipple = (u, v, strength) => {
          ripples.push({
            x: (u * 2 - 1) * aspect, y: 1 - v * 2, age: 0, strength,
            life: Math.hypot((1 + Math.abs(u * 2 - 1)) * aspect, 1 + Math.abs(v * 2 - 1)) / R_SPEED + R_TAIL,
          });
          if (ripples.length > 4) ripples.shift();
        };
        addEventListener('pointerdown', (e) => {
          if (e.target instanceof Element && e.target.closest('a, button, input, textarea, select')) return;
          pushRipple(e.clientX / innerWidth, e.clientY / innerHeight, 1);
          hold.id = e.pointerId; hold.t = 0;
          wake();
        }, { passive: true });
        addEventListener('pointerup', (e) => {
          if (hold.id === null || e.pointerId !== hold.id) return;
          hold.id = null;
          if (hold.amount > .1) {
            pushRipple(pointer.x / innerWidth, pointer.y / innerHeight, 1 + hold.amount * .8);
          }
          wake();
        }, { passive: true });
        addEventListener('pointercancel', () => { hold.id = null; }, { passive: true });
        addEventListener('blur', () => { pointer.active = false; hold.id = null; });
      }

      /* 第一帧画完再淡入，避免开场先闪一下空画布。 */
      last = 0;
      raf = requestAnimationFrame((t) => {
        render(t);
        shardCv.classList.add('is-ready');
      });

      window.__shards = () => {
        const halfCSS = innerHeight / 2;
        const strength = I_STRENGTH * pointer.presence;
        return {
          running: !!raf,
          count: Math.round(shards.length * COUNT_STEPS[level]),
          level,
          travel: +travel.toFixed(4),
          ripples: ripples.length,
          presence: +pointer.presence.toFixed(3),
          hold: +hold.amount.toFixed(3),
          cost: +lastCost.toFixed(2),
          px: Math.round(pointer.x), py: Math.round(pointer.y),
          /* 力场换算成 CSS 像素。峰值位移出现在离光标 ~157px 的地方、
             大小只有 ~32px —— 它把箔片拨开，不会清空一块区域。
             测试直接钉这个数：谁把力调成"推得比够得着还远"，画面就会出现黑洞。 */
          force: {
            radiusPx: Math.round(I_RADIUS * halfCSS),
            peakPx: +(strength * SHIFT * halfCSS * PEAK_V).toFixed(1),
            peakAtPx: Math.round(PEAK_X * I_RADIUS * halfCSS),
          },
        };
      };
    }
  }

  /* ---------------------------------------------------------
     10. 杂项
     --------------------------------------------------------- */
  $('#year').textContent = new Date().getFullYear();

  // 占位链接不要跳走
  $$('a[href="#"]').forEach(a => a.addEventListener('click', e => e.preventDefault()));
})();
