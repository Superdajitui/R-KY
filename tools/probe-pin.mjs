/**
 * probe-pin.mjs — 首屏钉住 + 向中间缩小
 *
 * 效果就是"滚动时整体不动、人物和名字往中间收"，
 * 静止单帧证明不了"不动"，所以要沿着跑道连拍。
 *
 * 用法: node tools/probe-pin.mjs [url]
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
await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
await sleep(3200);
await page.mouse.move(20, 860);
mkdirSync(SHOTS, { recursive: true });

const geo = await page.evaluate(() => ({
  top: document.querySelector('.heroPin').getBoundingClientRect().top + window.scrollY,
  len: document.querySelector('.heroPin').offsetHeight - innerHeight,
}));
console.log(`钉住跑道: 顶端 ${Math.round(geo.top)}px  长度 ${geo.len}px\n`);

const read = () => page.evaluate(() => {
  const hero = document.querySelector('.hero');
  const cs = getComputedStyle(hero);
  const st = document.querySelector('.hero__stage');
  const sm = getComputedStyle(st).transform;
  const m = sm === 'none' ? null : new DOMMatrixReadOnly(sm);
  const port = document.querySelector('.hero__portrait').getBoundingClientRect();
  const word = document.querySelector('.hero__word--top').getBoundingClientRect();
  const cn = document.querySelector('.hero__cn').getBoundingClientRect();
  return {
    pinP: +(cs.getPropertyValue('--pin-p') || 0),
    top: Math.round(hero.getBoundingClientRect().top),
    scale: m ? +Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)).toFixed(3) : 1,
    portH: Math.round(port.height), portTop: Math.round(port.top),
    wordTop: Math.round(word.top), cnTop: Math.round(cn.top),
    eyebrow: getComputedStyle(document.querySelector('.hero__eyebrow')).filter,
    foot: getComputedStyle(document.querySelector('.hero__foot')).filter,
  };
});

const tiles = [];
const FRAMES = [0, .25, .5, .75, 1];
for (const f of FRAMES) {
  await page.evaluate(y => window.scrollTo(0, y), Math.round(geo.top + geo.len * f));
  await sleep(720);
  const r = await read();
  console.log(`  ${(f * 100).toFixed(0).padStart(3)}%  pinP=${r.pinP.toFixed(2)}  ` +
    `首屏top=${r.top}  缩放=${r.scale}  人物高=${r.portH}  ` +
    `名字top=${r.wordTop} 任恺昱top=${r.cnTop}  小字=${r.eyebrow}`);
  const buf = await page.screenshot();
  tiles.push(await sharp(buf).resize({ width: 430 }).toBuffer());
}

const m = await sharp(tiles[0]).metadata();
await sharp({ create: { width: m.width * tiles.length + 10 * (tiles.length - 1),
  height: m.height, channels: 4, background: '#111112' } })
  .composite(tiles.map((t, i) => ({ input: t, left: i * (m.width + 10), top: 0 })))
  .toFile(`${SHOTS}/pin-strip.png`);
console.log(`\n胶片条: ${SHOTS}/pin-strip.png（沿着跑道 0 → 100%）`);

// 走完跑道之后再滚，页面应当正常往下走（这时候才真的开始滚）
await page.evaluate(y => window.scrollTo(0, y), Math.round(geo.top + geo.len + 420));
await sleep(800);
const after = await page.evaluate(() => ({
  heroTop: Math.round(document.querySelector('.hero').getBoundingClientRect().top),
  nextTop: Math.round(document.querySelector('#stats').getBoundingClientRect().top),
  y: Math.round(scrollY),
}));
console.log(`\n走完跑道再滚 420px: 首屏 top=${after.heroTop}（应当已经往上走了）  ` +
  `下一段 top=${after.nextTop}（应当已经进入视口）`);

await browser.close();
