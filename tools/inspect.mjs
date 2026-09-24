/**
 * inspect.mjs — 量首屏关键元素的实际位置，判断有没有互相压盖 / 溢出视口
 * 用法: node tools/inspect.mjs
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p));

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--disable-gpu', '--hide-scrollbars'],
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

for (const [w, h] of [[1440, 900], [1920, 1080], [390, 844]]) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h });
  await page.goto('http://127.0.0.1:4321/', { waitUntil: 'networkidle0' });
  await sleep(2400);

  const info = await page.evaluate(() => {
    const pick = sel => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1),
        left: +r.left.toFixed(1), right: +r.right.toFixed(1),
        h: +r.height.toFixed(1), w: +r.width.toFixed(1),
        fontSize: cs.fontSize,
      };
    };
    return {
      vh: innerHeight,
      eyebrow: pick('.hero__eyebrow'),
      nameTop: pick('.hero__word--top'),
      nameBottom: pick('.hero__word--bottom'),
      portrait: pick('.hero__portrait'),
      foot: pick('.hero__foot'),
    };
  });

  console.log(`\n════════ ${w}x${h} ════════`);
  const rows = ['eyebrow', 'nameTop', 'portrait', 'nameBottom', 'foot'];
  for (const k of rows) {
    const v = info[k];
    if (!v) continue;
    const flags = [];
    if (v.bottom > info.vh) flags.push(`⚠ 溢出底部 ${(v.bottom - info.vh).toFixed(0)}px`);
    if (v.top < 0) flags.push('⚠ 溢出顶部');
    console.log(`  ${k.padEnd(11)} top=${String(v.top).padStart(7)}  bottom=${String(v.bottom).padStart(7)}  h=${String(v.h).padStart(6)}  fs=${v.fontSize}  ${flags.join(' ')}`);
  }
  // 相邻元素是否压盖
  const gap1 = info.nameTop.top - info.eyebrow.bottom;
  const gap2 = info.foot.top - info.nameBottom.bottom;
  console.log(`  标签→KERRY 间距: ${gap1.toFixed(1)}px ${gap1 < 12 ? '⚠ 太挤/压盖' : '✓'}`);
  console.log(`  名字→底部信息 间距: ${gap2.toFixed(1)}px ${gap2 < 8 ? '⚠ 压盖' : '✓'}`);

  if (w === 1920) {
    await page.screenshot({
      path: 'tools/shots/inspect-bottom-name.png',
      clip: { x: 0, y: h - 340, width: w, height: 340 },
    });
    console.log('  → 已截取底部名字区域 tools/shots/inspect-bottom-name.png');
  }
  await page.close();
}

await browser.close();
