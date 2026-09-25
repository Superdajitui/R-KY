/**
 * test-welcome.mjs — 欢迎页 → 主页 的开场流程
 *
 * 守着几件容易出错的事：
 *   1. 欢迎页必须铺满视口、是主题色，且文字真的显示出来
 *   2. 首屏必须还在折叠线以下（不然"下滑揭幕"就没意义了）
 *   3. 下滑之后主页要完整露出来，导航要出现
 *   4. 滚回顶部还能再看到欢迎页（它是 fixed 的，不该被移除）
 *
 * 用法: node tools/test-welcome.mjs [url]
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import sharp from 'sharp';

const URL_BASE = process.argv[2] || 'http://127.0.0.1:4321/';
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p));

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`);
  ok ? pass++ : fail++;
};

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--hide-scrollbars', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 40000 });
await sleep(3200);          // 等预加载遮罩 + 欢迎页文字进场

/* ═══════════ 阶段一：刚加载完，应该停在欢迎页 ═══════════ */
console.log('\n════ 阶段一：加载完成（欢迎页）════');

const w = await page.evaluate(() => {
  const el = document.querySelector('#welcome');
  const hero = document.querySelector('.hero');
  const r = el?.getBoundingClientRect();
  const hr = hero?.getBoundingClientRect();
  const cs = el ? getComputedStyle(el) : null;
  const title = document.querySelector('.welcome__title');
  return {
    exists: !!el,
    // 铺满视口
    box: r ? `${r.width.toFixed(0)}x${r.height.toFixed(0)}` : '无',
    coversViewport: r ? (r.width >= innerWidth - 1 && r.height >= innerHeight - 1) : false,
    position: cs?.position,
    bg: cs?.backgroundColor,
    bodyClass: document.body.className,
    // 首屏是否还在折叠线以下
    heroTop: hr ? Math.round(hr.top) : -1,
    heroBelowFold: hr ? hr.top >= innerHeight - 2 : false,
    titleText: title?.textContent.replace(/\s+/g, '') || '',
    navHidden: getComputedStyle(document.querySelector('.nav')).opacity,
  };
});

console.log(`  欢迎页: ${w.box}  position=${w.position}  bg=${w.bg}`);
console.log(`  文字: 「${w.titleText}」`);
console.log(`  首屏 top=${w.heroTop} (视口高 900)  导航 opacity=${w.navHidden}`);
await page.screenshot({ path: 'tools/shots/welcome-1.png' });

check(w.exists, '欢迎页存在');
check(w.coversViewport, '铺满整个视口', w.box);
check(w.position === 'fixed', 'fixed 定位（滚动时留在原地）');
check(/210,\s*255,\s*0/.test(w.bg), '背景是主题色霓虹绿', w.bg);
check(w.titleText.includes('欢迎来到') && w.titleText.includes('我的个人网站'), '欢迎文案完整');
check(w.heroBelowFold, '首屏还在折叠线以下', `top=${w.heroTop}`);
check(w.bodyClass.includes('at-welcome'), '处于 at-welcome 状态');
check(w.navHidden === '0', '欢迎页期间导航已收起', `opacity=${w.navHidden}`);

// 文字不能是透明的（遮罩揭示动画没跑完的话会是透明的）
const titleOpacity = await page.evaluate(() =>
  getComputedStyle(document.querySelector('.welcome__line > span')).opacity);
check(titleOpacity === '1', '标题文字已完全显现', `opacity=${titleOpacity}`);

/* ═══════════ 中文字体一致性 ═══════════
   直接问浏览器「你这块文字实际用的是哪个字体」，
   而不是靠肉眼看字形 —— 这是最硬的证据。
   背景：中文字体没自托管时，Windows 用微软雅黑、iPhone 用苹方、
   安卓用思源黑体，同一个镂空描边效果在各平台对不上。 */
const client = await page.createCDPSession();
await client.send('DOM.enable');
await client.send('CSS.enable');
const { root } = await client.send('DOM.getDocument');

async function usedFonts(selector) {
  const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  if (!nodeId) return [];
  const { fonts } = await client.send('CSS.getPlatformFontsForNode', { nodeId });
  return fonts || [];
}

