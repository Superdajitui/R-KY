/**
 * test-scroll.mjs — 滚动驱动动效（scrub）的回归检查
 *
 * 这类动效最恶心的失败方式不是"不好看"，而是**内容看不见**：
 * 元素初始 opacity:0，等着 JS 把 --p 写上去才显示，
 * 一旦脚本报错、选择器写错、或者某个分支漏了，页面就会缺一块，
 * 而且本地看一眼首屏根本发现不了。
 *
 * 所以这里的核心断言只有一句：
 *   滚到底之后，每一个 data-scrub 元素都必须是完全不透明的。
 * 其余（进度单调、首屏退场、跑马灯响应）都是围着它加的。
 *
 * 用法: node tools/test-scroll.mjs [url]
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const URL_BASE = process.argv[2] || 'http://127.0.0.1:4321/';
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

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'],
});

// 等预加载遮罩走完（1.25s 动画 + 淡出）
const settleFirst = async (page) => {
  await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(2600);
};

/* ══════════════════ 1. 桌面：主流程 ══════════════════ */
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const problems = [];
page.on('pageerror', e => problems.push('JS 报错 ' + e.message));
page.on('console', m => { if (m.type() === 'error') problems.push('控制台 ' + m.text()); });
await settleFirst(page);

console.log('\n════ 桌面 1440x900 ════');

const info = await page.evaluate(() => ({
  scrubCount: document.querySelectorAll('[data-scrub]').length,
  lineCount: document.querySelectorAll('.ln__in').length,
  lineHeadings: document.querySelectorAll('[data-scrub="lines"]').length,
  scrubOff: document.documentElement.classList.contains('scrub-off'),
  mqInner: !!document.querySelector('.marquee__inner'),
}));

check(!info.scrubOff, '滚动动效初始化成功（没有走降级分支）');
check(info.scrubCount >= 12, '注册了足够多的 scrub 元素', `${info.scrubCount} 个`);
check(info.lineCount >= 5, '大标题已拆成行', `${info.lineCount} 行 / ${info.lineHeadings} 个标题`);
check(info.mqInner, '跑马灯外层容器存在');

// 首屏退场的 0 点：在欢迎页时 hero 必须是"没退场"的状态
const atTop = await page.evaluate(() => {
  const hero = document.querySelector('.hero');
  const stage = document.querySelector('.hero__stage');
  return {
    heroP: parseFloat(getComputedStyle(hero).getPropertyValue('--hero-p')) || 0,
    stageOpacity: +getComputedStyle(stage).opacity,
  };
});
check(atTop.heroP <= 0.02, '停在欢迎页时首屏没有退场', `--hero-p=${atTop.heroP}`);
check(atTop.stageOpacity > 0.99, '首屏内容完全可见', `opacity=${atTop.stageOpacity}`);

/* --- 分步滚到底，记录每个元素的 --p ---
   注意要量的目标有两类：
     1. [data-scrub] 元素本身（lines 除外 —— 那个的 --p 写在拆出来的行上，
        标题容器自己根本不带 --p，量它会永远是 0）；
     2. 由 lines 拆出来的每一行 .ln__in。 */
const STEPS = 26;
const trace = [];      // trace[step] = [{k, p}]
const vh = 900;
const maxScroll = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
const readP = () => page.evaluate(() => {
  const els = [
    ...document.querySelectorAll('[data-scrub]:not([data-scrub="lines"])'),
    ...document.querySelectorAll('.ln__in'),
  ];
  return els.map((el, idx) => ({
    k: idx,
    sel: el.dataset.scrub || 'line',
    p: parseFloat(el.style.getPropertyValue('--p') || '0'),
  }));
});

for (let i = 0; i <= STEPS; i++) {
  await page.evaluate(y => window.scrollTo(0, y), Math.round((i / STEPS) * maxScroll));
  await sleep(340);   // 等阻尼追平（时间常数 85ms，四个常数足够）
  trace.push(await readP());
}

// 停在底部再等一会儿，让最后一段阻尼彻底收敛。
// 只等 340ms 的话剩余误差约 1.8%，会卡在"到底算不算到位"的边界上 ——
// 那是测量的时间不够，不是动画没做完。
await sleep(1000);
trace.push(await readP());

