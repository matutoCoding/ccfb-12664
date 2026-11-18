'use strict';
/* 打版编辑页：轮廓编辑、控制点拖拽、框选、撤销重做、网格吸附、参数面板 */
App.pages.edit = {
  view: { x: 0, y: 0, scale: 4 },   // mm → px
  tool: 'select',
  sel: { shapes: new Set(), },
  undoStack: [], redoStack: [],
  drawing: null,   // 正在绘制的折线 [[x,y]..]
  drag: null,
  mouse: { x: 0, y: 0 },

  design() { return App.project.design; },
  settings() { return App.project.design.settings; },

  render(el) {
    el.innerHTML = `
      <div class="editor-wrap">
        <div class="toolbar" id="toolbar">
          <button class="tbtn" data-tool="select" title="选择/移动 (V)">选择</button>
          <button class="tbtn" data-tool="pan" title="平移画布 (H)">平移</button>
          <span class="sep"></span>
          <button class="tbtn" data-tool="rect" title="拖拽画矩形（榻榻米）">矩形</button>
          <button class="tbtn" data-tool="ellipse" title="拖拽画椭圆（榻榻米）">椭圆</button>
          <button class="tbtn" data-tool="polygon" title="点击加点，回车完成（榻榻米）">多边形</button>
          <button class="tbtn" data-tool="satin" title="点击加骨架点，回车完成（包针）">包针线</button>
          <button class="tbtn" data-tool="running" title="点击加点，回车完成（平针）">平针线</button>
          <span class="sep"></span>
          <button class="tbtn" id="btnUndo" title="Ctrl+Z">撤销</button>
          <button class="tbtn" id="btnRedo" title="Ctrl+Y">重做</button>
          <button class="tbtn" id="btnDel" title="Delete">删除所选</button>
          <span class="sep"></span>
          <label class="chk"><input type="checkbox" id="chkSnap"> 吸附</label>
          <label class="chk">网格 <input type="number" id="inpGrid" min="1" max="50" step="1" style="width:48px"> mm</label>
          <button class="tbtn" id="btnFit">适应窗口</button>
        </div>
        <div class="editor-main">
          <div class="canvas-host" id="canvasHost">
            <canvas id="editCanvas"></canvas>
            <div class="hint">双击边线加点 · 右键删点 · 拖拽空白框选 · 滚轮缩放 · Delete 删图形 · Ctrl+Z/Y 撤销重做</div>
            <div class="coords" id="coords"></div>
          </div>
          <div class="side-panel">
            <div class="panel-sec">
              <div class="panel-title">图形（<span id="shapeCount"></span>）</div>
              <div class="shape-list" id="shapeList"></div>
            </div>
            <div class="panel-sec grow">
              <div class="panel-title">参数</div>
              <div id="paramPanel" class="param-panel"><div class="empty">选中一个图形后编辑参数</div></div>
            </div>
          </div>
        </div>
      </div>`;
    this.canvas = el.querySelector('#editCanvas');
    this.host = el.querySelector('#canvasHost');
    this.ctx = this.canvas.getContext('2d');
    this.el = el;

    // 工具按钮
    el.querySelectorAll('[data-tool]').forEach(b => {
      b.onclick = () => this.setTool(b.dataset.tool);
    });
    el.querySelector('#btnUndo').onclick = () => this.undo();
    el.querySelector('#btnRedo').onclick = () => this.redo();
    el.querySelector('#btnDel').onclick = () => this.deleteSelected();
    el.querySelector('#btnFit').onclick = () => this.fitView();
    const chkSnap = el.querySelector('#chkSnap');
    chkSnap.checked = this.settings().snap;
    chkSnap.onchange = () => { this.settings().snap = chkSnap.checked; App.touch(); };
    const inpGrid = el.querySelector('#inpGrid');
    inpGrid.value = this.settings().grid;
    inpGrid.onchange = () => { this.settings().grid = U.clamp(+inpGrid.value || 5, 1, 50); App.touch(); this.draw(); };

    this.setTool('select');
    this.bindCanvas();
    this.keyHandler = (e) => this.onKey(e);
    window.addEventListener('keydown', this.keyHandler);
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.host);
    this.resize();
    this.fitView();
    this.renderShapeList();
  },

  destroy() {
    window.removeEventListener('keydown', this.keyHandler);
    if (this.resizeObs) this.resizeObs.disconnect();
  },

  /* ---------- 视图 ---------- */
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
    const shapes = this.design().shapes;
    const r = this.host.getBoundingClientRect();
    if (!shapes.length) { this.view = { x: -r.width / 8, y: -r.height / 8, scale: 4 }; this.draw(); return; }
    let all = [];
    for (const s of shapes) all = all.concat(s.points);
    const b = U.boundsOf(all);
    const pad = 15;
    const sx = r.width / (b.w + pad * 2), sy = r.height / (b.h + pad * 2);
    this.view.scale = Math.min(sx, sy, 20);
    this.view.x = b.x0 - pad;
    this.view.y = b.y0 - pad;
    this.draw();
  },
  toScreen(x, y) { return [(x - this.view.x) * this.view.scale, (y - this.view.y) * this.view.scale]; },
  toDesign(px, py) { return [px / this.view.scale + this.view.x, py / this.view.scale + this.view.y]; },
  snap(v) { const g = this.settings().grid; return this.settings().snap ? Math.round(v / g) * g : v; },

  /* ---------- 绘制 ---------- */
  draw() {
    const ctx = this.ctx, dpr = this.dpr || 1;
    const w = this.canvas.width / dpr, h = this.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#faf8f4';
    ctx.fillRect(0, 0, w, h);
    // 网格
    const g = this.settings().grid;
    let step = g;
    while (step * this.view.scale < 8) step *= 5;
    ctx.strokeStyle = '#e8e2d5';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const [dx0, dy0] = this.toDesign(0, 0), [dx1, dy1] = this.toDesign(w, h);
    for (let x = Math.floor(dx0 / step) * step; x <= dx1; x += step) {
      const [sx] = this.toScreen(x, 0);
      ctx.moveTo(sx, 0); ctx.lineTo(sx, h);
    }
    for (let y = Math.floor(dy0 / step) * step; y <= dy1; y += step) {
      const [, sy] = this.toScreen(0, y);
      ctx.moveTo(0, sy); ctx.lineTo(w, sy);
    }
    ctx.stroke();

    // 图形
    for (const s of this.design().shapes) {
      const selected = this.sel.shapes.has(s.id);
      const color = threadByCode(s.color).hex;
      ctx.strokeStyle = selected ? '#ff5722' : color;
      ctx.lineWidth = selected ? 2 : 1.4;
      ctx.setLineDash(s.type === 'raw' ? [4, 3] : []);
      ctx.beginPath();
      s.points.forEach((p, i) => {
        const [sx, sy] = this.toScreen(p[0], p[1]);
        i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
      });
      if (s.closed && s.points.length > 2) ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      // 洞
      for (const hole of (s.holes || [])) {
        ctx.beginPath();
        hole.forEach((p, i) => { const [sx, sy] = this.toScreen(p[0], p[1]); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
        ctx.closePath();
        ctx.strokeStyle = selected ? '#ff8a65' : color;
        ctx.stroke();
      }
      // 控制点
      if (selected) {
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#ff5722';
        s.points.forEach(p => {
          const [sx, sy] = this.toScreen(p[0], p[1]);
          ctx.beginPath();
          ctx.rect(sx - 3.5, sy - 3.5, 7, 7);
          ctx.fill(); ctx.stroke();
        });
      }
    }
    // 绘制中的折线
    if (this.drawing && this.drawing.length) {
      ctx.strokeStyle = '#2196f3';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      this.drawing.forEach((p, i) => {
        const [sx, sy] = this.toScreen(p[0], p[1]);
        i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
      });
      const [mx, my] = this.toScreen(this.mouse.x, this.mouse.y);
      ctx.lineTo(mx, my);
      ctx.stroke();
      this.drawing.forEach(p => {
        const [sx, sy] = this.toScreen(p[0], p[1]);
        ctx.fillStyle = '#2196f3';
        ctx.fillRect(sx - 3, sy - 3, 6, 6);
      });
    }
    // 框选矩形
    if (this.drag && this.drag.kind === 'box') {
      const [x0, y0] = this.toScreen(this.drag.x0, this.drag.y0);
      const [x1, y1] = this.toScreen(this.mouse.x, this.mouse.y);
      ctx.strokeStyle = '#2196f3';
      ctx.fillStyle = 'rgba(33,150,243,0.08)';
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.setLineDash([]);
    }
  },

  /* ---------- 命中 ---------- */
  hitPoint(mx, my) {
    // 屏幕坐标 → 找控制点（优先选中的图形）
    const tol = 7 / this.view.scale;
    const shapes = this.design().shapes;
    const test = (list) => {
      for (const s of list) {
        for (let i = 0; i < s.points.length; i++) {
          const p = s.points[i];
          if (Math.abs(p[0] - mx) < tol && Math.abs(p[1] - my) < tol) return { shape: s, idx: i };
        }
      }
      return null;
    };
    return test(shapes.filter(s => this.sel.shapes.has(s.id))) || test(shapes);
  },
  hitEdge(mx, my) {
    const tol = 5 / this.view.scale;
    for (let i = this.design().shapes.length - 1; i >= 0; i--) {
      const s = this.design().shapes[i];
      const pts = s.points, n = pts.length;
      const segs = s.closed ? n : n - 1;
      for (let k = 0; k < segs; k++) {
        const a = pts[k], b = pts[(k + 1) % n];
        const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
        let t = L2 ? ((mx - a[0]) * (b[0] - a[0]) + (my - a[1]) * (b[1] - a[1])) / L2 : 0;
        t = U.clamp(t, 0, 1);
        const d = Math.hypot(mx - (a[0] + t * (b[0] - a[0])), my - (a[1] + t * (b[1] - a[1])));
        if (d < tol) return { shape: s, seg: k, t };
      }
    }
    return null;
  },

  /* ---------- 事件 ---------- */
  bindCanvas() {
    const c = this.canvas;
    c.addEventListener('mousedown', (e) => this.onDown(e));
    c.addEventListener('mousemove', (e) => this.onMove(e));
    c.addEventListener('mouseup', (e) => this.onUp(e));
    c.addEventListener('dblclick', (e) => this.onDbl(e));
    c.addEventListener('contextmenu', (e) => { e.preventDefault(); this.onRight(e); });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      const [dx, dy] = this.toDesign(px, py);
      const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      this.view.scale = U.clamp(this.view.scale * f, 0.3, 200);
      const [nx, ny] = this.toDesign(px, py);
      this.view.x += dx - nx; this.view.y += dy - ny;
      this.draw();
    }, { passive: false });
  },
  evtPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  },

  setTool(t) {
    this.tool = t;
    this.drawing = null;
    this.el.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
    this.canvas.style.cursor = t === 'pan' ? 'grab' : 'crosshair';
    this.draw();
  },

  onDown(e) {
    if (e.button === 1) { this.tool_before = this.tool; this.tool = 'pan'; }
    if (e.button !== 0 && e.button !== 1) return;
    const [px, py] = this.evtPos(e);
    const [mx, my] = this.toDesign(px, py);

    if (this.tool === 'pan') { this.drag = { kind: 'pan', sx: px, sy: py, vx: this.view.x, vy: this.view.y }; return; }

    // 画图形工具
    if (['rect', 'ellipse'].includes(this.tool)) {
      this.drag = { kind: 'drawShape', x0: mx, y0: my };
      return;
    }
    if (['polygon', 'satin', 'running'].includes(this.tool)) {
      if (!this.drawing) this.drawing = [];
      this.drawing.push([this.snap(mx), this.snap(my)]);
      this.draw();
      return;
    }

    // 选择工具
    const hp = this.hitPoint(mx, my);
    if (hp) {
      if (!this.sel.shapes.has(hp.shape.id)) this.select([hp.shape.id]);
      this.snapshot();
      this.drag = { kind: 'point', shape: hp.shape, idx: hp.idx };
      return;
    }
    const he = this.hitEdge(mx, my);
    if (he) {
      if (e.shiftKey) {
        this.sel.shapes.has(he.shape.id) ? this.sel.shapes.delete(he.shape.id) : this.sel.shapes.add(he.shape.id);
        this.select([...this.sel.shapes]);
        return;
      }
      if (!this.sel.shapes.has(he.shape.id)) this.select([he.shape.id]);
      this.snapshot();
      this.drag = { kind: 'move', lx: mx, ly: my, moved: false };
      return;
    }
    // 空白：框选
    this.drag = { kind: 'box', x0: mx, y0: my, shift: e.shiftKey };
    if (!e.shiftKey) this.select([]);
  },

  onMove(e) {
    const [px, py] = this.evtPos(e);
    const [mx, my] = this.toDesign(px, py);
    this.mouse = { x: mx, y: my };
    const cd = this.el.querySelector('#coords');
    if (cd) cd.textContent = `X ${U.fmt1(mx)}  Y ${U.fmt1(my)} mm`;
    const d = this.drag;
    if (!d) { if (this.drawing) this.draw(); return; }
    if (d.kind === 'pan') {
      this.view.x = d.vx - (px - d.sx) / this.view.scale;
      this.view.y = d.vy - (py - d.sy) / this.view.scale;
      this.draw();
    } else if (d.kind === 'point') {
      d.shape.points[d.idx] = [this.snap(mx), this.snap(my)];
      this.draw();
    } else if (d.kind === 'move') {
      const dx = mx - d.lx, dy = my - d.ly;
      if (Math.abs(dx) + Math.abs(dy) > 0.01) {
        d.moved = true;
        for (const s of this.design().shapes) {
          if (!this.sel.shapes.has(s.id)) continue;
          s.points = s.points.map(p => [p[0] + dx, p[1] + dy]);
          if (s.holes) s.holes = s.holes.map(h => h.map(p => [p[0] + dx, p[1] + dy]));
          if (s.stitches) s.stitches = s.stitches.map(st => ({ x: st.x + dx, y: st.y + dy, f: st.f }));
        }
        d.lx = mx; d.ly = my;
        this.draw();
      }
    } else if (d.kind === 'box') {
      this.draw();
    } else if (d.kind === 'drawShape') {
      this.draw();
      const ctx = this.ctx, dpr = this.dpr || 1;
      const [x0, y0] = this.toScreen(d.x0, d.y0);
      const [x1, y1] = this.toScreen(mx, my);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = '#2196f3';
      ctx.setLineDash([4, 3]);
      if (this.tool === 'rect') ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      else {
        ctx.beginPath();
        ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  },

  onUp(e) {
    const d = this.drag;
    this.drag = null;
    if (e.button === 1 && this.tool_before) { this.tool = this.tool_before; this.tool_before = null; return; }
    if (!d) return;
    if (d.kind === 'point' || (d.kind === 'move' && d.moved)) {
      App.touch();
      this.renderShapeList();
    } else if (d.kind === 'move' && !d.moved) {
      this.undoStack.pop(); // 没动就不占撤销位
    } else if (d.kind === 'box') {
      const x0 = Math.min(d.x0, this.mouse.x), x1 = Math.max(d.x0, this.mouse.x);
      const y0 = Math.min(d.y0, this.mouse.y), y1 = Math.max(d.y0, this.mouse.y);
      const ids = [];
      for (const s of this.design().shapes) {
        if (s.points.some(p => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1)) ids.push(s.id);
      }
      this.select(d.shift ? [...this.sel.shapes, ...ids] : ids);
      this.draw();
    } else if (d.kind === 'drawShape') {
      const x0 = Math.min(d.x0, this.mouse.x), x1 = Math.max(d.x0, this.mouse.x);
      const y0 = Math.min(d.y0, this.mouse.y), y1 = Math.max(d.y0, this.mouse.y);
      if (x1 - x0 > 1 && y1 - y0 > 1) {
        this.snapshot();
        let pts;
        if (this.tool === 'rect') pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
        else {
          pts = [];
          const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
          for (let i = 0; i < 48; i++) { const t = i / 48 * Math.PI * 2; pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); }
        }
        this.addShape('fill', pts, true);
      }
      this.draw();
    }
  },

  onDbl(e) {
    // 双击：完成折线绘制，或在边上插点
    if (this.drawing) { this.finishDrawing(); return; }
    if (this.tool !== 'select') return;
    const [px, py] = this.evtPos(e);
    const [mx, my] = this.toDesign(px, py);
    const he = this.hitEdge(mx, my);
    if (he) {
      this.snapshot();
      he.shape.points.splice(he.seg + 1, 0, [mx, my]);
      if (he.shape.widths && he.shape.widths.length === he.shape.points.length - 1) {
        const w = he.shape.widths;
        w.splice(he.seg + 1, 0, (w[he.seg] + w[(he.seg + 1) % w.length]) / 2);
      }
      App.touch();
      this.draw();
    }
  },

  onRight(e) {
    const [px, py] = this.evtPos(e);
    const [mx, my] = this.toDesign(px, py);
    const hp = this.hitPoint(mx, my);
    if (hp) {
      const minPts = hp.shape.closed ? 3 : 2;
      if (hp.shape.points.length <= minPts) { App.toast('点数太少，不能再删', 'err'); return; }
      this.snapshot();
      hp.shape.points.splice(hp.idx, 1);
      if (hp.shape.widths && hp.shape.widths.length > hp.shape.points.length) hp.shape.widths.splice(hp.idx, 1);
      App.touch();
      this.draw();
    }
  },

  onKey(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); }
    else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); this.redo(); }
    else if (k === 'delete' || k === 'backspace') { this.deleteSelected(); }
    else if (k === 'escape') { this.drawing = null; this.select([]); this.draw(); }
    else if (k === 'enter' && this.drawing) { this.finishDrawing(); }
    else if (k === 'v') this.setTool('select');
    else if (k === 'h') this.setTool('pan');
    else if ((e.ctrlKey || e.metaKey) && k === 'a') { e.preventDefault(); this.select(this.design().shapes.map(s => s.id)); }
  },

  finishDrawing() {
    if (!this.drawing || this.drawing.length < 2) { this.drawing = null; this.draw(); return; }
    this.snapshot();
    const type = this.tool === 'satin' ? 'satin' : this.tool === 'running' ? 'running' : 'fill';
    const closed = type === 'fill';
    if (type === 'fill' && this.drawing.length < 3) { this.drawing = null; this.undoStack.pop(); this.draw(); return; }
    this.addShape(type, this.drawing, closed);
    this.drawing = null;
    this.draw();
  },

  addShape(type, points, closed) {
    const d = this.design();
    // 加到最后一个色块；没有则新建
    let blk = [...d.sequence].reverse().find(i => i.kind === 'block');
    if (!blk) {
      blk = { kind: 'block', id: U.uid(), threadId: '1027', shapeIds: [] };
      d.sequence.push(blk);
    }
    const s = {
      id: U.uid(), name: { fill: '填充', satin: '包针', running: '平针' }[type] + (d.shapes.length + 1),
      type, closed, points, holes: [], color: blk.threadId,
      params: U.defaultParams(type),
    };
    if (type === 'satin') { s.width = 3; }
    d.shapes.push(s);
    blk.shapeIds.push(s.id);
    App.touch();
    this.select([s.id]);
    this.renderShapeList();
  },

  /* ---------- 选择 ---------- */
  select(ids) {
    this.sel.shapes = new Set(ids);
    this.renderShapeList();
    this.renderParams();
    this.draw();
  },
  selectedShapes() {
    return this.design().shapes.filter(s => this.sel.shapes.has(s.id));
  },

  deleteSelected() {
    if (!this.sel.shapes.size) return;
    this.snapshot();
    const d = this.design();
    d.shapes = d.shapes.filter(s => !this.sel.shapes.has(s.id));
    for (const item of d.sequence) {
      if (item.kind === 'block') item.shapeIds = item.shapeIds.filter(id => !this.sel.shapes.has(id));
    }
    d.sequence = d.sequence.filter(i => i.kind !== 'block' || i.shapeIds.length);
    this.select([]);
    App.touch();
  },

  /* ---------- 撤销重做 ---------- */
  snapshot() {
    const d = this.design();
    this.undoStack.push(JSON.stringify({ shapes: d.shapes, sequence: d.sequence }));
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
  },
  undo() {
    if (!this.undoStack.length) return;
    const d = this.design();
    this.redoStack.push(JSON.stringify({ shapes: d.shapes, sequence: d.sequence }));
    const s = JSON.parse(this.undoStack.pop());
    d.shapes = s.shapes; d.sequence = s.sequence;
    this.select([]);
    App.touch();
  },
  redo() {
    if (!this.redoStack.length) return;
    const d = this.design();
    this.undoStack.push(JSON.stringify({ shapes: d.shapes, sequence: d.sequence }));
    const s = JSON.parse(this.redoStack.pop());
    d.shapes = s.shapes; d.sequence = s.sequence;
    this.select([]);
    App.touch();
  },

  /* ---------- 侧栏 ---------- */
  renderShapeList() {
    const list = this.el.querySelector('#shapeList');
    const cnt = this.el.querySelector('#shapeCount');
    if (!list) return;
    cnt.textContent = this.design().shapes.length;
    list.innerHTML = '';
    for (const s of this.design().shapes) {
      const t = threadByCode(s.color);
      const row = document.createElement('div');
      row.className = 'shape-row' + (this.sel.shapes.has(s.id) ? ' sel' : '');
      const typeName = { fill: '榻榻米', satin: '包针', running: '平针', zigzag: '锯齿', raw: '成品针迹' }[s.type] || s.type;
      row.innerHTML = `<span class="sw" style="background:${t.hex}"></span><span class="nm">${U.escapeHtml(s.name)}</span><span class="tp">${typeName}</span>`;
      row.onclick = (e) => {
        if (e.shiftKey) { const ids = [...this.sel.shapes]; const i = ids.indexOf(s.id); i >= 0 ? ids.splice(i, 1) : ids.push(s.id); this.select(ids); }
        else this.select([s.id]);
      };
      list.appendChild(row);
    }
  },

  renderParams() {
    const panel = this.el.querySelector('#paramPanel');
    if (!panel) return;
    const sel = this.selectedShapes();
    if (!sel.length) { panel.innerHTML = '<div class="empty">选中一个图形后编辑参数</div>'; return; }
    const s = sel[0];
    const multi = sel.length > 1;
    const d = this.design();
    const blocks = d.sequence.filter(i => i.kind === 'block');

    const num = (label, key, min, max, step, unit) => `
      <label class="p-row"><span>${label}</span>
        <input type="number" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${s.params[key] ?? ''}">
        <em>${unit}</em></label>`;
    let html = `<div class="p-title">${multi ? `已选 ${sel.length} 个图形` : U.escapeHtml(s.name)}</div>`;
    html += `<label class="p-row"><span>针法</span><select data-k="__type">
      ${[['fill', '榻榻米'], ['satin', '包针'], ['running', '平针'], ['zigzag', '锯齿针']].map(([v, n]) =>
        `<option value="${v}" ${s.type === v ? 'selected' : ''}>${n}</option>`).join('')}
    </select><em></em></label>`;
    html += `<label class="p-row"><span>色块</span><select data-k="__block">
      ${blocks.map(b => { const t = threadByCode(b.threadId); return `<option value="${b.id}" ${b.shapeIds.includes(s.id) ? 'selected' : ''}>${t.code} ${t.name}</option>`; }).join('')}
      <option value="__new">＋ 新建色块</option>
    </select><em></em></label>`;
    if (s.type === 'fill' || s.type === 'zigzag') {
      html += num('密度(行距)', 'spacing', 0.2, 2, 0.05, 'mm');
      html += num('针距', 'stitchLength', 0.8, 8, 0.1, 'mm');
      html += num('角度', 'angle', 0, 180, 5, '°');
      html += num('收缩补偿', 'pullComp', 0, 1, 0.05, 'mm');
      html += `<label class="p-row"><span>底线</span><input type="checkbox" data-k="underlay" ${s.params.underlay ? 'checked' : ''}><em></em></label>`;
    } else if (s.type === 'satin') {
      html += num('密度(针距)', 'spacing', 0.2, 1.2, 0.05, 'mm');
      html += num('宽度', '__width', 0.8, 12, 0.1, 'mm');
      html += num('收缩补偿', 'pullComp', 0, 1, 0.05, 'mm');
      html += `<label class="p-row"><span>底线</span><input type="checkbox" data-k="underlay" ${s.params.underlay ? 'checked' : ''}><em></em></label>`;
    } else if (s.type === 'running') {
      html += num('针距', 'stitchLength', 0.5, 8, 0.1, 'mm');
    } else if (s.type === 'raw') {
      html += '<div class="empty">DST 导入的成品针迹，可移动/换色/再导出</div>';
    }
    panel.innerHTML = html;

    panel.querySelectorAll('input,select').forEach(inp => {
      inp.onchange = () => {
        this.snapshot();
        const k = inp.dataset.k;
        for (const sh of this.selectedShapes()) {
          if (k === '__type') {
            sh.type = inp.value;
            sh.params = Object.assign(U.defaultParams(inp.value), sh.params);
            if (inp.value === 'satin' && !sh.widths && !sh.width) sh.width = 3;
            if (inp.value === 'fill') sh.closed = true;
          } else if (k === '__block') {
            this.moveToBlock(sh, inp.value);
          } else if (k === '__width') {
            const w = U.clamp(+inp.value || 3, 0.8, 12);
            if (sh.widths && sh.widths.length) {
              const avg = sh.widths.reduce((a, b) => a + b, 0) / sh.widths.length || 1;
              sh.widths = sh.widths.map(x => x * w / avg);
            } else sh.width = w;
          } else if (inp.type === 'checkbox') {
            sh.params[k] = inp.checked;
          } else {
            sh.params[k] = +inp.value;
          }
          sh.color = this.blockOf(sh)?.threadId || sh.color;
        }
        App.touch();
        this.renderShapeList();
        this.draw();
      };
    });
  },

  blockOf(shape) {
    return this.design().sequence.find(i => i.kind === 'block' && i.shapeIds.includes(shape.id));
  },
  moveToBlock(shape, blockId) {
    const d = this.design();
    for (const item of d.sequence) {
      if (item.kind === 'block') item.shapeIds = item.shapeIds.filter(id => id !== shape.id);
    }
    let blk;
    if (blockId === '__new') {
      blk = { kind: 'block', id: U.uid(), threadId: '1027', shapeIds: [] };
      d.sequence.push(blk);
    } else {
      blk = d.sequence.find(i => i.kind === 'block' && i.id === blockId);
    }
    if (blk) { blk.shapeIds.push(shape.id); shape.color = blk.threadId; }
    d.sequence = d.sequence.filter(i => i.kind !== 'block' || i.shapeIds.length);
  },
};
