/**
 * test-hero.mjs — 首屏照片的回归测试
 *
 * 守着两件容易出错的事：
 *   1. 照片必须显示出来（不能空白、不能被盖住）
 *   2. 光晕必须留在人物身后，不能糊到脸上
 *      —— 这是 CSS 绘制顺序的坑：定位元素会画在静态定位元素之上，
 *         改结构时很容易把 z-index 弄丢，症状就是整张脸泛绿。
 *
 * 用法: node tools/test-hero.mjs [url]
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

/**
 * 区域颜色统计。
 * ⚠ sharp 的 stats() 只统计「输入图」，会忽略 extract 等管线操作 ——
 * 直接写 sharp(src).extract(box).stats() 拿到的是整图统计，
 * 换任何取样框结果都一样，极具迷惑性。必须先 toBuffer() 落地。
 */
async function regionStats(src, box) {
  const buf = await sharp(src).extract(box).toBuffer();
  return sharp(buf).stats();
}

/** 区域平均亮度：照片在 → 明显偏亮；空白 → 接近背景色 #111112 (17) */
async function brightness(src) {
  const st = await sharp(src).stats();
  return st.channels.slice(0, 3).reduce((s, c) => s + c.mean, 0) / 3;
}

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--hide-scrollbars', '--disable-gpu'],
});

const errs = [];
async function openPage(w, h, dsf = 1) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: dsf });
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 40000 });
  await sleep(2800);
  return page;
}

/* ═══════════ 桌面 ═══════════ */
console.log('\n════ 桌面 1440x900 ════');
const page = await openPage(1440, 900);

// 首屏现在被欢迎页推到了第二屏，得先滚下去；
// 顺便等 is-hero 的入场动画播完，否则量到的是动画中途的状态
await page.evaluate(() => window.scrollTo(0, innerHeight));
await sleep(1800);

const st = await page.evaluate(() => {
  const c = document.querySelector('.hero__portrait');
  const pic = document.querySelector('.hero__portrait picture');
  const img = document.querySelector('.hero__img');
  const r = c.getBoundingClientRect();
  return {
    imgLoaded: !!img?.complete && img.naturalWidth > 0,
    imgSrc: (img?.currentSrc || '').split('/').pop(),
    imgNatural: img ? `${img.naturalWidth}x${img.naturalHeight}` : '无',
    pictureDisplay: pic ? getComputedStyle(pic).display : '无',
    scrollY: Math.round(window.scrollY),
    // ⚠ getBoundingClientRect 给的是「视口坐标」，而 puppeteer 的
    // screenshot({clip}) 用的是「文档坐标」，必须把滚动偏移加回去。
    // 加了欢迎页之后两者差了一整屏 —— 之前没暴露是因为首屏正好在文档顶部。
    box: { x: r.left, y: r.top + window.scrollY, w: r.width, h: r.height },
    // 流体效果已移除，这些不该再出现在 DOM 里
    leftoverCanvas: !!document.querySelector('.hero__canvas'),
    leftoverClass: c.classList.contains('is-webgl') || c.classList.contains('is-fluid'),
  };
});

const clip = {
  x: Math.max(0, Math.round(st.box.x)),
  y: Math.max(0, Math.round(st.box.y)),
  width: Math.round(st.box.w),
  height: Math.round(st.box.h),
};
const shot = await page.screenshot({ clip });
await page.screenshot({ path: 'tools/shots/hero-desktop.png' });
const b = await brightness(shot);

console.log(`  图片: ${st.imgSrc}  ${st.imgNatural}  picture=${st.pictureDisplay}`);
console.log(`  容器: ${st.box.w.toFixed(0)}x${st.box.h.toFixed(0)}  区域亮度 ${b.toFixed(1)}`);

check(st.imgLoaded, '照片已加载', st.imgSrc);
check(st.pictureDisplay !== 'none', '照片容器可见');
check(b > 60, '照片确实画出来了（不是空白）', `亮度 ${b.toFixed(1)}`);
check(!st.leftoverCanvas, '没有残留的流体 canvas');
check(!st.leftoverClass, '没有残留的流体状态类');