/* --- 断言 1：进度单调不减 --- */
let nonMono = 0;
for (let k = 0; k < trace[0].length; k++) {
  let prev = -1;
  for (const row of trace) {
    const p = row[k].p;
    if (p < prev - 0.02) nonMono++;
    prev = Math.max(prev, p);
  }
}
check(nonMono === 0, '四滚动过程中进度只增不减（可往回擦）', `异常 ${nonMono} 处`);

/* --- 断言 2：滚到底全部到位 --- */
const final = trace[trace.length - 1];
const notDone = final.filter(r => r.p < 0.99);
check(notDone.length === 0, '滚到底后所有 scrub 元素进度都到 1',
  notDone.length ? notDone.map(r => `${r.sel}:${r.p.toFixed(2)}`).join(' ') : `${final.length} 个`);

/* --- 断言 3：滚到底没有内容被藏在透明里（最关键的一条）--- */
const vis = await page.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll('[data-scrub]')) {
    const o = +getComputedStyle(el).opacity;
    if (o < 0.99) bad.push(`${el.className || el.tagName}:${o}`);
  }
  const lines = [...document.querySelectorAll('.ln__in')]
    .filter(el => !/matrix\(1, 0, 0, 1, 0, 0\)|none/.test(getComputedStyle(el).transform))
    .map(el => getComputedStyle(el).transform);
  const bars = [...document.querySelectorAll('.skills__list i')]
    .map(el => getComputedStyle(el).transform);
  return { bad, lines, bars };
});
check(vis.bad.length === 0, '滚到底没有任何 scrub 元素停在透明状态',
  vis.bad.length ? vis.bad.slice(0, 5).join(' ') : '全部不透明');
check(vis.lines.length === 0, '标题每一行都推到位了', `${vis.lines.length} 行未到位`);
// scaleX ≈ 1 → matrix(1, 0, 0, 1, 0, 0)
check(vis.bars.every(t => /matrix\(1, 0, 0, 1, 0, 0\)/.test(t)), '技能进度条全部铺满',
  `${vis.bars.filter(t => !/matrix\(1, 0, 0, 1, 0, 0\)/.test(t)).length} 条未满`);

/* --- 断言 4：首屏退场可逆 --- */
await page.evaluate((v) => window.scrollTo(0, v * 2), vh);
await sleep(700);
const gone = await page.evaluate(() => {
  const hero = document.querySelector('.hero');
  const stage = document.querySelector('.hero__stage');
  const top = document.querySelector('.hero__word--top');
  return {
    heroP: parseFloat(getComputedStyle(hero).getPropertyValue('--hero-p')),
    stageOpacity: +getComputedStyle(stage).opacity,
    wordTf: getComputedStyle(top).transform,
  };
});
check(gone.heroP > 0.9, '滚过首屏后首屏已退场', `--hero-p=${gone.heroP.toFixed(2)}`);
check(gone.stageOpacity < 0.2, '首屏内容已淡出', `opacity=${gone.stageOpacity.toFixed(2)}`);
check(!/matrix\(1, 0, 0, 1, 0, 0\)/.test(gone.wordTf), '名字被拉开了', gone.wordTf);

await page.evaluate(() => window.scrollTo(0, 0));
await sleep(900);
const back = await page.evaluate(() => {
  const hero = document.querySelector('.hero');
  return {
    heroP: parseFloat(getComputedStyle(hero).getPropertyValue('--hero-p')),
    stageOpacity: +getComputedStyle(document.querySelector('.hero__stage')).opacity,
  };
});
check(back.heroP < 0.05 && back.stageOpacity > 0.99, '滚回顶部首屏完全复原',
  `--hero-p=${back.heroP.toFixed(3)} opacity=${back.stageOpacity.toFixed(2)}`);

/* --- 断言 5：跑马灯响应滚动 --- */
await page.evaluate(() => window.scrollTo(0, 1200));
await sleep(120);
await page.evaluate(() => window.scrollTo(0, 2400));
await sleep(90);
const mqBusy = await page.evaluate(() => {
  const t = getComputedStyle(document.querySelector('.marquee__inner')).transform;
  return t;
});
check(!/matrix\(1, 0, 0, 1, 0, 0\)|none/.test(mqBusy), '快速滚动时跑马灯有偏移/斜切响应', mqBusy);

