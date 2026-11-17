// 编辑器画布交互：控制点拖拽、框选移动、网格吸附、滚轮缩放、空格平移
import { Viewport, resizeCanvas, drawGrid, drawHoop, drawShapeOutline, drawHandles, drawSelectionBox, hitHandle, pointInShape, setHitScale } from './viewport.js';
import { bbox, add, sub, scale, mm } from '../core/math.js';

export class EditorCanvas {
  constructor(canvas, project, hooks) {
    this.canvas = canvas;
    this.project = project;
    this.hooks = hooks; // { getSelectedIds, setSelection, onModify, getTool, getStitchResult, getShowStitch }
    this.vp = new Viewport();
    this.tool = 'select';
    this.drag = null;
    this.marquee = null;
    this.spaceDown = false;
    this.panning = false;
    this.fitOnce();
    this.bind();
    this.raf = requestAnimationFrame(() => this.render());
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.canvas.onwheel = null;
    this.canvas.onpointerdown = null;
    this.canvas.onpointermove = null;
    this.canvas.onpointerup = null;
    this._keydown && window.removeEventListener('keydown', this._keydown);
    this._keyup && window.removeEventListener('keyup', this._keyup);
  }

  fitOnce() {
    const { w, h } = this.size();
    const all = this.project.shapes.flatMap(s => s.points);
    this.vp.fit(all.length ? bbox(all) : { w: 2000, h: 2000, cx: 0, cy: 0 }, w, h);
  }

  size() {
    const rect = this.canvas.getBoundingClientRect();
    return { w: Math.max(50, rect.width), h: Math.max(50, rect.height) };
  }

  setProject(p) { this.project = p; this.render(); }
  setTool(t) { this.tool = t; this.canvas.style.cursor = t === 'pen' ? 'crosshair' : 'default'; }

