/**
 * probe-navspring.mjs — 量一下导航文字悬停的"Q弹"到底弹没弹
 *
 * 为什么不能只靠肉眼看截图：截图只能证明"变大了"，
 * 证明不了"冲过头再回来"。而那一下回弹才是 Q 弹的全部意义 ——
 * 一条单调放大的曲线和一截 cubic-bezier 在静态图上长得一模一样。
 *
 * 所以这里逐帧读 getComputedStyle 的矩阵，把整条 scale 曲线打出来：
 *   必须有 overshoot（峰值 > 终值），否则就是没弹。
 *
 * 两条走过但走不通的路，记在这里免得再踩：
 *  1) sleep 撞时间 —— page.screenshot() 本身要几十到几百毫秒，撞不准。
 *  2) getAnimations() + pause() + currentTime 定格 —— 更阴险：
 *     Chromium 对 CSSTransition 设 currentTime 是按【线性】映射的，缓动函数不参与 seek。
 *     实测 176/352/500ms 读回 1.0521 / 1.1043 / 1.1482，
 *     正好等于 1 + 0.16×(t/540) —— 一条直线，过冲被抹得一干二净，
 *     却带着"精确定位"的权威感。出图只能用慢放。
 *
 * 用法: node tools/probe-navspring.mjs [url]
 */
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { existsSync, mkdirSync } from 'node:fs';

const URL_BASE = process.argv[2] || 'http://127.0.0.1:4321/';
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const IDX = 2;   // 第 3 项「热爱」，取中间那项，左右都有邻居才测得出挤不挤
const SHOTS = 'tools/shots';

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
await sleep(2600);

/* 让导航露出来：先往下滚过阈值（会被藏起来），再往回滚一点（重新出现） */
await page.evaluate(() => window.scrollTo(0, innerHeight * 3));
await sleep(700);
await page.evaluate(() => window.scrollTo(0, innerHeight * 2.5));
await sleep(900);

console.log('导航状态:', JSON.stringify(await page.evaluate(() => {
  const nav = document.querySelector('.nav');
  const r = nav.getBoundingClientRect();
  return { cls: nav.className, top: Math.round(r.top), h: Math.round(r.height) };
})));

