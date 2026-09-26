/**
 * 证明 build.mjs 里的乱码检查真的会拦住被重新编码过的源文件
 * （检查必须能被证明会失败，否则等于没有）
 *
 * 背景：用 PowerShell 改中文源文件时，内容会被按 GBK 解码后再存成 UTF-8，
 * 整份文件静默变乱码 —— 不报错、构建照过、页面照显示，只是中文全烂了。
 * 这个脚本把那种损坏注入回去，确认构建确实会停下来。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const FILE = 'index.html';
const orig = readFileSync(FILE, 'utf8');

/* 和 build.mjs 里保持一致的指纹。
   两份写重复了是故意的：如果哪天有人把 build 里那条正则改松，
   这里的样本照样会去撞，撞不动就说明守卫失效了 —— 复制一份反而成了探针。 */
const MOJIBAKE = /[\u9225\u951b\u9286\u93b4\u9229]/;

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
console.log(`正常源文件：退出码 ${good.code}  ${good.code === 0 ? '✓ 通过' : '✗ 不该失败'}`);

/* 2) 注入真实的乱码。
      不是随手塞个怪字，而是把整份文件真的按 UTF-8 → GBK 走一遍：
      复现出编辑器/PowerShell 实际会产出的那些字节，
      而不是我以为"看起来像乱码"的一串字。
      自己手打的"乱码"很可能根本不是真乱码，
      于是"拦住了"这个结论也是假的。 */
const corrupted = new TextDecoder('gbk').decode(Buffer.from(orig, 'utf8'));
const sig = corrupted.match(MOJIBAKE);
console.log(`  注入样本：整份文件按 GBK 重解码 → 命中指纹「${sig ? sig[0] : '（无）'}」`);

if (!sig) {
  /* 样本本身不构成指纹，那这次自检什么都证明不了。
     这种情况下"构建失败"可能是因为别的原因，不能算数，直接判自检无效。 */
  console.log('  ✗ 注入样本里没有指纹字符，这次自检不成立（换一个样本再说）');
  process.exit(1);
}

writeFileSync(FILE, corrupted, 'utf8');
const bad = runBuild();
writeFileSync(FILE, orig, 'utf8');

const caught = bad.code !== 0 && /乱码/.test(bad.out);
console.log(`注入乱码后：退出码 ${bad.code}  ${caught ? '✓ 被拦住了' : '✗ 没拦住'}`);
const line = (bad.out.match(/第 (\d+) 行出现乱码/)) || [];
if (line[1]) console.log(`  并指出了位置：第 ${line[1]} 行`);
const where = (bad.out.match(/✗ (\S+) 第/) || [])[1];
if (where) console.log(`  并指出了文件：${where}`);

// 3) 还原后应当恢复通过
const again = runBuild();
console.log(`还原后：退出码 ${again.code}  ${again.code === 0 ? '✓ 恢复' : '✗ 仍然失败'}`);

// 4) 确认还原是真的还原了，不是"构建碰巧过了"
const restored = readFileSync(FILE, 'utf8') === orig;
console.log(`文件内容逐字节还原：${restored ? '✓' : '✗ 源文件被改坏了！'}`);

process.exit(caught && good.code === 0 && again.code === 0 && restored ? 0 : 1);
