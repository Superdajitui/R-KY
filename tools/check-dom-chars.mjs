/**
 * check-dom-chars.mjs — 用「浏览器真实渲染出来的字」校验 charset.txt
 *
 * extract-chars.mjs 是直接扫源码的，为了不让注释里的字混进字体子集，它会先剥注释。
 * 剥注释这件事本身有风险：万一正则剥多了，把正文的字也剥掉，
 * 子集就会缺字，而 check-font-coverage.mjs 用的是同一份 charset，根本发现不了。
 *
 * 所以这里换一条独立的路：把页面真正跑起来，从渲染后的 DOM 里把字捞出来。
 * DOM 里出现、但 charset.txt 里没有的字 = 真实的缺字。
 *
 * 用法: node tools/check-dom-chars.mjs
 */
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.env.BASE || 'http://127.0.0.1:4321/';

const charset = new Set(await readFile('tools/charset.txt', 'utf8'));

const isCJK = (c) =>
  (c >= 0x4e00 && c <= 0x9fff) ||
  (c >= 0x3400 && c <= 0x4dbf) ||
  (c >= 0xf900 && c <= 0xfaff) ||
  (c >= 0x3000 && c <= 0x303f) ||
  (c >= 0xff00 && c <= 0xffef);

const EXTRA = new Set([...'·—–…“”‘’「」《》']);

function collect(text, bag) {
  for (const ch of text || '') {
    const c = ch.codePointAt(0);
    if (isCJK(c) || EXTRA.has(ch)) bag.add(ch);
  }
  return bag;
}

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--font-render-hinting=none'],
});

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, dsf: 1 },
  { name: 'mobile', width: 390, height: 844, dsf: 3 },
];

const found = new Map(); // char -> [来源]

for (const vp of VIEWPORTS) {
  const page = await browser.newPage();
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: vp.dsf });
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 1200));

  // 滚一遍，触发 reveal / 懒加载 / 计数器
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.7;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 90));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 300));
  });

  // 手机上把菜单打开，菜单里的字也要算进去
  if (vp.name === 'mobile') {
    await page.evaluate(() => {
      const t = document.querySelector('[data-menu-toggle], .nav__toggle, .burger');
      if (t) t.click();
    });
    await new Promise((r) => setTimeout(r, 700));
  }

  const payload = await page.evaluate(() => {
    const out = { text: [], attrs: [] };
    out.text.push(document.documentElement.innerText || '');
    // 伪元素用的 data-text、无障碍标签、meta 描述都会被渲染或被读屏念出来
    for (const el of document.querySelectorAll('*')) {
      for (const a of el.attributes) {
        if (/^(data-text|aria-label|alt|title|placeholder|content)$/.test(a.name)) {
          out.attrs.push(a.value);
        }
      }
    }
    out.attrs.push(document.title || '');
    return out;
  });

  const bag = new Set();
  for (const t of payload.text) collect(t, bag);
  for (const t of payload.attrs) collect(t, bag);

  for (const ch of bag) {
    if (!found.has(ch)) found.set(ch, []);
    found.get(ch).push(vp.name);
  }

  await page.close();
}

await browser.close();

const missing = [...found.entries()].filter(([ch]) => !charset.has(ch)).sort((a, b) => a[0].localeCompare(b[0]));

console.log('\nDOM 字符覆盖检查');
console.log(`  渲染出的字符: ${found.size} 个`);
console.log(`  charset.txt: ${charset.size} 个`);

if (missing.length) {
  console.log(`\n  ✗ 有 ${missing.length} 个字在页面里渲染出来了，但不在字体子集里：`);
  for (const [ch, where] of missing) {
    console.log(`    ${ch}  U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}  ← ${where.join(', ')}`);
  }
  console.log('\n  修复: npm run font:chars && npm run font:build\n');
  process.exit(1);
}

console.log('\n  ✓ 渲染出来的字全部都在子集里\n');
