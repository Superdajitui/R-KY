/**
 * test-qtan.mjs — 全站交互元素的"Q弹"检查
 *
 * 用户的要求是"把网站里所有可以互动的地方都做得 q 弹"。
 * 这句话里"所有"是可以验证的，"q 弹"才是难点：
 * 截图只能证明"某个地方动了"，证明不了它是【弹】出去的还是【滑】出去的 ——
 * 单调放大和真弹簧，在静态图上长得一模一样。
 *
 * 所以这里对每一个可互动元素做同一件事：
 *   悬停 → 逐帧量它的位移 → 断言【峰值 > 终值】。
 * "冲过头再退回来"就是欠阻尼，就是 Q 弹。没有过冲就是普通的缓动。
 *
 * 位移用 getBoundingClientRect 统一度量（宽高变化 + 位置变化之和），
 * 这样不管是 scale、translate 还是 transform，都能被同一把尺子量到，
 * 也不用为每个元素写一套读数逻辑。
 *
 * 另外两件必须一起查的事：
 *   · 悬停前基线要【稳】。元素可能还在滚动动效里往位点上飘，
 *     这时候量到的"过冲"是滚动造成的假象，不是弹簧。
 *   · 按下要真的被压小。只弹不压，手感是"碰一下就飘"，不像按钮。
 *
 * 用法: node tools/test-qtan.mjs [url] [--shots]
 */
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { existsSync, mkdirSync } from 'node:fs';

