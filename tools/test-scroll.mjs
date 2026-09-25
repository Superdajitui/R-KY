/**
 * test-scroll.mjs — 滚动驱动动效（scrub）的回归检查
 *
 * 这类动效最恶心的失败方式不是"不好看"，而是**内容看不见**：
 * 元素初始 opacity:0，等着 JS 把 --p 写上去才显示，
 * 一旦脚本报错、选择器写错、或者某个分支漏了，页面就会缺一块，
 * 而且本地看一眼首屏根本发现不了。
 *
 * 所以这里的核心断言只有一句：
 *   滚到底之后，每一个 data-scrub 元素都必须是完全不透明的。
 * 其余（进度单调、首屏退场、跑马灯响应）都是围着它加的。
 *
 * 用法: node tools/test-scroll.mjs [url]
 */
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { existsSync } from 'node:fs';

const URL_BASE = process.argv[2] || 'http://127.0.0.1:4321/';
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p));

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`);
  ok ? pass++ : fail++;
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'],
});

// 等预加载遮罩走完（1.25s 动画 + 淡出）
const settleFirst = async (page) => {
  await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(2600);
};

/* ══════════════════ 1. 桌面：主流程 ══════════════════ */
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const problems = [];
page.on('pageerror', e => problems.push('JS 报错 ' + e.message));
page.on('console', m => { if (m.type() === 'error') problems.push('控制台 ' + m.text()); });
await settleFirst(page);

console.log('\n════ 桌面 1440x900 ════');

const info = await page.evaluate(() => ({
  scrubCount: document.querySelectorAll('[data-scrub]').length,
  lineCount: document.querySelectorAll('.ln__in').length,
  lineHeadings: document.querySelectorAll('[data-scrub="lines"]').length,
  scrubOff: document.documentElement.classList.contains('scrub-off'),
  marqueeSpans: document.querySelectorAll('.marquee__track > span').length,
}));

check(!info.scrubOff, '滚动动效初始化成功（没有走降级分支）');
check(info.scrubCount >= 12, '注册了足够多的 scrub 元素', `${info.scrubCount} 个`);
check(info.lineCount >= 5, '大标题已拆成行', `${info.lineCount} 行 / ${info.lineHeadings} 个标题`);
check(info.marqueeSpans >= 8, '跑马灯重复了足够多遍', `${info.marqueeSpans} 遍`);

// 首屏退场的 0 点：在欢迎页时 hero 必须是"没退场"的状态
const atTop = await page.evaluate(() => {
  const hero = document.querySelector('.hero');
  const stage = document.querySelector('.hero__stage');
  return {
    heroP: parseFloat(getComputedStyle(hero).getPropertyValue('--hero-p')) || 0,
    stageOpacity: +getComputedStyle(stage).opacity,
  };
});
check(atTop.heroP <= 0.02, '停在欢迎页时首屏没有退场', `--hero-p=${atTop.heroP}`);
check(atTop.stageOpacity > 0.99, '首屏内容完全可见', `opacity=${atTop.stageOpacity}`);

/* --- 分步滚到底，记录每个元素的 --p ---
   注意要量的目标有两类：
     1. [data-scrub] 元素本身（lines 除外 —— 那个的 --p 写在拆出来的行上，
        标题容器自己根本不带 --p，量它会永远是 0）；
     2. 由 lines 拆出来的每一行 .ln__in。 */
const STEPS = 26;
const trace = [];      // trace[step] = [{k, p}]
const vh = 900;
const maxScroll = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
const readP = () => page.evaluate(() => {
  const els = [
    ...document.querySelectorAll('[data-scrub]:not([data-scrub="lines"])'),
    ...document.querySelectorAll('.ln__in'),
  ];
  return els.map((el, idx) => ({
    k: idx,
    sel: el.dataset.scrub || 'line',
    p: parseFloat(el.style.getPropertyValue('--p') || '0'),
  }));
});

for (let i = 0; i <= STEPS; i++) {
  await page.evaluate(y => window.scrollTo(0, y), Math.round((i / STEPS) * maxScroll));
  await sleep(340);   // 等阻尼追平（时间常数 85ms，四个常数足够）
  trace.push(await readP());
}

// 停在底部再等一会儿，让最后一段阻尼彻底收敛。
// 只等 340ms 的话剩余误差约 1.8%，会卡在"到底算不算到位"的边界上 ——
// 那是测量的时间不够，不是动画没做完。
await sleep(1000);
trace.push(await readP());

/* --- 断言 1：进度单调不减 --- */
let nonMono = 0;
for (let k = 0; k < trace[0].length; k++) {
  let prev = -1;
  for (const row of trace) {
    const p = row[k].p;
    if (p < prev - 0.02) nonMono++;
    prev = Math.max(prev, p);
  }
}
check(nonMono === 0, '四滚动过程中进度只增不减（可往回擦）', `异常 ${nonMono} 处`);

/* --- 断言 2：滚到底全部到位 --- */
const final = trace[trace.length - 1];
const notDone = final.filter(r => r.p < 0.99);
check(notDone.length === 0, '滚到底后所有 scrub 元素进度都到 1',
  notDone.length ? notDone.map(r => `${r.sel}:${r.p.toFixed(2)}`).join(' ') : `${final.length} 个`);

/* --- 断言 3：滚到底没有内容被藏在透明里（最关键的一条）--- */
const vis = await page.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll('[data-scrub]')) {
    const o = +getComputedStyle(el).opacity;
    if (o < 0.99) bad.push(`${el.className || el.tagName}:${o}`);
  }
  const lines = [...document.querySelectorAll('.ln__in')]
    .filter(el => !/matrix\(1, 0, 0, 1, 0, 0\)|none/.test(getComputedStyle(el).transform))
    .map(el => getComputedStyle(el).transform);
  const bars = [...document.querySelectorAll('.skills__list i')]
    .map(el => getComputedStyle(el).transform);
  return { bad, lines, bars };
});
check(vis.bad.length === 0, '滚到底没有任何 scrub 元素停在透明状态',
  vis.bad.length ? vis.bad.slice(0, 5).join(' ') : '全部不透明');
check(vis.lines.length === 0, '标题每一行都推到位了', `${vis.lines.length} 行未到位`);
// scaleX ≈ 1 → matrix(1, 0, 0, 1, 0, 0)
check(vis.bars.every(t => /matrix\(1, 0, 0, 1, 0, 0\)/.test(t)), '技能进度条全部铺满',
  `${vis.bars.filter(t => !/matrix\(1, 0, 0, 1, 0, 0\)/.test(t)).length} 条未满`);

/* --- 断言 4：首屏退场可逆 --- */
await page.evaluate((v) => window.scrollTo(0, v * 2), vh);
await sleep(700);
const gone = await page.evaluate(() => {
  const hero = document.querySelector('.hero');
  const stage = document.querySelector('.hero__stage');
  const top = document.querySelector('.hero__word--top');
  return {
    heroP: parseFloat(getComputedStyle(hero).getPropertyValue('--hero-p')),
    stageOpacity: +getComputedStyle(stage).opacity,
    wordTf: getComputedStyle(top).transform,
  };
});
check(gone.heroP > 0.9, '滚过首屏后首屏已退场', `--hero-p=${gone.heroP.toFixed(2)}`);
check(gone.stageOpacity < 0.2, '首屏内容已淡出', `opacity=${gone.stageOpacity.toFixed(2)}`);
check(!/matrix\(1, 0, 0, 1, 0, 0\)/.test(gone.wordTf), '名字被拉开了', gone.wordTf);

await page.evaluate(() => window.scrollTo(0, 0));
await sleep(900);
const back = await page.evaluate(() => {
  const hero = document.querySelector('.hero');
  return {
    heroP: parseFloat(getComputedStyle(hero).getPropertyValue('--hero-p')),
    stageOpacity: +getComputedStyle(document.querySelector('.hero__stage')).opacity,
  };
});
check(back.heroP < 0.05 && back.stageOpacity > 0.99, '滚回顶部首屏完全复原',
  `--hero-p=${back.heroP.toFixed(3)} opacity=${back.stageOpacity.toFixed(2)}`);

/* --- 断言 5：跑马灯是无缝无限循环 --- */
/*
   用户反馈跑马灯"滚动不连续"，要求"首尾相接循环滚动"。
   无缝有两个条件，缺一个就会看着断掉：
     a. 位移正好等于「一遍」的宽度（图案能对上）；
     b. 任何时刻都盖满视口，即 轨道宽 - 一遍宽 ≥ 视口宽。
   原来 2 遍走 -50%：a 满足、b 不满足 —— 1440px 屏上循环后半程右侧露白 421px。
   所以这里不只查图案，还要**沿着整个循环扫一遍露白**。
*/
console.log('\n════ 跑马灯：首尾相接、全程不露白 ════');
{
  const mq = await page.evaluate(() => {
    const track = document.querySelector('.marquee__track');
    const box = document.querySelector('.marquee');
    const spans = [...track.querySelectorAll('span')];
    const cs = getComputedStyle(track);
    return {
      trackW: track.getBoundingClientRect().width,
      boxW: box.getBoundingClientRect().width,
      spanW: spans[0].getBoundingClientRect().width,
      n: spans.length,
      timing: cs.animationTimingFunction,
      dur: parseFloat(cs.animationDuration),
      // 回绕距离 = 关键帧里的百分比 × 轨道宽
      toPct: (cs.animationName, 0),
    };
  });

  const perSpan = info.marqueeSpans;
  check(Math.abs(mq.trackW - mq.spanW * perSpan) < 1,
    '轨道宽 = 一遍 × 遍数（没有多余空隙）',
    `${mq.trackW.toFixed(0)} vs ${(mq.spanW * perSpan).toFixed(0)}px`);
  check(mq.timing === 'linear', '匀速播放', mq.timing);

  // 一轮的位移必须正好等于「一遍」的宽度。
  //
  // 这里从 CSSOM 里读 @keyframes 声明的百分比，再乘轨道宽 —— 确定性算法。
  // 一开始是"把动画 delay 设成 -dur*0.999 再量 transform"，
  // 结果量到 739.9px（期望 1000.1px）：
  // animation-delay 是**相对于已流逝时间**做偏移的，动画早就跑了一会儿，
  // 所以 currentTime = 已流逝 + |delay|，落在哪儿全看运气。
  // 那个数字看起来"差不多"，很容易被当成测量误差放过去 —— 其实方法本身就不成立。
  const decl = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }   // 跨域表跳过
      for (const r of rules) {
        if (r.type === CSSRule.KEYFRAMES_RULE && r.name === 'slide') {
          const to = [...r.cssRules].find(k => k.keyText === '100%' || k.keyText === 'to');
          const m = (to?.style?.transform || '').match(/translateX\(\s*(-?[\d.]+)%\s*\)/);
          if (m) return { pct: Math.abs(parseFloat(m[1])) };
        }
      }
    }
    return null;
  });

  if (!decl) {
    check(false, '能找到 @keyframes slide 的位移声明');
  } else {
    const shift = (decl.pct / 100) * mq.trackW;
    check(Math.abs(shift - mq.spanW) < 2, '一轮位移正好等于一遍的宽度（图案能接上）',
      `声明 ${decl.pct}% × 轨道 ${mq.trackW.toFixed(0)} = ${shift.toFixed(1)}px，一遍 ${mq.spanW.toFixed(1)}px`);
    check(Math.abs(decl.pct - 100 / perSpan) < 0.01, `位移比例 = 1/遍数（1/${perSpan}）`,
      `${decl.pct}% vs ${(100 / perSpan).toFixed(2)}%`);
  }

  // 沿整个循环扫一遍，任何时刻都不能露白
  const worst = await page.evaluate(async () => {
    const track = document.querySelector('.marquee__track');
    const box = document.querySelector('.marquee');
    const dur = parseFloat(getComputedStyle(track).animationDuration);
    track.style.animationPlayState = 'paused';
    let worstGap = 0, worstAt = 0;
    for (let i = 0; i <= 40; i++) {
      const f = i / 40;
      track.style.animationDelay = `${(-f * dur).toFixed(2)}s`;
      void track.offsetWidth;
      const tr = track.getBoundingClientRect();
      const br = box.getBoundingClientRect();
      const gap = Math.max(br.right - tr.right, tr.left - br.left, 0);
      if (gap > worstGap) { worstGap = gap; worstAt = f; }
    }
    track.style.animationPlayState = '';
    track.style.animationDelay = '';
    return { worstGap, worstAt };
  });
  check(worst.worstGap < 2, '整个循环里轨道始终盖满视口（不会露白）',
    worst.worstGap < 2 ? '41 个采样点全部盖满'
      : `最大露白 ${worst.worstGap.toFixed(0)}px @ 循环 ${(worst.worstAt * 100).toFixed(0)}%`);

  // 悬停不能暂停：鼠标不动、页面往下滚时，跑马灯会从光标底下滑过去，
  // 一停一走看着就是抖动（这是电脑端特有的问题）
  const hoverPause = await page.evaluate(() => {
    const track = document.querySelector('.marquee__track');
    return getComputedStyle(track).animationPlayState === 'paused';
  });
  check(!hoverPause, '默认就是播放状态（没有悬停暂停）');

  // 滚动过程中跑马灯的位移不受干扰
  const mqSteady = await page.evaluate(async () => {
    const track = document.querySelector('.marquee__track');
    const samples = [];
    const t0 = performance.now();
    // 一边滚一边采样：跑马灯自己的 transform 应该只由 CSS 动画驱动
    for (let i = 0; i < 40; i++) {
      window.scrollBy(0, 60);
      await new Promise(r => requestAnimationFrame(r));
      const inline = track.style.transform;   // JS 不该往它身上写任何东西
      samples.push(inline);
    }
    return { anyInline: samples.some(s => s && s !== 'none'), ms: performance.now() - t0 };
  });
  check(!mqSteady.anyInline, '滚动时脚本没有插手跑马灯的位移（只由 CSS 匀速驱动）');

  /* 自检：还原成原来的写法（只留 2 遍 + 走 -50%），确认"露白"这条断言真的抓得住。
     只查"轨道宽 = 一遍 × 遍数"是不够的 —— 那个条件在 2 遍时也成立，
     真正缺的是"盖满视口"。这把尺子量的是画面，所以换几遍都能量出来。 */
  const probe = await page.evaluate(async () => {
    const st = document.createElement('style');
    st.id = '__mqProbe';
    // 后写的 @keyframes 同名会覆盖前面的
    st.textContent = '@keyframes slide{to{transform:translateX(-50%)}}';
    document.head.appendChild(st);
    const spans = [...document.querySelectorAll('.marquee__track > span')];
    spans.slice(2).forEach(s => { s.style.display = 'none'; });

    const track = document.querySelector('.marquee__track');
    const box = document.querySelector('.marquee');
    const dur = parseFloat(getComputedStyle(track).animationDuration);
    track.style.animationPlayState = 'paused';
    let worstGap = 0;
    for (let i = 0; i <= 40; i++) {
      track.style.animationDelay = `${(-(i / 40) * dur).toFixed(2)}s`;
      void track.offsetWidth;
      const tr = track.getBoundingClientRect();
      const br = box.getBoundingClientRect();
      worstGap = Math.max(worstGap, Math.max(br.right - tr.right, tr.left - br.left, 0));
    }
    st.remove();
    spans.slice(2).forEach(s => { s.style.display = ''; });
    track.style.animationPlayState = '';
    track.style.animationDelay = '';
    return { worstGap, n: spans.length };
  });
  check(probe.worstGap > 50, '还原成 2 遍写法后检查能抓到露白（证明这条断言有效）',
    `2 遍时最大露白 ${probe.worstGap.toFixed(0)}px`);
}

/* --- 断言 7：热爱区三张照片真的加载出来且比例正确 --- */
/*
   图片坏掉是最容易被忽略的一类失败：布局还在、位置也对，
   只是那块是空的，而本地开着缓存看首屏根本发现不了。
   顺便验一下三张都是 1:1 —— 排版是靠"比例一致 + 左右交错"成立的，
   谁换了一张别的比例，构图就散了。
*/
{
  // 先滚过去把懒加载的图催出来，并【等它们真的加载完】再断言。
  // 原来只 wait 600ms —— 网络稍慢时第三张就会超时，报出"照片没加载出来"
  // 这种假故障（本地快，线上慢，典型的环境差异）。
  await page.evaluate(async () => {
    const box = document.querySelector('#passions');
    box.scrollIntoView({ block: 'start', behavior: 'instant' });
    await new Promise(r => setTimeout(r, 400));
  });
  await page.waitForFunction(
    () => [...document.querySelectorAll('#passions img')].every(i => i.complete && i.naturalWidth > 0),
    { timeout: 20000 }).catch(() => {});

  const figs = await page.evaluate(async () => {
    const box = document.querySelector('#passions');
    return [...box.querySelectorAll('.passion__figure')].map(f => {
      const img = f.querySelector('img');
      const fr = f.getBoundingClientRect();
      const ir = img.getBoundingClientRect();
      return {
        alt: img.alt,
        loaded: img.complete && img.naturalWidth > 0,
        src: (img.currentSrc || img.src).split('/').pop(),
        boxRatio: +(fr.width / fr.height).toFixed(3),
        // 图片铺满画框（object-fit:cover）时，渲染尺寸应当不小于画框
        covers: ir.width >= fr.width - 1 && ir.height >= fr.height - 1,
      };
    });
  });
  const notLoaded = figs.filter(f => !f.loaded);
  check(figs.length === 3, '热爱区有三张照片', `${figs.length} 张`);
  check(notLoaded.length === 0, '三张照片都真的加载出来了',
    notLoaded.length ? notLoaded.map(f => f.src).join(' ') : figs.map(f => f.src).join(' '));
  check(figs.every(f => Math.abs(f.boxRatio - 1) < 0.01), '三张画框都是 1:1（构图靠比例一致）',
    figs.map(f => f.boxRatio).join(' / '));
  check(figs.every(f => f.covers), '图片铺满画框（没有留白或变形）');

  // 左右交错是这次改版的核心：三行必须是 文/图、图/文、文/图。
  // 只靠 order 翻转，很容易被后来的改动悄悄弄成一边倒。
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('.passion')].map(p => {
      const b = p.querySelector('.passion__body').getBoundingClientRect();
      const f = p.querySelector('.passion__figure').getBoundingClientRect();
      return b.left < f.left ? '文' : '图';
    }));
  check(order.join('') === '文图文', '三行左右交错（文/图 → 图/文 → 文/图）',
    order.join(' / '));
  const sideCount = await page.evaluate(() =>
    [...document.querySelectorAll('.passion')].length);
  check(sideCount === 3, '热爱区是三行（上下排开）', `${sideCount} 行`);
}

/* --- 断言 8：停下来之后 raf 循环要停 --- */
await sleep(1400);
const settle = await page.evaluate(() => document.querySelector('.marquee__track').style.transform);
check(!settle || settle === 'none', '滚动结束后脚本没有残留内联位移', settle || 'none');

console.log('\n  控制台问题:', problems.length ? problems.slice(0, 4).join(' | ') : '无');
check(problems.length === 0, '全程无 JS 报错');
await page.close();

/* ══════════════════ 2. 减少动态效果 ══════════════════ */
console.log('\n════ prefers-reduced-motion: reduce ════');
const rp = await browser.newPage();
await rp.setViewport({ width: 1440, height: 900 });
await rp.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await settleFirst(rp);
const rm = await rp.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll('[data-scrub]')) {
    const cs = getComputedStyle(el);
    if (+cs.opacity < 0.99) bad.push(`${el.dataset.scrub}:opacity=${cs.opacity}`);
  }
  const lines = [...document.querySelectorAll('.ln__in')]
    .filter(el => !/matrix\(1, 0, 0, 1, 0, 0\)|none/.test(getComputedStyle(el).transform));
  const bars = [...document.querySelectorAll('.skills__list i')]
    .map(el => getComputedStyle(el).transform)
    .filter(t => !/matrix\(1, 0, 0, 1, 0, 0\)/.test(t));
  return { bad, lines: lines.length, bars: bars.length };
});
check(rm.bad.length === 0, '关闭动效时没有元素被藏在透明里',
  rm.bad.length ? rm.bad.slice(0, 4).join(' ') : '全部可见');
check(rm.lines === 0, '关闭动效时标题不再被裁切', `${rm.lines} 行仍偏移`);
check(rm.bars === 0, '关闭动效时进度条直接显示为满', `${rm.bars} 条仍收起`);
await rp.close();

/* ══════════════════ 3. 禁用 JS ══════════════════ */
console.log('\n════ 禁用 JavaScript ════');
const np = await browser.newPage();
await np.setJavaScriptEnabled(false);
await np.setViewport({ width: 1440, height: 900 });
await np.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
await sleep(700);
const nojs = await np.evaluate(() => {
  const vis = sel => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { opacity: +cs.opacity, transform: cs.transform };
  };
  return {
    title: vis('.sec__title'),
    card: vis('.card'),
    line: vis('.ln__in'),
    bars: [...document.querySelectorAll('.skills__list i')]
      .filter(el => !/matrix\(1, 0, 0, 1, 0, 0\)/.test(getComputedStyle(el).transform)).length,
  };
});
check(nojs.title?.opacity === 1, '无脚本时标题可见', `opacity=${nojs.title?.opacity}`);
check(nojs.card?.opacity === 1, '无脚本时卡片可见', `opacity=${nojs.card?.opacity}`);
check(!nojs.line || nojs.line.transform === 'none', '无脚本时标题行不被裁切',
  nojs.line?.transform);
await np.close();

/* ══════════════════ 4. 手机 ══════════════════ */
console.log('\n════ 手机 390x844 ════');
const mp = await browser.newPage();
await mp.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await settleFirst(mp);
await mp.evaluate(async () => {
  const step = innerHeight * 0.6;
  for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
    window.scrollTo(0, y);
    await new Promise(r => setTimeout(r, 260));
  }
  window.scrollTo(0, document.documentElement.scrollHeight);
});
await sleep(1200);
const mob = await mp.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll('[data-scrub]')) {
    if (+getComputedStyle(el).opacity < 0.99) bad.push(el.dataset.scrub);
  }
  const bars = [...document.querySelectorAll('.skills__list i')]
    .filter(el => !/matrix\(1, 0, 0, 1, 0, 0\)/.test(getComputedStyle(el).transform)).length;
  const lines = [...document.querySelectorAll('.ln__in')]
    .filter(el => !/matrix\(1, 0, 0, 1, 0, 0\)|none/.test(getComputedStyle(el).transform)).length;
  // srcset 有没有真的起作用：2x 手机应当拿到更大的一档，而不是最小那档
  const passionSrc = [...document.querySelectorAll('#passions img')]
    .map(i => (i.currentSrc || i.src).split('/').pop());
  // 手机上顺序：文字在上、图片在下（三行一致）。
  // 偶数行桌面端有 order:-1，窄屏必须显式归零，否则第二行会反过来。
  const mobOrder = [...document.querySelectorAll('.passion')].map(p => {
    const b = p.querySelector('.passion__body').getBoundingClientRect();
    const f = p.querySelector('.passion__figure').getBoundingClientRect();
    return b.top < f.top ? '文上' : '图上';
  });
  return { bad, bars, lines, passionSrc, mobOrder };
});
check(mob.bad.length === 0, '手机上滚到底也没有内容被藏住',
  mob.bad.length ? [...new Set(mob.bad)].join(' ') : '全部可见');
check(mob.passionSrc.every(s => !s.includes('-700.')),
  '2x 手机上照片取用了更大的一档（srcset 生效，没退到最小那档）',
  mob.passionSrc.join(' '));
check(mob.mobOrder.every(o => o === '文上'),
  '手机上三行都是文字在上、图片在下', mob.mobOrder.join(' / '));

// svh 覆盖段必须真的能被解析到。
// 事故复盘：媒体查询提前闭合 + 一个多余的 }，让它之后的所有块失效，
// 于是 --hero-portrait-h 落回 54vh（比 54svh 高），手机上人物变高、挡住 KERRY。
// 这里直接从 CSSOM 里把那条规则捞出来看，而不是靠肉眼看 CSS 文本。
const svh = await mp.evaluate(() => {
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of rules) {
      if (r.constructor.name === 'CSSSupportsRule' && /100svh/.test(r.conditionText || '')) {
        for (const inner of r.cssRules || []) {
          for (const leaf of inner.cssRules || []) {
            const v = leaf.style?.getPropertyValue('--hero-portrait-h');
            if (v) return { found: true, value: v.trim(), supports: CSS.supports('height', '100svh') };
          }
        }
      }
    }
  }
  return { found: false };
});
check(svh.found && /svh$/.test(svh.value),
  'svh 覆盖段可被解析（手机上人物高度用 svh，不是 vh）',
  svh.found ? `--hero-portrait-h: ${svh.value}（浏览器支持 svh: ${svh.supports}）` : '✗ 没找到 @supports (height:100svh) 里的覆盖规则');

// 手机首屏四周的小字不能太小。
// 用户提过两次"字太小"：一次是开场页四周，一次是首屏（实测只有 9.9~11.2px）。
// 手机视口窄、观看距离近，这些字低于 12px 就偏小了，所以定一条下限守着。
const typeScale = await mp.evaluate(() => {
  const px = sel => {
    const el = document.querySelector(sel);
    return el ? +parseFloat(getComputedStyle(el).fontSize).toFixed(2) : 0;
  };
  return {
    eyebrow: px('.hero__eyebrow'),
    badge: px('.hero__badge'),
    scroll: px('.hero__scroll'),
    tagline: px('.hero__tagline'),
  };
});
const tooSmall = Object.entries(typeScale).filter(([, v]) => v < 12);
check(tooSmall.length === 0, '手机首屏四周的文字都不小于 12px',
  tooSmall.length
    ? tooSmall.map(([k, v]) => `${k}=${v}px`).join(' ')
    : Object.entries(typeScale).map(([k, v]) => `${k} ${v}`).join(' / '));
check(mob.bars === 0 && mob.lines === 0, '手机上进度条与标题都到位',
  `条 ${mob.bars} / 行 ${mob.lines}`);
await mp.close();

/* ══════════════════ 5. 自检：这套断言真的抓得住问题吗 ══════════════════ */
console.log('\n════ 自检：断言能否失败 ════');
const sp = await browser.newPage();
await sp.setViewport({ width: 1440, height: 900 });
await settleFirst(sp);
// 人为把某个元素的进度打回 0，模拟"JS 漏写了 --p"
const detected = await sp.evaluate(async () => {
  const el = document.querySelector('[data-scrub="read"]');
  el.style.setProperty('--p', '0');
  await new Promise(r => requestAnimationFrame(r));
  return +getComputedStyle(el).opacity < 0.99;
});
check(detected, '人为让一个元素停在透明状态，检查能抓到（证明断言有效）');
// 人为把降级类加上，确认兜底规则真的能救回来
const rescued = await sp.evaluate(async () => {
  document.documentElement.classList.add('scrub-off');
  await new Promise(r => requestAnimationFrame(r));
  const bad = [...document.querySelectorAll('[data-scrub]')]
    .filter(el => +getComputedStyle(el).opacity < 0.99).length;
  return bad === 0;
});
check(rescued, '加上 .scrub-off 兜底后全部内容立刻恢复可见');
await sp.close();

/* ══════════════════ 5. 上推过程中字必须是完整的 ══════════════════ */
/*
   用户反馈过：向上推的文字在中途只露出上半截，像"半个字"。
   根因是遮罩式揭示 —— 外层 overflow:hidden、内层从下方推上来，
   中途必然把字水平切一刀。汉字横画集中在中部，切一刀特别明显。

   所以这里查两件事：
     a. 结构性：.ln / .welcome__line 不能再是 overflow:hidden（那是刀口）；
     b. 功能性：把动画停在半路截图，量字的墨迹高度，
        必须和动画结束时的墨迹高度基本一致。裁切掉了就会矮一大截。
   —— 只查 (a) 不够：将来有人换个元素来裁，结构检查就漏了。
*/
console.log('\n════ 上推过程中字形完整（不出现半个字）════');

const cp = await browser.newPage();
await cp.setViewport({ width: 1440, height: 900 });
await cp.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
await sleep(2600);

const clipInfo = await cp.evaluate(() => {
  const bad = [];
  const check = (sel) => {
    for (const el of document.querySelectorAll(sel)) {
      const ov = getComputedStyle(el).overflow;
      if (ov !== 'visible') bad.push(`${sel}:overflow=${ov}`);
    }
  };
  check('.ln');
  check('.welcome__line');
  return { bad, ln: document.querySelectorAll('.ln').length };
});
check(clipInfo.bad.length === 0, '承载上推动画的元素没有裁切（overflow 不是 hidden）',
  clipInfo.bad.length ? [...new Set(clipInfo.bad)].join(' ') : `${clipInfo.ln} 个行容器都是 visible`);

// --- 功能性：把动画停在半路，量墨迹高度 ---
//
// 量之前必须把【同一栏里的其它文字】临时藏起来。
// 一开始没藏，窗口上下各留 26px 余量，结果把下面那一行标题的墨迹也框进去了，
// 量出 85px（字号才 54px）—— 数据是错的，但因为"看起来不小"，
// 差点就把"没被裁切"这个结论建立在错误数字上。
const hideOthers = (keepSel) => cp.evaluate((sel) => {
  const keep = document.querySelector(sel);
  for (const el of document.querySelectorAll('.ln__in')) {
    if (el !== keep) el.style.visibility = 'hidden';
  }
  // 左栏的小标签就在标题上方 25px 处，也会落进取样窗口
  for (const el of document.querySelectorAll('.about__left .sec__label, .contact .sec__label')) {
    el.style.visibility = 'hidden';
  }
}, keepSel);

const showAll = () => cp.evaluate(() => {
  for (const el of document.querySelectorAll('.ln__in, .sec__label')) el.style.visibility = '';
});

const inkHeight = async (sel) => {
  const box = await cp.evaluate((s) => {
    const el = document.querySelector(s);
    const r = el.getBoundingClientRect();
    const pad = 30;                       // 已排除邻居，余量可以给足
    return {
      x: Math.round(r.left + scrollX) - 8,
      y: Math.round(r.top + scrollY) - pad,
      width: Math.round(r.width) + 16,
      height: Math.round(r.height) + pad * 2,
      p: parseFloat(getComputedStyle(el).getPropertyValue('--p') || '0'),
    };
  }, sel);
  const buf = await cp.screenshot({
    clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    captureBeyondViewport: true,
  });
  const { data, info } = await sharp(buf).greyscale().raw().toBuffer({ resolveWithObject: true });
  // 阈值放宽到 40：动画中途字是半透明的，阈值太高会把淡的部分漏掉，
  // 反而量出一个偏矮的墨迹，把"没被裁"误判成"被裁了"。
  const TH = 40;
  let top = Infinity, bot = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[y * info.width + x] > TH) { if (y < top) top = y; if (y > bot) bot = y; }
    }
  }
  return { h: bot < 0 ? 0 : bot - top + 1, p: box.p };
};

const heading = '.about__left .sec__title .ln:first-child .ln__in';

// 把这一行滚到进度≈0.5 的位置。阻尼会自己收敛到该位置对应的进度。
// 一开始是直接从页面顶部 scrollBy 的，步长 26px × 40 次根本走不到
// 「关于」那一屏，进度一直是 0 —— 循环条件写得再对也没用。
const scrollToMid = async () => {
  await cp.evaluate((s) => {
    const el = document.querySelector(s);
    window.scrollBy(0, el.getBoundingClientRect().top - innerHeight + 30);
  }, heading);
  await sleep(1300);
  for (let i = 0; i < 40; i++) {
    const cur = await cp.evaluate(s =>
      parseFloat(getComputedStyle(document.querySelector(s)).getPropertyValue('--p') || '0'), heading);
    if (cur >= 0.44) break;
    await cp.evaluate(() => window.scrollBy(0, 30));
    await sleep(240);
  }
  await sleep(1000);
};

await scrollToMid();
await hideOthers(heading);
const mid = await inkHeight(heading);

// 再滚到动画结束，量同一个元素的完整墨迹
await cp.evaluate((s) => {
  const el = document.querySelector(s);
  window.scrollBy(0, el.getBoundingClientRect().top - 220);
}, heading);
await sleep(1300);
const full = await inkHeight(heading);
await showAll();

const ratio = full.h > 0 ? mid.h / full.h : 0;
check(mid.p > 0.3 && mid.p < 0.7, '成功把动画停在半路取样', `--p=${mid.p.toFixed(2)}`);
check(full.h > 20 && full.h < 90, '取样窗口干净（墨迹高度与字号相称）',
  `完整墨迹 ${full.h}px，字号约 54px`);
check(ratio >= 0.9, '动画中途字的墨迹高度与结束时一致（没有被切掉一半）',
  `中途 ${mid.h}px / 结束 ${full.h}px = ${(ratio * 100).toFixed(0)}%`);

/* 自检：把用户反馈的那种"裁切式上推"注入回去，确认这条检查真的抓得住。
   只查 overflow 是不够的 —— 将来若换个元素来裁，结构检查就漏了，
   而这把尺子量的是画面本身，换谁裁都能量出来。

   必须带 !important：源码里那条规则是 `html.js .sec__title .ln__in`，
   特异性比探针的 `.sec__title .ln__in` 高，不加 !important 探针根本压不住它 ——
   第一次就是这么写的，结果只模拟出了"轻微裁切"（89%），
   离真实故障差得远，自检通过得毫无意义。 */
await cp.evaluate(() => {
  const s = document.createElement('style');
  s.id = '__clipProbe';
  s.textContent =
    '.sec__title .ln{overflow:hidden !important}'
    + '.sec__title .ln__in{transform:translateY(calc((1 - var(--p,0)) * 112%)) !important}';
  document.head.appendChild(s);
});
await scrollToMid();
await hideOthers(heading);
const clipped = await inkHeight(heading);
await showAll();
await cp.evaluate(() => document.getElementById('__clipProbe')?.remove());

const clippedRatio = full.h > 0 ? clipped.h / full.h : 1;
check(clippedRatio < 0.9, '注入裁切式做法后检查能抓到（证明这条断言有效）',
  `裁切后 ${clipped.h}px / 完整 ${full.h}px = ${(clippedRatio * 100).toFixed(0)}%`);
await cp.close();

/* ══════════════════ 6b. 行动号召可见时必须已经显示完 ══════════════════ */
/*
   联系区是页面最后一块，后面的滚动余量最少，所以它的显示进度天然最晚。
   实测过：邮箱按钮已经出现在视口里了，标题第二行还停在 85% 透明度 ——
   CTA 自己半透明，等于拆自己的台。用户当时的要求正是"放大、显眼一些"。

   修法是给它单独的区间（data-scrub-to），让它早点显示完。
   这条检查盯的就是"按钮可见时，标题必须已经完全显示"。
*/
console.log('\n════ 行动号召（联系区）可见时已完全显示 ════');
{
  const cta = await browser.newPage();
  await cta.setViewport({ width: 1440, height: 900 });
  await cta.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
  // 必须等字体换入再滚动：中文字体是后加载的，换入后标题行高会变，
  // 滚动位置就要重算。不等的话偶尔会量到 0.99 —— 那是布局还没稳，
  // 不是动画没做完（线上复跑一次就过了，典型的 flaky）。
  await cta.evaluate(() => document.fonts.ready);
  await sleep(600);

  // 滚到"邮箱按钮刚露出来"的位置
  await cta.evaluate(() => {
    const btn = document.querySelector('.contact__row');
    window.scrollTo(0, btn.getBoundingClientRect().top + scrollY - innerHeight + 120);
  });
  await sleep(1500);

  const state = await cta.evaluate(() => {
    const btn = document.querySelector('.contact__row').getBoundingClientRect();
    const vh = innerHeight;
    return {
      btnVisible: btn.top < innerHeight && btn.bottom > 0,
      vh,
      btnTop: Math.round(btn.top),
      scrollY: Math.round(scrollY),
      maxScroll: Math.round(document.documentElement.scrollHeight - vh),
      docH: document.documentElement.scrollHeight,
      fontsReady: document.fonts.status,
      lines: [...document.querySelectorAll('.contact__big .ln__in')].map(el => {
        let top = 0;
        for (let n = el; n; n = n.offsetParent) top += n.offsetTop;
        return {
          text: el.textContent.trim(),
          viewTop: Math.round(top - scrollY),
          p: el.style.getPropertyValue('--p'),
          op: +getComputedStyle(el).opacity,
        };
      }),
    };
  });

  check(state.btnVisible, '邮箱按钮此时确实在视口里');
  // 阈值 0.95 而不是 0.99：这条检查要守的是「CTA 不能是灰的、要看得清」，
  // 而 0.99 与 1.00 的差别肉眼不可见，却被引擎的浮点/取整和
  // measure() 时机差异反复顶到线下（线上稳定复现 0.9898，本地 1.0000），
  // 变成一条长期飘红的假警报。真实故障长什么样是有记录的：
  // 修之前分别是 0.85 和 0.44 —— 0.95 一样抓得住。
  // 下面把实测值一并打出来，将来真出现缓慢劣化也看得见趋势。
  const faded = state.lines.filter(l => l.op < 0.95);
  check(faded.length === 0, '按钮可见时，联系区标题已经完全显示（不是半透明）',
    faded.length
      // 失败时把几何一起打出来，否则只知道数字，没法判断是布局漂了还是动画没跑完
      ? faded.map(f => `${f.text}:${f.op.toFixed(2)}`).join(' ')
        + ` ［按钮top=${state.btnTop} 视口=${state.vh} 文档高=${state.docH} 最大滚动=${state.maxScroll}`
        + ` 行顶=${state.lines.map(l => l.viewTop).join('/')} p=${state.lines.map(l => l.p).join('/')}`
        + ` 字体=${state.fontsReady}］`
      : `opacity ${state.lines.map(l => l.op.toFixed(3)).join(' / ')}`);
  await cta.close();
}

/* ══════════════════ 6c. 并排元素必须同步上滑 ══════════════════ */
/*
   用户反馈作品区"四个板块左右上滑速度不一致，有高度差"。
   根因是给同一排的卡片加了不同的 data-scrub-delay（0 / 0.05 / 0.1 / 0.15）——
   它们 docTop 完全相同，进度却永久差 0.071，屏幕上就是恒定的 3.2px 高度差，
   看着像排版坏了，而不像设计过的错落。

   错落应该按【排】错开（下一排本来就在更下面，几何上天然更晚），
   不能按【左右】错开。这条检查盯的就是这个：
   同一高度、左右并排的 scrub 元素，进度必须一致。
*/
console.log('\n════ 并排元素同步上滑（不出现左右高度差）════');
{
  const sp = await browser.newPage();
  await sp.setViewport({ width: 1440, height: 900 });
  await sp.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(2600);

  // 同一高度（docTop 相差 <4px）且左右位置不同的，算作"并排"
  const sampleRows = () => sp.evaluate(() => {
    const items = [...document.querySelectorAll('[data-scrub]')].map(el => {
      let top = 0;
      for (let n = el; n; n = n.offsetParent) top += n.offsetTop;
      const r = el.getBoundingClientRect();
      return {
        top: Math.round(top),
        left: Math.round(r.left),
        p: parseFloat(el.style.getPropertyValue('--p') || '0'),
      };
    });
    const groups = new Map();
    for (const it of items) {
      const k = Math.round(it.top / 4) * 4;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    }
    const out = [];
    for (const [k, g] of groups) {
      if (g.length < 2) continue;
      const lefts = new Set(g.map(x => x.left));
      if (lefts.size < 2) continue;              // 不是并排（是上下堆叠）
      const ps = g.map(x => x.p);
      out.push({ top: k, spread: Math.max(...ps) - Math.min(...ps), n: g.length });
    }
    return out;
  });

  const cardsTop = await sp.evaluate(() => {
    const el = document.querySelector('.cards');
    let y = 0; for (let n = el; n; n = n.offsetParent) y += n.offsetTop; return y;
  });

  let worst = 0, worstAt = '';
  for (const frac of [0.3, 0.45, 0.6, 0.75]) {
    await sp.evaluate(v => window.scrollTo(0, Math.round(v)), cardsTop - 900 * frac);
    await sleep(1200);
    for (const row of await sampleRows()) {
      if (row.spread > worst) { worst = row.spread; worstAt = `top=${row.top} (${row.n} 个并排)`; }
    }
  }
  check(worst < 0.01, '同一排的并排元素进度完全一致（没有左右高度差）',
    worst < 0.01 ? '4 个滚动位置全部一致' : `最大进度差 ${worst.toFixed(3)} @ ${worstAt}`);

  // 自检：人为把其中一张卡片的进度改掉，确认断言抓得住
  const caught = await sp.evaluate(() => {
    const cards = [...document.querySelectorAll('.card')];
    const before = cards.map(c => parseFloat(c.style.getPropertyValue('--p') || '0'));
    cards[1].style.setProperty('--p', String(Math.max(0, before[0] - 0.07)));
    const items = cards.map(el => {
      let top = 0;
      for (let n = el; n; n = n.offsetParent) top += n.offsetTop;
      return { top: Math.round(top / 4) * 4, p: parseFloat(el.style.getPropertyValue('--p') || '0') };
    });
    const row = items.filter(i => i.top === items[0].top).map(i => i.p);
    const spread = Math.max(...row) - Math.min(...row);
    cards.forEach((c, i) => c.style.setProperty('--p', String(before[i])));
    return spread;
  });
  check(caught > 0.01, '人为制造 0.07 的进度差后检查能抓到（证明这条断言有效）',
    `制造出的进度差 ${caught.toFixed(3)}`);
  await sp.close();
}

/* ══════════════════ 6d. 手机端规则不许漏到桌面 ══════════════════ */
/*
   这条来自一次真实事故：在媒体查询里多写了一个 }，
   @media (max-width:820px) 提前闭合，后面四条手机规则漏到桌面 ——
   技能列表、档案列表、页脚排版在电脑上全变了；
   而那个多余的 } 还让它之后的所有块失效，包括 @supports (height:100svh)
   里覆盖 --hero-portrait-h 的那段（手机人物因此变高，把背后的 KERRY 挡住）。

   CSS 写错不报错。所以这里直接断言"桌面上拿到的必须是桌面那一档的值"。
*/
console.log('\n════ 桌面不吃手机端规则 ════');
{
  const dp = await browser.newPage();
  await dp.setViewport({ width: 1440, height: 900 });
  await dp.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(1600);
  const d = await dp.evaluate(() => {
    const g = (sel, prop) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).getPropertyValue(prop).trim() : '(无)';
    };
    return {
      footDir: g('.hero__foot', 'flex-direction'),
      skillCols: g('.skills__list li', 'grid-template-columns').split(' ').length,
      factDir: g('.about__facts li', 'flex-direction'),
      footJustify: g('.foot__wrap', 'justify-content'),
      grainBlend: g('.grain', 'mix-blend-mode'),
      haloFilter: g('.hero__halo', 'filter'),
    };
  });
  check(d.footDir === 'row', '首屏底部仍是横向排布', d.footDir);
  check(d.skillCols >= 2, '技能列表在桌面上仍是两列', `${d.skillCols} 列`);
  check(d.factDir === 'row', '档案列表在桌面上仍是横向', d.factDir);
  check(d.footJustify === 'space-between', '页脚在桌面上仍是两端对齐', d.footJustify);
  check(d.grainBlend === 'overlay', '颗粒层在桌面上仍用混合模式', d.grainBlend);
  check(/blur/.test(d.haloFilter), '光晕在桌面上仍保留模糊', d.haloFilter);
  await dp.close();
}

/* ══════════════════ 7. 标题行不许折行 ══════════════════ */
/*
   一行 = 一个行容器。如果某个宽度下这行字太长而折成两行，
   行结构就和设计不符，动画区间也跟着翻倍。

   分两档，理由不同：
     ≥430px：必须单行。这个宽度以上排版是设计过的，折行就是出了 bug。
     <430px：窄手机上中文长标题本来就会自然折行，属于正常排版，
             所以只报告、不判失败 —— 不能为了让检查变绿去把手机字号调小，
             用户明确说过希望字大一点。

   文案一改长就必须跑这条（真实案例：改「关于」大标题时，
   9 个字的写法在 1100px 和 1001px 下折行了，1440px 却是好的 ——
   只看一个宽度根本发现不了。现在这句定稿是 7 个字 + 7 个字）。
*/
console.log('\n════ 标题行不折行（多宽度）════');
const STRICT = [1440, 1280, 1100, 1001, 900, 768, 520, 430];
const SOFT = [390, 360];
const wrapBad = [];
const wrapSoft = [];
const welcomeFill = [];

for (const [tier, widths] of [['strict', STRICT], ['soft', SOFT]]) {
  for (const w of widths) {
    const p = await browser.newPage();
    await p.setViewport({ width: w, height: 900 });
    await p.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
    await sleep(1800);
    const rows = await p.evaluate(() =>
      [...document.querySelectorAll('.ln__in')].map(el => {
        const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
        return {
          text: (el.textContent || '').trim(),
          lines: +(el.offsetHeight / lh).toFixed(2),
        };
      }));
    const bad = rows.filter(r => r.lines > 1.35);

    // 开场页那两行大字也要盯着。
    // 字号系数从 12vw 提到 14.2vw 之后，最宽那行占到可用宽的 93% ——
    // 视觉冲击是够了，但离折行只剩 7% 余量，必须有人看着。
    // 这里用 Range 量真正的文字：块级 span 的盒子宽度永远等于父宽，量了没用。
    const welcome = await p.evaluate(() =>
      [...document.querySelectorAll('.welcome__line')].map(el => {
        const span = el.querySelector('span');
        const range = document.createRange();
        range.selectNodeContents(span);
        const rects = [...range.getClientRects()].filter(r => r.width > 1);
        const avail = document.querySelector('.welcome__title').getBoundingClientRect().width;
        const widest = rects.length ? Math.max(...rects.map(r => r.width)) : 0;
        return {
          text: (span.textContent || '').trim(),
          lines: rects.length,
          fill: +(widest / avail).toFixed(3),
        };
      }));

    const badW = welcome.filter(r => r.lines > 1);
    if (badW.length) {
      const msg = `${w}px: ${badW.map(b => `「${b.text}」${b.lines}行`).join(' ')}`;
      (tier === 'strict' ? wrapBad : wrapSoft).push(msg);
    }
    // 顺便报告占比：超过 100% 一定会折，接近 100% 就是危险区
    const tightest = welcome.reduce((m, r) => Math.max(m, r.fill), 0);
    if (tier === 'strict') {
      welcomeFill.push(`${w}px ${(tightest * 100).toFixed(0)}%`);
    }
    if (bad.length) {
      const msg = `${w}px: ${bad.map(b => `「${b.text}」${b.lines}行`).join(' ')}`;
      (tier === 'strict' ? wrapBad : wrapSoft).push(msg);
    }
    await p.close();
  }
}

check(wrapBad.length === 0, '桌面/平板宽度下大标题都不折行',
  wrapBad.length ? wrapBad.join(' | ') : `${STRICT.length} 个宽度全部单行`);
console.log(`  · 开场页最宽那行占可用宽: ${welcomeFill.join(' / ')}（越接近 100% 越危险）`);
if (wrapSoft.length) {
  console.log(`  · 窄手机（正常折行，不算失败）: ${wrapSoft.join(' | ')}`);
}

await browser.close();

console.log(`\n${'─'.repeat(52)}`);
console.log(fail === 0
  ? `✓ 全部通过（${pass} 项）—— 滚动动效正常，且不会藏住内容`
  : `✗ ${fail} 项未通过，${pass} 项通过`);
console.log(`${'─'.repeat(52)}\n`);
process.exit(fail === 0 ? 0 : 1);
