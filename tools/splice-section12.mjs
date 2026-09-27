/* 一次性：把第 12 节整段换成照原版着色器重写的版本。
   用行号锚定会飘，所以用两头的内容当锚点校验。 */
import fs from 'node:fs';

const MAIN = 'assets/js/main.js';
const SRC = '../_section12.js';

const text = fs.readFileSync(MAIN, 'utf8');
const nl = text.includes('\r\n') ? '\r\n' : '\n';
const lines = text.split(/\r?\n/);

const isMarker = (i, needle) => lines[i] !== undefined && lines[i].includes(needle);

// 找第 12 节的头
let start = -1;
for (let i = 0; i < lines.length; i++) {
  if (isMarker(i, '12. 欢迎页背景') && isMarker(i - 1, '/* ---')) { start = i - 1; break; }
}
if (start < 0) throw new Error('没找到第 12 节的开头');

// 找它后面第一个 "10. 杂项" 的注释块，往回收两行（空行 + 收尾的 }）
let tail = -1;
for (let i = start; i < lines.length; i++) {
  if (isMarker(i, '10. 杂项')) { tail = i - 1; break; }
}
if (tail < 0) throw new Error('没找到第 10 节');

// tail 现在指在 "  /* ---" 那一行上，往回收掉空行
let end = tail - 1;
while (lines[end].trim() === '') end--;

if (lines[end].trim() !== '}') throw new Error(`收尾行不是 }，而是: ${JSON.stringify(lines[end])}`);
if (lines[start].trim() !== '/* ---------------------------------------------------------') {
  throw new Error(`开头行不对: ${JSON.stringify(lines[start])}`);
}

const body = fs.readFileSync(SRC, 'utf8').replace(/\r?\n$/, '').split(/\r?\n/);
const out = [...lines.slice(0, start), ...body, ...lines.slice(end + 1)];

fs.writeFileSync(MAIN, out.join(nl), 'utf8');
console.log(`替换 ${start + 1}..${end + 1} 行（共 ${end - start + 1} 行）→ ${body.length} 行`);
console.log(`文件 ${lines.length} 行 → ${out.length} 行`);