const centerOf = idx => page.evaluate(i => {
  const r = document.querySelectorAll('.nav__links a')[i].getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, idx);
const scaleNow = () => page.evaluate(i => {
  const t = getComputedStyle(document.querySelectorAll('.nav__links a')[i].querySelector('span')).transform;
  return t === 'none' ? 1 : +new DOMMatrixReadOnly(t).a.toFixed(4);
}, IDX);

const AWAY = { x: 12, y: 500 };

/* ══════════ 逐帧采样：真鼠标悬停，读真正画到屏幕上的值 ══════════ */
async function sampleHover(label) {
  /* 必须先移开、等回落跑完再悬停。
     鼠标若已经停在这个链接上，mouse.move 到同一坐标不会产生新的 hover，
     过渡不会重启，采样器读到的是一条水平线 —— 过冲会变成假的 0。 */
  await page.mouse.move(AWAY.x, AWAY.y);
  await sleep(650);
  const box = await centerOf(IDX);

  await page.evaluate(i => {
    const span = document.querySelectorAll('.nav__links a')[i].querySelector('span');
    const read = () => {
      const t = getComputedStyle(span).transform;
      return t === 'none' ? 1 : new DOMMatrixReadOnly(t).a;
    };
    window.__s = [];
    const t0 = performance.now();
    const tick = () => {
      window.__s.push([+(performance.now() - t0).toFixed(1), +read().toFixed(4)]);
      if (performance.now() - t0 < 950) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, IDX);

  await page.mouse.move(box.x, box.y);
  await sleep(1050);

  const s = await page.evaluate(() => window.__s);
  const peak = Math.max(...s.map(p => p[1]));
  const peakAt = s.find(p => p[1] === peak)[0];
  const min = Math.min(...s.map(p => p[1]));
  const final = s[s.length - 1][1];
  const over = (peak - final) / final * 100;

  console.log(`\n──── ${label} ────`);
  console.log(`  取样 ${s.length} 帧 / 950ms`);
  console.log(`  起点 ${s[0][1]}   峰值 ${peak} @${peakAt}ms   谷值 ${min}   终值 ${final}`);
  console.log(`  过冲 ${over.toFixed(1)}%   过冲幅度 ${(peak - final).toFixed(4)} 倍字号`);
  for (const [t, v] of s) {
    const bar = Math.max(0, Math.round((v - 0.9) * 240));
    console.log(`   ${String(t).padStart(5)}ms ${v.toFixed(3)} ${'█'.repeat(bar)}`);
  }
  return { peak, final, min, over, peakAt, samples: s };
}

const normal = await sampleHover('真实弹簧（当前 CSS）');

/* 自检：把缓动换成一条单调曲线，确认"过冲"这条断言真的抓得住。
   换成 linear 之后如果还能测出过冲，说明测到的不是缓动，是别的东西。 */
await page.mouse.move(AWAY.x, AWAY.y);
await sleep(700);
const selfTestStyle = await page.addStyleTag({
  content: '.nav__links a:hover > span{transition-timing-function:linear!important}',
});
await sleep(200);
const flat = await sampleHover('自检：换成 linear 缓动');

/* 自检用的样式必须【摘掉】再往下走。
   留着它，后面所有抓拍读到的都会是这条 linear，而不是真缓动 ——
   一个自检把后面全部测量都污染成"通过"，比没有自检更糟。
   （第一版就栽在这里：慢放抓拍读回来又是一条直线，查了半天才发现是自检没摘。） */
await selfTestStyle.evaluate(el => el.remove());
await sleep(200);
const restored = await sampleHover('自检摘除后：过冲应当恢复');
if (restored.over < 1) console.log('  ⚠ 摘除自检样式后过冲没恢复，后面的抓拍不可信');

/* ══════════ 邻居不动：transform 不参与布局，这是"不挤到别人"的保证 ══════════ */
await page.mouse.move(AWAY.x, AWAY.y);
await sleep(800);
const snap = () => page.evaluate(() => ({
  links: [...document.querySelectorAll('.nav__links a')].map(a => {
    const r = a.getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(',');
  }),
  nav: (() => { const r = document.querySelector('.nav').getBoundingClientRect();
    return Math.round(r.height); })(),
  cta: (() => { const r = document.querySelector('.nav__cta').getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.width)].join(','); })(),
}));
const before = await snap();
const b2 = await centerOf(IDX);
await page.mouse.move(b2.x, b2.y);
await sleep(900);
const during = await snap();

/* 放大后的字要还待在胶囊里 —— 顶出去就是坏了。
   必须在【还悬停着】的时候量：放到鼠标移开之后再量，字早缩回原大小了，
   余量会正好等于 padding，看着像通过，其实什么都没测到。 */
const fit = await page.evaluate(i => {
  const a = document.querySelectorAll('.nav__links a')[i];
  const ar = a.getBoundingClientRect();
  const sr = a.querySelector('span').getBoundingClientRect();
  return { spillL: +(sr.left - ar.left).toFixed(1), spillR: +(ar.right - sr.right).toFixed(1) };
}, IDX);

await page.mouse.move(AWAY.x, AWAY.y);
await sleep(800);

console.log('\n──── 邻居是否被挤动 ────');
console.log('  悬停前:', before.links.join(' | '));
console.log('  悬停中:', during.links.join(' | '));
console.log('  链接位移:', before.links.join('|') === during.links.join('|') ? '无 ✓' : '有 ✗');
console.log(`  导航条高度 ${before.nav} → ${during.nav}`);
console.log(`  右侧按钮 x/w ${before.cta} → ${during.cta}`);
console.log(`  悬停中文字离胶囊左/右边缘 ${fit.spillL}px / ${fit.spillR}px`);

/* ══════════ 取样出图：慢放 10 倍抓拍 ══════════
 * linear() 是按归一化进度定义的：把时长拉长 10 倍，
 * 曲线形状、过冲幅度、终值全都不变，只是时间轴被撑开 —— 相机就够得着了。
 * 抓拍那一刻的 scale 照旧实测，标在图上，不靠推算。 */
mkdirSync(SHOTS, { recursive: true });
await page.addStyleTag({ content: '.cursor{display:none!important}' });  // 自带光标环比两个字还宽，会污染墨迹测量
await page.addStyleTag({ content: '.nav__links a:hover > span{transition-duration:5.4s!important}' });

const VIEW_W = 1440;
const navH = Math.ceil(await page.evaluate(
  () => document.querySelector('.nav').getBoundingClientRect().height));
const linkBox = await page.evaluate(i => {
  const r = document.querySelectorAll('.nav__links a')[i].getBoundingClientRect();
  return { x: r.x - 8, y: r.y - 4, width: r.width + 16, height: r.height + 8 };
}, IDX);

async function grab() {
  const buf = await page.screenshot();            // 整屏
  const meta = await sharp(buf).metadata();
  const sx = meta.width / VIEW_W;                 // 实际像素 / CSS 像素
  const cut = {
    left: Math.round(linkBox.x * sx), top: Math.round(linkBox.y * sx),
    width: Math.round(linkBox.width * sx), height: Math.round(linkBox.height * sx),
  };
  cut.width = Math.min(cut.width, meta.width - cut.left);
  cut.height = Math.min(cut.height, meta.height - cut.top);
  return { buf, cut, sx };
}

/* 从像素里量墨迹的横向跨度。
   阈值取中间亮度，把抗锯齿的灰边排除掉 —— 否则每边多算一两个像素，
   比值会被压向 1，看着"没那么弹"。
   两个字的中文标签一定比下划线宽（下划线封顶 44% 链接宽），所以最宽的墨就是字。 */
async function inkSpan({ buf, cut }) {
  const { data, info } = await sharp(buf).extract(cut)
    .raw().toBuffer({ resolveWithObject: true });
  let minX = Infinity, maxX = -Infinity, count = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const o = (y * info.width + x) * info.channels;
      const lum = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
      if (lum > 128) { count++; if (x < minX) minX = x; if (x > maxX) maxX = x; }
    }
  }
  return { w: maxX - minX + 1, minX, maxX, count, px: info.width, py: info.height };
}

