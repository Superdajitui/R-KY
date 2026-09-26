/**
 * swatch-ripple.mjs — 水波纹配色的并排对比
 *
 * "画面有点脏"这种判断没法靠推理：同一个剖面在缩小、叠两层、动起来之后，
 * 观感和静态单看完全不是一回事。所以这里把候选配色按【真实尺寸】画在
 * 同一片霓虹上并排拍下来，一眼比出来。
 *
 * 每格还会把关心的几个量算出来：
 *   · 色相偏移（相对底色）—— 偏得越多越"浑"
 *   · 合成后的饱和度 —— 掉下来就是发灰、发脏
 *   · 与底色的明度差 —— 差太大就是"污渍"，太小又看不见
 *
 * 用法: node tools/swatch-ripple.mjs
 */
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { existsSync, mkdirSync } from 'node:fs';

const SHOTS = 'tools/shots';
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p));

const NEON = [210, 255, 0];

/* 每个候选：一组色标 [位置%, r, g, b, a]。
   底色 rgb(210,255,0)。凡是"暗"的色标都尽量按同比例缩三个通道 ——
   同比例缩放不改变色相，是最不容易发浑的做法。 */
const CANDIDATES = [
  { name: '0 当前（暗橄榄 92,128,0 + 奶油脊）', stops: [
    [54, 104, 146, 0, 0], [60, 96, 134, 0, .14], [65, 252, 255, 198, .42],
    [71, 92, 128, 0, .46], [77, 250, 255, 190, .24], [83, 96, 134, 0, .30],
    [89, 248, 255, 184, .13], [94, 100, 140, 0, .16], [100, 104, 146, 0, 0]] },
  { name: '1 白脊 + 同色相暗带（k=.72）', stops: [
    [56, 151, 184, 0, 0], [63, 151, 184, 0, .20], [69, 255, 255, 255, .46],
    [76, 151, 184, 0, .34], [84, 151, 184, 0, .14], [92, 151, 184, 0, 0],
    [100, 151, 184, 0, 0]] },
  { name: '2 白脊 + 同色相暗带（更轻 k=.82）', stops: [
    [56, 172, 209, 0, 0], [63, 172, 209, 0, .18], [69, 255, 255, 255, .40],
    [76, 172, 209, 0, .26], [84, 172, 209, 0, .10], [92, 172, 209, 0, 0],
    [100, 172, 209, 0, 0]] },
  { name: '3 只有白脊（无暗带）', stops: [
    [56, 255, 255, 255, 0], [64, 255, 255, 255, .10], [70, 255, 255, 255, .50],
    [78, 255, 255, 255, .16], [88, 255, 255, 255, 0], [100, 255, 255, 255, 0]] },
  { name: '4 白脊 + 两层轻暗带（波列）', stops: [
    [50, 168, 204, 0, 0], [58, 168, 204, 0, .16], [65, 255, 255, 255, .44],
    [72, 168, 204, 0, .24], [79, 255, 255, 255, .16], [86, 168, 204, 0, .12],
    [94, 168, 204, 0, 0], [100, 168, 204, 0, 0]] },
  { name: '5 暖调：白脊 + 偏黄暗带', stops: [
    [56, 190, 208, 0, 0], [63, 190, 208, 0, .20], [69, 255, 255, 255, .46],
    [76, 190, 208, 0, .30], [84, 190, 208, 0, .12], [92, 190, 208, 0, 0],
    [100, 190, 208, 0, 0]] },
  { name: '6 极淡：白脊 + 一点点暗', stops: [
    [58, 186, 226, 0, 0], [66, 255, 255, 255, .38], [74, 186, 226, 0, .16],
    [84, 186, 226, 0, 0], [100, 186, 226, 0, 0]] },
];

/* 合成 / 色彩换算：用来把"脏不脏"变成一个数 */
const over = ([r, g, b, a], bg = NEON) => [
  r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];
const hsl = ([r, g, b]) => {
  const R = r / 255, G = g / 255, B = b / 255;
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn;
  const l = (mx + mn) / 2;
  let h = 0;
  if (d) {
    if (mx === R) h = 60 * (((G - B) / d) % 6);
    else if (mx === G) h = 60 * ((B - R) / d + 2);
    else h = 60 * ((R - G) / d + 4);
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h: (h + 360) % 360, s, l };
};
const bgHSL = hsl(NEON);

console.log('底色 neon rgb(210,255,0)  →  H %s°  S %s  L %s',
  bgHSL.h.toFixed(1), bgHSL.s.toFixed(2), bgHSL.l.toFixed(2));
