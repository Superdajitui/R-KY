import { readFileSync } from 'node:fs';
const f = process.argv[2];
const s = readFileSync(f, 'utf8');
const cjk = s.match(/[\u4e00-\u9fff]/g) || [];
const repl = s.match(/\uFFFD/g) || [];
// UTF-8 被当成 GBK 再存成 UTF-8 的典型指纹：出现「鈥」「涓」「锛」这类字
const suspicious = s.match(/[\u9239\u6d93\u953b\u951b\u7ee3\u93c1\u93b4]/g) || [];
console.log('文件:', f);
console.log('  汉字数:', cjk.length);
console.log('  替换符 U+FFFD:', repl.length);
console.log('  双重编码嫌疑字:', suspicious.length, suspicious.slice(0, 12).join(''));
for (const probe of ['上到下', '定格', '弹簧', '墨迹', '慢放']) {
  console.log(`  含「${probe}」:`, s.includes(probe));
}