/* --- 断言 6：停下来之后 raf 循环要停 --- */
await sleep(1400);
const mqIdle = await page.evaluate(() =>
  getComputedStyle(document.querySelector('.marquee__inner')).transform);
check(/matrix\(1, 0, 0, 1, 0, 0\)|none/.test(mqIdle), '停止滚动后跑马灯回正', mqIdle);

console.log('\n  控制台问题:', problems.length ? problems.slice(0, 4).join(' | ') : '无');
check(problems.length === 0, '全程无 JS 报错');
await page.close();

/* ══════════════════ 2. 减少动态效果 ══════════════════ */
console.log('\n════ prefers-reduced-motion: reduce ════');
const rp = await browser.newPage();
await rp.setViewport({ width: 1440, height: 900 });
await rp.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await settleFirst(rp);
const rm = await rp.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll('[data-scrub]')) {
    const cs = getComputedStyle(el);
    if (+cs.opacity < 0.99) bad.push(`${el.dataset.scrub}:opacity=${cs.opacity}`);
  }
  const lines = [...document.querySelectorAll('.ln__in')]
    .filter(el => !/matrix\(1, 0, 0, 1, 0, 0\)|none/.test(getComputedStyle(el).transform));
  const bars = [...document.querySelectorAll('.skills__list i')]
    .map(el => getComputedStyle(el).transform)
    .filter(t => !/matrix\(1, 0, 0, 1, 0, 0\)/.test(t));
  return { bad, lines: lines.length, bars: bars.length };
});
check(rm.bad.length === 0, '关闭动效时没有元素被藏在透明里',
  rm.bad.length ? rm.bad.slice(0, 4).join(' ') : '全部可见');
check(rm.lines === 0, '关闭动效时标题不再被裁切', `${rm.lines} 行仍偏移`);
check(rm.bars === 0, '关闭动效时进度条直接显示为满', `${rm.bars} 条仍收起`);
await rp.close();

/* ══════════════════ 3. 禁用 JS ══════════════════ */
console.log('\n════ 禁用 JavaScript ════');
const np = await browser.newPage();
await np.setJavaScriptEnabled(false);
await np.setViewport({ width: 1440, height: 900 });
await np.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
await sleep(700);
const nojs = await np.evaluate(() => {
  const vis = sel => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { opacity: +cs.opacity, transform: cs.transform };
  };
  return {
    title: vis('.sec__title'),
    card: vis('.card'),
    line: vis('.ln__in'),
    bars: [...document.querySelectorAll('.skills__list i')]
      .filter(el => !/matrix\(1, 0, 0, 1, 0, 0\)/.test(getComputedStyle(el).transform)).length,
  };
});
check(nojs.title?.opacity === 1, '无脚本时标题可见', `opacity=${nojs.title?.opacity}`);
check(nojs.card?.opacity === 1, '无脚本时卡片可见', `opacity=${nojs.card?.opacity}`);
check(!nojs.line || nojs.line.transform === 'none', '无脚本时标题行不被裁切',
  nojs.line?.transform);
await np.close();

/* ══════════════════ 4. 手机 ══════════════════ */
console.log('\n════ 手机 390x844 ════');
const mp = await browser.newPage();
await mp.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await settleFirst(mp);
await mp.evaluate(async () => {
  const step = innerHeight * 0.6;
  for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
    window.scrollTo(0, y);
    await new Promise(r => setTimeout(r, 260));
  }
  window.scrollTo(0, document.documentElement.scrollHeight);
});
await sleep(1200);
const mob = await mp.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll('[data-scrub]')) {
    if (+getComputedStyle(el).opacity < 0.99) bad.push(el.dataset.scrub);
  }
  const bars = [...document.querySelectorAll('.skills__list i')]
    .filter(el => !/matrix\(1, 0, 0, 1, 0, 0\)/.test(getComputedStyle(el).transform)).length;
  const lines = [...document.querySelectorAll('.ln__in')]
    .filter(el => !/matrix\(1, 0, 0, 1, 0, 0\)|none/.test(getComputedStyle(el).transform)).length;
  return { bad, bars, lines };
});
check(mob.bad.length === 0, '手机上滚到底也没有内容被藏住',
  mob.bad.length ? [...new Set(mob.bad)].join(' ') : '全部可见');
