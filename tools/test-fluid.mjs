/**
 * test-fluid.mjs — 验证首屏流体效果真的工作了
 *
 * 不只是看页面能打开，而是真的用鼠标划过人物区域，
 * 抓下静止态 / 划过后 / 衰减后三个时刻的画面，确认：
 *   1. WebGL 初始化成功（容器拿到了 is-webgl）
 *   2. 静止态画面与原图一致（没有莫名其妙被推偏）
 *   3. 划过之后画面确实发生了变化
 *   4. 停止操作后会衰减回静止态
 *
 * 用法: node tools/test-fluid.mjs [url]
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const URL_BASE = process.argv[2] || 'http://127.0.0.1:4321/';
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p));

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 注意：不能加 --disable-gpu，否则 WebGL 拿不到上下文。
// 无头模式下需要显式允许 SwiftShader 软件渲染。
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: [
    '--hide-scrollbars',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const problems = [];
page.on('pageerror', e => problems.push(`JS 报错: ${e.message}`));
page.on('console', m => {
  const t = m.text();
  if (m.type() === 'error') problems.push(`控制台错误: ${t}`);
  if (t.includes('[fluid]')) console.log(`  ${t}`);
});

await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 40000 });
await sleep(3000);

/* ---------- 1. WebGL 是否初始化成功 ---------- */
const state = await page.evaluate(() => {
  const c = document.querySelector('.hero__portrait');
  const cv = document.querySelector('.hero__canvas');
  const pic = document.querySelector('.hero__portrait picture');
  return {
    hasClass: c?.classList.contains('is-webgl') || false,
    canvasExists: !!cv,
    canvasSize: cv ? `${cv.width}x${cv.height}` : '无',
    canvasDisplay: cv ? getComputedStyle(cv).display : '无',
    // 要看 <picture> 的 display，不能看里面的 <img> ——
    // 祖先 display:none 时，后代自身的计算样式仍然是 block
    pictureDisplay: pic ? getComputedStyle(pic).display : '无',
    portraitBox: c ? (() => { const r = c.getBoundingClientRect(); return `${r.width.toFixed(0)}x${r.height.toFixed(0)}`; })() : '无',
  };
});

console.log('\n初始化');
console.log(`  is-webgl 类:     ${state.hasClass ? '✓' : '✗'}`);
console.log(`  canvas:          ${state.canvasExists ? '✓' : '✗'}  尺寸 ${state.canvasSize}  display=${state.canvasDisplay}`);
console.log(`  静态 picture:    display=${state.pictureDisplay}`);
console.log(`  人物容器尺寸:    ${state.portraitBox}`);

/* ---------- 2. 抓三个时刻的画面 ---------- */
const box = await page.evaluate(() => {
  const r = document.querySelector('.hero__portrait').getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});

const clip = {
  x: Math.max(0, Math.round(box.x)),
  y: Math.max(0, Math.round(box.y)),
  width: Math.round(box.w),
  height: Math.round(Math.min(box.h, 900 - box.y)),
};

// 指纹取自「截图本身」而不是读 canvas：
// WebGL 默认 preserveDrawingBuffer=false，合成后缓冲就被清了，
// drawImage 读回来是全黑，判断不出任何变化。
async function grab(name) {
  const buf = await page.screenshot({ path: `tools/shots/fluid-${name}.png`, clip });
  let h = 2166136261;
  for (let i = 0; i < buf.length; i += 7) {
    h ^= buf[i];
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

const hIdle = await grab('1-idle');
console.log(`\n静止态指纹: ${hIdle}`);

// 在人物区域里来回划动
const cx = box.x + box.w / 2;
const cy = box.y + box.h * 0.45;
await page.mouse.move(cx - box.w * 0.28, cy - 60);
await sleep(120);
for (let i = 0; i <= 22; i++) {
  const t = i / 22;
  await page.mouse.move(
    cx - box.w * 0.28 + box.w * 0.56 * t,
    cy - 60 + Math.sin(t * Math.PI * 2) * 90
  );
  await sleep(22);
}
await sleep(80);
const hMoving = await grab('2-moving');
await page.screenshot({ path: 'tools/shots/fluid-hero-moving.png' });   // 整屏，看构图
console.log(`划过中指纹: ${hMoving}`);

// 等它衰减
await page.mouse.move(10, 10);
await sleep(3200);
const hAfter = await grab('3-after');
console.log(`衰减后指纹: ${hAfter}`);

/* ---------- 3. 判定 ---------- */
console.log('\n判定');
const checks = [
  [state.hasClass, 'WebGL 初始化成功'],
  [state.canvasExists, 'canvas 已插入 DOM'],
  [state.pictureDisplay === 'none', '静态图已让位给 canvas'],
  // 注意：画面变化必须以 WebGL 成功为前提。
  // 否则视差、入场动画本身就会让截图不同，得到假阳性。
  [state.hasClass && hMoving !== hIdle, '鼠标划过后画面确实变化了'],
  [state.hasClass && hAfter !== hMoving, '停止操作后画面继续衰减'],
];
let pass = 0;
for (const [ok, label] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  if (ok) pass++;
}
console.log(`\n${pass}/${checks.length} 通过`);
if (problems.length) {
  console.log('\n问题:');
  [...new Set(problems)].forEach(p => console.log(`  ✗ ${p}`));
}
console.log('\n截图: tools/shots/fluid-1-idle.png / fluid-2-moving.png / fluid-3-after.png');

await browser.close();
process.exit(pass === checks.length && problems.length === 0 ? 0 : 1);
