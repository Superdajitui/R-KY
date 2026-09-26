/* 生成 CSS linear() 弹簧缓动曲线
 *
 * 背景：中文说的"Q弹"，物理上就是【二阶欠阻尼系统的阶跃响应】——
 * 冲过目标值一点，再回弹一下，最后停住。
 *
 * CSS 自带的 cubic-bezier 只能过冲一次，而且过冲之后是单调收敛的，
 * 做不出"回弹"那一下。linear() 允许直接喂时间-数值采样点，
 * 所以这里按解析解采样，把整条弹簧交给浏览器去插值。
 *
 * 用法：node tools/gen-spring.mjs [zeta] [omega] [ms] [采样点]
 *   zeta  阻尼比，越小越弹。0.5 ≈ "Q弹但不轻浮"，0.7 ≈ 克制
 *   omega 无阻尼角频率(rad/s)，越大越快
 *   ms    过渡时长，要 ≥ 稳定时间，否则弹簧会被截断在半路
 */

const zeta = Number(process.argv[2] ?? 0.5);
const omega = Number(process.argv[3] ?? 18);
const ms = Number(process.argv[4] ?? 550);
const N = Number(process.argv[5] ?? 28);

const D = ms / 1000;
const wd = omega * Math.sqrt(1 - zeta * zeta);

/* 欠阻尼阶跃响应：f(0)=0，f(∞)=1，f 可以 >1（过冲）也可以短暂 <1（回弹） */
function spring(t) {
  return 1 - Math.exp(-zeta * omega * t) *
    (Math.cos(wd * t) + (zeta * omega / wd) * Math.sin(wd * t));
}

/* 采样点必须在时间上等距 —— linear() 的输入进度就是等距分配的 */
const stops = [];
for (let i = 0; i <= N; i++) {
  const t = (i / N) * D;
  let v = spring(t);
  if (i === 0) v = 0;            // 起点必须是 0
  if (i === N) v = 1;            // 终点必须是 1，否则停下来的瞬间会跳一下
  stops.push(Number(v.toFixed(4)));
}

const peakT = Math.PI / wd;
const peak = spring(peakT);
const settle = 4 / (zeta * omega);   // 2% 误差带

console.log(`阻尼比 ζ=${zeta}  角频率 ω=${omega} rad/s  时长 ${ms}ms  ${N + 1} 个采样点`);
console.log(`过冲峰值 ${((peak - 1) * 100).toFixed(1)}%  出现在 ${(peakT * 1000).toFixed(0)}ms`);
console.log(`振荡周期 ${((2 * Math.PI / wd) * 1000).toFixed(0)}ms  稳定时间 ${(settle * 1000).toFixed(0)}ms`);
if (ms / 1000 < settle) console.log(`⚠ 时长 ${ms}ms 短于稳定时间，弹簧会被截断，建议 ≥${Math.ceil(settle * 1000)}ms`);

/* 画出来看一眼，比盯着数字靠谱 */
const cols = 62, rows = 15;
const lo = Math.min(...stops, 0), hi = Math.max(...stops, 1);
const grid = Array.from({ length: rows }, () => Array(cols).fill(' '));
for (let c = 0; c < cols; c++) {
  const v = spring((c / (cols - 1)) * D);
  const r = Math.round((hi - v) / (hi - lo) * (rows - 1));
  grid[r][c] = '*';
}
for (let r = 0; r < rows; r++) {
  const v = hi - (r / (rows - 1)) * (hi - lo);
  const mark = Math.abs(v - 1) < (hi - lo) / (rows - 1) / 2 ? '1' : ' ';
  console.log(`${v.toFixed(3)} ${mark}|${grid[r].join('')}`);
}
console.log(`      +${'-'.repeat(cols)}`);
console.log(`       0ms${' '.repeat(cols - 12)}${ms}ms`);

console.log('\n盖进 CSS（前一行是给不支持 linear() 的浏览器的降级）：');
console.log(`  transition-timing-function: cubic-bezier(.2,1.5,.4,1);`);
console.log(`  transition-timing-function: linear(${stops.join(',')});`);
