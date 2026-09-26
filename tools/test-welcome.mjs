/**
 * test-welcome.mjs — 欢迎页 → 主页 的开场流程
 *
 * 守着几件容易出错的事：
 *   1. 欢迎页必须铺满视口、是主题色，且文字真的显示出来
 *   2. 首屏必须还在折叠线以下（不然"下滑揭幕"就没意义了）
 *   3. 下滑之后主页要完整露出来，导航要出现
 *   4. 滚回顶部还能再看到欢迎页（它是 fixed 的，不该被移除）
 *
 * 用法: node tools/test-welcome.mjs [url]
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
let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`);
  ok ? pass++ : fail++;
};

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--hide-scrollbars', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 40000 });
await sleep(3200);          // 等预加载遮罩 + 欢迎页文字进场

/* ═══════════ 阶段一：刚加载完，应该停在欢迎页 ═══════════ */
console.log('\n════ 阶段一：加载完成（欢迎页）════');

const w = await page.evaluate(() => {
  const el = document.querySelector('#welcome');
  const hero = document.querySelector('.hero');
  const r = el?.getBoundingClientRect();
  const hr = hero?.getBoundingClientRect();
  const cs = el ? getComputedStyle(el) : null;
  const title = document.querySelector('.welcome__title');
  return {
    exists: !!el,
    // 铺满视口
    box: r ? `${r.width.toFixed(0)}x${r.height.toFixed(0)}` : '无',
    coversViewport: r ? (r.width >= innerWidth - 1 && r.height >= innerHeight - 1) : false,
    position: cs?.position,
    bg: cs?.backgroundColor,
    bodyClass: document.body.className,
    // 首屏是否还在折叠线以下
    heroTop: hr ? Math.round(hr.top) : -1,
    heroBelowFold: hr ? hr.top >= innerHeight - 2 : false,
    titleText: title?.textContent.replace(/\s+/g, '') || '',
    navHidden: getComputedStyle(document.querySelector('.nav')).opacity,
  };
});

console.log(`  欢迎页: ${w.box}  position=${w.position}  bg=${w.bg}`);
console.log(`  文字: 「${w.titleText}」`);
console.log(`  首屏 top=${w.heroTop} (视口高 900)  导航 opacity=${w.navHidden}`);
await page.screenshot({ path: 'tools/shots/welcome-1.png' });

check(w.exists, '欢迎页存在');
check(w.coversViewport, '铺满整个视口', w.box);
check(w.position === 'fixed', 'fixed 定位（滚动时留在原地）');
check(/210,\s*255,\s*0/.test(w.bg), '背景是主题色霓虹绿', w.bg);
check(w.titleText.includes('欢迎来到') && w.titleText.includes('我的个人网站'), '欢迎文案完整');
check(w.heroBelowFold, '首屏还在折叠线以下', `top=${w.heroTop}`);
check(w.bodyClass.includes('at-welcome'), '处于 at-welcome 状态');
check(w.navHidden === '0', '欢迎页期间导航已收起', `opacity=${w.navHidden}`);

// 文字不能是透明的（遮罩揭示动画没跑完的话会是透明的）
const titleOpacity = await page.evaluate(() =>
  getComputedStyle(document.querySelector('.welcome__line > span')).opacity);
check(titleOpacity === '1', '标题文字已完全显现', `opacity=${titleOpacity}`);

/* ═══════════ 中文字体一致性 ═══════════
   直接问浏览器「你这块文字实际用的是哪个字体」，
   而不是靠肉眼看字形 —— 这是最硬的证据。
   背景：中文字体没自托管时，Windows 用微软雅黑、iPhone 用苹方、
   安卓用思源黑体，同一个镂空描边效果在各平台对不上。 */
const client = await page.createCDPSession();
await client.send('DOM.enable');
await client.send('CSS.enable');
const { root } = await client.send('DOM.getDocument');

async function usedFonts(selector) {
  const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  if (!nodeId) return [];
  const { fonts } = await client.send('CSS.getPlatformFontsForNode', { nodeId });
  return fonts || [];
}