const URL_BASE = process.argv[2] || 'http://127.0.0.1:4321/';
const SHOTS_ON = process.argv.includes('--shots');
const SHOTS = 'tools/shots';
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p));

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`);
  ok ? pass++ : fail++;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ══════════ 被测清单 ══════════
 * hover   —— 鼠标要移到哪个元素上
 * measure —— 量哪个元素的位移（内容位移和容器位移常常不是同一个）
 * area    —— 怎么把它弄到能悬停的位置
 * press   —— 是否可点（可点的才查"按下有没有被压小"）
 *
 * 说明几处 measure 和 hover 不同的：
 *   · 导航项：缩放加在里层 span 上（胶囊底不跟着涨），所以要量 span
 *   · 技能列表：位移挂在内层文字上，li 本身不动（li 里那根进度条是
 *     position:absolute 的"水平尺"，li 一动尺子就跟着跑，百分比就读错了）
 */
const TARGETS = [
  { label: '欢迎页滚动提示', hover: '.welcome__scroll', measure: '.welcome__scroll', area: 'top', press: true },
  { label: '导航 logo', hover: '.nav__logo', measure: '.nav__logo', area: 'nav', press: true },
  { label: '导航项「热爱」', hover: '.nav__links a:nth-child(3)', measure: '.nav__links a:nth-child(3) > span', area: 'nav', press: true },
  { label: '导航「聊聊」按钮', hover: '.nav__cta', measure: '.nav__cta', area: 'nav', press: true },
  { label: '首屏滚动提示', hover: '.hero__scroll', measure: '.hero__scroll', area: 'flow', press: true },
  { label: '热爱区照片', hover: '.passion__figure', measure: '.passion__figure', area: 'flow', press: false },
  { label: '项目卡片', hover: '.card', measure: '.card', area: 'flow', press: true },
  { label: '技能列表项', hover: '.skills__list li', measure: '.skills__list li b', area: 'flow', press: false },
  { label: '邮箱按钮', hover: '.btn--big', measure: '.btn--big', area: 'flow', press: true },
  { label: '页脚「回到顶部」', hover: '.foot__wrap a', measure: '.foot__wrap a', area: 'flow', press: true },
];

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: SHOTS_ON ? 2 : 1 });
const problems = [];
page.on('pageerror', e => problems.push('JS 报错 ' + e.message));
page.on('console', m => { if (m.type() === 'error') problems.push('控制台 ' + m.text()); });
await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
await sleep(2600);

/* 测"按下"要真的按下鼠标，而按下 + 松开 = 一次点击。
   这些元素全是 <a href="#...">，点下去页面真的会跳走 ——
   于是后面每一次测量的基线都在另一个位置上，"过冲"里混进了滚动的位移。
   所以测试期间掐掉哈希跳转：:active 状态照样触发，页面不会被滚走。 */
await page.evaluate(() => {
  document.addEventListener('click', e => {
    const a = e.target instanceof Element && e.target.closest('a[href^="#"]');
    if (a) e.preventDefault();
  }, true);
});

const AWAY = { x: 8, y: 880 };

const rectOf = sel => page.evaluate(s => {
  const r = document.querySelector(s).getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}, sel);

/* 基线必须稳：元素可能还在滚动动效里飘。
   不确认这一点，量到的"过冲"可能就是滚动造成的，白高兴一场。 */
async function waitStable(sel, tries = 16) {
  let prev = null;
  for (let i = 0; i < tries; i++) {
    const r = await rectOf(sel);
    if (prev && Math.abs(r.x - prev.x) < 0.02 && Math.abs(r.y - prev.y) < 0.02 &&
        Math.abs(r.w - prev.w) < 0.02 && Math.abs(r.h - prev.h) < 0.02) return true;
    prev = r;
    await sleep(150);
  }
  return false;
}

/* 还要等到元素身上没有【未完成的 CSS 动画】。
   为什么光有 waitStable 不够：入场动画（首屏那套 fadeUp）带 0.9s 的 delay，
   在 delay 阶段元素是真的一动不动 —— waitStable 只要两次读数一致就放行，
   很容易正好落在 delay 里。然后动画开跑，元素平移 18px，
   采样器把这段当成"悬停位移"，就得到一条 1ms 就到峰值 6px 的假曲线。

   这条不是推理出来的，是自检逼出来的：把弹簧全换成线性之后，
   别的元素过冲都归零了，只有首屏滚动提示还报 4.58px 过冲 ——
   一个"线性缓动却测出过冲"的结果，本身就说明测的不是缓动。
   明细一打，峰值时刻是 @1ms，原因写在脸上。 */
async function waitNoAnimations(sel, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const n = await page.evaluate(s => document.querySelector(s).getAnimations()
      .filter(a => a instanceof CSSAnimation)
      .filter(a => a.effect.getTiming().iterations !== Infinity)   // 常驻循环动画（sway/blink）不算
      .filter(a => a.playState !== 'finished' && a.playState !== 'idle').length, sel);
    if (n === 0) return true;
    await sleep(150);
  }
  return false;
}

async function bringIntoView(t) {
  if (t.area === 'top') {
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1400);                       // 欢迎页要重新露出来
    return true;
  }
  if (t.area === 'nav') {
    // 导航往下滚会被藏起来，滚回来才出现
    await page.evaluate(() => window.scrollTo(0, innerHeight * 3));
    await sleep(700);
    await page.evaluate(() => window.scrollTo(0, innerHeight * 2.5));
    await sleep(900);
    return true;
  }
  await page.evaluate(s => document.querySelector(s)
    .scrollIntoView({ block: 'center', behavior: 'instant' }), t.hover);
  await sleep(1500);
  return true;
}

/* 逐帧量位移。分两段采样：
 *   前 settleMs —— 鼠标还没到，只记录元素自己的状态（"基线窗口"）
 *   之后       —— 以进入第二段那一刻为基准，量悬停带来的位移
 *
 * 量的是【计算样式】而不是 getBoundingClientRect。
 * 这不是洁癖：用视口坐标量过一次，结果全是假的 ——
 *   悬停期间页面只要滚动一点点，元素的视口坐标就整体平移，
 *   这段位移被算进"悬停响应"，于是"峰值出现在中途、终值却很小"。
 *   （首屏滚动提示就这么报出过"过冲 324%"这种离谱数字，
 *     而逐帧打原始数据一看，效果一直是对的：0 → 5.85 → 5.0。）
 * translate / transform / scale 是元素自己的属性，跟页面滚不滚没关系。
 *
 * 三种属性折算到同一把尺子上：translate 直接用 px，
 * transform 取平移分量、缩放分量乘 100（缩放本来就无量纲，
 * 乘 100 只是让它和 px 处在同一量级；反正只比"峰值 vs 终值"的比值）。 */
async function sampleHover(sel, box, settleMs = 420) {
  await page.evaluate((s, settle) => {
    const el = document.querySelector(s);
    // 取数字必须用正则剥单位：Number('5px') 是 NaN，
    // 用 split().map(Number) 解析 "0px 5px" 会得到 [NaN, NaN] ——
    // 而 NaN || 0 是 0，于是"量到位移"变成"永远量到 0"，
    // 报出来的现象是"这个元素没有效果"，去改 CSS 就白改了。
    const nums = v => (v.match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(Number);
    const read = () => {
      const cs = getComputedStyle(el);
      let m = 0;
      if (cs.translate && cs.translate !== 'none') {
        const p = nums(cs.translate);
        m += Math.abs(p[0] || 0) + Math.abs(p[1] || 0);
      }
      if (cs.transform && cs.transform !== 'none') {
        const n = nums(cs.transform);
        if (n.length >= 6) {
          m += Math.abs(n[4]) + Math.abs(n[5]) +
               (Math.abs(n[0] - 1) + Math.abs(n[3] - 1)) * 100;
        }
      }
      if (cs.scale && cs.scale !== 'none') {
        const p = nums(cs.scale);
        const sx = p[0] ?? 1, sy = p[1] ?? p[0] ?? 1;
        m += (Math.abs(sx - 1) + Math.abs(sy - 1)) * 100;
      }
      return m;
    };
    window.__q = []; window.__pre = [];
    const t0 = performance.now();
    let r0 = null;
    const tick = () => {
      const t = performance.now() - t0;
      const v = read();
      if (t < settle) window.__pre.push([+t.toFixed(1), v]);
      else {
        if (r0 === null) r0 = v;
        window.__q.push([+t.toFixed(1), Math.abs(v - r0)]);
      }
      if (t < settle + 950) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, sel, settleMs);

  // 鼠标必须先离开再过去：已经停在同一个点上时，move 到同一坐标不产生新的 hover，
  // 过渡不会重启，采到的会是一条水平线 —— 过冲会变成假的 0。
  await sleep(settleMs + 90);
  await page.mouse.move(box.x, box.y);
  await sleep(950);

  const out = await page.evaluate(() => ({ q: window.__q, pre: window.__pre }));
  const drift = out.pre.length > 1
    ? Math.max(...out.pre.map(p => p[1])) - Math.min(...out.pre.map(p => p[1])) : 0;

  const s = out.q;
  const peak = Math.max(...s.map(p => p[1]));
  const final = s[s.length - 1][1];
  const peakAt = s.find(p => p[1] === peak)[0];
  return { peak, final, over: peak - final, peakAt, frames: s.length, drift, pre: out.pre.length };
}

async function measureTarget(t) {
  await bringIntoView(t);
  const quiet = await waitNoAnimations(t.measure);
  const stable = await waitStable(t.measure);
  await page.mouse.move(AWAY.x, AWAY.y);
  await sleep(700);

  const center = await page.evaluate(s => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, t.hover);
  const restW = (await rectOf(t.measure)).w;

  /* 命中测试：鼠标移过去之前，先确认那个点上【真的】是这个元素。
     少了这一步，"悬停没反应"和"效果没做"在数据上长得一模一样 ——
     都是位移 0、过冲 0，然后你会去改一个本来没坏的 CSS。
     实测踩到过：首屏滚动提示被上面一层盖着，鼠标压根没碰到它。 */
  const hit = await page.evaluate((s, x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return { ok: false, what: '视口外，那个点上什么都没有' };
    const target = document.querySelector(s);
    const ok = el === target || target.contains(el) || el.contains(target);
    const name = el.tagName.toLowerCase() +
      (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : '');
    return { ok, what: name };
  }, t.hover, center.x, center.y);

  const spring = await sampleHover(t.measure, center);
  const rest = await page.evaluate(s => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, t.hover);

  // 按下：可点的元素必须被压小，只弹不压不像按钮
  let press = null;
  if (t.press) {
    await page.mouse.move(rest.x, rest.y);
    await sleep(600);
    await page.mouse.down();
    await sleep(260);
    press = (await rectOf(t.measure)).w / restW;
    await page.mouse.up();
    await sleep(600);
  }

  await page.mouse.move(AWAY.x, AWAY.y);
  await sleep(800);
  const back = await sampleReturn(t.measure);

  /* 结构性诊断：这个元素的 transform 是不是被 CSS 动画占着？
     带 fill:forwards 的动画在层叠里压过普通声明 —— 你写的
     :hover{transform:...} 会被静默无视，表现成"位移 0.00px"，
     和"忘了写效果"长得一模一样。先把原因查出来，别去改没坏的 CSS。 */
  const hijack = await page.evaluate(s => {
    const el = document.querySelector(s);
    return el.getAnimations().filter(a => {
      const t = a.effect.getTiming();
      if (t.fill !== 'forwards' && t.fill !== 'both') return false;
      return a.effect.getKeyframes().some(k => 'transform' in k);
    }).map(a => a.animationName || a.transitionProperty || '?');
  }, t.measure);

  return { stable, quiet, hit, hijack, spring, press, back, frames: spring.frames };
}

/* 松手之后必须真回到原位，不能留一截放大态 */
async function sampleReturn(sel) {
  const r = await page.evaluate(s => {
    const el = document.querySelector(s);
    const r0 = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      w: r0.width,
      transform: cs.transform, translate: cs.translate, scale: cs.scale,
    };
  }, sel);
  return r;
}

console.log('\n════ 全站交互元素：悬停是否 Q 弹（峰值 > 终值）════');
const results = [];
for (const t of TARGETS) {
  const r = await measureTarget(t);
  results.push({ t, r });

  const moved = r.spring.final > 0.05;
  // 过冲门槛用【相对值】：真弹簧过冲 8%~20%，单调缓动是 0。
  // 绝对阈值会被亚像素噪声干扰，相对阈值才分得开。
  const threshold = Math.max(0.05, r.spring.final * 0.02);
  const bouncy = r.spring.over > threshold;

  console.log(`  ${bouncy ? '✓' : '✗'} ${t.label}`);
  console.log(`      基线稳定 ${r.stable ? '✓' : '✗ 还在动，这次测量不可信'}   ` +
    `入场动画已结束 ${r.quiet ? '✓' : '✗ 还在跑'}   ` +
    `鼠标落点 ${r.hit.ok ? '✓ 命中目标' : '✗ 落到了 ' + r.hit.what}   ` +
    `悬停前自漂移 ${r.spring.drift.toFixed(2)}px   ` +
    `位移 ${r.spring.final.toFixed(2)}px  峰值 ${r.spring.peak.toFixed(2)}px  ` +
    `过冲 ${r.spring.over.toFixed(2)}px (${(r.spring.over / Math.max(r.spring.final, 1e-6) * 100).toFixed(0)}%)  @${Math.round(r.spring.peakAt)}ms`);
  if (!r.hit.ok) console.log(`      ⚠ 鼠标没碰到目标（被 ${r.hit.what} 挡住了），这次测的是别人`);
  else if (!r.quiet) console.log(`      ⚠ 元素身上的「${r.hijack.join('、')}」动画还没跑完，量到的是动画不是悬停`);
  else if (r.spring.drift > 0.3) {
    console.log(`      ⚠ 鼠标还没到，元素自己就动了 ${r.spring.drift.toFixed(2)}px —— ` +
      '这段会被算进"悬停响应"，测出来的过冲是假的');
  } else if (!moved && r.hijack.length) {
    console.log(`      ⚠ transform 被 forwards 动画「${r.hijack.join('、')}」占着，` +
      '写在上面的 :hover{transform:...} 会被静默无视 —— 改用 translate / scale 独立属性');
  } else if (!moved) console.log('      ⚠ 悬停后根本没有位移，等于没做效果');
  else if (!bouncy) console.log('      ⚠ 动了，但是单调滑过去的，没有回弹');
  if (r.press !== null) {
    console.log(`      按下宽度 ${(r.press * 100).toFixed(1)}% ${r.press < 0.999 ? '（被压小了 ✓）' : '（没变化 ✗）'}`);
  }
  if (!r.stable || !r.quiet || !r.hit.ok || r.spring.drift > 0.3) fail++;
  else check(bouncy && moved, `　${t.label} 悬停 Q 弹`,
    `过冲 ${r.spring.over.toFixed(2)}px / ${r.spring.final.toFixed(2)}px`);
}

/* --- 可点元素按下必须被压小 --- */
const clickable = results.filter(x => x.r.press !== null);
const notSquashed = clickable.filter(x => x.r.press >= 0.999);
check(notSquashed.length === 0, '所有可点元素按下都会被压小（只弹不压不像按钮）',
  notSquashed.length ? notSquashed.map(x => x.t.label).join('、') : `${clickable.length} 个都压了`);

/* --- 松手后必须真的回到原位 --- */
const stuck = results.filter(x => {
  const b = x.r.back;
  return b.scale !== 'none' && Math.abs(parseFloat(b.scale) - 1) > 0.002
      || b.translate !== 'none' && !/^0px( 0px)?$/.test(b.translate);
});
check(stuck.length === 0, '鼠标移开后所有元素都回到原位（没有留在放大态）',
  stuck.length ? stuck.map(x => `${x.t.label}:${x.r.back.scale}/${x.r.back.translate}`).join(' ') : `${results.length} 个都已归位`);

console.log('\n  控制台问题:', problems.length ? problems.slice(0, 3).join(' | ') : '无');
check(problems.length === 0, '全程无 JS 报错');

/* ══════════════════ 自检：这套断言真的抓得住吗 ══════════════════ */
console.log('\n════ 自检：把弹簧全换成单调缓动，过冲必须消失 ════');
const flatStyle = await page.addStyleTag({
  content: '*{transition-timing-function:linear!important}',
});
await sleep(300);

let stillBouncy = [];
for (const t of TARGETS) {
  const r = await measureTarget(t);
  const threshold = Math.max(0.05, r.spring.final * 0.02);
  const bouncy = r.spring.final > 0.05 && r.spring.over > threshold;
  if (bouncy) stillBouncy.push(`${t.label}(过冲${r.spring.over.toFixed(2)})`);
  console.log(`  ${bouncy ? '✗ 还在弹' : '✓ 不弹了'}  ${t.label}  ` +
    `位移 ${r.spring.final.toFixed(2)}px 峰值 ${r.spring.peak.toFixed(2)}px ` +
    `过冲 ${r.spring.over.toFixed(2)}px @${Math.round(r.spring.peakAt)}ms  ` +
    `基线${r.stable ? '稳' : '不稳'} 命中${r.hit.ok ? '✓' : '✗' + r.hit.what}` +
    (r.hijack.length ? ` 动画占用:${r.hijack.join('/')}` : ''));
}
check(stillBouncy.length === 0, '换成单调缓动后没有任何元素还测得出过冲（证明断言有效）',
  stillBouncy.length ? stillBouncy.join('、') : `${TARGETS.length} 个元素的过冲全部归零`);

/* 自检样式必须摘掉，否则后面全被污染 */
await flatStyle.evaluate(el => el.remove());
await sleep(300);
const restoredSample = await measureTarget(TARGETS[6]);   // 项目卡片
const restoredOver = restoredSample.spring.over > Math.max(0.05, restoredSample.spring.final * 0.02);
check(restoredOver, '摘掉自检样式后过冲立刻恢复（自检没有污染后续测量）',
  `项目卡片过冲回到 ${restoredSample.spring.over.toFixed(2)}px`);

/* ══════════════════ 手机端：没有 hover，只有按下 ══════════════════
   汉堡按钮和全屏菜单只在窄屏出现，桌面上根本测不到。
   这里的关键差异：手机上永远不会有 :hover，反馈【全部】来自按下。
   只弹不压、或者松手是软塌塌滑回去，手感就是"点了没反应"。 */
console.log('\n════ 手机端 390x844：汉堡按钮 + 菜单行 ════');
const mp = await browser.newPage();
await mp.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
const mProblems = [];
mp.on('pageerror', e => mProblems.push('JS 报错 ' + e.message));
await mp.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
await sleep(2600);
/* 导航往下滚会被藏起来，先滚过去再滚回来，它才露出来。
   少了这一步，鼠标会被移动到一个负坐标上 —— 点了个空气，
   读数全是"没变化"，看起来像效果没做。 */
await mp.evaluate(() => window.scrollTo(0, innerHeight * 3));
await sleep(700);
await mp.evaluate(() => window.scrollTo(0, innerHeight * 2.5));
await sleep(1000);
const burgerReady = await mp.evaluate(() => {
  const nav = document.querySelector('.nav');
  const r = document.querySelector('.nav__burger').getBoundingClientRect();
  return { navTop: Math.round(nav.getBoundingClientRect().top),
    hidden: nav.classList.contains('is-hidden'),
    bx: Math.round(r.left + r.width / 2), by: Math.round(r.top + r.height / 2) };
});
check(burgerReady.navTop === 0 && !burgerReady.hidden &&
  burgerReady.by > 0 && burgerReady.by < 844,
  '手机端导航条露出来了、汉堡按钮在视口内（否则下面点的是空气）',
  `navTop=${burgerReady.navTop} 汉堡中心=(${burgerReady.bx},${burgerReady.by})`);

/* 位移读数：取 transform 矩阵里的 e（translateX），带符号 ——
   要验"松手会越过零点"，就必须知道方向，不能只取绝对值。 */
const signedX = s => mp.evaluate(sel => {
  const t = getComputedStyle(document.querySelector(sel)).transform;
  if (t === 'none') return 0;
  const n = (t.match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(Number);
  return n.length >= 6 ? n[4] : 0;
}, s);
const widthOf = s => mp.evaluate(sel => document.querySelector(sel).getBoundingClientRect().width, s);

/* --- 汉堡按钮：按下要缩 --- */
{
  const sel = '.nav__burger';
  const rest = await widthOf(sel);
  const box = await mp.evaluate(s => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel);
  await mp.mouse.move(box.x, box.y);
  await sleep(200);
  await mp.mouse.down();
  await sleep(260);
  const pressed = await widthOf(sel);
  await mp.mouse.up();
  /* 量"恢复原大小"之前必须先把鼠标移开。
     停在原地的话元素还在 :hover，量到的是悬停态的尺寸，不是静止态 ——
     这里就因此报过一次假失败（42px 的按钮量出 45.4px）。 */
  await mp.mouse.move(8, 700);
  await sleep(900);
  const back = await widthOf(sel);
  check(pressed / rest < 0.95, '汉堡按钮按下会被压小', `${(pressed / rest * 100).toFixed(1)}%`);
  check(Math.abs(back - rest) < 0.6, '汉堡按钮松手恢复原大小', `${back.toFixed(1)}px → ${rest.toFixed(1)}px`);
}

/* --- 确保菜单是开着的 ---
   注意：上面"按下 + 松开"本身就已经是一次点击，菜单这时【已经开了】。
   再无条件 click 一次会把它关掉，然后后面所有菜单项的检查
   都会对着一个隐藏的菜单做，读数全是 0 —— 看着像效果没做。 */
if (!await mp.evaluate(() => document.querySelector('.menu').classList.contains('is-open'))) {
  await mp.click('.nav__burger');
  await sleep(900);
}
check(await mp.evaluate(() => document.querySelector('.menu').classList.contains('is-open')),
  '汉堡按钮能把全屏菜单打开');

/* --- 菜单行：按下右移 + 压扁；松手要越过零点弹回来 --- */
{
  const sel = '.menu a:nth-child(2)';
  const restX = await signedX(sel);
  const restW = await widthOf(sel);
  const box = await mp.evaluate(s => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel);

  await mp.mouse.move(box.x, box.y);
  await sleep(150);
  await mp.mouse.down();
  await sleep(240);
  const pressX = await signedX(sel);
  const pressW = await widthOf(sel);

  // 挂采样器再松手：要抓"越过零点"那一下
  await mp.evaluate(s => {
    const el = document.querySelector(s);
    const read = () => {
      const t = getComputedStyle(el).transform;
      if (t === 'none') return 0;
      const n = (t.match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(Number);
      return n.length >= 6 ? n[4] : 0;
    };
    window.__mx = [];
    const t0 = performance.now();
    const tick = () => {
      window.__mx.push([+(performance.now() - t0).toFixed(1), +read().toFixed(3)]);
      if (performance.now() - t0 < 900) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, sel);
  await sleep(60);
  await mp.mouse.up();
  await sleep(950);
  const mx = await mp.evaluate(() => window.__mx);
  const minX = Math.min(...mx.map(p => p[1]));
  const maxX = Math.max(...mx.map(p => p[1]));
  const endX = mx[mx.length - 1][1];

  console.log(`      静止 ${restX.toFixed(1)}px → 按下 ${pressX.toFixed(1)}px（宽 ${(pressW / restW * 100).toFixed(1)}%）` +
    ` → 松手区间 ${minX.toFixed(2)} ~ ${maxX.toFixed(2)}，落在 ${endX.toFixed(2)}px`);
  /* 松手区间的两个数都值得看：
     正的 10.2 = 松手瞬间进入 hover 态（.6rem），弹簧冲过了头；
     负的 -2.06 = 这一行是 <a href="#stats">，鼠标松开就等于点了它，
                  菜单关闭、悬停消失，位移回到 0 的过程中【越过零点】。
     一次测量把"进入弹"和"退出弹"都抓到了。 */

  check(pressX - restX > 3, '菜单行按下会右移', `${(pressX - restX).toFixed(1)}px`);
  check(pressW / restW < 0.99, '菜单行按下会被压扁', `${(pressW / restW * 100).toFixed(1)}%`);
  // 弹簧签名：从正值回零，中间必须【越过】零点变成负的。
  // 一路单调滑回 0 的话，最小值只会趋近 0，不会穿过去。
  check(minX < -0.4, '菜单行松手后越过零点弹回来（欠阻尼的签名）',
    `最低到 ${minX.toFixed(2)}px`);
  check(Math.abs(endX - restX) < 0.5, '菜单行最终稳稳停在原位', `${endX.toFixed(2)}px`);
}

console.log('  手机端控制台问题:', mProblems.length ? mProblems.slice(0, 3).join(' | ') : '无');
check(mProblems.length === 0, '手机端全程无 JS 报错');
await mp.close();

/* ══════════════════ 出图 ══════════════════ */
if (SHOTS_ON) {
  mkdirSync(SHOTS, { recursive: true });
  console.log('\n════ 出图：每个元素 静置 / 悬停 各一张 ════');
  await page.addStyleTag({ content: '.cursor{display:none!important}' });
  for (const [i, t] of TARGETS.entries()) {
    await bringIntoView(t);
    const center = await page.evaluate(s => {
      const r = document.querySelector(s).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, t.hover);
    const box = await page.evaluate(s => {
      const r = document.querySelector(s).getBoundingClientRect();
      const pad = Math.max(40, r.width * 0.12);
      return { left: Math.max(0, r.left - pad), top: Math.max(0, r.top - pad),
        width: Math.min(1440, r.width + pad * 2), height: Math.min(900, r.height + pad * 2) };
    }, t.measure);

    const shot = async (file) => {
      const buf = await page.screenshot();
      const m = await sharp(buf).metadata();
      const sx = m.width / 1440;
      await sharp(buf).extract({
        left: Math.round(box.left * sx), top: Math.round(box.top * sx),
        width: Math.min(Math.round(box.width * sx), m.width - Math.round(box.left * sx)),
        height: Math.min(Math.round(box.height * sx), m.height - Math.round(box.top * sx)),
      }).toFile(file);
    };

    await page.mouse.move(AWAY.x, AWAY.y);
    await sleep(800);
    await shot(`${SHOTS}/qtan-${i}-${t.label}-rest.png`);
    await page.mouse.move(center.x, center.y);
    await sleep(900);
    await shot(`${SHOTS}/qtan-${i}-${t.label}-hover.png`);
    console.log(`  qtan-${i}-${t.label}  ${Math.round(box.width)}x${Math.round(box.height)}`);
  }
}

console.log(`\n${fail === 0 ? '✓ 全部通过' : '✗ ' + fail + ' 项未通过'}（${pass + fail} 项）`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
