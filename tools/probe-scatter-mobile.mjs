/**
 * probe-scatter-mobile.mjs — 手机上的揭幕散开
 *
 * 逐字散开两道闸门和其它效果分开了，手机上【要】跑。
 * 这里用真实的触屏仿真确认它确实在跑，并且顺手确认悬停和水面确实没挂上。
 *
 * 用法: node tools/probe-scatter-mobile.mjs [url]
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
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
await sleep(3000);
await page.mouse.move(20, 800);    // 触屏上这些监听没挂，这一下不该有任何反应
await sleep(300);

const media = await page.evaluate(() => ({
  touch: matchMedia('(hover: none), (pointer: coarse)').matches,
  chars: document.querySelectorAll('.welcome__ch').length,
  inside: window.__welcomeFx ? window.__welcomeFx().inside : null,
}));
console.log(`触屏判定=${media.touch}  拆了 ${media.chars} 个字  悬停 inside=${media.inside}`);

mkdirSync(SHOTS, { recursive: true });
const state = () => page.evaluate(() => {
  const fx = window.__welcomeFx();
  const read = el => {
    const t = getComputedStyle(el).transform;
    const m = t === 'none' ? null : new DOMMatrixReadOnly(t);
    return { ch: el.textContent, tx: m ? m.e : 0, ty: m ? m.f : 0,
      op: el.style.opacity === '' ? 1 : +el.style.opacity };
  };
  return { scat: fx.scat, rings: fx.rings,
    chars: [...document.querySelectorAll('.welcome__ch')].map(read) };
});

const tiles = [];
for (const v of [0, .18, .34, .5]) {
  await page.evaluate(y => window.scrollTo(0, y), Math.round(844 * v));
  await sleep(760);
  const s = await state();
  const moved = s.chars.filter(c => Math.abs(c.ty) > 3).length;
  console.log(`  scrollY=${Math.round(844 * v)}  scat=${s.scat.toFixed(2)}  ` +
    `在飞 ${moved}/${s.chars.length}  水面在跑 ${s.rings}`);
  const buf = await page.screenshot();
  tiles.push(await sharp(buf).resize({ width: 300 }).toBuffer());
}
const m = await sharp(tiles[0]).metadata();
await sharp({ create: { width: m.width * tiles.length + 12 * (tiles.length - 1),
  height: m.height, channels: 4, background: '#111112' } })
  .composite(tiles.map((t, i) => ({ input: t, left: i * (m.width + 12), top: 0 })))
  .toFile(`${SHOTS}/scatter-mobile.png`);
console.log(`\n出图: ${SHOTS}/scatter-mobile.png（手机 390×844，滚动 0 → 0.5 屏）`);

await browser.close();
