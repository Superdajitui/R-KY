/**
 * test-fluid.mjs — 验证首屏流体效果，以及最关键的「照片不能消失」
 *
 * 场景一（正常）：真的用鼠标划过人物，抓三个时刻，确认效果生效并能衰减。
 * 场景二（退化）：把 drawArrays 打成空操作，模拟"WebGL 能初始化却画不出内容"。
 *                这种情况下照片必须照样显示 —— 这是用户报过的问题，
 *                也是最容易再次踩到的坑：早期写法是 WebGL 成功就隐藏静态图，
 *                一旦 canvas 空白，照片就"凭空消失"。
 *
 * 用法: node tools/test-fluid.mjs [url]
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

// 不能加 --disable-gpu，否则 WebGL 拿不到上下文，测不到真正上线的那条路径
const ARGS = [
  '--hide-scrollbars',
  '--enable-unsafe-swiftshader',
  '--use-gl=angle',
  '--use-angle=swiftshader',
];

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`);
  ok ? pass++ : fail++;
};

/** 人物区域的平均亮度。照片在 → 明显偏亮；整块空白 → 接近背景色 #111112 (17) */
async function brightness(page, clip) {
  const buf = await page.screenshot({ clip });
  const st = await sharp(buf).stats();
  return st.channels.slice(0, 3).reduce((s, c) => s + c.mean, 0) / 3;
}

async function openPage(browser, stubDraw) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  if (stubDraw) {
    // 必须在页面脚本之前注入：把绘制调用打成空操作，
    // 就能复现"上下文正常、着色器正常，但画面什么都没有"
    await page.evaluateOnNewDocument(() => {
      const patch = (proto) => {
        if (!proto) return;
        proto.drawArrays = function () {};
        proto.drawElements = function () {};
      };
      patch(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
      patch(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
    });
  }
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 40000 });
  await sleep(3000);
  return { page, errs };
}

const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ARGS });

/* ═══════════ 场景一：正常 ═══════════ */
console.log('\n════ 场景一：正常运行 ════');
const { page, errs } = await openPage(browser, false);
page.on('console', m => { if (m.text().includes('[fluid]')) console.log(`  ${m.text()}`); });
await sleep(300);

const state = await page.evaluate(() => {
  const c = document.querySelector('.hero__portrait');
  const cv = document.querySelector('.hero__canvas');
  const pic = document.querySelector('.hero__portrait picture');
  const r = c.getBoundingClientRect();
  return {
    hasClass: c.classList.contains('is-webgl'),
    canvasExists: !!cv,
    canvasSize: cv ? `${cv.width}x${cv.height}` : '无',
    // 关键：静态图必须始终可见，它是 canvas 画不出来时的兜底
    pictureDisplay: pic ? getComputedStyle(pic).display : '无',
    box: { x: r.left, y: r.top, w: r.width, h: r.height },
  };
});

const clip = {
  x: Math.max(0, Math.round(state.box.x)),
  y: Math.max(0, Math.round(state.box.y)),
  width: Math.round(state.box.w),
  height: Math.round(Math.min(state.box.h, 900 - state.box.y)),
};

console.log(`  is-webgl=${state.hasClass}  canvas=${state.canvasSize}  picture=${state.pictureDisplay}`);
const bIdle = await brightness(page, clip);
console.log(`  静止态亮度: ${bIdle.toFixed(1)}`);

/* ---- 光晕层级：脸不能被绿光糊住 ----
   比对这个区域「页面渲染出来的颜色」和「源图的颜色」。
   如果 .hero__halo 盖在了图片上面（CSS 绘制顺序的坑：定位元素会画在
   静态定位元素之上），脸会整体偏绿，两者就对不上了。 */
/** 区域颜色统计。
 *  ⚠ sharp 的 stats() 只统计「输入图」，会忽略 extract 等管线操作 ——
 *  直接写 sharp(src).extract(box).stats() 拿到的是整图统计，
 *  换任何取样框结果都一样，极具迷惑性。必须先 toBuffer() 落地。 */
async function regionStats(src, box) {
  const buf = await sharp(src).extract(box).toBuffer();
  return sharp(buf).stats();
}

const FACE = { rx: 0.34, ry: 0.36, rw: 0.12, rh: 0.10 };   // 脸颊，相对人物图的比例
const srcMeta = await sharp('src/portrait-1400.webp').metadata();
const srcStats = await regionStats('src/portrait-1400.webp', {
  left: Math.round(FACE.rx * srcMeta.width),
  top: Math.round(FACE.ry * srcMeta.height),
  width: Math.round(FACE.rw * srcMeta.width),
  height: Math.round(FACE.rh * srcMeta.height),
});
const pageStats = await regionStats(await page.screenshot({ clip }), {
  left: Math.round(FACE.rx * clip.width),
  top: Math.round(FACE.ry * clip.height),
  width: Math.round(FACE.rw * clip.width),
  height: Math.round(FACE.rh * clip.height),
});

