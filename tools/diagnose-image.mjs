/**
 * diagnose-image.mjs — 分别在 http:// 和 file:// 下检查照片是否真的加载出来了
 * 用法: node tools/diagnose-image.mjs
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p));

const HTML = path.resolve('index.html');
const targets = [
  ['http://127.0.0.1:4321/', 'http 协议（npm start）'],
  [pathToFileURL(HTML).href, 'file:// 协议（直接双击文件）'],
];

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--disable-gpu', '--hide-scrollbars'],
});

for (const [url, label] of targets) {
  console.log(`\n════════ ${label} ════════`);
  console.log(`  ${url}`);

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const failed = [];
  page.on('requestfailed', r => failed.push(`${r.url().split('/').pop()} — ${r.failure()?.errorText}`));
  page.on('console', m => { if (m.type() === 'error') failed.push(`console: ${m.text()}`); });

  try {
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  } catch (e) {
    console.log(`  ✗ 页面打不开: ${e.message}`);
    await page.close();
    continue;
  }

  await new Promise(r => setTimeout(r, 2600));

  const state = await page.evaluate(() => {
    const out = { imgs: [] };
    document.querySelectorAll('.hero__portrait img').forEach(img => {
      const r = img.getBoundingClientRect();
      out.imgs.push({
        cls: img.className || '(主图)',
        currentSrc: (img.currentSrc || '').split('/').pop() || '(空)',
        complete: img.complete,
        naturalW: img.naturalWidth,
        naturalH: img.naturalHeight,
        boxW: +r.width.toFixed(1),
        boxH: +r.height.toFixed(1),
        opacity: getComputedStyle(img).opacity,
        display: getComputedStyle(img).display,
      });
    });
    const p = document.querySelector('.hero__portrait');
    const pr = p.getBoundingClientRect();
    out.portraitBox = { w: +pr.width.toFixed(1), h: +pr.height.toFixed(1) };
    out.fontsLoaded = document.fonts ? document.fonts.size : -1;
    return out;
  });

  console.log(`  人物容器: ${state.portraitBox.w} x ${state.portraitBox.h}`);
  for (const i of state.imgs) {
    const ok = i.naturalW > 0 && i.complete && i.boxW > 0;
    console.log(`  ${ok ? '✓' : '✗'} ${i.cls.padEnd(10)} 实际取用=${i.currentSrc.padEnd(24)} 原始尺寸=${i.naturalW}x${i.naturalH} 渲染尺寸=${i.boxW}x${i.boxH} opacity=${i.opacity}`);
  }
  if (failed.length) {
    console.log('  ⚠ 失败请求:');
    [...new Set(failed)].forEach(f => console.log(`      ${f}`));
  } else {
    console.log('  无失败请求');
  }

  await page.screenshot({ path: `tools/shots/diag-${url.startsWith('file') ? 'file' : 'http'}.png` });
  await page.close();
}

await browser.close();