  bind() {
    const c = this.canvas;
    c.onwheel = (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      this.vp.zoomAt(pt, e.deltaY < 0 ? 1.12 : 0.89);
    };
    c.onpointerdown = (e) => this.onDown(e);
    c.onpointermove = (e) => this.onMove(e);
    c.onpointerup = (e) => this.onUp(e);
    c.oncontextmenu = (e) => e.preventDefault();
    this._keydown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.code === 'Space') { this.spaceDown = true; c.style.cursor = 'grab'; }
      if (e.key === 'Delete' || e.key === 'Backspace') this.hooks.onDelete?.();
    };
    this._keyup = (e) => {
      if (e.code === 'Space') { this.spaceDown = false; c.style.cursor = this.tool === 'pen' ? 'crosshair' : 'default'; }
    };
    window.addEventListener('keydown', this._keydown);
    window.addEventListener('keyup', this._keyup);
  }

  eventPt(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  worldPt(e) {
    const s = this.eventPt(e);
    const w = this.vp.toWorld(s);
    if (this.project.settings.snap) {
      const g = mm(this.project.settings.gridSize || 10);
      return { x: Math.round(w.x / g) * g, y: Math.round(w.y / g) * g };
    }
    return w;
  }
  rawWorld(e) { return this.vp.toWorld(this.eventPt(e)); }

  getSelected() {
    const ids = new Set(this.hooks.getSelectedIds());
    return this.project.shapes.filter(s => ids.has(s.id));
  }

  onDown(e) {
    this.canvas.setPointerCapture(e.pointerId);
    const sp = this.eventPt(e);
    const raw = this.rawWorld(e);
    const wp = this.worldPt(e);

    if (this.spaceDown || e.button === 1) { this.panning = true; this.panStart = { sp, off: { ...this.vp } }; return; }
    if (e.button === 2) { this.panning = true; this.panStart = { sp, off: { ...this.vp } }; return; }

    if (this.tool === 'pen') {
      this.hooks.onPenPoint?.(wp, e.shiftKey);
      return;
    }
    // select 工具
    const selected = this.getSelected();
    // 1) 控制点命中
    for (const sh of selected.length ? selected : this.project.shapes) {
      const idx = hitHandle(sh, raw, this.vp);
      if (idx >= 0) {
        this.drag = { kind: 'handle', shape: sh, index: idx, moved: false };
        return;
      }
    }
    // 2) 形状命中
    setHitScale(this.vp.scale);
    for (let i = this.project.shapes.length - 1; i >= 0; i--) {
      const sh = this.project.shapes[i];
      if (sh.visible && pointInShape(raw, sh)) {
        if (!e.shiftKey && !this.hooks.getSelectedIds().includes(sh.id)) this.hooks.setSelection([sh.id]);
        if (e.shiftKey) this.hooks.toggleSelection?.(sh.id);
        this.drag = {
          kind: 'move',
          shapes: this.getSelected().length ? this.getSelected() : [sh],
          start: wp,
          original: this.getSelected().map(s => ({ id: s.id, pts: s.points.map(p => ({ ...p })) })),
          moved: false
        };
        return;
      }
    }
    // 3) 空白处：框选
    this.marquee = { x0: sp.x, y0: sp.y, x1: sp.x, y1: sp.y, additive: e.shiftKey };
  }

  onMove(e) {
    const sp = this.eventPt(e);
    if (this.panning) {
      this.vp.offsetX = this.panStart.off.offsetX + (sp.x - this.panStart.sp.x);
      this.vp.offsetY = this.panStart.off.offsetY + (sp.y - this.panStart.sp.y);
      return;
    }
    const wp = this.worldPt(e);
    if (this.drag?.kind === 'handle') {
      this.drag.shape.points[this.drag.index] = { ...wp };
      this.drag.moved = true;
      this.hooks.onModify?.(false);
    } else if (this.drag?.kind === 'move') {
      const d = sub(wp, this.drag.start);
      for (const o of this.drag.original) {
        const sh = this.project.shapes.find(s => s.id === o.id);
        sh.points = o.pts.map(p => add(p, d));
      }
      this.drag.moved = true;
      this.hooks.onModify?.(false);
    } else if (this.marquee) {
      this.marquee.x1 = sp.x; this.marquee.y1 = sp.y;
    }
  }

  onUp(e) {
    if (this.panning) { this.panning = false; return; }
    if (this.drag) {
      if (this.drag.moved) this.hooks.onModify?.(true);
      this.drag = null;
      return;
    }
    if (this.marquee) {
      const m = this.marquee;
      const x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1);
      const y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1);
      if (Math.hypot(x1 - x0, y1 - y0) > 4) {
        const ids = [];
        for (const sh of this.project.shapes) {
          const box = bbox(sh.points);
          const a = this.vp.toScreen({ x: box.minX, y: box.minY });
          const b = this.vp.toScreen({ x: box.maxX, y: box.maxY });
          if (a.x >= x0 && b.x <= x1 && a.y >= y0 && b.y <= y1) ids.push(sh.id);
        }
        const base = m.additive ? this.hooks.getSelectedIds() : [];
        this.hooks.setSelection([...new Set([...base, ...ids])]);
      } else if (!m.additive) {
        this.hooks.setSelection([]);
      }
      this.marquee = null;
    }
  }

  render() {
    const { ctx, w, h } = resizeCanvas(this.canvas);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#12161a';
    ctx.fillRect(0, 0, w, h);
    drawGrid(ctx, this.vp, w, h, mm(this.project.settings.gridSize || 10), this.project.settings.snap);
    const hoop = this.hooks.getHoop?.();
    if (hoop) drawHoop(ctx, this.vp, hoop);

    // 针迹预览（淡色）
    const result = this.hooks.getStitchResult?.();
    if (result && this.hooks.getShowStitch?.()) this.drawStitches(ctx, result);

    const selIds = new Set(this.hooks.getSelectedIds());
    for (const sh of this.project.shapes) {
      drawShapeOutline(ctx, this.vp, sh, selIds.has(sh.id), false);
    }
    const selected = this.project.shapes.filter(s => selIds.has(s.id));
    selected.forEach(sh => drawHandles(ctx, this.vp, sh));
    if (selected.length > 1) drawSelectionBox(ctx, this.vp, selected);

    if (this.marquee) {
      const m = this.marquee;
      ctx.save();
      ctx.fillStyle = 'rgba(232,130,58,0.12)';
      ctx.strokeStyle = 'rgba(232,130,58,0.8)';
      ctx.fillRect(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1), Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
      ctx.strokeRect(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1), Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
      ctx.restore();
    }
    this.raf = requestAnimationFrame(() => this.render());
  }

  drawStitches(ctx, result) {
    const colorById = new Map(this.project.palette.map(c => [c.id, c.hex]));
    ctx.save();
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.55;
    let curColor = null;
    ctx.beginPath();
    for (const block of result.blocks) {
      ctx.strokeStyle = colorById.get(block.colorId) || '#bbb';
      ctx.beginPath();
      for (let i = 0; i < block.stitches.length; i++) {
        const s = block.stitches[i];
        const sp = this.vp.toScreen(s);
        if (i === 0) ctx.moveTo(sp.x, sp.y); else ctx.lineTo(sp.x, sp.y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}