console.log('\n每个候选最"重"的那个色标，合成到底色上的效果：');
for (const c of CANDIDATES) {
  const solid = c.stops.filter(s => s[4] > .05);
  const worst = solid.reduce((m, s) => (s[4] > m[4] ? s : m), solid[0]);
  if (!worst) { console.log(`  ${c.name}: 无可视色标`); continue; }
  const comp = over([worst[1], worst[2], worst[3], worst[4]]);
  const h = hsl(comp);
  console.log(`  ${c.name}\n     最深色标 a=${worst[4]} 合成 rgb(${comp.map(v => Math.round(v)).join(',')})` +
    `  →  H ${h.h.toFixed(1)}°（底色 ${bgHSL.h.toFixed(1)}°，偏 ${(h.h - bgHSL.h).toFixed(1)}°）` +
    `  S ${h.s.toFixed(2)}  L ${h.l.toFixed(2)}（底色 ${bgHSL.l.toFixed(2)}）`);
}

/* ── 画出来看 ── */
const cells = CANDIDATES.map((c, i) => `
  <div class="cell">
    <div class="ring" style="background:radial-gradient(circle closest-side,
      ${c.stops.map(s => `rgba(${s[1]},${s[2]},${s[3]},${s[4]}) ${s[0]}%`).join(',')})"></div>
    <b>${i}</b><span>${c.name.replace(/^\d\s/, '')}</span>
  </div>`).join('');

const html = `<!doctype html><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:rgb(210,255,0);font:13px/1.5 system-ui,sans-serif;color:#111;
       display:grid;grid-template-columns:repeat(4,1fr);gap:0}
  .cell{position:relative;height:360px;display:grid;place-items:center;
        border-right:1px solid rgba(17,17,18,.12);border-bottom:1px solid rgba(17,17,18,.12)}
  .ring{width:300px;height:300px;border-radius:50%}
  b{position:absolute;left:14px;top:12px;font-size:22px}
  span{position:absolute;left:14px;bottom:12px;font-size:12px;opacity:.7;max-width:88%}
</style>${cells}`;

mkdirSync(SHOTS, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--disable-gpu', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 720, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: `${SHOTS}/swatch-ripple.png`, fullPage: true });

/* 再出一张"真实尺寸"的：环铺到 ⌀400 左右时的样子 */
const html2 = `<!doctype html><meta charset="utf-8"><style>
  *{margin:0;padding:0}
  body{background:rgb(210,255,0);height:${Math.ceil(CANDIDATES.length / 4) * 560}px;
       display:grid;grid-template-columns:repeat(4,1fr);gap:0}
  .cell{position:relative;height:560px;display:grid;place-items:center;
        border-right:1px solid rgba(17,17,18,.10);border-bottom:1px solid rgba(17,17,18,.10)}
  .ring{width:520px;height:520px;border-radius:50%}
  b{position:absolute;left:16px;top:14px;font:600 26px/1 system-ui;color:#111}
</style>${CANDIDATES.map((c, i) => `
  <div class="cell"><div class="ring" style="background:radial-gradient(circle closest-side,
    ${c.stops.map(s => `rgba(${s[1]},${s[2]},${s[3]},${s[4]}) ${s[0]}%`).join(',')})"></div><b>${i}</b></div>`).join('')}`;
await page.setViewport({ width: 2080, height: Math.ceil(CANDIDATES.length / 4) * 560 });
await page.setContent(html2, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: `${SHOTS}/swatch-ripple-big.png`, fullPage: true });

/* 再叠一层：两个环交叠 + 缩小到实际铺开尺寸，看叠加之后会不会浑 */
await page.setViewport({ width: 1440, height: 760, deviceScaleFactor: 2 });
await page.setContent(`<!doctype html><meta charset="utf-8"><style>
  *{margin:0;padding:0}
  body{background:rgb(210,255,0);display:grid;grid-template-columns:repeat(4,1fr)}
  .cell{position:relative;height:760px;display:grid;place-items:center;
        border-right:1px solid rgba(17,17,18,.10)}
  i{position:absolute;width:250px;height:250px;border-radius:50%;display:block}
  b{position:absolute;left:16px;top:14px;font:600 26px/1 system-ui;color:#111;z-index:2}
</style>${CANDIDATES.map((c, i) => {
  const g = `radial-gradient(circle closest-side,${c.stops.map(s =>
    `rgba(${s[1]},${s[2]},${s[3]},${s[4]}) ${s[0]}%`).join(',')})`;
  return `<div class="cell">
    <i style="left:120px;top:180px;background:${g};transform:scale(.55);opacity:.9"></i>
    <i style="left:290px;top:280px;background:${g};transform:scale(.9);opacity:.6"></i>
    <i style="left:180px;top:390px;background:${g};transform:scale(1.2);opacity:.4"></i>
    <b>${i}</b></div>`;
}).join('')}`, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: `${SHOTS}/swatch-ripple-stack.png`, fullPage: true });

console.log(`\n出图: ${SHOTS}/swatch-ripple.png（单环对比）`);
console.log(`      ${SHOTS}/swatch-ripple-big.png（真实尺寸）`);
console.log(`      ${SHOTS}/swatch-ripple-stack.png（交叠 + 缩小，看会不会浑）`);
await browser.close();
