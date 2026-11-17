// 极简 SVG 线稿解析器：把矢量轮廓展平为多边形折线，供自动打版识别轮廓
// 只依赖纯 JS（worker 内可用）。任何解析失败都抛出带中文信息的 Error
import { mm } from './math.js';

class PathBuilder {
  constructor() { this.subs = []; this.cur = null; this.start = null; this.prevCtrl = null; this.prevCmd = ''; }
  move(x, y) { this.flush(); this.cur = [{ x, y }]; this.start = { x, y }; this.prevCtrl = null; }
  line(x, y) {
    if (!this.cur) this.move(x, y); else this.cur.push({ x, y });
    this.prevCtrl = null;
  }
  close() {
    if (this.cur && this.cur.length > 1) {
      const first = this.cur[0];
      if (Math.hypot(this.cur[this.cur.length - 1].x - first.x, this.cur[this.cur.length - 1].y - first.y) > 0.01) {
        this.cur.push({ ...first });
      }
      this.cur.closed = true;
    }
    this.flush();
    this.prevCtrl = null;
  }
  cubic(c1x, c1y, c2x, c2y, x, y) {
    if (!this.cur) this.move(c1x, c1y);
    const p0 = this.cur[this.cur.length - 1];
    const steps = 14;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      const px = mt ** 3 * p0.x + 3 * mt ** 2 * t * c1x + 3 * mt * t * t * c2x + t ** 3 * x;
      const py = mt ** 3 * p0.y + 3 * mt ** 2 * t * c1y + 3 * mt * t * t * c2y + t ** 3 * y;
      this.cur.push({ x: px, y: py });
    }
    this.prevCtrl = { x: c2x, y: c2y };
  }
  quad(cx, cy, x, y) {
    if (!this.cur) this.move(cx, cy);
    const p0 = this.cur[this.cur.length - 1];
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, mt = 1 - t;
      this.cur.push({
        x: mt * mt * p0.x + 2 * mt * t * cx + t * t * x,
        y: mt * mt * p0.y + 2 * mt * t * cy + t * t * y
      });
    }
    this.prevCtrl = { x: cx, y: cy };
  }
  arc(rx, ry, rot, large, sweep, x, y) {
    if (!this.cur) this.move(x, y);
    const p0 = this.cur[this.cur.length - 1];
    const segs = arcToCubics(p0.x, p0.y, rx, ry, rot, large, sweep, x, y);
    for (const s of segs) this.cubic(s.c1x, s.c1y, s.c2x, s.c2y, s.x, s.y);
  }
  flush() {
    if (this.cur && this.cur.length >= 2) {
      this.subs.push(this.cur);
      if (this.cur.closed) this.subs[this.subs.length - 1].closed = true;
    }
    this.cur = null; this.start = null;
  }
}

// 椭圆弧转三次贝塞尔（标准实现）
function arcToCubics(x1, y1, rx, ry, angleDeg, largeFlag, sweepFlag, x2, y2) {
  let rx2 = Math.abs(rx), ry2 = Math.abs(ry);
  if (rx2 < 1e-9 || ry2 < 1e-9) return [{ c1x: x1, c1y: y1, c2x: x2, c2y: y2, x: x2, y: y2 }];
  const phi = angleDeg * Math.PI / 180;
  const cosP = Math.cos(phi), sinP = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;
  let lambda = (x1p * x1p) / (rx2 * rx2) + (y1p * y1p) / (ry2 * ry2);
  if (lambda > 1) { const s = Math.sqrt(lambda); rx2 *= s; ry2 *= s; }
  let factor = (rx2 * rx2 * ry2 * ry2 - rx2 * rx2 * y1p * y1p - ry2 * ry2 * x1p * x1p) /
    (rx2 * rx2 * y1p * y1p + ry2 * ry2 * x1p * x1p);
  factor = Math.sqrt(Math.max(0, factor));
  if (largeFlag === sweepFlag) factor = -factor;
  const cxp = factor * (rx2 * y1p / ry2);
  const cyp = factor * (-ry2 * x1p / rx2);
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;
  const angle = (ux, uy, vx, vy) => (Math.atan2(uy, ux) - Math.atan2(vy, vx));
  let theta1 = angle(1, 0, (x1p - cxp) / rx2, (y1p - cyp) / ry2);
  let dtheta = angle((x1p - cxp) / rx2, (y1p - cyp) / ry2, (-x1p - cxp) / rx2, (-y1p - cyp) / ry2);
  if (!sweepFlag && dtheta > 0) dtheta -= 2 * Math.PI;
  if (sweepFlag && dtheta < 0) dtheta += 2 * Math.PI;
  const nSeg = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 6)));
  const out = [];
  const k = 4 / 3 * Math.tan(dtheta / (2 * nSeg) / 2);
  for (let i = 0; i < nSeg; i++) {
    const a0 = theta1 + dtheta * i / nSeg;
    const a1 = theta1 + dtheta * (i + 1) / nSeg;
    const c1xp = Math.cos(a0) - k * Math.sin(a0), c1yp = Math.sin(a0) + k * Math.cos(a0);
    const c2xp = Math.cos(a1) + k * Math.sin(a1), c2yp = Math.sin(a1) - k * Math.cos(a1);
    const map = (xx, yy) => ({
      x: cx + cosP * rx2 * xx - sinP * ry2 * yy,
      y: cy + sinP * rx2 * xx + cosP * ry2 * yy
    });
    const c1 = map(c1xp, c1yp), c2 = map(c2xp, c2yp), e = map(Math.cos(a1), Math.sin(a1));
    out.push({ c1x: c1.x, c1y: c1.y, c2x: c2.x, c2y: c2.y, x: e.x, y: e.y });
  }
  return out;
}