/* ---- 光晕层级：脸不能被绿光糊住 ---- */
const FACE = { rx: 0.34, ry: 0.36, rw: 0.12, rh: 0.10 };   // 脸颊，相对人物图的比例
const srcMeta = await sharp('src/portrait-1400.webp').metadata();
const srcRGB = (await regionStats('src/portrait-1400.webp', {
  left: Math.round(FACE.rx * srcMeta.width),
  top: Math.round(FACE.ry * srcMeta.height),
  width: Math.round(FACE.rw * srcMeta.width),
  height: Math.round(FACE.rh * srcMeta.height),
})).channels.slice(0, 3).map(c => c.mean);

const pageRGB = (await regionStats(shot, {
  left: Math.round(FACE.rx * clip.width),
  top: Math.round(FACE.ry * clip.height),
  width: Math.round(FACE.rw * clip.width),
  height: Math.round(FACE.rh * clip.height),
})).channels.slice(0, 3).map(c => c.mean);

const maxDiff = Math.max(...srcRGB.map((v, i) => Math.abs(v - pageRGB[i])));
const greenShift = (pageRGB[1] - srcRGB[1]) - (pageRGB[0] - srcRGB[0]);

console.log(`  源图脸颊 RGB: ${srcRGB.map(v => v.toFixed(0)).join(' / ')}`);
console.log(`  页面脸颊 RGB: ${pageRGB.map(v => v.toFixed(0)).join(' / ')}`);
check(maxDiff < 14, '脸部颜色与源图一致（光晕没有糊到脸上）', `最大偏差 ${maxDiff.toFixed(1)}`);
check(greenShift < 8, '没有额外的绿色偏移', `绿增益 ${greenShift.toFixed(1)}`);
await page.close();

/* ═══════════ 移动端 ═══════════ */
console.log('\n════ 移动端 390x844 ════');
const mob = await openPage(390, 844, 2);
await mob.evaluate(() => window.scrollTo(0, innerHeight));
await sleep(1800);
const ms = await mob.evaluate(() => {
  const img = document.querySelector('.hero__img');
  const c = document.querySelector('.hero__portrait');
  const pic = document.querySelector('.hero__portrait picture');
  const r = c.getBoundingClientRect();
  const foot = document.querySelector('.hero__foot')?.getBoundingClientRect();
  return {
    src: (img?.currentSrc || '').split('/').pop(),
    loaded: !!img?.complete && img.naturalWidth > 0,
    pictureDisplay: pic ? getComputedStyle(pic).display : '无',
    boxBottom: r.bottom,
    footTop: foot ? foot.top : 0,
    // 文档坐标，理由同桌面端
    box: { x: r.left, y: r.top + window.scrollY, w: r.width, h: r.height },
  };
});
const mClip = {
  x: Math.max(0, Math.round(ms.box.x)),
  y: Math.max(0, Math.round(ms.box.y)),
  width: Math.round(ms.box.w),
  height: Math.round(ms.box.h),
};
const mb = await brightness(await mob.screenshot({ clip: mClip }));
console.log(`  图片: ${ms.src}  区域亮度 ${mb.toFixed(1)}`);
check(ms.loaded, '照片已加载');
check(ms.src.includes('900'), '取用了移动端专用小图', ms.src);
check(mb > 60, '照片确实画出来了', `亮度 ${mb.toFixed(1)}`);
check(ms.pictureDisplay !== 'none', '照片容器可见');
await mob.close();

await browser.close();

check(errs.filter(e => !/favicon/i.test(e)).length === 0, '无 JS 报错',
  [...new Set(errs)].slice(0, 2).join(' | '));

console.log(`\n${'─'.repeat(52)}`);
console.log(fail === 0 ? `✓ 全部通过（${pass} 项）` : `✗ ${fail} 项未通过，${pass} 项通过`);
console.log('─'.repeat(52));
process.exit(fail === 0 ? 0 : 1);
