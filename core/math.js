// 2D 几何数学库，全部使用普通 {x,y} 点对象
import { MM } from './constants.js';

export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
export const dist2 = (a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  return dx * dx + dy * dy;
};
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s });
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const len = (a) => Math.hypot(a.x, a.y);
export const norm = (a) => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};
export const perp = (a) => ({ x: -a.y, y: a.x });
export const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// 折线总长
export function polylineLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  return L;
}

// 按弧长在折线上取点（d 为沿折线距离），返回点与所在段切线
export function pointAtDistance(pts, d) {
  if (pts.length === 1) return { point: { ...pts[0] }, tangent: { x: 1, y: 0 } };
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const segLen = dist(pts[i - 1], pts[i]);
    if (acc + segLen >= d || i === pts.length - 1) {
      const t = segLen === 0 ? 0 : Math.min(1, (d - acc) / segLen);
      return {
        point: lerp(pts[i - 1], pts[i], t),
        tangent: segLen === 0 ? { x: 1, y: 0 } : norm(sub(pts[i], pts[i - 1]))
      };
    }
    acc += segLen;
  }
  const n = pts.length;
  return {
    point: { ...pts[n - 1] },
    tangent: norm(sub(pts[n - 1], pts[n - 2]))
  };
}

// 对折线按固定步长重采样（包含起点终点）
export function resampleByLength(pts, step) {
  if (pts.length < 2 || step <= 0) return pts.map(p => ({ ...p }));
  const total = polylineLength(pts);
  const out = [{ ...pts[0] }];
  const n = Math.max(1, Math.floor(total / step));
  for (let i = 1; i <= n; i++) {
    const d = Math.min(total, i * step);
    out.push(pointAtDistance(pts, d).point);
  }
  if (dist(out[out.length - 1], pts[pts.length - 1]) > 0.5) {
    out.push({ ...pts[pts.length - 1] });
  }
  return out;
}

// 多边形面积（带符号）
export function polygonArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return a / 2;
}

export const polygonCentroid = (pts) => {
  let x = 0, y = 0;
  pts.forEach(p => { x += p.x; y += p.y; });
  return { x: x / pts.length, y: y / pts.length };
};

export const bbox = (pts) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
};

// 点在多边形内（射线法），边界算在内
export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > p.y) !== (yj > p.y)) &&
      (p.x < (xj - xi) * (p.y - yi) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// 线段相交（不含共线），返回交点或 null
export function segmentIntersect(p1, p2, p3, p4) {
  const d1 = cross(sub(p4, p3), sub(p1, p3));
  const d2 = cross(sub(p4, p3), sub(p2, p3));
  const d3 = cross(sub(p2, p1), sub(p3, p1));
  const d4 = cross(sub(p2, p1), sub(p4, p1));
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    const t = d3 / (d3 - d4);
    return lerp(p1, p2, t);
  }
  return null;
}

// 两线段距离（用于连接排序的代价评估）
export function segmentSegDistance(a1, a2, b1, b2) {
  if (segmentIntersect(a1, a2, b1, b2)) return 0;
  return Math.min(dist(a2, b1), dist(a2, b2), dist(a1, b1), dist(a1, b2));
}

// 多边形等距偏移（正=外扩/收缩补偿，负=内缩）。简单顶点法线法，适合平滑花稿
export function offsetPolygon(poly, amount) {
  if (Math.abs(amount) < 1e-9) return poly.map(p => ({ ...p }));
  const c = polygonCentroid(poly);
  const n = poly.length;
  return poly.map((p, i) => {
    const prev = poly[(i - 1 + n) % n];
    const next = (i + 1) % n;
    const t = norm(sub(poly[next], prev));
    const normal = perp(t);
    // 让法线朝外
    const outward = dot(normal, sub(p, c)) >= 0 ? normal : scale(normal, -1);
    return add(p, scale(outward, amount));
  });
}

// 开放折线两侧偏移（用于底线路径）
export function offsetPolyline(pts, amount) {
  const n = pts.length;
  return pts.map((p, i) => {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    const t = norm(sub(next, prev));
    return add(p, scale(perp(t), amount));
  });
}

// 求线段与多边形所有交点，按沿线段参数 t 排序
export function segmentPolygonIntersections(a, b, poly) {
  const hits = [];
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    const hit = segmentIntersect(a, b, poly[i], poly[j]);
    if (hit) hits.push(hit);
  }
  hits.sort((p, q) => dist2(a, p) - dist2(a, q));
  return hits;
}

// 最近邻贪心排序（同色块最短路径连接），返回新顺序索引数组
export function nearestNeighborOrder(items, startPoint, getEnds) {
  const used = new Array(items.length).fill(false);
  const order = [];
  let cur = startPoint || null;
  for (let k = 0; k < items.length; k++) {
    let best = -1, bestCost = Infinity, bestFlip = false;
    for (let i = 0; i < items.length; i++) {
      if (used[i]) continue;
      const [s, e] = getEnds(items[i]);
      if (!cur) { best = i; bestCost = 0; bestFlip = false; break; }
      const c1 = dist(cur, s), c2 = dist(cur, e);
      if (c1 < bestCost) { bestCost = c1; best = i; bestFlip = false; }
      if (c2 < bestCost) { bestCost = c2; best = i; bestFlip = true; }
    }
    used[best] = true;
    order.push({ index: best, flip: bestFlip });
    const [s, e] = getEnds(items[best]);
    cur = bestFlip ? s : e;
  }
  return order;
}

export const mm = (v) => v * MM;
export const toMM = (v) => v / MM;

// 角度差归一化到 [-PI, PI]
export function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
