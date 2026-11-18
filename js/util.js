'use strict';
/* 通用工具与几何函数（浏览器全局 U） */
const U = {
  uid() { return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); },
  clamp(v, a, b) { return v < a ? a : v > b ? b : v; },
  lerp(a, b, t) { return a + (b - a) * t; },
  dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); },
  debounce(fn, ms) { let t = 0; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; },
  fmtInt(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); },
  fmt1(n) { return (Math.round(n * 10) / 10).toString(); },
  escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },

  /* 折线等距重采样，返回 [[x,y],...]，步长 step(mm)，closed 表示闭合 */
  resample(pts, step, closed) {
    if (!pts || pts.length < 2) return (pts || []).slice();
    const out = [[pts[0][0], pts[0][1]]];
    const n = pts.length, segs = closed ? n : n - 1;
    let carry = 0;
    for (let i = 0; i < segs; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-9) continue;
      let d = step - carry;
      while (d <= L) {
        const t = d / L;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        d += step;
      }
      carry = L - (d - step);
    }
    if (!closed && out.length && pts.length) {
      const last = pts[pts.length - 1];
      const o = out[out.length - 1];
      if (Math.hypot(last[0] - o[0], last[1] - o[1]) > step * 0.5) out.push([last[0], last[1]]);
    }
    return out;
  },

  polyLength(pts, closed) {
    let L = 0; const n = pts.length, segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) { const a = pts[i], b = pts[(i + 1) % n]; L += Math.hypot(b[0] - a[0], b[1] - a[1]); }
    return L;
  },

  boundsOf(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[0] > x1) x1 = p[0]; if (p[1] > y1) y1 = p[1]; }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  },

  pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  },

  /* 水平扫描线与多边形交点（已排序） */
  scanline(poly, y) {
    const xs = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const x1 = poly[j][0], y1 = poly[j][1], x2 = poly[i][0], y2 = poly[i][1];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + (y - y1) / (y2 - y1) * (x2 - x1));
    }
    xs.sort((a, b) => a - b);
    return xs;
  },

  hexToRgb(hex) {
    const h = hex.replace('#', '');
    const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
  },
  rgbToHex(r, g, b) {
    const c = v => U.clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
    return '#' + c(r) + c(g) + c(b);
  },
  /* 亮度缩放 f: 0~2 */
  shadeHex(hex, f) {
    const [r, g, b] = U.hexToRgb(hex);
    return U.rgbToHex(r * f, g * f, b * f);
  },
  nearestThread(hex, palette) {
    const [r, g, b] = U.hexToRgb(hex);
    let best = palette[0], bd = Infinity;
    for (const t of palette) {
      const [r2, g2, b2] = U.hexToRgb(t.hex);
      const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  },

  /* 各针法默认参数 */
  defaultParams(type) {
    switch (type) {
      case 'fill':    return { spacing: 0.45, stitchLength: 3.2, angle: 45, pullComp: 0.15, underlay: true, offsetPattern: 3 };
      case 'zigzag':  return { spacing: 0.9, stitchLength: 1.4, angle: 0, pullComp: 0.1, underlay: false, offsetPattern: 2 };
      case 'satin':   return { spacing: 0.4, stitchLength: 2.0, pullComp: 0.2, underlay: true };
      case 'running': return { stitchLength: 2.5 };
      default:        return { stitchLength: 2.5 };
    }
  },
  defaultSettings() {
    return {
      trimThreshold: 4,     // 空跳超过该值(mm)自动插剪线
      grid: 5, snap: true,
      speed: 750,           // 机型转速 针/分
      fabric: '#f2ead8', hoop: '130x180',
      tilt: 25, sheen: true, showJumps: false, threadWidth: 0.4,
    };
  },

  download(name, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  },

  readFile(file, asText) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(new Error('文件读取失败'));
      if (asText) r.readAsText(file); else r.readAsArrayBuffer(file);
    });
  },
};
