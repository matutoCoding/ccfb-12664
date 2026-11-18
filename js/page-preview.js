'use strict';
/* 仿真预览页：按真实线径逐针绘制，布料/绷子可换，侧视光泽，走针动画 */
const Preview = {
  /* 生成工程缩略图（工程列表卡片用） */
  makeThumb(project, compute) {
    const cv = document.createElement('canvas');
    cv.width = 220; cv.height = 160;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = project.design.settings.fabric || '#f2ead8';
    ctx.fillRect(0, 0, 220, 160);
    const s = compute.stats;
    if (!s.w || !s.h) return cv.toDataURL('image/png');
    const sc = Math.min(200 / s.w, 140 / s.h);
    const ox = (220 - s.w * sc) / 2 - s.x0 * sc, oy = (160 - s.h * sc) / 2 - s.y0 * sc;
    ctx.lineWidth = Math.max(0.6, 0.4 * sc);
    for (const blk of compute.blocks) {
      ctx.strokeStyle = threadByCode(blk.threadId).hex;
      ctx.beginPath();
      let px = null, py = null;
      for (let i = 0, j = 0; j < blk.flags.length; i += 2, j++) {
        const x = blk.xy[i] * sc + ox, y = blk.xy[i + 1] * sc + oy;
        if (blk.flags[j] === 0 && px !== null) { ctx.moveTo(px, py); ctx.lineTo(x, y); }
        px = x; py = y;
      }
      ctx.stroke();
    }
    return cv.toDataURL('image/png');
  },
};

