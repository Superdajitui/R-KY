/* 把欢迎页的"水面"样式整段换成"箔片"样式。
   按行号范围替换，不靠手抄一大段 old_string。 */
import { readFileSync, writeFileSync } from 'node:fs';

const P = 'assets/css/style.css';
const src = readFileSync(P, 'utf8');
const lines = src.split('\n');

const findLine = re => {
  const i = lines.findIndex(l => re.test(l));
  if (i < 0) throw new Error('找不到锚点: ' + re);
  return i;
};

// 从"欢迎页：水面"那段注释的开头，到 .welcome__top 之前（中间全是要换掉的水面样式）
const start = findLine(/欢迎页：水面/);
const topIdx = findLine(/^\.welcome__top\{/);
// 把 .welcome__top 前面那些空行留给新块和它之间的间隔
let deepEnd = topIdx - 1;
while (deepEnd > start && lines[deepEnd].trim() === '') deepEnd--;
if (deepEnd <= start) throw new Error('锚点顺序不对：水面块是空的？');

const block = `/* ---------- 欢迎页背景：风中的折叠箔片 ----------
   照着 reactbits 的 Aero Shards 做的（用户指定 shardColor=#aeff32、
   accentColor=#ccff7f）。tools/peek-aero.mjs 是当时把它源码抓下来的脚本。

   原版是 WebGPU 组件：vgpu 依赖、WGSL 着色器、三千多个实例，
   外加泛光/颗粒/色散三档后处理。这个站是零依赖的静态站 ——
   搬一整套 WebGPU 管线进来不现实，而且 WebGPU 至今没有广泛支持，
   搬进来的结果是相当一部分访客只看到一片空白。
   所以用 Canvas 2D 复刻它的【观感】，画法在 main.js 第 12 节。

   画布这一层只管铺满和层级，箔片全在 JS 里画。
   放在网格线【下面】（z-index:0），压在上面才不会把网格糊掉。 */
.welcome__shards{
  position:absolute;inset:0;z-index:0;
  width:100%;height:100%;display:block;pointer-events:none;
  /* 第一帧画出来之前不显示，避免开场先闪一下空画布 */
  opacity:0;transition:opacity .8s var(--ease);
}
.welcome__shards.is-ready{opacity:1}`;

lines.splice(start, deepEnd - start + 1, block);
writeFileSync(P, lines.join('\n') + (src.endsWith('\n') ? '' : '\n'), 'utf8');
console.log(`替换了第 ${start + 1} ~ ${deepEnd + 1} 行（${deepEnd - start + 1} 行 → ${block.split('\n').length} 行）`);
