/**
 * probe-welcomefx.mjs — 欢迎页两个效果的目视检查
 *
 * 逐字弹起和"好不好看"有关，水波纹和"像不像水"有关，断言都只能证明它动了。
 * 这里把几个关键时刻拍下来：静止时的随机波纹 / 鼠标扫过时的尾迹 / 标题被指着的峰值。
 *
 * 用法: node tools/probe-welcomefx.mjs [url]
 */
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { existsSync, mkdirSync } from 'node:fs';

const URL_BASE = process.argv[2] || 'http://127.0.0.1:4321/';
const SHOTS = 'tools/shots';
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
await sleep(3600);

mkdirSync(SHOTS, { recursive: true });
const shot = f => page.screenshot({ path: `${SHOTS}/${f}` });

/* 当前活着的波纹：位置、进度、实际渲染直径、透明度。
   直接从 DOM 和 WAAPI 读，不靠生产代码开洞。 */
const rings = () => page.evaluate(() =>
  [...document.querySelectorAll('#wave i')].map(el => {
    const a = el.getAnimations()[0];
    if (!a) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
      d: Math.round(r.width),
      op: +getComputedStyle(el).opacity,
      p: +(a.effect.getComputedTiming().progress ?? 1).toFixed(3),
      state: a.playState,
    };
  }).filter(Boolean));

console.log('════ 一、鼠标不动：随机波纹应当自己冒出来 ════');
const seen = [];
for (let i = 0; i < 8; i++) {
  await sleep(750);
  const r = await rings();
  const live = r.filter(x => x.state === 'running');
  console.log(`  t=${((i + 1) * 0.75).toFixed(2)}s  活跃 ${live.length} 圈  ` +
    live.map(x => `(${x.x},${x.y}) ⌀${x.d} p=${x.p} op=${x.op}`).join('  '));
  seen.push(...live.map(x => [x.x, x.y]));
}
if (seen.length > 2) {
  const xs = seen.map(p => p[0]), ys = seen.map(p => p[1]);
  console.log(`  共出现 ${seen.length} 圈，横跨 x ${Math.min(...xs)}~${Math.max(...xs)}  ` +
    `y ${Math.min(...ys)}~${Math.max(...ys)}`);
  console.log(`  不同位置数 ${new Set(seen.map(p => p.join(','))).size}/${seen.length}` +
    '（越接近 1 越随机）');
}
await shot('fx-0-idle-ripples.png');

/* ══════════ 显眼程度：把"太不明显"变成一个数 ══════════
   "明不明显"听起来只能靠嘴说，其实是可量的：以波纹的圆心为中心裁一块，
   统计每个像素与霓虹底色的色差。
   峰值差 = 波脊相对底色有多亮；受影响面积占比 = 这个环占了多少画面。
   两个都太小，就是"看不出有东西"。 */
console.log('\n════ 一之补：静态波纹的显眼程度 ════');
{
  const r = (await rings()).filter(x => x.state === 'running')
    .sort((a, b) => b.op - a.op)[0];
  if (!r) {
    console.log('  （这一刻没有活跃的环，跳过）');
  } else {
    const d = Math.max(120, Math.round(r.d * 1.15));
    const box = {
      left: Math.max(0, Math.min(1440 - d, r.x - d / 2)),
      top: Math.max(0, Math.min(900 - d, r.y - d / 2)),
      width: d, height: d,
    };
    const png = await page.screenshot();
    const { data, info } = await sharp(png)
      .extract({ left: box.left * 2, top: box.top * 2, width: box.width * 2, height: box.height * 2 })
      .raw().toBuffer({ resolveWithObject: true });
    // 底色按画面四角的中位数取，不写死 —— 深水层会让底色略微浮动。
    // 只统计"比底色亮"的像素：不排除的话，裁剪框一旦叠到黑色标题上，
    // 量到的峰值其实是那几个字贡献的，和波纹无关。
    const bgLum = .299 * 210 + .587 * 255;
    let mx = 0, n = 0;
    const devs = [];
    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (.299 * r + .587 * g + .114 * b < bgLum) continue;
      const dr = r - 210, dg = g - 255, db = b;
      const v = Math.sqrt(dr * dr + dg * dg + db * db) / 441.7;  // 归一到 0~1
      devs.push(v);
      if (v > mx) mx = v;
      if (v > .06) n++;
    }
    devs.sort((a, b) => a - b);
    const p99 = devs[Math.floor(devs.length * .99)];
    console.log(`  最明显的那个环: (${r.x},${r.y}) ⌀${r.d} op=${r.op.toFixed(2)}`);
    console.log(`    峰值色差 ${(mx * 100).toFixed(1)}%   99 分位 ${(p99 * 100).toFixed(1)}%   ` +
      `受影响面积 ${(n / Math.max(devs.length,1) * 100).toFixed(1)}%`);
    console.log('    （峰值低于 ~12% 基本就是"看不出有东西"）');
  }
}

