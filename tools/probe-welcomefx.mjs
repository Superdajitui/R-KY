/**
 * probe-welcomefx.mjs — 欢迎页两个新效果的目视检查
 *
 * 逐字弹起和流体都是"好不好看"的问题，断言只能证明它动了。
 * 这里把几个关键时刻拍下来：静止 / 悬停到某个字上 / 横扫的中途 / 纯色区的流体。
 *
 * 用法: node tools/probe-welcomefx.mjs [url]
 */
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { existsSync, mkdirSync } from 'node:fs';

const URL_BASE = process.argv[2] || 'http://127.0.0.1:4321/';
const SHOTS = 'tools/shots';
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
await sleep(3000);

mkdirSync(SHOTS, { recursive: true });
const shot = f => page.screenshot({ path: `${SHOTS}/${f}` });

/* 把鼠标放到第 i 个字上 */
const charAt = i => page.evaluate(idx => {
  const el = document.querySelectorAll('.welcome__ch')[idx];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, ch: el.textContent };
}, i);

const scales = () => page.evaluate(() => {
  const out = {};
  document.querySelectorAll('.welcome__ch').forEach((el, i) => {
    const m = el.style.transform.match(/scale\(([\d.]+)\)/);
    out[i + ':' + el.textContent] = m ? +m[1] : 1;
  });
  return out;
});

const n = await page.evaluate(() => document.querySelectorAll('.welcome__ch').length);
console.log(`标题拆成 ${n} 个字`);

/* 核对"字中心"的算法 —— main.js 里用的是
     bodyRect.left + el.offsetLeft + el.offsetWidth / 2
   这里把它和真实的 getBoundingClientRect 中心并排打出来。
   对不上的话，影响半径就是照着错误的位置在算，效果会几乎看不见。 */
const centers = await page.evaluate(() => {
  const b = document.querySelector('.welcome__body').getBoundingClientRect();
  return [...document.querySelectorAll('.welcome__ch')].map(el => {
    const r = el.getBoundingClientRect();
    return {
      ch: el.textContent,
      offL: el.offsetLeft, offT: el.offsetTop,
      offW: el.offsetWidth, offH: el.offsetHeight,
      parent: el.offsetParent ? el.offsetParent.className : '(null)',
      calcX: Math.round(b.left + el.offsetLeft + el.offsetWidth / 2),
      calcY: Math.round(b.top + el.offsetTop + el.offsetHeight / 2),
      realX: Math.round(r.left + r.width / 2),
      realY: Math.round(r.top + r.height / 2),
    };
  });
});
console.log('  字中心核对（算法 vs 真实）:');
for (const c of centers) {
  const dx = c.calcX - c.realX, dy = c.calcY - c.realY;
  console.log(`    ${c.ch}  offset(${c.offL},${c.offT}) ${c.offW}×${c.offH}  ` +
    `offsetParent=${c.parent}  算(${c.calcX},${c.calcY}) 实(${c.realX},${c.realY})  ` +
    `偏差(${dx},${dy})`);
}

await shot('fx-0-idle.png');
console.log('  静止:', JSON.stringify(await scales()));

/* --- 悬停到第 3 个字上，抓弹簧峰值附近 --- */
const c3 = await charAt(3);
console.log(`\n悬停到「${c3.ch}」 (${Math.round(c3.x)}, ${Math.round(c3.y)})`);
await page.mouse.move(c3.x, c3.y, { steps: 12 });
await sleep(210);                       // 176ms 是弹簧峰值
await shot('fx-1-peak.png');
console.log('  峰值附近:', JSON.stringify(await scales()));

await sleep(700);
await shot('fx-2-settled.png');
console.log('  停稳:', JSON.stringify(await scales()));

/* --- 横扫：从最左扫到最右，中途抓一帧，看"逐个" --- */
console.log('\n横扫标题...');
const first = await charAt(0);
const last = await charAt(n - 1);
await page.mouse.move(first.x, first.y, { steps: 4 });
await sleep(400);
await page.mouse.move(last.x, last.y, { steps: 34 });   // 慢速扫过
await sleep(120);
await shot('fx-3-sweep.png');
console.log('  横扫中途:', JSON.stringify(await scales()));

/* --- 纯色区：把鼠标移到标题下方的空白处，抓流体 --- */
console.log('\n移到纯色区...');
await page.mouse.move(200, 300, { steps: 10 });
await sleep(120);
await page.mouse.move(1150, 640, { steps: 26 });
await sleep(190);                       // 甩出去的途中才有拉伸
await shot('fx-4-fluid.png');
const blobs = await page.evaluate(() => [...document.querySelectorAll('#fluid i')].map(el =>
  el.style.transform));
