/**
 * 证明 build.mjs 里的 CSS 括号配平检查真的会拦住坏样式
 * （检查必须能被证明会失败，否则等于没有）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const orig = readFileSync('assets/css/style.css', 'utf8');

function runBuild() {
  try {
    const out = execFileSync('node', ['tools/build.mjs'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

// 1) 正常情况：应当通过
const good = runBuild();
console.log(`正常 CSS：退出码 ${good.code}  ${good.code === 0 ? '✓ 通过' : '✗ 不该失败'}`);

// 2) 故意多写一个 }：应当被拦住
writeFileSync('assets/css/style.css', orig + '\n.broken{color:red}\n}\n', 'utf8');
const bad = runBuild();
writeFileSync('assets/css/style.css', orig, 'utf8');

const caught = bad.code !== 0 && /括号不配平/.test(bad.out);
console.log(`多一个 } ：退出码 ${bad.code}  ${caught ? '✓ 被拦住了' : '✗ 没拦住'}`);
const line = (bad.out.match(/第 (\d+) 行处深度变负/) || [])[1];
if (line) console.log(`  并指出了位置：第 ${line} 行`);

// 3) 还原后应当恢复通过
const again = runBuild();
console.log(`还原后：退出码 ${again.code}  ${again.code === 0 ? '✓ 恢复' : '✗ 仍然失败'}`);

process.exit(caught && good.code === 0 && again.code === 0 ? 0 : 1);
