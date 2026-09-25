/**
 * perf-scroll.mjs — 量移动端滚动的真实开销，并定位是哪一层造成的
 *
 * 为什么不用"帧间隔/FPS"：rAF 受垂直同步封顶，只要没掉到 60 以下，
 * 帧间隔永远显示 16.6ms —— 所有变体都"满分"，根本分不出谁贵。
 * 第一版就是这么写的，七个变体全是 60 FPS / 0 掉帧，毫无信息量。
 *
 * 改成读 CDP 的性能计数器，量【主线程真实工作量】：
 *   RecalcStyleCount / RecalcStyleDuration —— 样式重算次数与耗时
 *   LayoutCount / LayoutDuration           —— 重排
 *   TaskDuration / ScriptDuration          —— 总任务与脚本耗时
 * 这些是绝对量，不受 vsync 封顶影响，能直接比较。
 *
 * 用法: node tools/perf-scroll.mjs [url]
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const URL_BASE = process.argv[2] || 'http://127.0.0.1:4321/';
const THROTTLE = Number(process.env.THROTTLE || 6);   // CPU 降速倍数

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p));

const VARIANTS = [
  { name: '基线（现状）', css: '' },
  { name: '关掉脉冲圆点(box-shadow)', css: '.hero__eyebrow .dot{animation:none!important}' },
  { name: '关掉所有循环动画', css: '.hero__eyebrow .dot,.hero__badge i,.hero__scroll svg,.welcome__scroll svg{animation:none!important}' },
  { name: '关掉颗粒层 .grain', css: '.grain{display:none!important}' },
  { name: '关掉跑马灯', css: '.marquee{display:none!important}' },
  { name: '关掉滚动动效引擎', css: '', reduced: true },
];

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--disable-gpu', '--hide-scrollbars'],
});

const rows = [];

for (const v of VARIANTS) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (v.reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const client = await page.createCDPSession();
  await client.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await client.send('Performance.enable');

  await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2600));
  if (v.css) await page.addStyleTag({ content: v.css });
  await new Promise(r => setTimeout(r, 400));

  const read = async () => {
    const { metrics } = await client.send('Performance.getMetrics');
    const m = {};
    for (const x of metrics) m[x.name] = x.value;
    return m;
  };

  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise(r => setTimeout(r, 500));
  const before = await read();

  // 固定工作量：滚 240 帧，每帧 14px（约 3 屏）
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let i = 0;
      (function tick() {
        window.scrollTo(0, (i += 14));
        if (++i < 240) requestAnimationFrame(tick); else resolve();
      })();
    });
  });
  const after = await read();

  const d = (k) => +( (after[k] || 0) - (before[k] || 0) ).toFixed(4);
  rows.push({
    name: v.name,
    recalc: d('RecalcStyleCount'),
    recalcMs: +(d('RecalcStyleDuration') * 1000).toFixed(1),
    layout: d('LayoutCount'),
    layoutMs: +(d('LayoutDuration') * 1000).toFixed(1),
    taskMs: +(d('TaskDuration') * 1000).toFixed(1),
    scriptMs: +(d('ScriptDuration') * 1000).toFixed(1),
  });
  await page.close();
}

await browser.close();

console.log(`\nCPU 降速 ${THROTTLE}x，滚动 240 帧（约 3 屏）\n`);
console.log('  ' + '变体'.padEnd(22) + '样式重算'.padStart(9) + '重算耗时'.padStart(10)
  + '重排'.padStart(7) + '重排耗时'.padStart(10) + '脚本耗时'.padStart(10) + '总任务'.padStart(9));
for (const r of rows) {
  console.log('  ' + r.name.padEnd(22) + String(r.recalc).padStart(9) + (r.recalcMs + 'ms').padStart(10)
    + String(r.layout).padStart(7) + (r.layoutMs + 'ms').padStart(10)
    + (r.scriptMs + 'ms').padStart(10) + (r.taskMs + 'ms').padStart(9));
}

const base = rows[0];
console.log('\n相对基线（省下的主线程时间）:');
for (const r of rows.slice(1)) {
  const save = base.taskMs - r.taskMs;
  const pct = base.taskMs ? (save / base.taskMs) * 100 : 0;
  console.log(`  ${r.name.padEnd(22)} ${save >= 0 ? '-' : '+'}${Math.abs(save).toFixed(1)}ms  `
    + `(${pct >= 0 ? '-' : '+'}${Math.abs(pct).toFixed(1)}%)`);
}
