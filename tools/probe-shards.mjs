/**
 * probe-shards.mjs — 欢迎页背景：风中的折叠箔片
 *
 * 这是个每帧重绘的 canvas，单帧只能看出"有没有东西、颜色对不对"，
 * 看不出"在不在动"。所以：连拍一组胶片条看流动，再单独量帧时。
 *
 * 用法: node tools/probe-shards.mjs [url]
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
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
await sleep(3200);
await page.mouse.move(20, 860);
mkdirSync(SHOTS, { recursive: true });

console.log('画布状态:', JSON.stringify(await page.evaluate(() => {
  const c = document.querySelector('#shards');
  const cs = getComputedStyle(c);
  return {
    w: c.width, h: c.height,
    cssW: c.clientWidth, cssH: c.clientHeight,
    opacity: cs.opacity, zIndex: cs.zIndex, ready: c.classList.contains('is-ready'),
    pageBg: getComputedStyle(document.querySelector('.welcome')).backgroundColor,
  };
})));
console.log('渲染器:', JSON.stringify(await page.evaluate(() => window.__shards?.() ?? null)));

/* 画布上到底有没有墨：逐像素统计"非底色"的比例，以及出现的色相。
   "看着像有东西"不能靠眼睛，尤其是在暗底上。 */
const stats = async () => {
  const buf = await page.screenshot();
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  let ink = 0, total = 0, maxLum = 0;
  const hues = [];
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = .299 * r + .587 * g + .114 * b;
    total++;
    if (lum > maxLum) maxLum = lum;
    if (lum > 60 && g > r) { ink++; hues.push(Math.round(60 * (2 + (b - r) / Math.max(g, 1)))); }
  }
  const avgHue = hues.length ? hues.reduce((a, v) => a + v, 0) / hues.length : 0;
  return { inkPct: ink / total * 100, maxLum, avgHue };
};

const a = await stats();
console.log(`\n画面: 发光像素占比 ${a.inkPct.toFixed(2)}%  最亮 ${a.maxLum.toFixed(0)}  ` +
  `平均色相 ${a.avgHue.toFixed(0)}°`);

/* 帧时：箔片是每帧重绘的，这是这个效果唯一的性能风险 */
const perf = await page.evaluate(() => new Promise(res => {
  const ts = [];
  let last = 0;
  const tick = t => {
    if (last) ts.push(t - last);
    last = t;
    if (ts.length < 120) requestAnimationFrame(tick);
    else {
      ts.sort((x, y) => x - y);
      res({ avg: ts.reduce((x, y) => x + y, 0) / ts.length, p95: ts[Math.floor(ts.length * .95)], n: ts.length });
    }
  };
  requestAnimationFrame(tick);
}));
console.log(`\n帧间隔: 平均 ${perf.avg.toFixed(1)}ms  p95 ${perf.p95.toFixed(1)}ms（${perf.n} 帧）`);
console.log(`  渲染器自报: ${JSON.stringify(await page.evaluate(() => window.__shards?.() ?? null))}`);

/* 胶片条：看它到底在不在流动 */
const full = await page.screenshot();
await sharp(full).toFile(`${SHOTS}/shards-full.png`);
// 放大一块：折痕的明暗对比是这个效果的命根子，整体缩略图上判断不了
await sharp(full).extract({ left: 760, top: 180, width: 420, height: 300 })
  .resize({ width: 1260, kernel: 'nearest' }).toFile(`${SHOTS}/shards-zoom.png`);
const tiles = [];
for (let i = 0; i < 5; i++) {
  const buf = await page.screenshot();
  tiles.push(await sharp(buf).resize({ width: 420 }).toBuffer());
  await sleep(900);
}
const m = await sharp(tiles[0]).metadata();
await sharp({ create: { width: m.width * tiles.length + 8 * (tiles.length - 1),
  height: m.height, channels: 4, background: '#000' } })
  .composite(tiles.map((t, i) => ({ input: t, left: i * (m.width + 8), top: 0 })))
  .toFile(`${SHOTS}/shards-strip.png`);
console.log(`\n胶片条: ${SHOTS}/shards-strip.png（间隔 0.9s × 5 帧）`);

// 指针交互：推一下应该看得到区别
const before = await stats();
await page.mouse.move(720, 450, { steps: 12 });
await sleep(500);
const during = await stats();
console.log(`\n指针: 移入前发光 ${before.inkPct.toFixed(2)}% → 移入后 ${during.inkPct.toFixed(2)}%`);

// 滚过一屏之后必须停：per-frame 的 canvas 不停就是白烧电
await page.evaluate(() => window.scrollTo({ top: innerHeight * 2, behavior: 'instant' }));
await sleep(900);
const stopped = await page.evaluate(() => window.__shards?.() ?? null);
console.log(`滚过一屏后: ${JSON.stringify(stopped)}（running 应当是 false）`);

console.log(`\nJS 报错: ${errs.length ? errs.slice(0, 3).join(' | ') : '无'}`);
await page.close();

/* ══════════ 手机：箔片到底跑不跑得起 ══════════
   代码里给手机留了一档（200 片 / dpr 1.5），但"留了档"不等于"跑得动"。
   这里是它们上不上手机的唯一依据 —— 不实测就开，等于拿别人的续航赌。 */
const mp = await browser.newPage();
await mp.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await mp.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
await sleep(3200);
const mob = await mp.evaluate(() => ({
  api: window.__shards ? window.__shards() : null,
  opacity: getComputedStyle(document.querySelector('#shards')).opacity,
}));
console.log(`\n手机 390×844: ${JSON.stringify(mob)}`);
if (mob.api) {
  const mperf = await mp.evaluate(() => new Promise(res => {
    const ts = [];
    let last = 0;
    const tick = t => {
      if (last) ts.push(t - last);
      last = t;
      if (ts.length < 120) requestAnimationFrame(tick);
      else {
        ts.sort((x, y) => x - y);
        res({ avg: +(ts.reduce((x, y) => x + y, 0) / ts.length).toFixed(1),
          p95: +ts[Math.floor(ts.length * .95)].toFixed(1) });
      }
    };
    requestAnimationFrame(tick);
  }));
  console.log(`  帧间隔: 平均 ${mperf.avg}ms  p95 ${mperf.p95}ms  ` +
    `（60fps 的预算是 16.7ms；明显超过就该关掉）`);
  const buf = await mp.screenshot();
  await sharp(buf).toFile(`${SHOTS}/shards-mobile.png`);
}

await browser.close();
