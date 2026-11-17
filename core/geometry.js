// 形状 -> 轮廓/骨架/扫描线。所有坐标为内部单位(0.1mm)
import {
  bbox, norm, sub, add, scale, perp, dot, dist, lerp,
  pointInPolygon, segmentPolygonIntersections, polygonCentroid, polylineLength
} from './math.js';

// 任意形状统一取轮廓点（编辑器里 rect/ellipse 创建时已离散为 points）
export function shapeOutline(shape) {
  return {
    points: shape.points.map(p => ({ ...p })),
    closed: !!shape.closed
  };
}

// PCA 主方向：返回单位主轴 u 与其垂直轴 v
export function principalAxis(poly) {
  const c = polygonCentroid(poly);
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of poly) {
    const dx = p.x - c.x, dy = p.y - c.y;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  // 主成分方向
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const u = { x: Math.cos(theta), y: Math.sin(theta) };
  return { u, v: perp(u), center: c };
}

// 沿主轴切片：每片给出与多边形的弦（中点+宽度），这就是包针的骨架与宽度来源
// 宽度自然随轮廓收缩 -> 宽窄变化处自动收口
export function sliceAlongAxis(poly, step) {
  const { u, v, center } = principalAxis(poly);
  const box = bbox(poly);
  const proj = poly.map(p => dot(sub(p, center), u));
  const minT = Math.min(...proj), maxT = Math.max(...proj);
  const rows = [];
  for (let t = minT + step * 0.5; t <= maxT; t += step) {
    const base = add(center, scale(u, t));
    const a = sub(base, scale(v, box.h + box.w));
    const b = add(base, scale(v, box.h + box.w));
    const hits = segmentPolygonIntersections(a, b, poly);
    if (hits.length >= 2) {
      // 成对取交点，选最长弦作为该片
      let best = null;
      for (let k = 0; k + 1 < hits.length; k += 2) {
        const w = dist(hits[k], hits[k + 1]);
        if (!best || w > best.width) best = { a: hits[k], b: hits[k + 1], width: w };
      }
      if (best) {
        rows.push({
          mid: mid(best.a, best.b),
          a: best.a, b: best.b,
          width: best.width,
          dir: norm(sub(best.b, best.a))
        });
      }
    }
  }
  return { rows, u, v };
}

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// 通用扫描线填充：沿 dir 方向按 spacing 走线，返回裁剪后的行线段（含错位量）
export function scanlineRows(poly, spacing, dirAngle) {
  const dir = { x: Math.cos(dirAngle), y: Math.sin(dirAngle) };
  const nd = perp(dir);
  const box = bbox(poly);
  const c = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  const radius = Math.hypot(box.w, box.h) / 2 + spacing;
  const rows = [];
  for (let off = -radius; off <= radius; off += spacing) {
    const base = add(c, scale(nd, off));
    const a = sub(base, scale(dir, radius * 1.5));
    const b = add(base, scale(dir, radius * 1.5));
    const hits = segmentPolygonIntersections(a, b, poly);
    for (let k = 0; k + 1 < hits.length; k += 2) {
      rows.push({ a: hits[k], b: hits[k + 1], offset: off });
    }
  }
  return rows;
}

// 开放折线的等距切片（沿曲线每 step 取一条法线横档），用于细条花稿的包针
export function spineBars(pts, step, widthFn) {
  const total = polylineLength(pts);
  const bars = [];
  for (let d = 0; d <= total; d += step) {
    const { point, tangent } = arcPoint(pts, d);
    const n = perp(tangent);
    const w = widthFn(d / total, d);
    bars.push({
      mid: point,
      a: sub(point, scale(n, w / 2)),
      b: add(point, scale(n, w / 2)),
      width: w,
      dir: n
    });
  }
  return bars;
}

// 折线上按弧长取点（返回切线）
export function arcPoint(pts, d) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1], pts[i]);
    if (acc + seg >= d || i === pts.length - 1) {
      const t = seg === 0 ? 0 : Math.min(1, (d - acc) / seg);
      return {
        point: lerp(pts[i - 1], pts[i], t),
        tangent: seg === 0 ? { x: 1, y: 0 } : norm(sub(pts[i], pts[i - 1]))
      };
    }
    acc += seg;
  }
  const n = pts.length;
  return { point: { ...pts[n - 1] }, tangent: norm(sub(pts[n - 1], pts[n - 2])) };
}

// 点到多边形边界最短距离
export function distanceToBoundary(p, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    best = Math.min(best, pointSegmentDist(p, poly[i], poly[j]));
  }
  return best;
}

export function pointSegmentDist(p, a, b) {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return dist(p, add(a, scale(ab, t)));
}

export { pointInPolygon };