console.log('\n════ 中文字体 ════');
const fontChecks = [
  ['开场页大字（镂空那行）', '.welcome__line--outline > span'],
  ['开场页大字（实心那行）', '.welcome__line > span'],
  ['开场页四周小字', '.welcome__roles'],
];
let allNoto = true;
for (const [label, sel] of fontChecks) {
  const fonts = await usedFonts(sel);
  const names = fonts.map(f => `${f.familyName}(${f.glyphCount}${f.isCustomFont ? ',自定义' : ',系统'})`).join(' + ');
  const ok = fonts.some(f => f.familyName.includes('Noto Sans SC') && f.isCustomFont);
  if (!ok) allNoto = false;
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${names || '（取不到）'}`);
}
check(allNoto, '中文全部走自托管字体（各平台渲染一致）');

// 字体确实被下载了，且没有 404。
// 注意：document.fonts.check() 只判断「字体加载了没」，
// **不检查字形是否存在** —— 拿生僻字试探它照样返回 true。
// 所以「子集是否覆盖了页面用到的所有汉字」由 check-font-coverage.mjs
// 用纯 Node 比对字符表来把关，不在这里做。
const fontLoaded = await page.evaluate(() =>
  document.fonts.check('900 100px "Noto Sans SC"', '欢迎来到我的个人网站'));
check(fontLoaded, 'Noto Sans SC 子集已加载');

const fontRes = await page.evaluate(() =>
  performance.getEntriesByType('resource')
    .filter(r => r.name.includes('noto-sans-sc'))
    .map(r => ({ name: r.name.split('/').pop(), size: Math.round(r.transferSize / 1024) })));
console.log(`  字体请求: ${fontRes.map(f => `${f.name} ${f.size}KB`).join(', ') || '（无）'}`);
check(fontRes.length > 0 && fontRes[0].size > 0, '字体文件网络请求正常');

/* ═══════════ 镂空描边 ═══════════
   镂空字用「描边 + 一层同字填充」实现，两个地方都极易出错：
     · 填充层丢了 → 内部笔画交叉线全露出来（思源黑体是重叠笔画拼合的）
     · 描边颜色丢了 → 描边整个消失，页面看着还挺正常，肉眼很难发现
   第二点真发生过：-webkit-text-stroke 是简写属性，只给宽度的话
   颜色取 currentColor，而 color 是 transparent，描边就没了。
   所以这里既查计算样式，也数渲染出来的深色像素。 */
console.log('\n════ 镂空描边 ════');
const stroke = await page.evaluate(() => {
  const line = document.querySelector('.welcome__line--outline > span');
  if (!line) return null;
  /* 拆字之后，描边和填充从"整行"下沉到了"每个字"上（见 main.js 第 11 节）。
     所以这里要问的是【现在到底是谁在画字】，而不是写死某一个选择器 ——
     写死的话，结构一变这条断言就会对着一个已经不画字的元素报"描边没了"，
     让人去修一个根本没坏的东西。 */
  const el = line.classList.contains('is-split')
    ? line.querySelector('.welcome__ch') : line;
  const cs = getComputedStyle(el);
  const after = getComputedStyle(el, '::after');
  // 取景仍然按【整行】算：下面的数像素要覆盖整行，不能只量一个字
  const r = line.getBoundingClientRect();
  return {
    paintedBy: line.classList.contains('is-split') ? '每个字' : '整行',
    split: line.classList.contains('is-split'),
    charCount: line.querySelectorAll('.welcome__ch').length,
    lineText: line.textContent,
    width: cs.webkitTextStrokeWidth,
    color: cs.webkitTextStrokeColor,
    fillColor: cs.color,
    afterContent: after.content,
    afterColor: after.color,
    box: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
  };
});

console.log(`  描边由「${stroke.paintedBy}」绘制: ${stroke.width} ${stroke.color}`);
console.log(`  填充层 ::after: content=${stroke.afterContent} color=${stroke.afterColor}`);
check(stroke.width && stroke.width !== '0px', '描边宽度已设置', stroke.width);
check(stroke.color && !/rgba?\([^)]*,\s*0\)/.test(stroke.color), '描边颜色不是透明', stroke.color);
check(stroke.fillColor && /rgba?\([^)]*,\s*0\)/.test(stroke.fillColor), '底层文字填透明（只留描边）');
check(stroke.afterContent !== 'none', '填充层存在', stroke.afterContent);
// 拆字不能把字弄丢、也不能留个还在画整行填充的 ::after（会和逐字填充叠成双份）
check(stroke.lineText === '我的个人网站', '拆字后这一行的文字完整',
  `「${stroke.lineText}」${stroke.split ? `（${stroke.charCount} 个字）` : ''}`);
if (stroke.split) {
  // 期望值从文本本身推出来，不写死数字 ——
  // 写死的话，哪天改了文案这条断言就会去报一个跟 bug 无关的错
  const want = [...stroke.lineText].length;
  check(stroke.charCount === want, `这一行拆成了 ${want} 个字（一个字都不多不少）`,
    `${stroke.charCount} 个`);
}

// 数像素：镂空区域内必须有深色描边，且不能多到糊成一片
const shotBuf = await page.screenshot();
const crop = {
  left: Math.max(0, stroke.box.x), top: Math.max(0, stroke.box.y),
  width: Math.min(stroke.box.w, 1440 - stroke.box.x),
  height: Math.min(stroke.box.h, 900 - stroke.box.y),
};
const { data, info } = await sharp(shotBuf).extract(crop).raw().toBuffer({ resolveWithObject: true });
let ink = 0, total = info.width * info.height;
for (let i = 0; i < data.length; i += info.channels) {
  if (data[i] < 110 && data[i + 1] < 110 && data[i + 2] < 110) ink++;
}
const inkPct = ink / total * 100;
console.log(`  镂空区域墨量: ${inkPct.toFixed(2)}%（只有描边 → 个位数；填充层丢了会更高）`);
check(inkPct > 0.5, '描边确实渲染出来了（不是隐形）', `${inkPct.toFixed(2)}%`);
check(inkPct < 25, '没有糊成实心（填充层正常工作）', `${inkPct.toFixed(2)}%`);

/* ═══════════ 标题逐字弹起 + 纯色区流体 ═══════════
   两个效果都只在欢迎页可见时有意义，所以必须在"阶段二下滑"之前测。

   这里能验的是"动没动、动得对不对"，验不了"好不好看" ——
   好不好看靠 tools/probe-welcomefx.mjs 出图看。
   但"是不是 Q 弹"必须在这里验：单调放大和真弹簧在截图上长得一模一样。
   ═══════════════════════════════════════════════ */
console.log('\n════ 标题逐字弹起 + 流体 ════');

const fxReady = await page.evaluate(() => typeof window.__welcomeFx === 'function');
check(fxReady, '逐字/流体已初始化（手机和"减少动效"下不该初始化）');

if (fxReady) {
  const chars = await page.evaluate(() => [...document.querySelectorAll('.welcome__ch')]
    .map(el => {
      const r = el.getBoundingClientRect();
      return { ch: el.textContent, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }));
  check(chars.length === 10, '标题拆成了 10 个字（欢迎来到 4 + 我的个人网站 6）',
    `${chars.length} 个`);

  // 挑第 4 个字「到」，它左右都有邻居，才测得出"只有附近的动"
  const target = chars[3];

  /* 逐帧量第 idx 个字的 scale，同时把其余字的也记下来。
     目标坐标【每次都重新读】—— 用最早那份快照的话，
     中间滚过一次再滚回来，只要布局差了哪怕一点点，
     鼠标就没落在那个字上，量出来的是"字几乎没动"，
     然后你会去怀疑弹簧参数。（这里确实先怀疑错了方向。） */
  const sampleChar = async (idx, steps) => {
    await page.mouse.move(20, 840);
    await sleep(700);
    const at = await page.evaluate(i => {
      const el = document.querySelectorAll('.welcome__ch')[i];
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, ch: el.textContent };
    }, idx);
    await page.evaluate(() => {
      window.__cs = [];
      const t0 = performance.now();
      const tick = () => {
        const all = [...document.querySelectorAll('.welcome__ch')].map(el => {
          const m = el.style.transform.match(/scale\(([\d.]+)/);
          return m ? +m[1] : 1;
        });
        window.__cs.push([+(performance.now() - t0).toFixed(1), all]);
        if (performance.now() - t0 < 1100) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.mouse.move(at.x, at.y, { steps });
    await sleep(1150);
    const cs = await page.evaluate(() => window.__cs);
    const fx = await page.evaluate(() => window.__welcomeFx());
    return { cs, at, fx, dist: Math.round(Math.hypot(at.x - chars[idx].x, at.y - chars[idx].y)) };
  };

  const first = await sampleChar(3, 10);
  const cs = first.cs;
  console.log(`  鼠标落在「${first.at.ch}」(${Math.round(first.at.x)}, ${Math.round(first.at.y)})，` +
    `与最初快照相差 ${first.dist}px`);
  const series = cs[0][1].map((_, i) => cs.map(s => s[1][i]));
  const peak = series.map(s => Math.max(...s));
  const final = series.map(s => s[s.length - 1]);
  const peakAt = series.map((s, i) => cs.find(r => r[1][i] === peak[i])[0]);
  const over = peak.map((p, i) => p - final[i]);

  console.log('  逐字 scale:');
  chars.forEach((c, i) => {
    console.log(`    ${c.ch}  终值 ${final[i].toFixed(4)}  峰值 ${peak[i].toFixed(4)}  ` +
      `过冲 ${over[i].toFixed(4)}  @${Math.round(peakAt[i])}ms`);
  });

  // 被指着那个字：放大到 1.16 附近，而且必须是【冲过头再退回来】
  check(final[3] > 1.12, `鼠标指着「${chars[3].ch}」时它确实变大了`, `scale=${final[3].toFixed(4)}`);
  check(over[3] > 0.005, '放大是 Q 弹的（峰值 > 终值，欠阻尼）',
    `峰值 ${peak[3].toFixed(4)} > 终值 ${final[3].toFixed(4)}`);

  // 逐个：离鼠标越远越小，最远的基本不动
  const far = chars.map((c, i) => Math.hypot(c.x - target.x, c.y - target.y));
  const order = chars.map((_, i) => i).filter(i => i !== 3).sort((a, b) => far[a] - far[b]);
  const near = order[0], farIdx = order[order.length - 1];
  console.log(`  最近的邻居「${chars[near].ch}」${final[near].toFixed(4)}（距 ${far[near].toFixed(0)}px）` +
    `  最远的「${chars[farIdx].ch}」${final[farIdx].toFixed(4)}（距 ${far[farIdx].toFixed(0)}px）`);
  check(final[near] > 1.005 && final[near] < final[3], '紧挨着的字也跟着变大，但比被指着的那个小（逐个扩散）',
    `${final[near].toFixed(4)} < ${final[3].toFixed(4)}`);
  check(Math.abs(final[farIdx] - 1) < 0.01, '最远的字基本没动（影响是有范围的，不是整行一起涨）',
    `${final[farIdx].toFixed(4)}`);

  // 移开之后要收回去
  await page.mouse.move(20, 840);
  await sleep(1200);
  const after = await page.evaluate(() => window.__welcomeFx().chars);
  check(after.every(v => Math.abs(v - 1) < 0.01), '鼠标移开后所有字缩回原大小',
    after.map(v => v.toFixed(3)).join(','));

  /* --- 流体 --- */
  await page.mouse.move(200, 300, { steps: 8 });
  await sleep(120);
  await page.mouse.move(1150, 620, { steps: 28 });
  await sleep(200);
  const fl = await page.evaluate(() => {
    const layer = document.querySelector('#fluid');
    return {
      live: layer.classList.contains('is-live'),
      opacity: getComputedStyle(layer).opacity,
      blobs: [...layer.querySelectorAll('i')].map(el => {
        const tf = el.style.transform;
        const t = tf.match(/translate3d\(([-\d.]+)px,\s*([-\d.]+)px/);
        const sc = tf.match(/scale\(([-\d.]+),\s*([-\d.]+)\)/);
        return { x: t ? +t[1] : null, y: t ? +t[2] : null,
          sx: sc ? +sc[1] : null, sy: sc ? +sc[2] : null };
      }),
    };
  });
  console.log(`  流体: live=${fl.live} opacity=${fl.opacity}`);
  for (const [i, b] of fl.blobs.entries()) {
    console.log(`    色斑 ${i}: (${b.x?.toFixed(0)}, ${b.y?.toFixed(0)})  形变 ${b.sx}×${b.sy}`);
  }

  check(fl.blobs.length === 4, '流体层有四团色斑', `${fl.blobs.length} 团`);
  check(fl.live && fl.opacity === '1', '鼠标一动流体层就出现了', `opacity=${fl.opacity}`);
  const xs = fl.blobs.map(b => b.x);
  const spread = Math.max(...xs) - Math.min(...xs);
  check(spread > 40, '四团色斑拉开了尾迹（不是叠成一团）', `展开 ${spread.toFixed(0)}px`);
  const near2 = fl.blobs.filter(b => Math.hypot(b.x - 1150, b.y - 620) < 320).length;
  check(near2 === fl.blobs.length, '四团都跟在鼠标附近', `${near2}/${fl.blobs.length} 团在 320px 内`);
  const stretched = fl.blobs.filter(b => b.sx > 1.01 && b.sy < 0.99).length;
  check(stretched > 0, '色斑沿运动方向被拉长、垂直方向压扁（液滴的形状）',
    `${stretched} 团有拉伸，最大 ${Math.max(...fl.blobs.map(b => b.sx)).toFixed(3)}`);
  check(fl.blobs.every(b => b.sy < 1), '每一团都是"拉长"而不是"变圆"');
  // 四团大小不一，否则叠出来是一个规规矩矩的圆，像影子不像液体。
  // 比的是 sx（各团的尺寸），不是 sx/sy —— 后者是"拉伸程度"，
  // 四团的阻尼一样，拉伸程度当然也差不多，比它什么也说明不了。
  const sizes = fl.blobs.map(b => b.sx);
  check(Math.max(...sizes) / Math.min(...sizes) > 1.3, '四团大小明显不同（叠出来才有内部结构）',
    `尺寸 ${sizes.map(v => v.toFixed(2)).join(' / ')}`);

  /* --- 循环必须自己停：这是性能承诺，不是观感问题 --- */
  await sleep(4200);
  const stopped = await page.evaluate(() => window.__welcomeFx());
  check(!stopped.running, '鼠标停住几秒后 rAF 循环自己停了（不留空转）',
    `running=${stopped.running} activity=${stopped.activity} ` +
    `残余距离=${stopped.residual.join('/')} 速度=${stopped.speed.join('/')}`);

  /* --- 滚过一屏之后要整体复位 --- */
  await page.evaluate(() => window.scrollTo(0, innerHeight * 2));
  await sleep(700);
  const afterScroll = await page.evaluate(() => window.__welcomeFx());
  check(!afterScroll.running && afterScroll.chars.every(v => v === 1),
    '滚过欢迎页后循环停掉、字也复位了（不会留着放大态飘在那儿）',
    `running=${afterScroll.running}`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(900);

  /* --- 自检：把弹簧调成过阻尼，过冲必须消失 ---
     光说"我看它是弹的"不算数，对照组必须真的造出来。

     阻尼值的选取有个坑：这个积分是半隐式欧拉，c·dt ≥ 1 时速度会每帧翻号。
     dt 上限锁在 1/30，所以 c 必须小于 30 —— 但光满足这一条还不够：
     第一版自检填了 c=80，字根本没动；改成 c=48 仍然不动。
     按 Jury 判据算，c=48 配 dt=1/30 时特征值已经是一正一负（-0.8 附近），
     每帧翻号地抖，采样窗里就看不出"放大"这回事。
     所以对照组要挑得离稳定边界远一点：k=100 / c=20（ζ=1.0 临界阻尼，
     两个特征值都是正实数，不会有任何振荡），c·dt 最大 0.67。
     这个坑的教训是：自检自己也会坏，而且坏起来是"通过"的样子 ——
     幸好这里额外加了一条"对照组本身得有效"的断言，才没被蒙过去。 */
  await page.evaluate(() => window.__welcomeFx.damp(100, 20));
  const cs2 = (await sampleChar(3, 10)).cs;
  const cs2fx = (await page.evaluate(() => window.__welcomeFx()));
  /* 取第 3 号【字】的整条时间序列。
     写成 cs2[0][1].map((_, i) => cs2.map(s => s[1][i])[3]) 是错的 ——
     那个 [3] 取的是"第 4 个采样点"，不是"第 4 个字"；
     结果量到的其实是 10 个字各自在第 4 帧的瞬时值，
     max 是别人、末项是「站」的静止值 1.0000。表现就是一条平线，
     然后你会去怀疑弹簧参数（这里确实先怀疑错了两轮）。
     内部状态里明明写着 字[3]=1.1598，是"对照组本身得有效"那条断言
     把这个提取错误兜住的。 */
  const s2 = cs2.map(s => s[1][3]);
  const peak2 = Math.max(...s2);
  const final2 = s2[s2.length - 1];
  console.log(`  自检（过阻尼 ζ=1.2）: 终值 ${final2.toFixed(4)} 峰值 ${peak2.toFixed(4)} ` +
    `过冲 ${(peak2 - final2).toFixed(4)}`);
  console.log(`    内部状态: inside=${cs2fx.inside} running=${cs2fx.running} ` +
    `activity=${cs2fx.activity} radius=${cs2fx.radius} 字=${cs2fx.chars.join(',')}`);
  check(final2 > 1.12, '  过阻尼下字照样会放大（对照组本身是有效的）',
    `scale=${final2.toFixed(4)}`);
  check(peak2 - final2 <= 0.005, '过阻尼后过冲消失（证明"Q弹"这条断言真的抓得住）',
    `过冲从 ${over[3].toFixed(4)} 降到 ${(peak2 - final2).toFixed(4)}`);

  // 还原弹簧，并确认过冲回来了 —— 免得自检把后面的测量全污染了
  await page.evaluate(() => window.__welcomeFx.damp(400, 18));
  const cs3 = (await sampleChar(3, 10)).cs;
  const s3 = cs3.map(s => s[1][3]);
  const over3 = Math.max(...s3) - s3[s3.length - 1];
  check(over3 > 0.005, '还原弹簧后过冲立刻回来（自检没有污染后续测量）',
    `过冲 ${over3.toFixed(4)}`);

  // 收尾：把鼠标移开、滚回顶部，别影响后面的阶段
  await page.mouse.move(20, 840);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(900);
}

/* ═══════════ 阶段二：下滑揭幕 ═══════════ */
console.log('\n════ 阶段二：下滑进入主页 ════');

// 先在半途抓一帧，验证"主页滑上来盖住欢迎页"的幕布效果
await page.evaluate(() => window.scrollTo(0, Math.round(innerHeight * 0.5)));
await sleep(300);
await page.screenshot({ path: 'tools/shots/welcome-2-transition.png' });
const mid = await page.evaluate(() => {
  const hero = document.querySelector('.hero');
  const w = document.querySelector('#welcome');
  const hr = hero.getBoundingClientRect();
  const wr = w.getBoundingClientRect();
  return {
    scrollY: Math.round(scrollY),
    heroTop: Math.round(hr.top),
    // 欢迎页是 fixed，滚动时应该一直贴在 0
    welcomeTop: Math.round(wr.top),
    welcomeParallax: getComputedStyle(w.querySelector('.welcome__body')).transform,
  };
});
console.log(`  半途: scrollY=${mid.scrollY}  主页 top=${mid.heroTop}  欢迎页 top=${mid.welcomeTop}`);
console.log(`  欢迎页视差: ${mid.welcomeParallax}`);
check(mid.heroTop > 0, '半途时主页正从下方滑入', `top=${mid.heroTop}`);
check(mid.welcomeTop === 0, '欢迎页留在原地（fixed 生效）');
check(mid.welcomeParallax !== 'none', '欢迎页内容有视差位移');

// 再滚到刚好一屏：此时主页应当正好贴齐视口顶部
await page.evaluate(() => window.scrollTo(0, innerHeight));
await sleep(1500);

const h = await page.evaluate(() => {
  const hero = document.querySelector('.hero');
  const hr = hero.getBoundingClientRect();
  const nav = document.querySelector('.nav');
  const portrait = document.querySelector('.hero__portrait');
  const word = document.querySelector('.hero__word--top');
  return {
    scrollY: Math.round(scrollY),
    heroTop: Math.round(hr.top),
    bodyClass: document.body.className,
    navOpacity: getComputedStyle(nav).opacity,
    portraitOpacity: getComputedStyle(portrait).opacity,
    wordOpacity: getComputedStyle(word).opacity,
  };
});

console.log(`  scrollY=${h.scrollY}  首屏 top=${h.heroTop}  导航 opacity=${h.navOpacity}`);
console.log(`  人物 opacity=${h.portraitOpacity}  大字 opacity=${h.wordOpacity}`);
await page.screenshot({ path: 'tools/shots/welcome-3-hero.png' });

check(h.heroTop <= 2, '主页已完全滑到位', `top=${h.heroTop}`);
check(h.bodyClass.includes('is-hero'), '已切到 is-hero 状态');
check(!h.bodyClass.includes('at-welcome'), '已离开 at-welcome 状态');
check(h.navOpacity === '1', '导航已出现');
// 首屏动画必须在滑到位之后才播，不然就是在欢迎页背后空放
check(h.portraitOpacity === '1', '人物已入场', `opacity=${h.portraitOpacity}`);
check(h.wordOpacity === '1', '大字名已入场', `opacity=${h.wordOpacity}`);

/* ═══════════ 阶段三：滚回顶部 ═══════════ */
console.log('\n════ 阶段三：滚回顶部 ════');
await page.evaluate(() => window.scrollTo(0, 0));
await sleep(900);
const back = await page.evaluate(() => {
  const el = document.querySelector('#welcome');
  const r = el.getBoundingClientRect();
  const nav = document.querySelector('.nav');
  return {
    welcomeStillThere: !!el,
    covers: r.top === 0 && r.height >= innerHeight - 1,
    navOpacity: getComputedStyle(nav).opacity,
    bodyClass: document.body.className,
  };
});
await page.screenshot({ path: 'tools/shots/welcome-4-back.png' });
check(back.welcomeStillThere, '欢迎页还在 DOM 里');
check(back.covers, '欢迎页重新铺满视口');
check(back.bodyClass.includes('at-welcome'), '重新进入 at-welcome 状态');
check(back.navOpacity === '0', '导航再次收起', `opacity=${back.navOpacity}`);

/* ═══════════ 阶段四：点欢迎页任意位置也能进入 ═══════════ */
console.log('\n════ 阶段四：点击欢迎页 ════');
await page.mouse.click(720, 500);
await sleep(1600);
const clicked = await page.evaluate(() => Math.round(scrollY));
console.log(`  点击后 scrollY=${clicked}`);
check(clicked > 800, '点击欢迎页能进入主页', `scrollY=${clicked}`);

await browser.close();
check(errs.filter(e => !/favicon/i.test(e)).length === 0, '无 JS 报错',
  [...new Set(errs)].slice(0, 2).join(' | '));

console.log(`\n${'─'.repeat(52)}`);
console.log(fail === 0 ? `✓ 全部通过（${pass} 项）` : `✗ ${fail} 项未通过，${pass} 项通过`);
console.log('截图: tools/shots/welcome-1.png → welcome-4-back.png');
console.log('─'.repeat(52));
process.exit(fail === 0 ? 0 : 1);