console.log('\n════ 二、鼠标移动：波纹沿路径散开 ════');await page.mouse.move(180, 700, { steps: 6 });
await sleep(300);
await page.mouse.move(1240, 300, { steps: 30 });   // 斜着扫过
await sleep(140);
const tr = (await rings()).filter(x => x.state === 'running');
console.log(`  扫过之后有 ${tr.length} 圈在跑：`);
for (const r of tr) console.log(`    (${r.x},${r.y}) ⌀${r.d} p=${r.p} op=${r.op}`);
await shot('fx-1-trail.png');

console.log('\n════ 三、波纹是不是在"扩散"（同一圈前后对比）════');
{
  // 只留一圈：把鼠标停住，等其它圈散尽，然后盯着新冒出来的那一圈
  await page.mouse.move(700, 450);
  await sleep(2600);
  const before = (await rings()).filter(x => x.state === 'running');
  if (!before.length) {
    console.log('  （这一刻没有活跃的圈，等下一圈）');
    await sleep(1200);
  }
  const a0 = (await rings()).filter(x => x.state === 'running')[0];
  if (a0) {
    console.log(`  第 1 次: (${a0.x},${a0.y}) ⌀${a0.d} op=${a0.op} p=${a0.p}`);
    await sleep(420);
    const a1 = (await rings()).find(x => Math.abs(x.x - a0.x) < 3 && Math.abs(x.y - a0.y) < 3);
    if (a1) {
      console.log(`  第 2 次: (${a1.x},${a1.y}) ⌀${a1.d} op=${a1.op} p=${a1.p}`);
      console.log(`  → 直径 ${a0.d} → ${a1.d}（${a1.d > a0.d ? '变大 ✓' : '没变大 ✗'}）  ` +
        `透明度 ${a0.op} → ${a1.op}（${a1.op < a0.op ? '变淡 ✓' : '没变淡'}）`);
    } else {
      console.log('  （这一圈已经结束）');
    }
  }
}

console.log('\n════ 四、标题逐字（回归确认）════');
const chars = await page.evaluate(() => [...document.querySelectorAll('.welcome__ch')]
  .map(el => {
    const r = el.getBoundingClientRect();
    return { ch: el.textContent, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }));
console.log(`  拆成 ${chars.length} 个字`);
const c3 = chars[3];
await page.mouse.move(20, 860);
await sleep(700);
await page.mouse.move(c3.x, c3.y, { steps: 10 });
await sleep(200);
const sc = await page.evaluate(() => window.__welcomeFx().chars);
console.log(`  悬停「${c3.ch}」: ${chars.map((c, i) => c.ch + sc[i].toFixed(3)).join(' ')}`);
await shot('fx-2-char-peak.png');

/* 出一张紧贴被悬停那个字的对比图 */
const box = await page.evaluate(() => {
  const el = document.querySelectorAll('.welcome__ch')[3];
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left - 26), y: Math.round(r.top - 26),
    w: Math.round(r.width + 52), h: Math.round(r.height + 52) };
});
await page.mouse.move(20, 860);
await sleep(900);
const beforeShot = await page.screenshot();
await page.mouse.move(c3.x, c3.y, { steps: 10 });
await sleep(230);
const afterShot = await page.screenshot();
const cut = s => sharp(s).extract({ left: box.x * 2, top: box.y * 2, width: box.w * 2, height: box.h * 2 })
  .resize({ width: box.w * 3, kernel: 'nearest' }).png().toBuffer();
