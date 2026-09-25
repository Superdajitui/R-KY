/**
 * check-name-collar.mjs — 首屏「任恺昱」有没有压过衣领
 *
 * 为什么要量：
 *   名字是绝对定位 + 超大字号，靠肉眼调 bottom 和 font-size 很容易反复试错。
 *   这里把人物图里量到的衣领坐标换算到页面坐标，再扫出名字真正的
 *   墨迹顶端，两者一比就知道超没超。
 *
 *   「墨迹顶端」不能用元素盒子顶端代替 —— CJK 字形在 em 盒里有上留白，
 *   盒子顶通常比看得见的笔画高出一截，用盒子算会误判。
 *
 * 用法: node tools/check-name-collar.mjs [url]
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import sharp from 'sharp';

const URL_BASE = process.argv[2] || 'http://127.0.0.1:4321/';
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p));

const IMG_H = 1400;        // 人物图原始高度
const COLLAR_IMG_Y = 987;  // 由 tools/find-collar.mjs 量得
const VP = { width: 1440, height: 900 };

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new', args: ['--disable-gpu', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport(VP);   // 注意是 {width,height}，不是 {w,h}
await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 40000 });
await new Promise(r => setTimeout(r, 2600));
await page.evaluate(() => window.scrollTo(0, innerHeight));
await new Promise(r => setTimeout(r, 2000));

// ⚠ 全部换算成「文档坐标」。
// getBoundingClientRect 给的是视口坐标，而 screenshot({clip}) 要的是文档坐标 ——
// 加了开场页之后两者差一整屏，混用会让裁剪框跑到别处去（扫不到任何霓虹像素）。
const geo = await page.evaluate(() => {
  const sy = window.scrollY;
  const p = document.querySelector('.hero__portrait').getBoundingClientRect();
  const n = document.querySelector('.hero__word--bottom').getBoundingClientRect();
  const cs = getComputedStyle(document.querySelector('.hero__word--bottom'));
  return {
    scrollY: sy,
    portrait: { top: p.top + sy, height: p.height, width: p.width },
    name: { top: n.top + sy, bottom: n.bottom + sy, height: n.height, width: n.width, left: n.left },
    fontSize: cs.fontSize,
  };
});

// 衣领在页面上的位置：人物图按高度等比缩放
const scale = geo.portrait.height / IMG_H;
const collarY = geo.portrait.top + COLLAR_IMG_Y * scale;

// 扫名字所在区域，找出第一行含有霓虹绿像素的位置 = 墨迹顶端
const pad = 6;
const clip = {
  x: Math.max(0, Math.round(geo.name.left - pad)),
  y: Math.max(0, Math.round(geo.name.top - pad)),
  width: Math.min(Math.round(geo.name.width + pad * 2), VP.width),
  height: Math.min(Math.round(geo.name.height + pad * 2), VP.height),
};
const { data, info } = await sharp(await page.screenshot({ clip }))
  .raw().toBuffer({ resolveWithObject: true });

let inkTopOffset = -1, inkBottomOffset = -1;
for (let y = 0; y < info.height; y++) {
  let hit = false;
  for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * info.channels;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    // 霓虹绿 #d2ff00
    if (r > 150 && g > 190 && b < 130) { hit = true; break; }
  }
  if (hit) { if (inkTopOffset < 0) inkTopOffset = y - pad; inkBottomOffset = y - pad; }
}
const inkTop = inkTopOffset >= 0 ? geo.name.top + inkTopOffset : null;
const inkBottom = inkBottomOffset >= 0 ? geo.name.top + inkBottomOffset : null;

console.log(`\n站点: ${URL_BASE}`);
console.log(`  视口: ${VP.width}x${VP.height}   滚动 ${geo.scrollY}`);
console.log(`  人物容器: ${geo.portrait.width.toFixed(0)}x${geo.portrait.height.toFixed(0)}  top=${geo.portrait.top.toFixed(0)}`);
console.log(`  衣领位置: y=${collarY.toFixed(0)}  (图内 y=${COLLAR_IMG_Y}, 缩放 ${scale.toFixed(3)})`);
console.log(`  名字字号: ${geo.fontSize}`);
console.log(`  名字盒子: top=${geo.name.top.toFixed(0)}  bottom=${geo.name.bottom.toFixed(0)}  宽=${geo.name.width.toFixed(0)}`);
console.log(`  名字墨迹: top=${inkTop === null ? '?' : inkTop.toFixed(0)}  bottom=${inkBottom === null ? '?' : inkBottom.toFixed(0)}`);

if (inkTop === null) {
  console.log('\n  ✗ 没扫到霓虹绿描边，检查名字是否正常渲染');
  await browser.close();
  process.exit(1);
}

const fs = Number.parseFloat(geo.fontSize);
console.log(`  墨迹高度: ${(inkBottom - inkTop).toFixed(0)}px  = ${((inkBottom - inkTop) / fs).toFixed(3)}em`);
console.log(`  墨迹顶端距盒子顶: ${(inkTop - geo.name.top).toFixed(0)}px = ${((inkTop - geo.name.top) / fs).toFixed(3)}em`);

const gap = inkTop - collarY;
console.log(`\n  墨迹顶端 − 衣领 = ${gap.toFixed(0)}px`);
if (gap >= 0) {
  console.log(`  ✓ 名字完全落在衣服上，没有压过衣领（留白 ${gap.toFixed(0)}px）`);
} else {
  console.log(`  ✗ 名字压过衣领 ${(-gap).toFixed(0)}px —— 需要调小字号或下移`);
}

await browser.close();
process.exit(gap >= 0 ? 0 : 1);
