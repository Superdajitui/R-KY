/**
 * shoot.mjs — 用 puppeteer 驱动本机 Edge 给页面截图，顺便收集控制台报错
 * 用法: node tools/shoot.mjs [url] [输出前缀]
 */
import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const URL_BASE = process.argv[2] || 'http://127.0.0.1:4321/';
const PREFIX = process.argv[3] || 'shot';
const OUT = 'tools/shots';

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p)) || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check'],
});

const problems = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function newPage(width, height, deviceScaleFactor = 1) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor });
  page.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', r => problems.push(`请求失败: ${r.url()} — ${r.failure()?.errorText}`));
  await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 30000 });
  await sleep(2400); // 等预加载揭幕结束
  return page;
}

async function shot(page, name, opts = {}) {
  const file = `${OUT}/${PREFIX}-${name}.png`;
  await page.screenshot({ path: file, ...opts });
  console.log(`✓ ${file}`);
}

/* ---------- 桌面：逐屏滚动，验证进场动效 ---------- */
const desktop = await newPage(1440, 900);
await shot(desktop, 'desktop-1-hero');

for (const [i, sel] of ['#stats', '#about', '#work', '#skills', '#contact'].entries()) {
  await desktop.evaluate(s => {
    document.querySelector(s).scrollIntoView({ block: 'start', behavior: 'instant' });
  }, sel);
  await sleep(1500);           // 留足时间给过渡动画跑完
  await shot(desktop, `desktop-${i + 2}-${sel.slice(1)}`);
}

// 统计一下有没有元素卡在不可见状态
const hidden = await desktop.evaluate(() =>
  [...document.querySelectorAll('[data-reveal]')]
    .filter(el => getComputedStyle(el).opacity !== '1')
    .map(el => el.className || el.tagName)
);
console.log(hidden.length ? `⚠ 仍有 ${hidden.length} 个元素未显现: ${hidden.slice(0, 6).join(' | ')}`
                          : '✓ 所有 [data-reveal] 元素均已显现');

await shot(desktop, 'desktop-full', { fullPage: true });
await desktop.close();

/* ---------- 移动端 ---------- */
const mobile = await newPage(390, 844, 2);
await shot(mobile, 'mobile-hero');
await mobile.evaluate(() => document.querySelector('#work').scrollIntoView({ block: 'start', behavior: 'instant' }));
await sleep(1500);
await shot(mobile, 'mobile-work');
await mobile.close();

/* ---------- 平板（横竖屏都测，断点在 820px）---------- */
const tabletP = await newPage(820, 1180, 2);
await shot(tabletP, 'tablet-portrait');
await tabletP.close();

const tabletL = await newPage(1180, 820, 2);
await shot(tabletL, 'tablet-landscape');
await tabletL.close();

/* ---------- 宽屏 ---------- */
const wide = await newPage(1920, 1080);
await shot(wide, 'wide-hero');
await wide.close();

/* ---------- 禁用 JS 的兜底检查 ----------
   所有入场动效都挂在 html.js 下，脚本被禁用时内容必须完整可见。
   这里直接检查首屏和正文元素的实际不透明度。 */
const nojs = await browser.newPage();
await nojs.setJavaScriptEnabled(false);
await nojs.setViewport({ width: 1440, height: 900 });
await nojs.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 30000 });
await sleep(800);
const nojsState = await nojs.evaluate(() => {
  const op = sel => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el).opacity : 'missing';
  };
  // 注意：display:none 不改变 opacity 的计算值，
  // 所以判断遮罩是否真的挡屏必须看 display / 实际盒模型
  const loaderEl = document.querySelector('#loader');
  const loaderCs = getComputedStyle(loaderEl);
  return {
    loaderDisplay: loaderCs.display,
    loaderCovers: loaderEl.getBoundingClientRect().height > 0,
    wordTop: op('.hero__word--top'),
    wordBottom: op('.hero__word--bottom'),
    aboutTitle: op('.about .sec__title'),
    card: op('.card'),
    hiddenReveals: [...document.querySelectorAll('[data-reveal]')]
      .filter(el => getComputedStyle(el).opacity !== '1').length,
    totalReveals: document.querySelectorAll('[data-reveal]').length,
  };
});
console.log('\n──────── 禁用 JS 兜底 ────────');
console.log(`  预加载遮罩: display=${nojsState.loaderDisplay}, 是否占据画面=${nojsState.loaderCovers} ` +
  (!nojsState.loaderCovers ? '✓ 不挡内容' : '✗ 挡住内容了'));
console.log(`  首屏 KERRY: ${nojsState.wordTop}   任恺昱: ${nojsState.wordBottom}`);
console.log(`  关于标题: ${nojsState.aboutTitle}   项目卡片: ${nojsState.card}`);
console.log(`  未显现的 [data-reveal]: ${nojsState.hiddenReveals} / ${nojsState.totalReveals} ` +
  (nojsState.hiddenReveals === 0 ? '✓' : '✗ 有内容看不见'));
await shot(nojs, 'nojs-full', { fullPage: true });
await nojs.close();

await browser.close();

console.log('\n──────── 控制台问题 ────────');
if (problems.length === 0) console.log('无');
else [...new Set(problems)].forEach(p => console.log('  ' + p));
