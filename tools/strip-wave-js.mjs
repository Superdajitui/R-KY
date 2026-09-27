/* 只删掉 main.js 里"水面（波纹）"那一大段 —— 它被箔片背景替掉了，留着是死代码。
   其余几处零散的改动用手工编辑做（能看见上下文，工具还会校验唯一性）。
   这里用两个【注释行】当锚点，不靠行号算术。 */
import { readFileSync, writeFileSync } from 'node:fs';

const P = 'assets/js/main.js';
const lines = readFileSync(P, 'utf8').split('\n');

const startMark = lines.findIndex(l => /══════════ 水面/.test(l));
const endMark = lines.findIndex(l => /══════════ 标题逐字/.test(l));
if (startMark < 0 || endMark < 0 || endMark <= startMark) {
  throw new Error(`锚点不对：水面=${startMark} 标题逐字=${endMark}`);
}
// 往前吃掉水面段前面的空行，往后停在"标题逐字"那行之前
let a = startMark;
let b = endMark - 1;
while (b > a && lines[b].trim() === '') b--;

const removed = b - a + 1;
lines.splice(a, b - a + 1);
writeFileSync(P, lines.join('\n'), 'utf8');
console.log(`删掉水面段：第 ${a + 1} ~ ${b + 1} 行（${removed} 行）`);
