/* 把 test-welcome.mjs 里的"水波纹"测试段整段换成"箔片背景"的测试段。 */
import { readFileSync, writeFileSync } from 'node:fs';

const P = 'tools/test-welcome.mjs';
const lines = readFileSync(P, 'utf8').split('\n');

const a = lines.findIndex(l => /--- 水波纹 ---/.test(l));
const b = lines.findIndex(l => /--- 循环必须自己停/.test(l));
if (a < 0 || b < 0 || b <= a) throw new Error(`锚点不对：水波纹=${a} 循环=${b}`);

const block = `  /* --- 背景：风中的折叠箔片 ---
     照着 reactbits 的 Aero Shards 做的（Canvas 2D 复刻观感，不是 WebGPU）。
     这里验的是三件事：它在跑、它的颜色是用户指定的那两个、它会自己停。 */
  const shardState = () => page.evaluate(() => {
    const c = document.querySelector('#shards');
    if (!c) return null;
    const api = window.__shards ? window.__shards() : null;
    return {
      ready: c.classList.contains('is-ready'),
      opacity: +getComputedStyle(c).opacity,
      w: c.width, h: c.height,
      api,
    };
  });

  const sh = await shardState();
  check(!!sh && sh.w > 0 && sh.h > 0, '箔片画布铺满了视口',
    sh ? \`\${sh.w}×\${sh.h}\` : '找不到画布');
  check(sh && sh.ready && sh.opacity === 1, '画布已经淡入（不是停在透明的第一帧）',
    sh ? \`ready=\${sh.ready} opacity=\${sh.opacity}\` : '');
  check(sh && sh.api && sh.api.running && sh.api.count > 100,
    '箔片在跑，而且数量够（不是个位数的装饰）',
    sh && sh.api ? \`\${sh.api.count} 片 running=\${sh.api.running}\` : '没有调试钩子');

  /* 颜色：用户指定 shardColor=#aeff32 / accentColor=#ccff7f，
     底色是站里的墨黑。逐像素量出来才对得上 —— 断言里写死十六进制没用，
     真正画上去的是着色之后的颜色。 */
  {
    const buf = await page.screenshot();
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    let lit = 0, total = 0, maxG = 0, sumR = 0, sumB = 0, hueSum = 0, hueN = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      total++;
      if (g > maxG) maxG = g;
      // 只统计"发光的那部分"：绿通道明显高于红，且不是纯灰
      if (g > 90 && g > r + 20) {
        lit++; sumR += r; sumB += b;
        // 色相（度）：aeff32 是 84° 左右，偏黄绿
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        if (d) {
          let h = mx === g ? 60 * ((b - r) / d + 2) : 0;
          hueSum += (h + 360) % 360; hueN++;
        }
      }
    }
    const pct = lit / total * 100;
    const hue = hueN ? hueSum / hueN : 0;
    console.log(\`  箔片: 发光像素 \${pct.toFixed(2)}%  最亮绿 \${maxG}  \` +
      \`平均色相 \${hue.toFixed(0)}°（目标 aeff32 ≈ 84°）\`);
    check(pct > 1 && pct < 30, '箔片画出来了，而且是"碎屑"不是"整片"',
      \`发光像素占 \${pct.toFixed(2)}%\`);
    check(hue > 70 && hue < 100, '颜色落在指定的柠檬绿上（aeff32 / ccff7f 都是这个色相）',
      \`\${hue.toFixed(0)}°\`);
    // 折痕：同一片箔上要有明暗两面，全靠画面里同时存在亮绿和暗绿
    check(maxG > 180, '有迎光的亮面（不是整幅都压暗）', \`最亮绿 \${maxG}\`);
  }

  /* 滚过一屏之后必须停：每帧重绘的 canvas 不停就是白烧电。
     这条原来查的是波纹元素，换成箔片之后选择器匹配不到任何东西，
     于是"0 个在跑"永远成立 —— 空过的检查比没有检查更糟。 */
  await page.evaluate(() => window.scrollTo({ top: innerHeight * 2, behavior: 'instant' }));
  await sleep(700);
  const stoppedShards = await shardState();
  check(stoppedShards && !stoppedShards.api.running,
    '滚过一屏后箔片循环自己停了（不是一直在后台空转）',
    stoppedShards && stoppedShards.api ? \`running=\${stoppedShards.api.running}\` : '');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await sleep(900);

`;

lines.splice(a, b - a, block);
writeFileSync(P, lines.join('\n'), 'utf8');
console.log(`水波纹测试段 → 箔片测试段：第 ${a + 1} ~ ${b} 行（${b - a} 行 → ${block.split('\n').length} 行）`);
