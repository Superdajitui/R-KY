/**
 * probe-scatter.mjs — 揭幕：整屏文字随滚动散开飞走
 *
 * 这是全站唯一一个"编排过的时刻"，也是这一轮唯一的加法。
 * 它由滚动位置驱动，单个静止帧看不出任何东西 ——
 * 必须把几个滚动位置连起来看：字是不是【依次】飞的、有没有互相穿插、
 * 淡出是不是发生得太早（太早会看不清"散开"这个动作本身）。
 *
 * 用法: node tools/probe-scatter.mjs [url]
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
await sleep(3000);
await page.mouse.move(20, 860);   // 别让悬停弹簧掺进来

mkdirSync(SHOTS, { recursive: true });

const state = () => page.evaluate(() => {
  const fx = window.__welcomeFx();
  const one = document.querySelector('.welcome__ch');
  return {
    scat: fx.scat,
    running: fx.running,
    /* 从【矩阵】读数，不解析 transform 字符串。
       解析字符串这条路上已经栽过两次：CSSOM 会把值规范化
       （`translate3d(x, y, 0)` 补成 `0px`、逗号后补空格），
       正则一不匹配就静默返回 0，看起来像"位移没生效"，
       然后你会去改一个本来没坏的 JS。 */
    chars: [...document.querySelectorAll('.welcome__ch')].map(el => {
      const t = getComputedStyle(el).transform;
      const m = t === 'none' ? null : new DOMMatrixReadOnly(t);
      return {
        ch: el.textContent,
        tx: m ? m.e : 0, ty: m ? m.f : 0,
        rot: m ? Math.atan2(m.b, m.a) * 180 / Math.PI : 0,
        s: m ? Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) : 1,
        op: el.style.opacity === '' ? 1 : +el.style.opacity,
      };
    }),
    sample: one ? +getComputedStyle(one).fontSize.replace('px', '') : 0,
  };
});

console.log('滚动位置 → 每个字的位移 / 旋转 / 缩放 / 透明度\n');
const tiles = [];
const STEPS = [0, .1, .2, .32, .45, .58];
for (const f of STEPS) {
  await page.evaluate(v => window.scrollTo(0, Math.round(innerHeight * v)), f);
  await sleep(700);                       // 等阻尼跟随走完
  const s = await state();
  console.log(`  scrollY=${(f * 900).toFixed(0)}  scat=${s.scat.toFixed(3)}  字高≈${s.sample.toFixed(0)}px`);
  for (const c of s.chars) {
    console.log(`    ${c.ch}  x${String(Math.round(c.tx)).padStart(5)}  ` +
      `y${String(Math.round(c.ty)).padStart(5)}  ${String(c.rot.toFixed(1)).padStart(6)}°  ` +
      `s${c.s.toFixed(3)}  op${c.op.toFixed(2)}`);
  }
  const buf = await page.screenshot();
  tiles.push(await sharp(buf).resize({ width: 460 }).toBuffer());
  await sleep(80);
}

const m = await sharp(tiles[0]).metadata();
await sharp({ create: { width: m.width * tiles.length, height: m.height, channels: 4, background: '#111112' } })
  .composite(tiles.map((t, i) => ({ input: t, left: i * m.width, top: 0 })))
  .toFile(`${SHOTS}/scatter-strip.png`);
console.log(`\n胶片条: ${SHOTS}/scatter-strip.png（滚动 0 → 0.58 屏）`);

/* 滚回顶部必须完全复原，不能留一地的内联样式 */
await page.evaluate(() => window.scrollTo(0, 0));
await sleep(1400);
const back = await page.evaluate(() => {
  const els = [...document.querySelectorAll('.welcome__ch')];
  return {
    scat: window.__welcomeFx().scat,
    dirty: els.filter(el => el.style.transform || el.style.opacity).length,
    anyMoved: els.some(el => {
      const m = el.style.transform.match(/translate3d\(([-\d.]+)px/);
      return m && Math.abs(+m[1]) > .5;
    }),
  };
});
console.log(`\n滚回顶部: scat=${back.scat}  还带内联样式的字=${back.dirty}  ` +
  `还有位移的=${back.anyMoved ? '有' : '没有'}`);

await browser.close();
