// 画布视口变换：内部坐标(0.1mm) -> 屏幕像素
export class Viewport {
  constructor() {
    this.scale = 0.35;  // 像素/内部单位
    this.offsetX = 0;
    this.offsetY = 0;
  }
  toScreen(p) {
    return { x: p.x * this.scale + this.offsetX, y: p.y * this.scale + this.offsetY };
  }
  toWorld(p) {
    return { x: (p.x - this.offsetX) / this.scale, y: (p.y - this.offsetY) / this.scale };
  }
  zoomAt(screenPt, factor) {
    const before = this.toWorld(screenPt);
    this.scale = Math.max(0.05, Math.min(8, this.scale * factor));
    this.offsetX = screenPt.x - before.x * this.scale;
    this.offsetY = screenPt.y - before.y * this.scale;
  }
  fit(bbox2d, width, height, pad = 60) {
    if (!bbox2d || bbox2d.w <= 0 || bbox2d.h <= 0) {
      this.scale = 0.5; this.offsetX = width / 2; this.offsetY = height / 2; return;
    }
    const sx = (width - pad * 2) / bbox2d.w;
    const sy = (height - pad * 2) / bbox2d.h;
    this.scale = Math.max(0.05, Math.min(8, Math.min(sx, sy)));
    this.offsetX = width / 2 - bbox2d.cx * this.scale;
    this.offsetY = height / 2 - bbox2d.cy * this.scale;
  }
}

export function resizeCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(50, rect.width), h = Math.max(50, rect.height);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

export function drawGrid(ctx, vp, w, h, gridSizeUnits, snap) {
  const step = gridSizeUnits * vp.scale;
  if (step < 6) return;
  ctx.save();
  ctx.strokeStyle = snap ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 1;
  const startX = ((vp.offsetX % step) + step) % step;
  const startY = ((vp.offsetY % step) + step) % step;
  ctx.beginPath();
  for (let x = startX; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let y = startY; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();
  // 原点十字
  const o = vp.toScreen({ x: 0, y: 0 });
  ctx.strokeStyle = 'rgba(232,130,58,0.5)';
  ctx.beginPath();
  ctx.moveTo(o.x - 8, o.y); ctx.lineTo(o.x + 8, o.y);
  ctx.moveTo(o.x, o.y - 8); ctx.lineTo(o.x, o.y + 8);
  ctx.stroke();
  ctx.restore();
}

export function drawHoop(ctx, vp, hoop) {
  const c = vp.toScreen({ x: 0, y: 0 });
  const w = hoop.w * vp.scale, h = hoop.h * vp.scale;
  ctx.save();
  ctx.strokeStyle = 'rgba(120,180,255,0.55)';
  ctx.setLineDash([8, 6]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (hoop.shape === 'circle') {
    ctx.ellipse(c.x, c.y, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else {
    ctx.rect(c.x - w / 2, c.y - h / 2, w, h);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(120,180,255,0.7)';
  ctx.font = '11px sans-serif';
  ctx.fillText(hoop.name, c.x - w / 2, c.y - h / 2 - 6);
  ctx.restore();
}

const TYPE_COLORS = { run: '#7fd0ff', satin: '#ffb36b', tatami: '#8de08d', zigzag: '#d59bff', rawStitch: '#cccccc' };

export function drawShapeOutline(ctx, vp, shape, selected, hover) {
  if (!shape.visible || shape.points.length < 2) return;
  const pts = shape.points.map(p => vp.toScreen(p));
  ctx.save();
  ctx.lineWidth = selected ? 2.2 : 1.4;
  ctx.strokeStyle = selected ? '#e8823a' : (hover ? '#f0a35e' : (TYPE_COLORS[shape.type] || '#9aa7b3'));
  ctx.fillStyle = selected ? 'rgba(232,130,58,0.08)' : 'rgba(255,255,255,0.03)';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  if (shape.closed) ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function drawHandles(ctx, vp, shape, filledSelection) {
  const pts = shape.points;
  const handleR = vp.scale > 1.2 ? 5 : 3.5;
  ctx.save();
  for (let i = 0; i < pts.length; i++) {
    const sp = vp.toScreen(pts[i]);
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, handleR, 0, Math.PI * 2);
    ctx.fillStyle = i === 0 ? '#ffd166' : '#ffffff';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#222';
    ctx.stroke();
  }
  ctx.restore();
}

export function drawSelectionBox(ctx, vp, shapes) {
  const all = shapes.flatMap(s => s.points);
  if (!all.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of all) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const a = vp.toScreen({ x: minX, y: minY });
  const b = vp.toScreen({ x: maxX, y: maxY });
  ctx.save();
  ctx.strokeStyle = 'rgba(232,130,58,0.9)';
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.2;
  ctx.strokeRect(a.x - 6, a.y - 6, b.x - a.x + 12, b.y - a.y + 12);
  ctx.setLineDash([]);
  ctx.restore();
}

// 命中测试：控制点
export function hitHandle(shape, worldPt, vp) {
  const tol = 8 / vp.scale;
  for (let i = shape.points.length - 1; i >= 0; i--) {
    if (Math.hypot(shape.points[i].x - worldPt.x, shape.points[i].y - worldPt.y) <= tol) return i;
  }
  return -1;
}

export function pointInShape(pt, shape) {
  if (shape.closed) {
    let inside = false;
    const poly = shape.points;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      if (((yi > pt.y) !== (yj > pt.y)) && pt.x < (xj - xi) * (pt.y - yi) / (yj - yi || 1e-12) + xi) inside = !inside;
    }
    return inside;
  }
  // 开放折线：点到线段距离
  for (let i = 1; i < shape.points.length; i++) {
    const a = shape.points[i - 1], b = shape.points[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const px = a.x + dx * t, py = a.y + dy * t;
    if (Math.hypot(pt.x - px, pt.y - py) < 8 / (vpGlobal || 0.35)) return true;
  }
  return false;
}
let vpGlobal = 0.35;
export function setHitScale(s) { vpGlobal = s; }