console.log('\n──── 慢放 10 倍抓拍（540ms → 5.4s，曲线不变）────');
await page.mouse.move(AWAY.x, AWAY.y);
await sleep(900);
const idleShot = await grab();
const idle = await inkSpan(idleShot);
console.log(`  基准 原大小       scale=1      墨迹宽 ${idle.w}px  取景 ${idle.px}x${idle.py}  墨点 ${idle.count}`);

const tiles = [['原大小 scale=1', idleShot]];
const SLOW = 10;
for (const [name, ms] of [['过冲峰值', 176], ['回弹谷值', 352], ['停稳', 540]]) {
  await page.mouse.move(AWAY.x, AWAY.y);
  await sleep(700);                                // 让回落跑完（回落没被拉长，还是 .3s）
  await page.mouse.move(b2.x, b2.y);
  await sleep(ms * SLOW);
  // scale 要在截图【之前】读：截图本身要花几十毫秒，之后再读就偏到后面去了
  const scale = await scaleNow();
  const shot = await grab();
  const ink = await inkSpan(shot);
  console.log(`  ${name} @${String(ms * SLOW).padStart(5)}ms  scale=${scale}  ` +
    `墨迹宽 ${ink.w}px  实测倍数 ${(ink.w / idle.w).toFixed(3)}`);
  tiles.push([`${name} scale=${scale}`, shot]);
}

/* 四联对比图：原大小 / 过冲峰值 / 回弹谷值 / 停稳 */
const ups = await Promise.all(tiles.map(async ([, s]) =>
  sharp(s.buf).extract(s.cut).resize({ width: s.cut.width * 3, kernel: 'nearest' })
    .png().toBuffer()));
const metas = await Promise.all(ups.map(t => sharp(t).metadata()));
const gap = 26;
const W = Math.max(...metas.map(m => m.width));
const H = metas.reduce((a, m) => a + m.height, 0) + gap * (ups.length - 1);
await sharp({ create: { width: W, height: H, channels: 4, background: '#0b0b0c' } })
  .composite(ups.map((t, i) => ({
    input: t,
    left: Math.round((W - metas[i].width) / 2),
    top: metas.slice(0, i).reduce((a, m) => a + m.height, 0) + gap * i,
  })))
  .toFile(`${SHOTS}/nav-q-bounce.png`);
console.log(`\n  ${SHOTS}/nav-q-bounce.png  ← 上到下: ` + tiles.map(t => t[0]).join(' / '));

/* 整条导航截图，正常态 vs 悬停停稳 */
const fullCut = { left: 0, top: 0, width: Math.round(VIEW_W * 2), height: Math.round(navH * 2) };
await page.mouse.move(AWAY.x, AWAY.y);
await sleep(700);
await sharp((await grab()).buf).extract(fullCut).toFile(`${SHOTS}/nav-normal.png`);
await page.addStyleTag({ content: '.nav__links a:hover > span{transition-duration:.54s!important}' });
await page.mouse.move(b2.x, b2.y);
await sleep(900);
await sharp((await grab()).buf).extract(fullCut).toFile(`${SHOTS}/nav-hover.png`);
for (const f of [`${SHOTS}/nav-normal.png`, `${SHOTS}/nav-hover.png`]) {
  const m = await sharp(f).metadata();
  console.log(`  ${f}  ${m.width}x${m.height}`);
}

console.log(`\n结论: 真实过冲 ${normal.over.toFixed(1)}% / linear 过冲 ${flat.over.toFixed(1)}%` +
  ` / 摘除自检后 ${restored.over.toFixed(1)}%`);

await browser.close();
