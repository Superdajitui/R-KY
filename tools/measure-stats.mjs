/**
 * measure-stats.mjs — 量「档案」四格的排版对齐情况
 *
 * 为什么要量：
 *   四格的大字用了不同字号（数字 80px / 字母 62px / 符号 80px / 汉字 55px），
 *   高度不同 → 下面的标签起始位置就参差不齐，肉眼看"不整齐"但说不清差在哪。
 *   这里把每个字块的实际墨迹范围和标签位置都量出来。
 *
 * 用法: node tools/measure-stats.mjs [url]
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const URL_BASE = process.argv[2] || 'http://127.0.0.1:4321/';
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p));

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new', args: ['--disable-gpu', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 40000 });
await new Promise(r => setTimeout(r, 2600));
await page.evaluate(() => document.querySelector('#stats').scrollIntoView({ block: 'start', behavior: 'instant' }));
await new Promise(r => setTimeout(r, 2200));

const rows = await page.evaluate(() => {
  return [...document.querySelectorAll('.stat')].map(cell => {
    const num = cell.querySelector('.stat__num');
    const key = cell.querySelector('.stat__key');
    const cs = getComputedStyle(num);
    // 墨迹范围：用 Range 量真正的文字，不是元素盒子
    const range = document.createRange();
    range.selectNodeContents(num);
    const tr = range.getBoundingClientRect();
    const nr = num.getBoundingClientRect();
    const kr = key.getBoundingClientRect();
    return {
      text: num.textContent.trim(),
      fontSize: parseFloat(cs.fontSize),
      weight: cs.fontWeight,
      family: cs.fontFamily.split(',')[0].replace(/["']/g, ''),
      boxTop: Math.round(nr.top), boxH: Math.round(nr.height),
      inkTop: Math.round(tr.top), inkBot: Math.round(tr.bottom),
      keyTop: Math.round(kr.top),
    };
  });
});

const w = (s, n) => String(s).padEnd(n);
const r = (s, n) => String(s).padStart(n);

console.log(`\n站点: ${URL_BASE}\n`);
console.log('  ' + w('内容', 10) + r('字号', 7) + r('字重', 6) + '  ' + w('字体', 18)
  + r('元素高', 7) + r('墨迹顶', 7) + r('墨迹底', 7) + r('标签顶', 7));
for (const x of rows) {
  console.log('  ' + w(x.text, 10) + r(x.fontSize.toFixed(1), 7) + r(x.weight, 6) + '  '
    + w(x.family.slice(0, 17), 18) + r(x.boxH, 7) + r(x.inkTop, 7) + r(x.inkBot, 7) + r(x.keyTop, 7));
}

const spread = (arr) => Math.max(...arr) - Math.min(...arr);
const inkTops = rows.map(x => x.inkTop);
const inkBots = rows.map(x => x.inkBot);
const keyTops = rows.map(x => x.keyTop);
const sizes = rows.map(x => x.fontSize);

console.log('');
console.log(`  字号区间:     ${Math.min(...sizes).toFixed(0)} ~ ${Math.max(...sizes).toFixed(0)}px   差值 ${spread(sizes).toFixed(0)}px`);
console.log(`  墨迹顶对齐:   差值 ${spread(inkTops)}px    ${spread(inkTops) <= 2 ? '✓ 齐' : '✗ 不齐'}`);
console.log(`  墨迹底对齐:   差值 ${spread(inkBots)}px    ${spread(inkBots) <= 2 ? '✓ 齐' : '✗ 不齐'}`);
console.log(`  标签起始对齐: 差值 ${spread(keyTops)}px    ${spread(keyTops) <= 2 ? '✓ 齐' : '✗ 不齐'}`);

await browser.close();
