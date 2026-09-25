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

// 开场页
await page.screenshot({ path: 'tools/shots/peek-welcome.png' });

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
    h: Math.round(r.height),
    // ⚠ puppeteer 的 screenshot({clip}) 用文档坐标，
    // 而 getBoundingClientRect 给的是视口坐标 —— 要把滚动偏移加回去
    docY: Math.round(r.top + window.scrollY),
    scrollY: Math.round(window.scrollY),
  };
});

// 滚到首屏再截
await page.evaluate(() => window.scrollTo(0, innerHeight));
await sleep(1800);
await page.screenshot({ path: 'tools/shots/peek-hero.png' });
await page.screenshot({
  path: 'tools/shots/peek-portrait.png',
  clip: {
    x: Math.round(1440 / 2 - 260),
    y: Math.max(0, st.docY),
    width: 520,
    height: st.h,
  },
});

console.log(`\n线上站点: ${URL_BASE}`);
console.log(`  picture display=${st.pictureDisplay}`);
console.log(`  图片已加载=${st.imgLoaded}  原始=${st.imgNatural}  src=${st.imgSrc}`);
console.log(`  人物容器 ${st.box}  文档坐标 y=${st.docY}`);
if (errs.length) { console.log('  报错:'); [...new Set(errs)].slice(0, 5).forEach(e => console.log(`    ${e}`)); }
else console.log('  无报错');

console.log('\n截图: tools/shots/peek-welcome.png / peek-hero.png / peek-portrait.png');
await browser.close();
