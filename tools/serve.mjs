/**
 * serve.mjs — 极简静态文件服务器（本地 / 局域网预览）
 *
 * 用法:
 *   node tools/serve.mjs [端口]                      监听所有网卡，手机平板也能访问
 *   node tools/serve.mjs [端口] --local               只监听本机，更私密
 *   node tools/serve.mjs [端口] --root=dist           指定站点根目录
 *   node tools/serve.mjs [端口] --prefix=/R-KY        模拟 GitHub Pages 子路径
 *
 * 默认监听 0.0.0.0：只绑 127.0.0.1 的话，同一局域网里的手机、平板
 * 根本连不上（这是"其他设备打不开"最常见的原因）。
 */
import http from 'node:http';
import { networkInterfaces } from 'node:os';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));

const args = process.argv.slice(2);
const LOCAL_ONLY = args.includes('--local');
const PORT = Number(args.find(a => /^\d+$/.test(a))) || 4321;
const HOST = LOCAL_ONLY ? '127.0.0.1' : '0.0.0.0';

const rootArg = args.find(a => a.startsWith('--root='));
const ROOT = rootArg ? join(PROJECT_ROOT, rootArg.slice(7)) : PROJECT_ROOT;

// 模拟部署到子路径（GitHub Pages 项目站点就是 /仓库名/ 这种形式）
const prefixArg = args.find(a => a.startsWith('--prefix='));
const PREFIX = prefixArg ? '/' + prefixArg.slice(9).replace(/^\/+|\/+$/g, '') : '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

/** 列出所有可作为访问地址的局域网 IPv4 */
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family !== 'IPv4' || ni.internal) continue;
      out.push({ name, address: ni.address });
    }
  }
  return out;
}

const server = http.createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);

    // 剥掉模拟的子路径前缀
    if (PREFIX) {
      if (path === PREFIX) path = '/';
      else if (path.startsWith(PREFIX + '/')) path = path.slice(PREFIX.length);
      else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          .end(`404 Not Found — 该请求不在 ${PREFIX} 前缀下`);
        console.log(`404  ${path}  (前缀不匹配)`);
        return;
      }
    }

    if (path.endsWith('/')) path += 'index.html';

    // 防目录穿越
    const full = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (!full.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }

    const st = await stat(full);
    if (st.isDirectory()) { res.writeHead(302, { Location: path + '/' }).end(); return; }

    const body = await readFile(full);
    res.writeHead(200, {
      'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
      // 方便同一局域网内用手机调试
      'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
    console.log(`200  ${path}`);
  } catch {
    // 与 GitHub Pages 行为保持一致：未知路径返回 404.html 的内容 + 404 状态码。
    // 这样本地子路径测试才能忠实反映线上表现。
    try {
      const custom = await readFile(join(ROOT, '404.html'));
      res.writeHead(404, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': custom.length,
      });
      res.end(custom);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
    }
    console.log(`404  ${req.url}`);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n端口 ${PORT} 已被占用。换一个端口，例如：node tools/serve.mjs 4322\n`);
  } else {
    console.error('\n启动失败:', err.message, '\n');
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const base = PREFIX ? `${PREFIX}/` : '/';
  console.log('');
  console.log('  任恺昱 · 个人网站 预览服务已启动');
  console.log('  ' + '─'.repeat(46));
  console.log(`  站点根目录: ${ROOT === PROJECT_ROOT ? '(项目根)' : ROOT.replace(PROJECT_ROOT, '.')}`);
  if (PREFIX) console.log(`  子路径模拟: ${PREFIX}/   (等同 GitHub Pages 项目站点)`);
  console.log(`  本机:      http://127.0.0.1:${PORT}${base}`);

  if (LOCAL_ONLY) {
    console.log('  模式:      仅本机可访问 (--local)');
  } else {
    const lan = lanAddresses();
    if (lan.length) {
      console.log('  手机/平板: 用同一 Wi-Fi 下的设备打开下面任一地址');
      for (const { name, address } of lan) {
        console.log(`             http://${address}:${PORT}${base}     (${name})`);
      }
      console.log('');
      console.log('  提示: 若手机仍打不开，多半是 Windows 防火墙拦了入站连接，');
      console.log('        以管理员身份运行一次 tools\\放行防火墙.bat 即可。');
    } else {
      console.log('  未检测到局域网地址，其他设备暂时无法访问。');
    }
  }
  console.log('  ' + '─'.repeat(46));
  console.log('');
});