console.log('\n════ 中文字体 ════');
const fontChecks = [
  ['开场页大字（镂空那行）', '.welcome__line--outline > span'],
  ['开场页大字（实心那行）', '.welcome__line > span'],
  ['开场页四周小字', '.welcome__roles'],
];
let allNoto = true;
for (const [label, sel] of fontChecks) {
  const fonts = await usedFonts(sel);
  const names = fonts.map(f => `${f.familyName}(${f.glyphCount}${f.isCustomFont ? ',自定义' : ',系统'})`).join(' + ');
  const ok = fonts.some(f => f.familyName.includes('Noto Sans SC') && f.isCustomFont);
  if (!ok) allNoto = false;
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${names || '（取不到）'}`);
}
check(allNoto, '中文全部走自托管字体（各平台渲染一致）');

// 字体确实被下载了，且没有 404
const fontLoaded = await page.evaluate(() =>
  document.fonts.check('900 100px "Noto Sans SC"', '欢迎来到我的个人网站'));
check(fontLoaded, 'Noto Sans SC 子集已加载且覆盖所需字形');

const fontRes = await page.evaluate(() =>
  performance.getEntriesByType('resource')
    .filter(r => r.name.includes('noto-sans-sc'))
    .map(r => ({ name: r.name.split('/').pop(), size: Math.round(r.transferSize / 1024) })));
console.log(`  字体请求: ${fontRes.map(f => `${f.name} ${f.size}KB`).join(', ') || '（无）'}`);
check(fontRes.length > 0 && fontRes[0].size > 0, '字体文件网络请求正常');

/* ═══════════ 阶段二：下滑揭幕 ═══════════ */
console.log('\n════ 阶段二：下滑进入主页 ════');

// 先在半途抓一帧，验证"主页滑上来盖住欢迎页"的幕布效果
await page.evaluate(() => window.scrollTo(0, Math.round(innerHeight * 0.5)));
await sleep(300);
await page.screenshot({ path: 'tools/shots/welcome-2-transition.png' });
const mid = await page.evaluate(() => {
  const hero = document.querySelector('.hero');
  const w = document.querySelector('#welcome');
  const hr = hero.getBoundingClientRect();
  const wr = w.getBoundingClientRect();
  return {
    scrollY: Math.round(scrollY),
    heroTop: Math.round(hr.top),
    // 欢迎页是 fixed，滚动时应该一直贴在 0
    welcomeTop: Math.round(wr.top),
    welcomeParallax: getComputedStyle(w.querySelector('.welcome__body')).transform,
  };
});
console.log(`  半途: scrollY=${mid.scrollY}  主页 top=${mid.heroTop}  欢迎页 top=${mid.welcomeTop}`);
console.log(`  欢迎页视差: ${mid.welcomeParallax}`);
check(mid.heroTop > 0, '半途时主页正从下方滑入', `top=${mid.heroTop}`);
check(mid.welcomeTop === 0, '欢迎页留在原地（fixed 生效）');
check(mid.welcomeParallax !== 'none', '欢迎页内容有视差位移');

// 再滚到刚好一屏：此时主页应当正好贴齐视口顶部
await page.evaluate(() => window.scrollTo(0, innerHeight));
await sleep(1500);

const h = await page.evaluate(() => {
  const hero = document.querySelector('.hero');
  const hr = hero.getBoundingClientRect();
  const nav = document.querySelector('.nav');
  const portrait = document.querySelector('.hero__portrait');
  const word = document.querySelector('.hero__word--top');
  return {
    scrollY: Math.round(scrollY),
    heroTop: Math.round(hr.top),
    bodyClass: document.body.className,
    navOpacity: getComputedStyle(nav).opacity,
    portraitOpacity: getComputedStyle(portrait).opacity,
    wordOpacity: getComputedStyle(word).opacity,
  };
});

console.log(`  scrollY=${h.scrollY}  首屏 top=${h.heroTop}  导航 opacity=${h.navOpacity}`);
console.log(`  人物 opacity=${h.portraitOpacity}  大字 opacity=${h.wordOpacity}`);
await page.screenshot({ path: 'tools/shots/welcome-3-hero.png' });

check(h.heroTop <= 2, '主页已完全滑到位', `top=${h.heroTop}`);
check(h.bodyClass.includes('is-hero'), '已切到 is-hero 状态');
check(!h.bodyClass.includes('at-welcome'), '已离开 at-welcome 状态');
check(h.navOpacity === '1', '导航已出现');
// 首屏动画必须在滑到位之后才播，不然就是在欢迎页背后空放
check(h.portraitOpacity === '1', '人物已入场', `opacity=${h.portraitOpacity}`);
check(h.wordOpacity === '1', '大字名已入场', `opacity=${h.wordOpacity}`);

/* ═══════════ 阶段三：滚回顶部 ═══════════ */
console.log('\n════ 阶段三：滚回顶部 ════');
await page.evaluate(() => window.scrollTo(0, 0));
await sleep(900);
const back = await page.evaluate(() => {
  const el = document.querySelector('#welcome');
  const r = el.getBoundingClientRect();
  const nav = document.querySelector('.nav');
  return {
    welcomeStillThere: !!el,
    covers: r.top === 0 && r.height >= innerHeight - 1,
    navOpacity: getComputedStyle(nav).opacity,
    bodyClass: document.body.className,
  };
});
await page.screenshot({ path: 'tools/shots/welcome-4-back.png' });
check(back.welcomeStillThere, '欢迎页还在 DOM 里');
check(back.covers, '欢迎页重新铺满视口');
check(back.bodyClass.includes('at-welcome'), '重新进入 at-welcome 状态');
check(back.navOpacity === '0', '导航再次收起', `opacity=${back.navOpacity}`);

/* ═══════════ 阶段四：点欢迎页任意位置也能进入 ═══════════ */
console.log('\n════ 阶段四：点击欢迎页 ════');
await page.mouse.click(720, 500);
await sleep(1600);
const clicked = await page.evaluate(() => Math.round(scrollY));
console.log(`  点击后 scrollY=${clicked}`);
check(clicked > 800, '点击欢迎页能进入主页', `scrollY=${clicked}`);

await browser.close();
check(errs.filter(e => !/favicon/i.test(e)).length === 0, '无 JS 报错',
  [...new Set(errs)].slice(0, 2).join(' | '));

console.log(`\n${'─'.repeat(52)}`);
console.log(fail === 0 ? `✓ 全部通过（${pass} 项）` : `✗ ${fail} 项未通过，${pass} 项通过`);
console.log('截图: tools/shots/welcome-1.png → welcome-4-back.png');
console.log('─'.repeat(52));
process.exit(fail === 0 ? 0 : 1);