function parseNumbers(str) {
  const m = str.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g);
  if (!m) return [];
  return m.map(Number);
}

function parsePathD(d) {
  const b = new PathBuilder();
  const re = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
  let match, count = 0;
  while ((match = re.exec(d)) !== null) {
    const cmd = match[0][0];
    const args = parseNumbers(match[1]);
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const cur = () => b.cur ? b.cur[b.cur.length - 1] : { x: 0, y: 0 };
    const X = (v) => rel ? cur().x + v : v;
    const Y = (v) => rel ? cur().y + v : v;
    let i = 0, guard = 0;
    switch (C) {
      case 'M':
        b.move(X(args[i++]), Y(args[i++]));
        while (i + 1 < args.length && guard++ < 10000) { b.line(X(args[i]), Y(args[i + 1])); i += 2; }
        break;
      case 'L':
        while (i + 1 < args.length && guard++ < 10000) { b.line(X(args[i]), Y(args[i + 1])); i += 2; }
        break;
      case 'H':
        while (i < args.length && guard++ < 10000) { b.line(X(args[i]), cur().y); i++; }
        break;
      case 'V':
        while (i < args.length && guard++ < 10000) { b.line(cur().x, Y(args[i])); i++; }
        break;
      case 'C':
        while (i + 5 < args.length && guard++ < 10000) {
          b.cubic(X(args[i]), Y(args[i + 1]), X(args[i + 2]), Y(args[i + 3]), X(args[i + 4]), Y(args[i + 5])); i += 6;
        }
        break;
      case 'S':
        while (i + 3 < args.length && guard++ < 10000) {
          const pc = b.prevCtrl || cur();
          const p = cur();
          const c1x = 2 * p.x - pc.x, c1y = 2 * p.y - pc.y;
          b.cubic(c1x, c1y, X(args[i]), Y(args[i + 1]), X(args[i + 2]), Y(args[i + 3])); i += 4;
        }
        break;
      case 'Q':
        while (i + 3 < args.length && guard++ < 10000) {
          b.quad(X(args[i]), Y(args[i + 1]), X(args[i + 2]), Y(args[i + 3])); i += 4;
        }
        break;
      case 'T':
        while (i + 1 < args.length && guard++ < 10000) {
          const pc = b.prevCtrl || cur(); const p = cur();
          const cx = 2 * p.x - pc.x, cy = 2 * p.y - pc.y;
          b.quad(cx, cy, X(args[i]), Y(args[i + 1])); i += 2;
        }
        break;
      case 'A':
        while (i + 6 < args.length && guard++ < 10000) {
          b.arc(args[i], args[i + 1], args[i + 2], args[i + 3], args[i + 4], X(args[i + 5]), Y(args[i + 6])); i += 7;
        }
        break;
      case 'Z': b.close(); break;
    }
    count += guard;
    if (count > 200000) throw new Error('SVG 路径过于复杂（超过 20 万个数据段），请简化线稿后再导入');
  }
  b.flush();
  return b.subs;
}

// 解析 transform 为 2x3 仿射矩阵 [a,b,c,d,e,f]
function parseTransform(str) {
  let m = [1, 0, 0, 1, 0, 0];
  if (!str) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let match;
  const mul = (n) => [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5]
  ];
  while ((match = re.exec(str)) !== null) {
    const v = parseNumbers(match[2]);
    let n;
    switch (match[1]) {
      case 'matrix': n = v; break;
      case 'translate': n = [1, 0, 0, 1, v[0] || 0, v[1] || 0]; break;
      case 'scale': n = [v[0], 0, 0, v[1] ?? v[0], 0, 0]; break;
      case 'rotate': {
        const a = (v[0] || 0) * Math.PI / 180, cx = v[1] || 0, cy = v[2] || 0;
        const cos = Math.cos(a), sin = Math.sin(a);
        // translate(cx,cy) rotate translate(-cx,-cy)
        n = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
        break;
      }
      case 'skewX': { const t = Math.tan((v[0] || 0) * Math.PI / 180); n = [1, 0, t, 1, 0, 0]; break; }
      case 'skewY': { const t = Math.tan((v[0] || 0) * Math.PI / 180); n = [1, t, 0, 1, 0, 0]; break; }
    }
    if (n && n.length === 6) m = mul(n);
  }
  return m;
}

