import { readFileSync } from 'node:fs';
const f = process.argv[2];
const raw = readFileSync(f, 'utf8');
const start = raw.indexOf('{');
const json = JSON.parse(raw.slice(start, raw.lastIndexOf('}') + 1));
const src = json.files.find(x => x.path.endsWith('.jsx')).content;

const grab = (label, re) => {
  const m = src.match(re);
  console.log(`${label}: ${m ? m[0].replace(/\s+/g, ' ').slice(0, 200) : '（没找到）'}`);
};

console.log('源码长度:', src.length, '字符\n');
grab('默认 shard', /shard:\s*\[[^\]]*\]/);
grab('默认 accent', /accent:\s*\[[^\]]*\]/);
grab('默认 highlight', /highlight:\s*\[[^\]]*\]/);
grab('默认 background', /background:\s*\[[^\]]*\]/);
grab('默认 interaction', /interaction:\s*'[a-z]+'/);
grab('默认 placement', /placement:\s*'[a-z]+'/);
grab('默认 material', /material:\s*'[a-z]+'/);
grab('默认 effect', /effect:\s*'[a-z]+'/);
grab('默认 flow', /flow:\s*'[a-z]+'/);
grab('默认 detail', /detail:\s*'[a-z]+'/);
grab('默认 quality', /quality:\s*'[a-z]+'/);
grab('默认 speed', /speed:\s*[\d.]+/);
grab('默认 spread', /spread:\s*[\d.]+/);
grab('默认 depth', /depth:\s*[\d.]+/);
grab('默认 turbulence', /turbulence:\s*[\d.]+/);
grab('默认 bloom', /bloom:\s*[\d.]+/);
grab('默认 grain', /grain:\s*[\d.]+/);
grab('默认 scale', /scale:\s*[\d.]+/);
grab('默认 shardSize', /shardSize:\s*[\d.]+/);
grab('hex 解析函数', /hexToRgb|function hex|const hex/i);
// 所有形如 #xxxxxx 的字面量
const hexes = [...new Set((src.match(/#[0-9a-fA-F]{6}/g) || []))];
console.log('\n源码里出现的十六进制颜色:', hexes.join(' '));