App.pages.preview = {
  view: { x: 0, y: 0, scale: 4 },
  paths: null,      // 缓存的 Path2D [{path,color}]
  playIdx: 0, playing: false, speed: 300,
  raf: 0,

  settings() { return App.project.design.settings; },

  render(el) {
    const st = this.settings();
    el.innerHTML = `
      <div class="preview-wrap">
        <div class="toolbar">
          <label class="chk">布料
            <select id="selFabric">
              <option value="#f2ead8">米色棉布</option>
              <option value="#ffffff">白布</option>
              <option value="#2b3a55">牛仔蓝</option>
              <option value="#1b1b1e">黑布</option>
              <option value="#c9d8c5">浅绿麻</option>
              <option value="__custom">自定义…</option>
            </select>
            <input type="color" id="inpFabric" value="${st.fabric}" style="width:34px;height:26px;padding:0;border:none">
          </label>
          <label class="chk">绷子
            <select id="selHoop">
              <option value="none">不显示</option>
              <option value="100x100">100×100</option>
              <option value="130x180">130×180</option>
              <option value="200x300">200×300</option>
            </select>
          </label>
          <label class="chk">侧视 <input type="range" id="rngTilt" min="0" max="60" value="${st.tilt}" style="width:90px"> <span id="tiltVal">${st.tilt}°</span></label>
          <label class="chk"><input type="checkbox" id="chkSheen" ${st.sheen ? 'checked' : ''}> 光泽</label>
          <label class="chk"><input type="checkbox" id="chkJumps" ${st.showJumps ? 'checked' : ''}> 显示跳针</label>
          <span class="sep"></span>
          <button class="tbtn" id="btnPlay">▶ 走针</button>
          <label class="chk">速度 <input type="range" id="rngSpeed" min="50" max="2000" value="300" style="width:80px"></label>
          <button class="tbtn" id="btnFit">适应窗口</button>
        </div>
        <div class="canvas-host" id="pvHost"><canvas id="pvCanvas"></canvas>
          <div class="hint">滚轮缩放 · 拖拽平移 · 侧视角度越大丝线光泽越明显</div>
        </div>
      </div>`;
    this.el = el;
    this.canvas = el.querySelector('#pvCanvas');
    this.host = el.querySelector('#pvHost');
    this.ctx = this.canvas.getContext('2d');

    el.querySelector('#selFabric').value = ['#f2ead8', '#ffffff', '#2b3a55', '#1b1b1e', '#c9d8c5'].includes(st.fabric) ? st.fabric : '__custom';
    el.querySelector('#selFabric').onchange = (e) => {
      if (e.target.value !== '__custom') { st.fabric = e.target.value; el.querySelector('#inpFabric').value = st.fabric; App.touch(); this.draw(); }
    };
    el.querySelector('#inpFabric').oninput = (e) => { st.fabric = e.target.value; App.touch(); this.draw(); };
    el.querySelector('#selHoop').value = st.hoop;
    el.querySelector('#selHoop').onchange = (e) => { st.hoop = e.target.value; App.touch(); this.draw(); };
    el.querySelector('#rngTilt').oninput = (e) => { st.tilt = +e.target.value; el.querySelector('#tiltVal').textContent = st.tilt + '°'; App.touch(); this.rebuildPaths(); this.draw(); };
    el.querySelector('#chkSheen').onchange = (e) => { st.sheen = e.target.checked; App.touch(); this.rebuildPaths(); this.draw(); };
    el.querySelector('#chkJumps').onchange = (e) => { st.showJumps = e.target.checked; App.touch(); this.draw(); };
    el.querySelector('#btnFit').onclick = () => this.fitView();
    el.querySelector('#rngSpeed').oninput = (e) => { this.speed = +e.target.value; };
    el.querySelector('#btnPlay').onclick = () => this.togglePlay();

    this.bindView();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.host);
    this.resize();
    this.rebuildPaths();
    this.fitView();
  },

  destroy() {
    cancelAnimationFrame(this.raf);
    if (this.resizeObs) this.resizeObs.disconnect();
  },

  onCompute() { this.rebuildPaths(); this.playIdx = 0; this.draw(); },

  resize() {
    const r = this.host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, r.width * dpr);
    this.canvas.height = Math.max(1, r.height * dpr);
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    this.dpr = dpr;
    this.draw();
  },

  fitView() {
    if (!App.lastCompute) return;
    const s = App.lastCompute.stats;
    const r = this.host.getBoundingClientRect();
    const w = Math.max(s.w, 10), h = Math.max(s.h, 10);
    const pad = 20;
    this.view.scale = Math.min(r.width / (w + pad * 2), r.height / (h + pad * 2));
    this.view.x = s.x0 - pad;
    this.view.y = s.y0 - pad;
    this.draw();
  },

  /* 把针迹按角度分桶构建 Path2D（设计坐标），平移缩放时直接复用 */
  rebuildPaths() {
    this.paths = [];
    if (!App.lastCompute) return;
    const st = this.settings();
    const BINS = 24;
    const lightAng = -Math.PI / 3; // 光源方向
    const tiltF = st.sheen ? (0.35 + st.tilt / 60 * 0.65) : 0;
    for (const blk of App.lastCompute.blocks) {
      const base = threadByCode(blk.threadId).hex;
      const buckets = [];
      for (let b = 0; b < BINS; b++) buckets.push(new Path2D());
      for (let i = 0, j = 0; j < blk.flags.length; i += 2, j++) {
        if (blk.flags[j] !== 0 || j === 0) continue;
        const x0 = blk.xy[i - 2], y0 = blk.xy[i - 1], x1 = blk.xy[i], y1 = blk.xy[i + 1];
        const ang = Math.atan2(y1 - y0, x1 - x0);
        let b = Math.round(((ang % Math.PI) + Math.PI) % Math.PI / Math.PI * BINS) % BINS;
        buckets[b].moveTo(x0, y0);
        buckets[b].lineTo(x1, y1);
      }
      const shaded = [];
      for (let b = 0; b < BINS; b++) {
        const ang = b / BINS * Math.PI;
        const sheen = Math.pow(Math.abs(Math.cos(ang - lightAng)), 2);
        const f = 1 - tiltF * 0.45 + tiltF * 0.75 * sheen;
        shaded.push({ path: buckets[b], color: U.shadeHex(base, f) });
      }
      this.paths.push({ block: blk, buckets: shaded, base });
    }
  },

  draw() {
    if (!this.ctx) return;
    const ctx = this.ctx, dpr = this.dpr || 1;
    const st = this.settings();
    const w = this.canvas.width / dpr, h = this.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = st.fabric;
    ctx.fillRect(0, 0, w, h);

    // 绷子
    if (st.hoop !== 'none') {
      const [hw, hh] = st.hoop.split('x').map(Number);
      const cx = (this.view.x + w / 2 / this.view.scale), cy = (this.view.y + h / 2 / this.view.scale);
      const [sx, sy] = this.toScreen(cx - hw / 2, cy - hh / 2);
      ctx.strokeStyle = 'rgba(120,90,40,0.8)';
      ctx.lineWidth = 8;
      this.roundRect(ctx, sx, sy, hw * this.view.scale, hh * this.view.scale, 14);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(120,90,40,0.35)';
      ctx.lineWidth = 2;
      this.roundRect(ctx, sx + 8, sy + 8, hw * this.view.scale - 16, hh * this.view.scale - 16, 10);
      ctx.stroke();
    }

    if (!App.lastCompute || !this.paths) return;
    // 侧视：绕水平轴倾斜 → 纵向压缩（绕画布中心）
    const tilt = st.tilt * Math.PI / 180;
    const cyMid = this.canvas.height / dpr / 2;
    const sc = this.view.scale;
    const cosT = Math.cos(tilt);
    ctx.setTransform(dpr * sc, 0, 0, dpr * sc * cosT,
      -this.view.x * sc * dpr,
      dpr * (cyMid * (1 - cosT) - this.view.y * sc * cosT));

    ctx.lineWidth = st.threadWidth;
    ctx.lineCap = 'round';

    // 播放进度：全局针序
    let budget = this.playing || this.playIdx > 0 ? this.playIdx : Infinity;
    for (const entry of this.paths) {
      const blk = entry.block;
      if (budget <= 0) break;
      if (budget >= blk.stitches) {
        for (const b of entry.buckets) { ctx.strokeStyle = b.color; ctx.stroke(b.path); }
        budget -= blk.stitches;
      } else {
        // 当前色块只画到 budget 针（播放中不分光泽桶，用本色）
        ctx.strokeStyle = entry.base;
        ctx.beginPath();
        let cnt = 0;
        for (let i = 0, j = 0; j < blk.flags.length && cnt < budget; i += 2, j++) {
          if (blk.flags[j] !== 0 || j === 0) continue;
          ctx.moveTo(blk.xy[i - 2], blk.xy[i - 1]);
          ctx.lineTo(blk.xy[i], blk.xy[i + 1]);
          cnt++;
        }
        ctx.stroke();
        budget = 0;
        break;
      }
    }
    // 跳针与剪线标记
    ctx.lineWidth = Math.max(0.2, 0.15);
    for (const blk of App.lastCompute.blocks) {
      if (st.showJumps) {
        ctx.strokeStyle = 'rgba(90,90,90,0.55)';
        ctx.setLineDash([1.2, 1.2]);
        ctx.beginPath();
        for (let i = 0, j = 0; j < blk.flags.length; i += 2, j++) {
          if (blk.flags[j] === 1 && j > 0) { ctx.moveTo(blk.xy[i - 2], blk.xy[i - 1]); ctx.lineTo(blk.xy[i], blk.xy[i + 1]); }
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = '#d32f2f';
      for (let i = 0, j = 0; j < blk.flags.length; i += 2, j++) {
        if (blk.flags[j] === 2) {
          ctx.beginPath();
          ctx.arc(blk.xy[i], blk.xy[i + 1], 0.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  },

  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },

  toScreen(x, y) { return [(x - this.view.x) * this.view.scale, (y - this.view.y) * this.view.scale]; },

  bindView() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y }; });
    c.addEventListener('mousemove', (e) => {
      if (!drag) return;
      this.view.x = drag.vx - (e.clientX - drag.x) / this.view.scale;
      this.view.y = drag.vy - (e.clientY - drag.y) / this.view.scale;
      this.draw();
    });
    c.addEventListener('mouseup', () => drag = null);
    c.addEventListener('mouseleave', () => drag = null);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const dx = px / this.view.scale + this.view.x, dy = py / this.view.scale + this.view.y;
      const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      this.view.scale = U.clamp(this.view.scale * f, 0.3, 300);
      this.view.x = dx - px / this.view.scale;
      this.view.y = dy - py / this.view.scale;
      this.draw();
    }, { passive: false });
  },

  togglePlay() {
    this.playing = !this.playing;
    const btn = this.el.querySelector('#btnPlay');
    btn.textContent = this.playing ? '⏸ 暂停' : '▶ 走针';
    if (this.playing) {
      if (!App.lastCompute || this.playIdx >= App.lastCompute.stats.stitches) this.playIdx = 0;
      let last = performance.now();
      const step = (now) => {
        if (!this.playing) return;
        const dt = (now - last) / 1000; last = now;
        this.playIdx += this.speed * dt;
        if (App.lastCompute && this.playIdx >= App.lastCompute.stats.stitches) {
          this.playIdx = App.lastCompute.stats.stitches;
          this.playing = false;
          btn.textContent = '▶ 走针';
        }
        this.draw();
        this.raf = requestAnimationFrame(step);
      };
      this.raf = requestAnimationFrame(step);
    }
  },
};
