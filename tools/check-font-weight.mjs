/**
 * check-font-weight.mjs — 确认可变字体的字重轴真的生效
 *
 * 为什么需要这条检查：
 *   自托管的是一个可变字体（wght 400~900），而 CDP 报出来的字体名
 *   是 name 表里的默认实例名，会写成「Noto Sans SC Thin」。
 *   名字里带 Thin 很容易让人以为渲染成了最细字重。
 *
 *   验证办法：用同一份字体在 canvas 上渲染不同字重，比较「墨量」
 *   （深色像素占比）。字重轴正常的话，墨量应当随字重递增。
 *
 * 用法: node tools/check-font-weight.mjs [url]
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const URL_BASE = process.argv[2] || 'http://127.0.0.1:4321/';
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p));

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new', args: ['--disable-gpu'],
});
const page = await browser.newPage();
await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate(() => document.fonts.ready);

const res = await page.evaluate(() => {
  const cv = document.createElement('canvas');
  cv.width = 400; cv.height = 120;
  const ctx = cv.getContext('2d');

  const ink = (w) => {
    ctx.clearRect(0, 0, 400, 120);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 400, 120);
    ctx.fillStyle = '#000';
    ctx.font = `${w} 80px "Noto Sans SC"`;
    ctx.fillText('欢迎来到', 10, 90);
    const d = ctx.getImageData(0, 0, 400, 120).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark++;
    return dark;
  };

  return {
    loaded: document.fonts.check('900 80px "Noto Sans SC"', '欢迎来到'),
    // 注意：字重必须取在字体的轴范围内。
    // 请求时用的是 wght@400..900，所以 100 会被钳制到 400 ——
    // 拿 100 和 400 比会得到相同的墨量，那是正常的，不是 bug。
    w400: ink(400),
    w600: ink(600),
    w900: ink(900),
  };
});

console.log(`\n站点: ${URL_BASE}`);
console.log(`  字形已加载: ${res.loaded}`);
console.log(`  字重 400 墨量: ${res.w400}`);
console.log(`  字重 600 墨量: ${res.w600}`);
console.log(`  字重 900 墨量: ${res.w900}`);

// 字体轴范围是 400~900，只在这个区间内比较
const ok = res.loaded
  && res.w400 < res.w600 && res.w600 < res.w900
  && res.w900 > res.w400 * 1.4;

console.log('');
console.log(ok
  ? '  ✓ 字重轴正常：墨量随字重递增，900 明显粗于 400'
  : '  ✗ 字重轴没生效 —— 各字重渲染结果几乎一样，文字会偏细');

await browser.close();
process.exit(ok ? 0 : 1);