check(mob.bars === 0 && mob.lines === 0, '手机上进度条与标题都到位',
  `条 ${mob.bars} / 行 ${mob.lines}`);
await mp.close();

/* ══════════════════ 5. 自检：这套断言真的抓得住问题吗 ══════════════════ */
console.log('\n════ 自检：断言能否失败 ════');
const sp = await browser.newPage();
await sp.setViewport({ width: 1440, height: 900 });
await settleFirst(sp);
// 人为把某个元素的进度打回 0，模拟"JS 漏写了 --p"
const detected = await sp.evaluate(async () => {
  const el = document.querySelector('[data-scrub="read"]');
  el.style.setProperty('--p', '0');
  await new Promise(r => requestAnimationFrame(r));
  return +getComputedStyle(el).opacity < 0.99;
});
check(detected, '人为让一个元素停在透明状态，检查能抓到（证明断言有效）');
// 人为把降级类加上，确认兜底规则真的能救回来
const rescued = await sp.evaluate(async () => {
  document.documentElement.classList.add('scrub-off');
  await new Promise(r => requestAnimationFrame(r));
  const bad = [...document.querySelectorAll('[data-scrub]')]
    .filter(el => +getComputedStyle(el).opacity < 0.99).length;
  return bad === 0;
});
check(rescued, '加上 .scrub-off 兜底后全部内容立刻恢复可见');
await sp.close();

/* ══════════════════ 5. 标题行不许折行 ══════════════════ */
/*
   逐行揭示用的是"外层 overflow:hidden、内层推上来"的做法，
   一行 = 一个裁切框。如果某个宽度下这行字太长而折成两行，
   裁切框会跟着变高，动画区间也跟着翻倍，看起来就是一整块糊上去。
   （内容最终不会丢，但那个宽度下的观感是坏的，而且很难注意到。）

   分两档，理由不同：
     ≥430px：必须单行。这个宽度以上排版是设计过的，折行就是出了 bug。
     <430px：窄手机上中文长标题本来就会自然折行，属于正常排版，
             所以只报告、不判失败 —— 不能为了让检查变绿去把手机字号调小，
             用户明确说过希望字大一点。

   文案一改长就必须跑这条（真实案例：把「白天拆解系统」换成
   「仿真、光圈、走线，」时，9 个字在 1100px 和 1001px 下折行了，
   1440px 却是好的 —— 只看一个宽度根本发现不了）。
*/
console.log('\n════ 标题行不折行（多宽度）════');
const STRICT = [1440, 1280, 1100, 1001, 900, 768, 520, 430];
const SOFT = [390, 360];
const wrapBad = [];
const wrapSoft = [];

for (const [tier, widths] of [['strict', STRICT], ['soft', SOFT]]) {
  for (const w of widths) {
    const p = await browser.newPage();
    await p.setViewport({ width: w, height: 900 });
    await p.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
    await sleep(1800);
    const rows = await p.evaluate(() =>
      [...document.querySelectorAll('.ln__in')].map(el => {
        const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
        return {
          text: (el.textContent || '').trim(),
          lines: +(el.offsetHeight / lh).toFixed(2),
        };
      }));
    const bad = rows.filter(r => r.lines > 1.35);
    if (bad.length) {
      const msg = `${w}px: ${bad.map(b => `「${b.text}」${b.lines}行`).join(' ')}`;
      (tier === 'strict' ? wrapBad : wrapSoft).push(msg);
    }
    await p.close();
  }
}

check(wrapBad.length === 0, '桌面/平板宽度下大标题都不折行',
  wrapBad.length ? wrapBad.join(' | ') : `${STRICT.length} 个宽度全部单行`);
if (wrapSoft.length) {
  console.log(`  · 窄手机（正常折行，不算失败）: ${wrapSoft.join(' | ')}`);
}

await browser.close();

console.log(`\n${'─'.repeat(52)}`);
console.log(fail === 0
  ? `✓ 全部通过（${pass} 项）—— 滚动动效正常，且不会藏住内容`
  : `✗ ${fail} 项未通过，${pass} 项通过`);
console.log(`${'─'.repeat(52)}\n`);
process.exit(fail === 0 ? 0 : 1);
