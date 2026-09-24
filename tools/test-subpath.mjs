/**
 * test-subpath.mjs — 验证生产包在子路径下能否正常工作
 *
 * GitHub Pages 的项目站点跑在 /仓库名/ 下，而不是域名根目录。
 * 任何一处写成 /assets/... 的绝对路径都会 404，而这个错误在本地
 * 根路径预览时完全看不出来 —— 所以必须在子路径下实测一遍。
 *
 * 用法: node tools/test-subpath.mjs
 */
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const PORT = 4399;
const PREFIX = '/R-KY';
const URL_BASE = `http://127.0.0.1:${PORT}${PREFIX}/`;

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p));

if (!existsSync('docs/index.html')) {
  console.error('✗ 找不到 docs/index.html，请先运行: node tools/build.mjs');
  process.exit(1);
}

// 以子路径模式启动服务器
const server = spawn(process.execPath,
  ['tools/serve.mjs', String(PORT), '--local', '--root=docs', `--prefix=${PREFIX}`],
  { stdio: ['ignore', 'pipe', 'pipe'] });

const serverLog = [];
server.stdout.on('data', d => serverLog.push(d.toString()));
server.stderr.on('data', d => serverLog.push('ERR ' + d.toString()));

const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(1500);

console.log(`测试地址: ${URL_BASE}`);
console.log('(等同 GitHub Pages 项目站点的 /仓库名/ 形式)\n');

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--disable-gpu', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const failed = [];
page.on('requestfailed', r => failed.push(`请求失败 ${r.url()} — ${r.failure()?.errorText}`));
page.on('response', r => { if (r.status() >= 400) failed.push(`HTTP ${r.status()}  ${r.url()}`); });
page.on('pageerror', e => failed.push(`JS 报错: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') failed.push(`控制台: ${m.text()}`); });

await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 30000 });
await sleep(2600);

const state = await page.evaluate(() => {
  const img = document.querySelector('.hero__portrait img');
  const cs = getComputedStyle(document.querySelector('.hero__word--top'));
  return {
    title: document.title,
    ready: document.body.classList.contains('is-ready'),
    imgSrc: (img?.currentSrc || '').split('/').slice(-1)[0],
    imgNatural: img ? `${img.naturalWidth}x${img.naturalHeight}` : '无',
    imgLoaded: !!img && img.complete && img.naturalWidth > 0,
    nameVisible: cs.opacity === '1',
    fontLoaded: document.fonts.check('16px Anton'),
    revealsHidden: [...document.querySelectorAll('[data-reveal]')]
      .filter(el => getComputedStyle(el).opacity !== '1').length,
  };
});

console.log('渲染结果:');
console.log(`  标题:        ${state.title}`);
console.log(`  揭幕完成:    ${state.ready ? '✓' : '✗'}`);
console.log(`  照片:        ${state.imgLoaded ? '✓' : '✗'} ${state.imgSrc} (${state.imgNatural})`);
console.log(`  大字名可见:  ${state.nameVisible ? '✓' : '✗'}`);
console.log(`  Anton 字体:  ${state.fontLoaded ? '✓ 已加载' : '✗ 未加载'}`);
console.log(`  未显现元素:  ${state.revealsHidden}`);

await page.screenshot({ path: 'tools/shots/subpath-hero.png' });

/* ---------- 404 页面 ---------- */
// GitHub Pages 对不存在的路径会返回 404.html 的内容，
// 验证它的样式能正常加载（同样受子路径影响）
const p404 = await browser.newPage();
await p404.setViewport({ width: 1440, height: 900 });
const failed404 = [];
// favicon.ico 是浏览器向「源站根目录」要的（/favicon.ico），
// 项目站点管不到那里，GitHub Pages 上同样是 404，属于预期行为，不计入失败
const isExpected404 = (u) => /\/favicon\.ico$/.test(u) || u.endsWith(`/R-KY/no-such-page/`);
p404.on('requestfailed', r => { if (!isExpected404(r.url())) failed404.push(r.url()); });
p404.on('response', r => {
  if (r.status() >= 400 && !isExpected404(r.url())) failed404.push(`HTTP ${r.status()}  ${r.url()}`);
});
await p404.goto(`${URL_BASE}no-such-page/`, { waitUntil: 'networkidle0', timeout: 30000 });
await sleep(900);
const s404 = await p404.evaluate(() => {
  const code = document.querySelector('.nf__code');
  const btn = document.querySelector('.nf__actions a');
  const home = document.querySelector('.nf__actions a');
  return {
    code: code?.textContent.trim() || '无',
    codeColor: code ? getComputedStyle(code).color : '',
    codeFont: code ? getComputedStyle(code).fontFamily : '',
    title: document.querySelector('.nf__title')?.textContent.trim() || '无',
    // 用具体数值判断，空字符串或默认值都算失败
    btnRadius: btn ? getComputedStyle(btn).borderRadius : '',
    // 「回到首页」链接必须指向站点根，而不是当前这个坏路径
    homeHref: home ? home.getAttribute('href') : '',
    homeResolved: home ? home.href : '',
  };
});
await p404.screenshot({ path: 'tools/shots/subpath-404.png' });
const styleOk = s404.codeColor.includes('210, 255, 0');
const btnOk = s404.btnRadius === '100px';
const homeOk = s404.homeResolved === URL_BASE;

console.log('\n404 页面:');
console.log(`  内容:        ${s404.code} — ${s404.title}`);
console.log(`  样式生效:    ${styleOk ? '✓ 霓虹绿 + Anton' : '✗ 样式没加载 (' + s404.codeColor + ')'}`);
console.log(`  按钮圆角:    ${btnOk ? '✓ 100px（style.css 生效）' : '✗ ' + s404.btnRadius}`);
console.log(`  回到首页:    ${homeOk ? '✓ 指向 ' + URL_BASE : '✗ 指向 ' + s404.homeResolved + '（指到坏路径了）'}`);
if (failed404.length) [...new Set(failed404)].forEach(f => console.log(`  ✗ ${f}`));
else console.log('  ✓ 资源全部加载成功');
await p404.close();

console.log('\n资源加载:');
if (failed.length === 0) console.log('  ✓ 全部成功，没有 404 或报错');
else [...new Set(failed)].forEach(f => console.log(`  ✗ ${f}`));

await browser.close();
server.kill();

const ok = failed.length === 0 && state.imgLoaded && state.nameVisible && state.fontLoaded
  && styleOk && btnOk && homeOk && failed404.length === 0;
console.log(`\n${ok ? '✓ 通过 —— 生产包可以安全部署到子路径' : '✗ 未通过 —— 子路径下有问题，不能直接部署'}`);
process.exit(ok ? 0 : 1);