const srcRGB = srcStats.channels.slice(0, 3).map(c => c.mean);
const pageRGB = pageStats.channels.slice(0, 3).map(c => c.mean);
const diff = srcRGB.map((v, i) => Math.abs(v - pageRGB[i]));
const maxDiff = Math.max(...diff);
const greenShift = (pageRGB[1] - srcRGB[1]) - (pageRGB[0] - srcRGB[0]);   // 绿相对红的额外增益

console.log(`  源图脸颊 RGB:   ${srcRGB.map(v => v.toFixed(0)).join(' / ')}`);
console.log(`  页面脸颊 RGB:   ${pageRGB.map(v => v.toFixed(0)).join(' / ')}`);
console.log(`  最大偏差:       ${maxDiff.toFixed(1)}   绿相对增益: ${greenShift.toFixed(1)}`);

const hashShot = async () => {
  const b = await page.screenshot({ clip });
  let h = 2166136261;
  for (let i = 0; i < b.length; i += 7) { h ^= b[i]; h = Math.imul(h, 16777619) >>> 0; }
  return h;
};
const hIdle = await hashShot();

const cx = state.box.x + state.box.w / 2;
const cy = state.box.y + state.box.h * 0.45;
for (let i = 0; i <= 20; i++) {
  const t = i / 20;
  await page.mouse.move(cx - state.box.w * 0.26 + state.box.w * 0.52 * t,
                        cy - 55 + Math.sin(t * Math.PI * 2) * 85);
  await sleep(22);
}
await sleep(80);
const hMove = await hashShot();
await page.screenshot({ path: 'tools/shots/fluid-hero-moving.png' });
const bMove = await brightness(page, clip);

await page.mouse.move(10, 10);
await sleep(3200);
const hAfter = await hashShot();

console.log('\n  判定');
check(state.hasClass, 'WebGL 初始化成功（含像素自检）');
check(state.pictureDisplay !== 'none', '静态图始终可见（兜底防线）');
check(bIdle > 60, '静止态人物清晰可见', `亮度 ${bIdle.toFixed(1)}`);
// 光晕必须留在人物身后：脸部的渲染色要和源图一致，不能被绿光染上去
check(maxDiff < 14, '脸部颜色与源图一致（绿光没有糊到脸上）', `最大偏差 ${maxDiff.toFixed(1)}`);
check(greenShift < 8, '没有额外的绿色偏移', `绿增益 ${greenShift.toFixed(1)}`);
check(bMove > 60, '划过时人物依然可见', `亮度 ${bMove.toFixed(1)}`);
check(hMove !== hIdle, '鼠标划过后画面确实变化了');
check(hAfter !== hMove, '停止操作后画面继续衰减');
await page.close();

/* ═══════════ 场景二：WebGL 画不出内容 ═══════════ */
console.log('\n════ 场景二：WebGL 能初始化但画不出内容（模拟故障）════');
const deg = await openPage(browser, true);

const dState = await deg.page.evaluate(() => {
  const c = document.querySelector('.hero__portrait');
  const cv = document.querySelector('.hero__canvas');
  const pic = document.querySelector('.hero__portrait picture');
  const r = c.getBoundingClientRect();
  return {
    hasClass: c.classList.contains('is-webgl'),
    canvasStillThere: !!cv,
    pictureDisplay: pic ? getComputedStyle(pic).display : '无',
    box: { x: r.left, y: r.top, w: r.width, h: r.height },
  };
});
const dClip = {
  x: Math.max(0, Math.round(dState.box.x)),
  y: Math.max(0, Math.round(dState.box.y)),
  width: Math.round(dState.box.w),
  height: Math.round(Math.min(dState.box.h, 900 - dState.box.y)),
};
const dBright = await brightness(deg.page, dClip);
await deg.page.screenshot({ path: 'tools/shots/fluid-degraded.png' });

console.log(`  is-webgl=${dState.hasClass}  picture=${dState.pictureDisplay}  亮度=${dBright.toFixed(1)}`);
check(!dState.hasClass, '自检识别出画不出内容，未启用流体');
check(dState.pictureDisplay !== 'none', '静态图未被隐藏');
check(dBright > 60, '照片照常显示，没有变空白', `亮度 ${dBright.toFixed(1)}`);

const errsAll = [...errs, ...deg.errs].filter(e => !/favicon/i.test(e));
check(errsAll.length === 0, '无 JS 报错', errsAll.slice(0, 2).join(' | '));

await browser.close();

console.log(`\n${'─'.repeat(52)}`);
console.log(fail === 0 ? `✓ 全部通过（${pass} 项）` : `✗ ${fail} 项未通过，${pass} 项通过`);
console.log(`截图: tools/shots/fluid-hero-moving.png / fluid-degraded.png`);
console.log('─'.repeat(52));
process.exit(fail === 0 ? 0 : 1);
