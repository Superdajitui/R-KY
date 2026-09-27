/* 一次性：headless 到底在用 GPU 还是软件光栅化？
   这直接决定"帧耗时 5.5ms"是真实数字还是被放大了几倍的数字。 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const URL_ = process.argv[2] || 'http://127.0.0.1:4321/';
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const CASES = [
  ['默认 headless', ['--no-sandbox', '--hide-scrollbars']],
  ['要求启用 GPU', ['--no-sandbox', '--hide-scrollbars', '--enable-gpu', '--use-angle=d3d11',
    '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']],
];

for (const [name, args] of CASES) {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await p.goto(URL_, { waitUntil: 'networkidle0', timeout: 30000 });
  await sleep(3000);
  const renderer = await p.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '（拿不到）';
  });
  const st = await p.evaluate(() => window.__shards());
  // 帧耗时序列，看波动
  const costs = await p.evaluate(() => new Promise(res => {
    const out = [];
    const id = setInterval(() => {
      const s = window.__shards();
      out.push(s.cost);
      if (out.length >= 25) { clearInterval(id); res(out); }
    }, 60);
  }));
  console.log(`\n${name}`);
  console.log('  GL renderer :', renderer);
  console.log('  状态        :', JSON.stringify(st));
  console.log('  帧耗时序列  :', costs.join(' '));
  await b.close();
}