const [ia, ib] = [await cut(beforeShot), await cut(afterShot)];
const m = await sharp(ia).metadata();
await sharp({ create: { width: m.width, height: m.height * 2 + 20, channels: 4, background: '#111112' } })
  .composite([{ input: ia, left: 0, top: 0 }, { input: ib, left: 0, top: m.height + 20 }])
  .toFile(`${SHOTS}/fx-compare.png`);

console.log(`\n截图: ${SHOTS}/fx-0-idle-ripples.png  fx-1-trail.png  fx-2-char-peak.png  fx-compare.png`);

/* ══════════ 胶片条：环境动画只能连起来看 ══════════
   单个静止帧判不出"高级不高级"——环境动画的全部意义都在【变化】上。
   这里连拍 6 帧并排：能同时看到涟漪的疏密、扩散的层次、深水层的缓慢起伏。
   再把两层各自遮掉拍一组，用像素差值确认它们【真的在起作用】——
   "少一层有没有区别"不能靠"我觉得有"。 */
console.log('\n════ 五、胶片条 ════');
await page.mouse.move(20, 860);
await page.evaluate(() => window.scrollTo(0, 0));
await sleep(1400);

async function strip(file, n = 6, gap = 950) {
  const tiles = [];
  for (let i = 0; i < n; i++) {
    const buf = await page.screenshot();
    tiles.push(await sharp(buf).resize({ width: 420 }).toBuffer());
    if (i < n - 1) await sleep(gap);
  }
  const m = await sharp(tiles[0]).metadata();
  await sharp({ create: { width: m.width * n, height: m.height, channels: 4, background: '#111112' } })
    .composite(tiles.map((t, i) => ({ input: t, left: i * m.width, top: 0 })))
    .toFile(`${SHOTS}/${file}`);
  return tiles;
}

const diff = async tiles => {
  const raw = await Promise.all(tiles.map(t => sharp(t).greyscale().raw().toBuffer()));
  let sum = 0;
  for (let i = 1; i < raw.length; i++) {
    for (let k = 0; k < raw[i].length; k++) sum += Math.abs(raw[i][k] - raw[i - 1][k]);
  }
  return sum / ((raw.length - 1) * raw[0].length);
};

const both = await strip('fx-3-strip-both.png');
console.log('  fx-3-strip-both.png    （两层都在）');

await page.addStyleTag({ content: '#wave{display:none!important}' });
await sleep(500);
const deepOnly = await strip('fx-4-strip-deep.png');
console.log('  fx-4-strip-deep.png    （只留深水层）');

await page.addStyleTag({ content: '#wave{display:block!important}#waveDeep{display:none!important}' });
await sleep(500);
const ripOnly = await strip('fx-5-strip-rip.png', 6, 950);
console.log('  fx-5-strip-rip.png     （只留表面涟漪）');

console.log('\n  逐帧平均像素变化（灰阶 0~255）:');
console.log(`    两层都在   : ${(await diff(both)).toFixed(3)}`);
console.log(`    只留深水层 : ${(await diff(deepOnly)).toFixed(3)}`);
console.log(`    只留表面层 : ${(await diff(ripOnly)).toFixed(3)}`);
console.log('    深水层本来就该远小于表面层；只要不是 0，它就在做"底"');

/* 滚过一屏之后必须彻底安静下来 */
await page.evaluate(() => window.scrollTo(0, innerHeight * 2));
await sleep(1500);
const after = await page.evaluate(() => ({
  rings: window.__welcomeFx().rings,
  running: window.__welcomeFx().running,
  live: [...document.querySelectorAll('#wave i')].filter(el => +getComputedStyle(el).opacity > .01).length,
}));
console.log(`\n滚过一屏 1.5s 后: 活跃圈=${after.rings} 循环=${after.running} ` +
  `还可见的圈=${after.live}（都应当是 0）`);

await browser.close();
