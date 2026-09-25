/**
 * verify-live.mjs — 对已上线的站点做完整验证
 *
 * 不只是看首页返回 200，而是真的用浏览器渲染一遍：
 * 照片、字体、样式、404 页、移动端布局都要确认没问题。
 *
 * 用法: node tools/verify-live.mjs [url]
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const URL_BASE = (process.argv[2] || 'https://superdajitui.github.io/R-KY/').replace(/\/?$/, '/');

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p));

const sleep = ms => new Promise(r => setTimeout(r, ms));
// 注意：不能加 --disable-gpu，否则 WebGL 起不来，流体效果会走静态兜底分支，
// 测不到真正上线的那条路径。显式启用 SwiftShader 软件渲染。
const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: [
    '--hide-scrollbars',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
  ],
});

console.log(`\n验证线上站点: ${URL_BASE}\n`);
let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`);
  ok ? pass++ : fail++;
};

/* ---------- 1. 首页 ---------- */
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const problems = [];
page.on('requestfailed', r => problems.push(`请求失败 ${r.url()}`));
page.on('response', r => { if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`); });
page.on('pageerror', e => problems.push(`JS 报错 ${e.message}`));
page.on('console', m => { if (m.type() === 'error') problems.push(`控制台 ${m.text()}`); });

await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
await sleep(3000);

const s = await page.evaluate(() => {
  const img = document.querySelector('.hero__portrait img');
  const word = document.querySelector('.hero__word--top');
  const cn = document.querySelector('.hero__cn');
  const portrait = document.querySelector('.hero__portrait');
  return {
    title: document.title,
    ready: document.body.classList.contains('is-ready'),
    ogImage: document.querySelector('meta[property="og:image"]')?.content || '',
    canonical: document.querySelector('link[rel="canonical"]')?.href || '',
    imgLoaded: !!img?.complete && img.naturalWidth > 0,
    imgSrc: (img?.currentSrc || '').split('/').pop(),
    wordOpacity: word ? getComputedStyle(word).opacity : '0',
    cnStroke: cn ? getComputedStyle(cn).webkitTextStrokeWidth : '',
    fontAnton: document.fonts.check('16px Anton'),
    fontInter: document.fonts.check('16px Inter'),
    // 流体效果已移除，这些不该再出现
    leftoverCanvas: !!document.querySelector('.hero__canvas'),
    pictureDisplay: document.querySelector('.hero__portrait picture')
      ? getComputedStyle(document.querySelector('.hero__portrait picture')).display : '无',
  };
});

console.log('首页');
check(s.title.includes('任恺昱'), '标题正确', s.title);
check(s.ready, '预加载揭幕完成');
check(s.imgLoaded, '照片已加载', s.imgSrc);
check(s.imgSrc.includes('hero-composite'), '取用的是首屏图', s.imgSrc);
check(s.pictureDisplay !== 'none', '照片容器可见');
check(!s.leftoverCanvas, '没有残留的流体 canvas');
// 首屏大字名的可见性要等滚下去之后再查 —— 开场页期间它还藏在下面，
// opacity 是 0（正常初始态，不是 bug）
check(s.fontAnton, 'Anton 字体（英文大字）已加载');
check(s.fontInter, 'Inter 字体（正文）已加载');
check(s.cnStroke && s.cnStroke !== '0px', '中文描边效果生效', s.cnStroke);
check(s.ogImage.startsWith('https://'), 'og:image 是绝对地址', s.ogImage);
check(s.canonical.startsWith('https://'), 'canonical 是绝对地址', s.canonical);

/* ---------- 开场页 ---------- */
const wel = await page.evaluate(() => {
  const el = document.querySelector('#welcome');
  const cs = el ? getComputedStyle(el) : null;
  const title = document.querySelector('.welcome__title');
  return {
    exists: !!el,
    bg: cs?.backgroundColor || '',
    text: title?.textContent.replace(/\s+/g, '') || '',
    atWelcome: document.body.classList.contains('at-welcome'),
  };
});
console.log('\n开场页');
check(wel.exists, '欢迎页存在');
check(/210,\s*255,\s*0/.test(wel.bg), '背景是主题色', wel.bg);
check(wel.text.includes('欢迎来到我的个人网站'), '文案完整', wel.text);
check(wel.atWelcome, '初始停在欢迎页');
await page.screenshot({ path: 'tools/shots/live-welcome.png' });

// 滚到首屏（开场页占了第一屏）
await page.evaluate(() => window.scrollTo(0, innerHeight));
await sleep(1800);
await page.screenshot({ path: 'tools/shots/live-desktop.png' });

const heroState = await page.evaluate(() => {
  const word = document.querySelector('.hero__word--top');
  const portrait = document.querySelector('.hero__portrait');
  const nav = document.querySelector('.nav');
  const hero = document.querySelector('.hero').getBoundingClientRect();
  return {
    wordOpacity: word ? getComputedStyle(word).opacity : '0',
    portraitOpacity: portrait ? getComputedStyle(portrait).opacity : '0',
    navOpacity: nav ? getComputedStyle(nav).opacity : '0',
    heroTop: Math.round(hero.top),
    isHero: document.body.classList.contains('is-hero'),
  };
});
console.log('\n首屏（滚下去之后）');
check(heroState.heroTop <= 2, '主页已滑到位', `top=${heroState.heroTop}`);
check(heroState.isHero, 'is-hero 已触发');
check(heroState.wordOpacity === '1', '首屏大字名可见', `opacity=${heroState.wordOpacity}`);
check(heroState.portraitOpacity === '1', '人物已入场', `opacity=${heroState.portraitOpacity}`);
check(heroState.navOpacity === '1', '导航已出现');

/* ---------- 2. 滚动到底，确认所有板块都显现 ---------- */
for (const sel of ['#stats', '#about', '#work', '#skills', '#contact']) {
  await page.evaluate(x => document.querySelector(x).scrollIntoView({ block: 'start', behavior: 'instant' }), sel);
  await sleep(700);
}
await sleep(1200);
const hidden = await page.evaluate(() =>
  [...document.querySelectorAll('[data-reveal]')].filter(el => getComputedStyle(el).opacity !== '1').length);
check(hidden === 0, '滚到底后所有板块均已显现', `未显现 ${hidden} 个`);
await page.close();

/* ---------- 3. 404 页 ---------- */
const p404 = await browser.newPage();
await p404.setViewport({ width: 1440, height: 900 });
await p404.goto(`${URL_BASE}no-such-page/`, { waitUntil: 'networkidle0', timeout: 60000 });
await sleep(1200);
const s404 = await p404.evaluate(() => {
  const code = document.querySelector('.nf__code');
  const btn = document.querySelector('.nf__actions a');
  return {
    code: code?.textContent.trim() || '无',
    color: code ? getComputedStyle(code).color : '',
    radius: btn ? getComputedStyle(btn).borderRadius : '',
    home: btn ? btn.href : '',
  };
});
console.log('\n404 页面');
check(s404.code === '404', '显示 404 内容', s404.code);
check(s404.color.includes('210, 255, 0'), '霓虹绿样式生效');
check(s404.radius === '100px', '按钮样式生效（style.css 已加载）');
check(s404.home === URL_BASE, '「回到首页」指向站点根');
await p404.screenshot({ path: 'tools/shots/live-404.png' });
await p404.close();

/* ---------- 4. 移动端 ---------- */
const mob = await browser.newPage();
await mob.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await mob.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
await sleep(3000);
// 同样要先滚过开场页，否则量到的是它在折叠线以下的位置
await mob.evaluate(() => window.scrollTo(0, innerHeight));
await sleep(1800);
const sm = await mob.evaluate(() => {
  const img = document.querySelector('.hero__portrait img');
  const pick = sel => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: +r.top.toFixed(0), bottom: +r.bottom.toFixed(0) };
  };
  return {
    imgLoaded: !!img?.complete && img.naturalWidth > 0,
    imgSrc: (img?.currentSrc || '').split('/').pop(),
    burgerVisible: getComputedStyle(document.querySelector('.nav__burger')).display !== 'none',
    word: pick('.hero__word--bottom'),
    foot: pick('.hero__foot'),
    vh: innerHeight,
  };
});
console.log('\n移动端 390x844');
check(sm.imgLoaded, '照片已加载', sm.imgSrc);
check(sm.imgSrc.includes('900'), '自动取用了移动端专用小图', sm.imgSrc);
check(sm.burgerVisible, '汉堡菜单已显示');
check(sm.word && sm.foot && sm.word.bottom < sm.foot.top, '名字与底部信息不重叠',
  `名字底 ${sm.word?.bottom} < 底部信息顶 ${sm.foot?.top}`);
check(sm.word && sm.word.bottom <= sm.vh, '名字未溢出视口底部');
await mob.screenshot({ path: 'tools/shots/live-mobile.png' });
await mob.close();

await browser.close();

/* ---------- 汇总 ---------- */
console.log('\n资源加载');
if (problems.length === 0) check(true, '全程无 404、无报错');
else { check(false, `发现 ${problems.length} 个问题`); [...new Set(problems)].slice(0, 8).forEach(p => console.log(`      ${p}`)); }

console.log(`\n${'─'.repeat(50)}`);
console.log(fail === 0
  ? `✓ 全部通过（${pass} 项）—— 站点在线上运行正常`
  : `✗ ${fail} 项未通过，${pass} 项通过`);
console.log(`${'─'.repeat(50)}\n`);
process.exit(fail === 0 ? 0 : 1);
