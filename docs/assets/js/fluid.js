/* ============================================================
   fluid.js — 首屏人物的流体悬停效果（WebGL）
   ------------------------------------------------------------
   原理（两趟渲染 + 一张乒乓缓冲）：
     1. 流场趟：把上一帧的流场做耗散，然后在鼠标位置注入"鼠标速度"。
        于是光标划过会留下一条会自己衰减、平滑扩散的痕迹。
     2. 显示趟：拿流场当位移图去采样人物贴图。R/G/B 三通道用略微不同的
        偏移量采样 —— 这点色散是"液体/玻璃"质感的关键，没了它只像画面在抖。
     3. 扰动剧烈的地方叠一层霓虹绿，呼应整站的双色系统。

   两个编码约定（很容易写错）：
     · 流场用 0.5 表示"零位移"，所以耗散必须写成 (v-0.5)*decay + 0.5，
       直接乘 decay 会让整个画面被持续推向一个方向。
     · 纹理的 v 轴向上、DOM 的 y 轴向下，指针坐标要翻一下。

   兜底策略（很重要）：
     任何一步失败（不支持 WebGL、贴图加载失败、context 丢失），
     都安静地退回静态 <img>，绝不让首屏变成空白。
   ============================================================ */
(() => {
  'use strict';

  const container = document.querySelector('.hero__portrait');
  const img = container?.querySelector('.hero__img');
  if (!container || !img) return;

  // 尊重系统的"减少动态效果"设置：不做效果，保留静态图
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const ZERO = 0.5;   // 流场里代表"零位移"的编码值

  /* ---------------- 可调参数 ----------------
     调这几个值就能控制"液体感"的强弱。
     注意：位移是屏幕比例，STRENGTH 0.2 配位移上限 0.028，
     最大偏移约 0.6% 画面宽度 —— 看得出波动，但图像仍然清晰可辨。
     一开始给到 0.62，结果头盔被涂抹到认不出，像融化了。

     ⚠ 插值进着色器时必须保证是浮点字面量：
     JS 会把 14.0 渲染成 "14"，而 GLSL ES 里 `vec2 * int` 是非法的，
     会直接编译失败（报 wrong operand types）。所以统一用 toFixed。 */
  const f = (v, d = 4) => v.toFixed(d);   // 生成合法的 GLSL 浮点字面量
  const STRENGTH = 0.20;   // 位移强度
  const INJECT   = 14.0;   // 鼠标速度注入倍率
  const RADIUS   = 0.16;   // 光标影响半径（uv）
  const DECAY    = 0.90;   // 每帧保留比例，越小衰减越快
  const MAXVEL   = 0.028;  // 位移上限，防止猛拖把画面撕开

  /* ---------------- 着色器 ---------------- */

  const VERT = `
    attribute vec2 aPos;
    varying vec2 vUv;
    void main() {
      vUv = aPos * 0.5 + 0.5;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }`;

  const FLOW_FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uPrev;
    uniform vec2  uMouse;
    uniform vec2  uDelta;
    uniform float uAspect;
    uniform float uRadius;
    uniform float uDecay;

    void main() {
      // 解码成有符号位移，向 0 耗散，再编码回去
      vec2 vel = (texture2D(uPrev, vUv).xy - ${f(ZERO, 1)}) * uDecay;

      vec2 d = vUv - uMouse;
      d.x *= uAspect;
      float infl = pow(smoothstep(uRadius, 0.0, length(d)), 2.0);

      vel += uDelta * infl * ${f(INJECT, 1)};
      vel = clamp(vel, -${f(MAXVEL)}, ${f(MAXVEL)});   // 封顶，猛拖也不会把画面撕开

      gl_FragColor = vec4(vel + ${f(ZERO, 1)}, 0.0, 1.0);
    }`;

  const SHOW_FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTex;
    uniform sampler2D uFlow;
    uniform float uStrength;
    uniform float uHover;

    void main() {
      vec2 flow = texture2D(uFlow, vUv).xy - ${f(ZERO, 1)};
      vec2 off  = flow * uStrength * uHover;

      // 色散：红蓝通道错开一点点，做出玻璃折射的观感
      vec4 c;
      c.r = texture2D(uTex, clamp(vUv + off * 1.06, 0.0, 1.0)).r;
      c.g = texture2D(uTex, clamp(vUv + off,        0.0, 1.0)).g;
      c.b = texture2D(uTex, clamp(vUv + off * 0.94, 0.0, 1.0)).b;
      c.a = texture2D(uTex, clamp(vUv + off,        0.0, 1.0)).a;

      float m = length(flow) * 9.0;
      c.rgb += vec3(0.82, 1.0, 0.0) * m * 0.16 * uHover;
      c.a    = min(1.0, c.a + m * 0.05 * uHover);

      gl_FragColor = c;
    }`;

  /* ---------------- WebGL 初始化 ---------------- */

  function compile(g, type, src) {
    const sh = g.createShader(type);
    g.shaderSource(sh, src);
    g.compileShader(sh);
    if (!g.getShaderParameter(sh, g.COMPILE_STATUS)) {
      console.warn('[fluid] 着色器编译失败:', g.getShaderInfoLog(sh));
      return null;
    }
    return sh;
  }

  function program(g, vs, fs) {
    const v = compile(g, g.VERTEX_SHADER, vs);
    const f = compile(g, g.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    const p = g.createProgram();
    g.attachShader(p, v);
    g.attachShader(p, f);
    g.linkProgram(p);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) {
      console.warn('[fluid] 程序链接失败:', g.getProgramInfoLog(p));
      return null;
    }
    return p;
  }

  let gl = null;
  let canvas = null;
  try {
    canvas = document.createElement('canvas');
    canvas.className = 'hero__canvas';
    canvas.setAttribute('aria-hidden', 'true');
    gl = canvas.getContext('webgl', {
      alpha: true, premultipliedAlpha: false, antialias: false,
      depth: false, stencil: false,
    }) || canvas.getContext('experimental-webgl');
    if (!gl) throw new Error('无法创建 WebGL 上下文');
  } catch (e) {
    console.warn('[fluid] 跳过流体效果:', e.message);
    return;                                  // 静默退回静态图
  }

  const flowProg = program(gl, VERT, FLOW_FRAG);
  const showProg = program(gl, VERT, SHOW_FRAG);
  if (!flowProg || !showProg) return;

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  function bindQuad(prog) {
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }

  const U = (prog, names) => names.map(n => gl.getUniformLocation(prog, n));
  const [uPrev, uMouse, uDelta, uAspect, uRadius, uDecay] =
    U(flowProg, ['uPrev', 'uMouse', 'uDelta', 'uAspect', 'uRadius', 'uDecay']);
  const [uTex, uFlow, uStrength, uHover] =
    U(showProg, ['uTex', 'uFlow', 'uStrength', 'uHover']);

  /* ---------------- 流场乒乓缓冲 ---------------- */
  // 低分辨率跑模拟：位移场本身是平滑的，256 足够，还省一大截填充率
  const SIM = 256;
  function makeTarget() {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SIM, SIM, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex: t, fb };
  }
  let targetA = makeTarget();
  let targetB = makeTarget();
  for (const t of [targetA, targetB]) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.clearColor(ZERO, ZERO, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  /* ---------------- 人物贴图 ---------------- */
  const tex = gl.createTexture();
  let texReady = false;

  function uploadTexture() {
    if (!img.complete || !img.naturalWidth) return false;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    texReady = true;
    return true;
  }

  /* ---------------- 尺寸 ---------------- */
  let cssW = 0, cssH = 0;
  function resize() {
    const r = container.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssW = r.width; cssH = r.height;
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return true;
  }

  /* ---------------- 交互状态 ---------------- */
  let mouse = [0.5, 0.5];
  let prev = [0.5, 0.5];
  let delta = [0, 0];
  let hover = 0, hoverTarget = 0;
  let energy = 0;
  let running = false;

  function toUv(e) {
    const r = canvas.getBoundingClientRect();
    return [
      (e.clientX - r.left) / r.width,
      1 - (e.clientY - r.top) / r.height,      // GL 的 v 轴朝上
    ];
  }

  container.addEventListener('pointerenter', () => { hoverTarget = 1; wake(); });
  container.addEventListener('pointerleave', () => { hoverTarget = 0; });
  container.addEventListener('pointerdown', () => { hoverTarget = 1; wake(); });
  container.addEventListener('pointerup', () => { hoverTarget = 0; });

  container.addEventListener('pointermove', (e) => {
    const [x, y] = toUv(e);
    delta[0] += x - prev[0];
    delta[1] += y - prev[1];
    mouse[0] = x; mouse[1] = y;
    prev[0] = x; prev[1] = y;
    wake();
  }, { passive: true });

  /* ---------------- 渲染 ---------------- */
  function drawStatic(h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(showProg);
    bindQuad(showProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(uTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, targetA.tex);
    gl.uniform1i(uFlow, 1);
    gl.uniform1f(uStrength, STRENGTH);
    gl.uniform1f(uHover, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function render() {
    if (!texReady) { running = false; return; }
    resize();

    // 离场且流场已衰减干净 → 停循环省电
    energy *= 0.94;
    if (hover < 0.002 && hoverTarget === 0 && energy < 0.002) {
      running = false;
      return;
    }

    hover += (hoverTarget - hover) * 0.08;

    // ── 1. 流场趟 ──
    const dMag = Math.hypot(delta[0], delta[1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetB.fb);
    gl.viewport(0, 0, SIM, SIM);
    gl.useProgram(flowProg);
    bindQuad(flowProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, targetA.tex);
    gl.uniform1i(uPrev, 0);
    gl.uniform2f(uMouse, mouse[0], mouse[1]);
    gl.uniform2f(uDelta, delta[0] * 0.5, delta[1] * 0.5);
    gl.uniform1f(uAspect, cssW / Math.max(1, cssH));
    gl.uniform1f(uRadius, RADIUS);
    gl.uniform1f(uDecay, DECAY);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    [targetA, targetB] = [targetB, targetA];      // 乒乓交换

    // 位移已消费完，清空；顺便估算活跃度决定何时停机
    delta[0] = 0; delta[1] = 0;
    energy = Math.min(1, energy + dMag * 4 + 0.015);

    // ── 2. 显示趟 ──
    drawStatic(hover);

    requestAnimationFrame(render);
  }

  function wake() {
    if (running) return;
    if (!texReady || !resize()) return;
    running = true;
    requestAnimationFrame(render);
  }

  /* ---------------- 启动 ---------------- */
  function start() {
    if (!resize()) { requestAnimationFrame(start); return; }
    container.insertBefore(canvas, container.firstChild);
    hover = 0; hoverTarget = 0; energy = 0;
    drawStatic(0);                    // 静止态：和原图完全一致
    container.classList.add('is-webgl');
    console.log('[fluid] 流体效果已就绪');
  }

  // 只注册一次 load 兜底
  if (uploadTexture()) start();
  else img.addEventListener('load', () => { if (uploadTexture()) start(); }, { once: true });

  // 上下文丢失（切换显卡、驱动重置等）→ 退回静态图
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    running = false;
    container.classList.remove('is-webgl');
    console.warn('[fluid] WebGL 上下文丢失，已退回静态图');
  });

  // 支持 pointer 才启用（老浏览器直接静态图）
  if (!window.PointerEvent) container.classList.remove('is-webgl');
})();