const applyMatrix = (m, p) => ({
  x: m[0] * p.x + m[2] * p.y + m[4],
  y: m[1] * p.x + m[3] * p.y + m[5]
});

function parseLen(v) {
  if (v == null) return 0;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// 主入口：SVG 文本 -> { paths: [{points, closed}], width, height }，单位已转为内部单位
export function parseSvg(text) {
  if (!text || typeof text !== 'string' || text.length > 20 * 1024 * 1024) {
    throw new Error('SVG 文件为空或超过 20MB，无法解析');
  }
  let doc;
  try {
    doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  } catch {
    throw new Error('当前浏览器不支持 SVG 解析（DOMParser 不可用）');
  }
  const errNode = doc.querySelector('parsererror');
  if (errNode) throw new Error('SVG 文件格式损坏：XML 解析失败，请检查文件内容');
  const root = doc.querySelector('svg');
  if (!root) throw new Error('文件中没有找到 <svg> 根节点，可能不是有效的 SVG 文件');

  const width = parseLen(root.getAttribute('width')) || 100;
  const height = parseLen(root.getAttribute('height')) || 100;
  const paths = [];

  const walk = (el, parentMatrix) => {
    const m = parentMatrix;
    const tag = el.tagName.toLowerCase();
    const addSubs = (subs) => {
      for (const s of subs) {
        const pts = s.map(p => applyMatrix(m, p)).map(p => ({ x: mm(p.x), y: mm(p.y) }));
        if (pts.length >= 2) {
          if (s.closed) pts.closed = true;
          paths.push({ points: pts, closed: !!s.closed });
        }
      }
    };
    if (tag === 'path') {
      const d = el.getAttribute('d');
      if (!d) throw new Error('存在缺少 d 属性的 <path>，无法识别轮廓');
      addSubs(parsePathD(d));
    } else if (tag === 'rect') {
      const x = parseLen(el.getAttribute('x')), y = parseLen(el.getAttribute('y'));
      const w = parseLen(el.getAttribute('width')), h = parseLen(el.getAttribute('height'));
      if (w <= 0 || h <= 0) throw new Error('存在宽高无效的 <rect> 元素');
      const r = (parseLen(el.getAttribute('rx')) || 0);
      let sub;
      if (r > 0) {
        const b = new PathBuilder();
        b.move(x + r, y); b.line(x + w - r, y);
        b.arc(r, r, 0, 0, 1, x + w, y + r);
        b.line(x + w, y + h - r); b.arc(r, r, 0, 0, 1, x + w - r, y + h);
        b.line(x + r, y + h); b.arc(r, r, 0, 0, 1, x, y + h - r);
        b.line(x, y + r); b.arc(r, r, 0, 0, 1, x + r, y);
        b.close(); sub = b.subs;
      } else {
        sub = [[{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }]];
        sub[0].closed = true;
      }
      addSubs(sub);
    } else if (tag === 'circle' || tag === 'ellipse') {
      const cx = parseLen(el.getAttribute('cx')), cy = parseLen(el.getAttribute('cy'));
      const rx = tag === 'circle' ? parseLen(el.getAttribute('r')) : parseLen(el.getAttribute('rx'));
      const ry = tag === 'circle' ? parseLen(el.getAttribute('r')) : parseLen(el.getAttribute('ry'));
      if (!(rx > 0) || !(ry > 0)) throw new Error('存在半径无效的 circle/ellipse 元素');
      const b = new PathBuilder();
      b.move(cx + rx, cy);
      b.arc(rx, ry, 0, 1, 1, cx + rx, cy + 0.0001);
      b.close();
      addSubs(b.subs);
    } else if (tag === 'polygon' || tag === 'polyline') {
      const nums = parseNumbers(el.getAttribute('points') || '');
      if (nums.length < 4) throw new Error(tag + ' 元素的 points 数据不足，无法构成轮廓');
      const pts = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
      if (tag === 'polygon') pts.push({ ...pts[0] }), pts.closed = true;
      addSubs([pts]);
    } else if (tag === 'line') {
      addSubs([[
        { x: parseLen(el.getAttribute('x1')), y: parseLen(el.getAttribute('y1')) },
        { x: parseLen(el.getAttribute('x2')), y: parseLen(el.getAttribute('y2')) }
      ]]);
    }
    for (const child of el.children) {
      const cm = parseTransform(child.getAttribute && child.getAttribute('transform'));
      const combined = [
        m[0] * cm[0] + m[2] * cm[1],
        m[1] * cm[0] + m[3] * cm[1],
        m[0] * cm[2] + m[2] * cm[3],
        m[1] * cm[2] + m[3] * cm[3],
        m[0] * cm[4] + m[2] * cm[5] + m[4],
        m[1] * cm[4] + m[3] * cm[5] + m[5]
      ];
      walk(child, combined);
    }
  };

  walk(root, parseTransform(root.getAttribute('viewBox') ? root.getAttribute('transform') : root.getAttribute('transform')));
  if (!paths.length) throw new Error('SVG 中没有识别到任何可用轮廓（path/rect/circle/polygon 等）');
  return { paths, width, height };
}