console.log('  四团色斑的原始 transform:');
for (const [i, tf] of blobs.entries()) console.log(`    ${i}: ${tf || '(空)'}`);

/* 注意逗号后面的 \s* —— el.style.transform 读回来是 CSSOM 【规范化】过的值，
   逗号后面会自动补一个空格：写成 scale(1.006, 0.996)。
   不写 \s* 的话正则会静默匹配不上，读出来全是 undefined，
   看起来像"形变没生效"，其实只是没解析到。 */
const parsed = blobs.map(tf => ({
  x: (tf.match(/translate3d\(([-\d.]+)px/) || [])[1],
  sx: (tf.match(/scale\(([-\d.]+),\s*([-\d.]+)\)/) || [])[1],
  sy: (tf.match(/scale\(([-\d.]+),\s*([-\d.]+)\)/) || [])[2],
}));
const xs = parsed.map(p => +p.x).filter(Number.isFinite);
if (xs.length) console.log(`  尾迹展开宽度: ${(Math.max(...xs) - Math.min(...xs)).toFixed(0)}px`);
console.log('  形变(拉伸): ' + parsed.map((p, i) =>
  `${i}:${p.sx ?? '?'}×${p.sy ?? '?'}`).join('  '));

await sleep(900);
await shot('fx-5-fluid-settled.png');

/* 鼠标停住之后循环必须自己停下来 —— 这是性能承诺，不是观感问题。
   靠 __welcomeFx() 直接问，不靠帧率间接猜。 */
for (const wait of [1500, 3000, 5000]) {
  await sleep(wait === 1500 ? 1500 : 1500);
  const fx = await page.evaluate(() => window.__welcomeFx());
  console.log(`  停手 ${wait}ms 后: running=${fx.running} activity=${fx.activity} ` +
    `字=${fx.chars.map(v => v.toFixed(3)).join(',')}`);
}

const running = await page.evaluate(() => window.__welcomeFx().running);
console.log(running ? '  ✗ 循环还在跑' : '  ✓ 循环已经自己停了');

console.log(`\n截图在 ${SHOTS}/fx-*.png`);

/* 裁一张标题的特写，方便看清"逐个" */
const box = await page.evaluate(() => {
  const r = document.querySelector('.welcome__title').getBoundingClientRect();
  return { left: Math.max(0, r.left - 30), top: Math.max(0, r.top - 30),
    width: Math.min(1440, r.width + 60), height: Math.min(900, r.height + 60) };
});
for (const f of ['fx-1-peak', 'fx-3-sweep']) {
  const buf = await sharp(`${SHOTS}/${f}.png`).extract({
    left: Math.round(box.left * 2), top: Math.round(box.top * 2),
    width: Math.round(box.width * 2), height: Math.round(box.height * 2),
  }).png().toBuffer();
  await sharp(buf).toFile(`${SHOTS}/${f}-title.png`);
}
console.log('并生成了 fx-1-peak-title.png / fx-3-sweep-title.png');

/* 紧贴被悬停的那个字做一张前后对比。
   整体缩略图上根本判断不出 16% 的差别 —— 那种图只能用来确认"没坏"，
   确认不了"够不够明显"。 */
{
  const c = await page.evaluate(() => {
    const el = document.querySelectorAll('.welcome__ch')[3];
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left - 26), y: Math.round(r.top - 26),
      w: Math.round(r.width + 52), h: Math.round(r.height + 52) };
  });
  await page.mouse.move(8, 860);
  await sleep(900);
  const before = await page.screenshot();
  await page.mouse.move(c3.x, c3.y, { steps: 10 });
  await sleep(230);
  const after = await page.screenshot();

  const cut = s => sharp(s).extract({
    left: c.x * 2, top: c.y * 2, width: c.w * 2, height: c.h * 2,
  }).resize({ width: c.w * 3, kernel: 'nearest' }).png().toBuffer();
  const [a, b] = [await cut(before), await cut(after)];
  const m = await sharp(a).metadata();
  await sharp({ create: { width: m.width, height: m.height * 2 + 20, channels: 4, background: '#111112' } })
    .composite([{ input: a, left: 0, top: 0 }, { input: b, left: 0, top: m.height + 20 }])
    .toFile(`${SHOTS}/fx-compare.png`);
  console.log('fx-compare.png 已生成（上：静止  下：悬停到该字）');
}

await browser.close();
