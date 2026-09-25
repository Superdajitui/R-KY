/**
 * compare-name.mjs — 把各端的「任恺昱」裁出来并排对比
 *
 * 裁切范围从 DOM 直接取，不手量 ——
 * 手量过一次，改了布局就全错，裁出来一片空白还以为是渲染问题。
 *
 * 用法: node tools/compare-name.mjs [url]
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import sharp from 'sharp';

const URL_BASE = process.argv[2] || 'http://127.0.0.1:4321/';
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p));

const VIEWPORTS = [
  ['desktop', 1440, 900, 1],
  ['tablet', 1180, 820, 2],
  ['tablet-P', 820, 1180, 2],
  ['mobile', 390, 844, 2],
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new', args: ['--disable-gpu', '--hide-scrollbars'],
});

const TILE_W = 900;
const tiles = [];

for (const [tag, w, h, dsf] of VIEWPORTS) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: dsf });
  await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 40000 });
  await sleep(2600);
  await page.evaluate(() => window.scrollTo(0, innerHeight));
  await sleep(1900);

  // 取名字的位置 + 衣领换算，一并标出来
  const info = await page.evaluate(() => {
    const sy = window.scrollY;
    const n = document.querySelector('.hero__word--bottom').getBoundingClientRect();
    const p = document.querySelector('.hero__portrait').getBoundingClientRect();
    const cs = getComputedStyle(document.querySelector('.hero__word--bottom'));
    return {
      name: { left: n.left, top: n.top + sy, width: n.width, height: n.height },
      portrait: { top: p.top + sy, height: p.height },
      fontSize: cs.fontSize,
      strokeWidth: getComputedStyle(document.querySelector('.hero__cn')).webkitTextStrokeWidth,
      vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio,
    };
  });

  const COLLAR_IMG = 987, IMG_H = 1400;
  const collarY = info.portrait.top + COLLAR_IMG * (info.portrait.height / IMG_H);

  // 裁切区域：名字四周留白，并把衣领线也框进来
  const padX = info.name.width * 0.08;
  const top = Math.min(info.name.top, collarY) - 24;
  const bottom = info.name.top + info.name.height + 24;
  const clip = {
    x: Math.max(0, Math.round(info.name.left - padX)),
    y: Math.max(0, Math.round(top)),
    width: Math.round(info.name.width + padX * 2),
    height: Math.round(bottom - top),
  };

  const shot = await page.screenshot({ clip });
  const out = await sharp(shot).resize({ width: TILE_W - 24, kernel: 'lanczos3' }).png().toBuffer();
  const om = await sharp(out).metadata();
  const dbg = await sharp(shot).stats();
  console.log(`      clip=${JSON.stringify(clip)} 亮度=${(dbg.channels.slice(0,3).reduce((s,c)=>s+c.mean,0)/3).toFixed(1)}`);

  const label = `${tag} ${w}x${h} · 字号 ${parseFloat(info.fontSize).toFixed(0)}px · 描边 ${info.strokeWidth}`;
  // 注意：这个 SVG 会在图片【之后】合成，所以背景矩形只能盖标题条那一条，
  // 铺满整块会把刚放上去的截图整个盖掉（踩过一次，输出全黑还以为裁切错了）。
  const svg = Buffer.from(
    `<svg width="${TILE_W}" height="${om.height + 44}" xmlns="http://www.w3.org/2000/svg">
       <rect width="${TILE_W}" height="44" fill="#111112"/>
       <text x="14" y="28" font-family="monospace" font-size="20" fill="#d2ff00">${label}</text>
     </svg>`);
  const svgBuf = await sharp(svg).resize(TILE_W, om.height + 44, { fit: 'fill' }).png().toBuffer();

  tiles.push(await sharp({
    create: { width: TILE_W, height: om.height + 44, channels: 4,
              background: { r: 17, g: 17, b: 18, alpha: 1 } },
  }).composite([
    { input: out, left: 12, top: 38 },
    { input: svgBuf, left: 0, top: 0 },
  ]).png().toBuffer());

  console.log(`  ✓ ${label}`);
  await page.close();
}

const metas = await Promise.all(tiles.map(t => sharp(t).metadata()));
const H = metas.reduce((s, m) => s + m.height + 10, 10);
await sharp({
  create: { width: TILE_W + 20, height: H, channels: 4, background: { r: 45, g: 45, b: 50, alpha: 1 } },
}).composite(tiles.map((t, i) => ({
  input: t, left: 10,
  top: 10 + metas.slice(0, i).reduce((s, m) => s + m.height + 10, 0),
}))).png().toFile('tools/shots/name-compare.png');

console.log('\n对比图: tools/shots/name-compare.png');
await browser.close();
