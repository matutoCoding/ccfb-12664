// 仿真渲染：按真实线径一针一针绘制，带线光泽、布料纹理、绷子、倾斜观察
import { Viewport, resizeCanvas } from './viewport.js';
import { F } from '../core/constants.js';
import { FABRICS, HOOPS } from '../data/palette.js';
import { bbox } from '../core/math.js';

function shade(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r * factor)));
  g = Math.max(0, Math.min(255, Math.round(g * factor)));
  b = Math.max(0, Math.min(255, Math.round(b * factor)));
  return `rgb(${r},${g},${b})`;
}

export class Simulation {
  constructor(canvas, project) {
    this.canvas = canvas;
    this.project = project;
    this.vp = new Viewport();
    this.tilt = 0;              // 0..1 侧倾程度
    this.showStitchDots = true;
    this.progress = 1;          // 绣作进度 0..1，可播放
    this.fabric = FABRICS.find(f => f.id === project.settings.fabricId) || FABRICS[0];
    this.hoop = HOOPS.find(h => h.id === project.settings.hoopId) || HOOPS[1];
    this.threadWidthMm = project.settings.threadWidthMm || 0.4;
    this.fit();
    this.raf = requestAnimationFrame(() => this.render());
  }
  dispose() { cancelAnimationFrame(this.raf); }
  setProject(p) { this.project = p; this.fit(); }
  fit() {
    const rect = this.canvas.getBoundingClientRect();
    const all = this.project.shapes.flatMap(s => s.points);
    this.vp.fit(all.length ? bbox(all) : { w: 2000, h: 2000, cx: 0, cy: 0 }, Math.max(50, rect.width), Math.max(50, rect.height), 80);
  }
  zoomAt(screen, factor) { this.vp.zoomAt(screen, factor); }
  pan(dx, dy) { this.vp.offsetX += dx; this.vp.offsetY += dy; }

  render() {
    const { ctx, w, h } = resizeCanvas(this.canvas);
    this.drawFabric(ctx, w, h);
    this.drawHoop(ctx);
    const result = this.result;
    if (result) this.drawThreads(ctx, result);
    this.raf = requestAnimationFrame(() => this.render());
  }

  setResult(r) { this.result = r; }

  drawFabric(ctx, w, h) {
    ctx.fillStyle = this.fabric.hex;
    ctx.fillRect(0, 0, w, h);
    // 织物经纬纹理
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    const gap = 5;
    ctx.beginPath();
    for (let x = 0; x < w; x += gap) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = 0; y < h; y += gap) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    ctx.restore();
  }

  drawHoop(ctx) {
    const c = this.vp.toScreen({ x: 0, y: 0 });
    const wpx = this.hoop.w * this.vp.scale, hpx = this.hoop.h * this.vp.scale;
    ctx.save();
    ctx.strokeStyle = 'rgba(220,220,220,0.7)';
    ctx.lineWidth = 5;
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    if (this.hoop.shape === 'circle') ctx.ellipse(c.x, c.y, wpx / 2, hpx / 2, 0, 0, Math.PI * 2);
    else ctx.rect(c.x - wpx / 2, c.y - hpx / 2, wpx, hpx);
    ctx.stroke();
    ctx.restore();
  }

  // 倾斜变换：y 方向压缩，模拟侧向观察
  applyTilt(ctx, w, h) {
    if (this.tilt <= 0.01) return;
    const k = 1 - this.tilt * 0.65;
    ctx.translate(0, h * (1 - k) / 2);
    ctx.scale(1, k);
  }

  drawThreads(ctx, result) {
    const colorById = new Map(this.project.palette.map(c => [c.id, c]));
    const lineW = Math.max(1, this.threadWidthMm * this.vp.scale);
    const limit = Math.floor(result.records.length * this.progress);
    ctx.save();
    const rect = this.canvas.getBoundingClientRect();
    this.applyTilt(ctx, rect.width, rect.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 视口裁剪：把屏幕四边反算到世界坐标，画布外的针迹段直接跳过
    const margin = 40;
    const tl = this.vp.toWorld({ x: -margin, y: -margin });
    const br = this.vp.toWorld({ x: rect.width + margin, y: rect.height + margin });
    const inView = (s) => s.x >= tl.x && s.x <= br.x && s.y >= tl.y && s.y <= br.y;

    let drawn = 0;
    for (const block of result.blocks) {
      const color = colorById.get(block.colorId);
      if (!color) continue;
      const hex = color.hex;
      // 1) 阴影底（线凸起感）
      ctx.strokeStyle = shade(hex, 0.45);
      ctx.lineWidth = lineW + 1.5;
      ctx.beginPath();
      let started = false;
      const stitches = block.stitches;
      for (let i = 0; i < stitches.length; i++) {
        if (drawn++ > limit) break;
        const s = stitches[i];
        if (s.flag & (F.JUMP | F.TRIM)) { started = false; continue; }
        if (!inView(s)) { started = false; continue; }
        const sp = this.vp.toScreen(s);
        if (!started) { ctx.moveTo(sp.x + 1, sp.y + 1.5); started = true; }
        else ctx.lineTo(sp.x + 1, sp.y + 1.5);
      }
      ctx.stroke();

      // 2) 主线
      ctx.strokeStyle = hex;
      ctx.lineWidth = lineW;
      ctx.beginPath();
      started = false;
      for (let i = 0; i < stitches.length; i++) {
        const s = stitches[i];
        if (s.flag & (F.JUMP | F.TRIM)) { started = false; continue; }
        if (!inView(s)) { started = false; continue; }
        const sp = this.vp.toScreen(s);
        if (!started) { ctx.moveTo(sp.x, sp.y); started = true; }
        else ctx.lineTo(sp.x, sp.y);
      }
      ctx.stroke();

      // 3) 高光（光泽：沿线上方偏移一条细线），侧倾时更明显
      ctx.strokeStyle = shade(hex, 1.35);
      ctx.lineWidth = Math.max(0.5, lineW * 0.35);
      ctx.globalAlpha = 0.55 + this.tilt * 0.35;
      ctx.beginPath();
      started = false;
      for (let i = 0; i < stitches.length; i++) {
        const s = stitches[i];
        if (s.flag & (F.JUMP | F.TRIM)) { started = false; continue; }
        if (!inView(s)) { started = false; continue; }
        const sp = this.vp.toScreen(s);
        if (!started) { ctx.moveTo(sp.x - 0.6, sp.y - 0.8); started = true; }
        else ctx.lineTo(sp.x - 0.6, sp.y - 0.8);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      // 4) 针脚点（放大时可见，视域外跳过）
      if (this.showStitchDots && this.vp.scale > 0.9) {
        ctx.fillStyle = shade(hex, 0.7);
        for (let i = 0; i < stitches.length; i += 1) {
          const s = stitches[i];
          if (s.flag & (F.JUMP | F.TRIM) || !inView(s)) continue;
          const sp = this.vp.toScreen(s);
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, Math.max(0.8, lineW * 0.28), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }
}
