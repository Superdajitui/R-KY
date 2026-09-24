/**
 * test-render.mjs — 对比不同渲染后端下人物是否可见
 * 用来定位「软件渲染正常、GPU 渲染下整块消失」这类合成问题
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p));

const URL_FILE = pathToFileURL(path.resolve('index.html')).href;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const configs = [
  ['软件渲染 (--disable-gpu)', ['--disable-gpu']],
  ['GPU 渲染 (默认)', []],
  ['GPU + ANGLE/D3D11', ['--use-angle=d3d11', '--enable-gpu-rasterization']],
];

for (const [label, extraArgs] of configs) {
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: EDGE,
      headless: 'new',
      args: ['--hide-scrollbars', '--no-first-run', ...extraArgs],
    });
  } catch (e) {
    console.log(`\n${label}: 启动失败 — ${e.message}`);
    continue;
  }

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(URL_FILE, { waitUntil: 'networkidle0', timeout: 30000 });
  await sleep(2800);

  const r = await page.evaluate(() => {
    const img = document.querySelector('.hero__portrait img');
    const wrap = document.querySelector('.hero__portrait');
    const ir = img.getBoundingClientRect();
    return {
      ready: document.body.classList.contains('is-ready'),
      natural: `${img.naturalWidth}x${img.naturalHeight}`,
      box: `${ir.width.toFixed(0)}x${ir.height.toFixed(0)}`,
      imgOpacity: getComputedStyle(img).opacity,
      wrapOpacity: getComputedStyle(wrap).opacity,
      wrapFilter: getComputedStyle(wrap).filter,
      hasMask: getComputedStyle(wrap).maskImage !== 'none' ||
               getComputedStyle(wrap).webkitMaskImage !== 'none',
    };
  });

  // 直接采样首屏中央偏下位置的像素，判断人物到底有没有画出来
  const shot = await page.screenshot({ encoding: 'base64', clip: { x: 620, y: 380, width: 200, height: 200 } });
  const avg = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let sum = 0, mx = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
      sum += l; if (l > mx) mx = l;
    }
    return { avg: +(sum / (d.length / 4)).toFixed(1), max: mx };
  }, shot);

  console.log(`\n════ ${label} ════`);
  console.log(`  is-ready=${r.ready}  图片原始尺寸=${r.natural}  渲染=${r.box}`);
  console.log(`  img.opacity=${r.imgOpacity}  portrait.opacity=${r.wrapOpacity}  有 mask=${r.hasMask}`);
  console.log(`  人物区域采样亮度: 平均=${avg.avg} 最高=${avg.max}  ${avg.max < 12 ? '✗ 全黑 —— 人物没画出来' : '✓ 有内容'}`);

  await browser.close();
}
