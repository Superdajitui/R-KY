/**
 * peek-live.mjs — 打开线上站点，把首屏和人物区域截出来
 * 用法: node tools/peek-live.mjs [url]
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const URL_BASE = process.argv[2] || 'https://superdajitui.github.io/R-KY/';
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p));

const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--hide-scrollbars', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
await sleep(3000);

const st = await page.evaluate(() => {
  const c = document.querySelector('.hero__portrait');
  const pic = document.querySelector('.hero__portrait picture');
  const img = document.querySelector('.hero__img');
  const r = c.getBoundingClientRect();
  return {
    pictureDisplay: pic ? getComputedStyle(pic).display : '无',
    imgLoaded: !!img?.complete && img.naturalWidth > 0,
    imgNatural: img ? `${img.naturalWidth}x${img.naturalHeight}` : '无',
    imgSrc: (img?.currentSrc || '').split('/').pop(),
    box: `${r.width.toFixed(0)}x${r.height.toFixed(0)}`,
    boxTop: Math.round(r.top),
  };
});

const clip = {
  x: Math.round(1440 / 2 - 260), y: Math.max(0, st.boxTop),
  width: 520, height: Math.min(640, 900 - st.boxTop),
};
await page.screenshot({ path: 'tools/shots/peek-portrait.png', clip });
await page.screenshot({ path: 'tools/shots/peek-hero.png' });

console.log(`\n线上站点: ${URL_BASE}`);
console.log(`  picture display=${st.pictureDisplay}`);
console.log(`  图片已加载=${st.imgLoaded}  原始=${st.imgNatural}  src=${st.imgSrc}`);
console.log(`  人物容器 ${st.box}  top=${st.boxTop}`);
if (errs.length) { console.log('  报错:'); [...new Set(errs)].slice(0, 5).forEach(e => console.log(`    ${e}`)); }
else console.log('  无报错');

console.log('\n截图: tools/shots/peek-portrait.png / peek-hero.png');
await browser.close();
