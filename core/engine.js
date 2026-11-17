// 针迹引擎：形状参数 -> 针迹块 -> 全局路由（无交叉连接、自动剪线跳针、换色）
// 纯计算、无 DOM 依赖，可直接在 Web Worker 中运行
import {
  F, DEFAULT_TRIM_GAP_MM, DEFAULT_JUMP_MM
} from './constants.js';
import {
  mm, toMM, dist, resampleByLength, offsetPolygon,
  nearestNeighborOrder, bbox, norm, sub, scale, add
} from './math.js';
import { sliceAlongAxis, scanlineRows, spineBars, pointInPolygon } from './geometry.js';

const MAX_STITCH_MM = 12.0;   // 单针最大跨度，超过则补针
const LOCK_LEN_MM = 0.8;      // 锁针短针长度

function rec(x, y, flag = F.NORMAL) { return { x: Math.round(x), y: Math.round(y), flag }; }

// 锁针：在当前点附近来回 2 短针
function lockStitches(pts, x, y) {
  const d = mm(LOCK_LEN_MM);
  pts.push(rec(x - d, y, F.LOCK));
  pts.push(rec(x, y, F.LOCK));
  pts.push(rec(x + d * 0.7, y, F.LOCK));
  pts.push(rec(x, y, F.LOCK));
}

// 把一根长横档拆成多针（针步 <= maxLen），长短针时在奇数档加错位短针
function fillBar(pts, a, b, maxLen, shortStitch, shortRatio, barIndex) {
  const d = dist(a, b);
  if (d <= maxLen) { pts.push(rec(b.x, b.y)); return; }
  const n = Math.ceil(d / maxLen);
  const useShort = shortStitch && barIndex % 2 === 1;
  for (let i = 1; i <= n; i++) {
    let t = i / n;
    if (useShort && i === n) t = Math.min(1, t * shortRatio + (1 - shortRatio) * 0.5);
    pts.push(rec(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
  }
}

// ---------- 平针 ----------
function genRun(shape) {
  const step = mm(shape.params.runLength || 2.5);
  const src = shape.closed && shape.points.length > 2
    ? [...shape.points, { ...shape.points[0] }]
    : shape.points;
  const pts = resampleByLength(src, step).map(p => rec(p.x, p.y));
  if (shape.params.lockStitch && pts.length > 4) {
    const head = [], tail = [];
    lockStitches(head, pts[0].x, pts[0].y);
    lockStitches(tail, pts[pts.length - 1].x, pts[pts.length - 1].y);
    return { stitches: [...head, ...pts, ...tail] };
  }
  return { stitches: pts };
}

// ---------- 包针（按轮廓骨架走线，宽窄处自动收口） ----------
function genSatin(shape) {
  const p = shape.params;
  const step = mm(Math.max(0.8, p.runLength || 2.5));
  const maxLen = mm(MAX_STITCH_MM);
  const pull = mm(p.pullComp || 0);
  const out = [];

  let bars;
  if (shape.closed && shape.points.length > 2) {
    const poly = pull ? offsetPolygon(shape.points, pull) : shape.points;
    bars = sliceAlongAxis(poly, step).rows.map(r => ({ a: r.a, b: r.b, mid: r.mid }));
  } else {
    const width = mm(p.width || 3);
    bars = spineBars(shape.points, step, () => width);
  }
  if (bars.length < 2) return { stitches: genRun(shape).stitches };

  // 底线：沿骨架中线先走一道疏针 + 横向固定
  if (p.underlay) {
    const inset = mm(p.underlayInset || 0.3);
    const center = resampleByLength(bars.map(b => b.mid), step * 2.5);
    if (center.length > 1) {
      out.push(rec(center[0].x, center[0].y, F.LOCK));
      for (let i = 1; i < center.length; i++) out.push(rec(center[i].x, center[i].y, F.LOCK));
      // 横向底线（缩短 inset），每隔几道放一根
      for (let i = 0; i < bars.length; i += 3) {
        const ba = add(bars[i].mid, scale(norm(sub(bars[i].a, bars[i].mid)), Math.max(0, dist(bars[i].mid, bars[i].a) - inset)));
        const bb = add(bars[i].mid, scale(norm(sub(bars[i].b, bars[i].mid)), Math.max(0, dist(bars[i].mid, bars[i].b) - inset)));
        out.push(rec(ba.x, ba.y, F.LOCK));
        out.push(rec(bb.x, bb.y, F.LOCK));
        out.push(rec(bars[i].mid.x, bars[i].mid.y, F.LOCK));
      }
    }
  }

  // 面线：横档左右交替，连接沿边缘走，避免针迹交叉
  out.push(rec(bars[0].a.x, bars[0].a.y));
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    if (i % 2 === 0) fillBar(out, bar.a, bar.b, maxLen, p.shortStitch, p.shortRatio, i);
    else fillBar(out, bar.b, bar.a, maxLen, p.shortStitch, p.shortRatio, i);
  }
  if (p.lockStitch) lockStitches(out, out[out.length - 1].x, out[out.length - 1].y);
  return { stitches: out };
}

// ---------- 榻榻米 ----------
function genTatami(shape) {
  const p = shape.params;
  if (!shape.closed || shape.points.length < 3) return { stitches: genRun(shape).stitches };
  const poly = p.pullComp ? offsetPolygon(shape.points, mm(p.pullComp)) : shape.points;
  const spacing = mm(Math.max(0.15, p.density || 0.4));
  const step = mm(Math.max(0.8, p.runLength || 2.5));
  const angle = (p.fillAngle ?? 45) * Math.PI / 180;
  const maxLen = mm(MAX_STITCH_MM);
  const out = [];

  // 底线：粗网格两道
  if (p.underlay) {
    const insetPoly = offsetPolygon(poly, -mm(p.underlayInset || 0.3));
    for (const a of [angle, angle + Math.PI / 2]) {
      const rows = scanlineRows(insetPoly, spacing * 5, a);
      rows.forEach((r, idx) => {
        const s = idx % 2 === 0 ? r.a : r.b, e = idx % 2 === 0 ? r.b : r.a;
        const run = resampleByLength([s, e], step * 3);
        run.forEach((q, i) => i === 0 && out.length === 0 ? out.push(rec(q.x, q.y, F.LOCK)) : out.push(rec(q.x, q.y, F.LOCK)));
      });
    }
  }

  // 面线扫描行，蛇形走线（相邻行方向相反，连接在边缘，不交叉）
  const rows = scanlineRows(poly, spacing, angle);
  rows.forEach((r, idx) => {
    const start = idx % 2 === 0 ? r.a : r.b;
    const end = idx % 2 === 0 ? r.b : r.a;
    if (out.length === 0) {
      out.push(rec(start.x, start.y));
    } else {
      const last = out[out.length - 1];
      // 边缘连接针（超出 maxLen 时补中间针）
      const d = dist(last, start);
      if (d > maxLen) {
        const n = Math.ceil(d / maxLen);
        for (let k = 1; k <= n; k++) {
          out.push(rec(last.x + (start.x - last.x) * k / n, last.y + (start.y - last.y) * k / n));
        }
      } else out.push(rec(start.x, start.y));
    }
    const run = resampleByLength([start, end], step);
    // 长短针：奇数行错位
    const offset = p.shortStitch && idx % 2 === 1 ? step * (p.shortRatio - 0.5) : 0;
    for (let k = 1; k < run.length; k++) {
      const q = run[k];
      out.push(rec(q.x + (k % 2 === 0 ? offset : 0), q.y, F.NORMAL));
    }
  });
  if (p.lockStitch && out.length > 4) lockStitches(out, out[out.length - 1].x, out[out.length - 1].y);
  return { stitches: out };
}

// ---------- 锯齿针 ----------
function genZigzag(shape) {
  const p = shape.params;
  const step = mm(Math.max(0.6, p.runLength || 2.5));
  const ampl = mm(Math.max(0.2, p.zigAmplitude || 1.2));
  const out = [];
  const spine = resampleByLength(shape.points, step);
  if (spine.length < 2) return { stitches: [] };
  out.push(rec(spine[0].x, spine[0].y));
  for (let i = 1; i < spine.length - 1; i++) {
    const t = norm(sub(spine[i + 1], spine[i - 1]));
    const n = { x: -t.y, y: t.x };
    const side = i % 2 === 0 ? 1 : -1;
    out.push(rec(spine[i].x + n.x * ampl * side, spine[i].y + n.y * ampl * side));
  }
  out.push(rec(spine[spine.length - 1].x, spine[spine.length - 1].y));
  if (p.lockStitch && out.length > 4) lockStitches(out, out[out.length - 1].x, out[out.length - 1].y);
  return { stitches: out };
}

const GENERATORS = {
  run: genRun, satin: genSatin, tatami: genTatami, zigzag: genZigzag
};

// 单个形状 -> 针迹块
export function buildBlock(shape) {
  if (!shape.visible) return null;
  if (!shape.points || shape.points.length < 2) return null;
  // DST 导入的原始针迹：原样保留，只更新首尾信息，仍参与全局路由/换色统计
  if (shape.type === 'rawStitch' && Array.isArray(shape.rawRecords)) {
    const stitches = shape.rawRecords
      .filter(s => Number.isFinite(s.x) && Number.isFinite(s.y))
      .map(s => rec(s.x, s.y, s.flag ?? F.NORMAL));
    if (stitches.length < 2) return null;
    return {
      id: shape.id + '_blk',
      shapeId: shape.id,
      colorId: shape.colorId,
      stitches,
      first: { ...stitches[0] },
      last: { ...stitches[stitches.length - 1] }
    };
  }
  const gen = GENERATORS[shape.type] || genRun;
  let result;
  try { result = gen(shape); } catch (e) { return null; }
  const stitches = result.stitches.filter(s => Number.isFinite(s.x) && Number.isFinite(s.y));
  if (stitches.length < 2) return null;
  return {
    id: shape.id + '_blk',
    shapeId: shape.id,
    colorId: shape.colorId,
    stitches,
    first: { ...stitches[0] },
    last: { ...stitches[stitches.length - 1] }
  };
}

// 2-opt 微调块顺序，消除交叉空跳
function twoOpt(order, blocks, getEnds) {
  if (order.length < 4) return order;
  const cost = (a, flipA, b, flipB) => {
    const ea = getEnds(blocks[a]); const eb = getEnds(blocks[b]);
    return dist(flipA ? ea[0] : ea[1], flipB ? eb[1] : eb[0]);
  };
  let improved = true, guard = 0;
  const flips = order.map(o => o.flip);
  const seq = order.map(o => o.index);
  while (improved && guard++ < 6) {
    improved = false;
    for (let i = 0; i < seq.length - 2; i++) {
      for (let j = i + 2; j < seq.length; j++) {
        const before = cost(seq[i], flips[i], seq[i + 1], flips[i + 1]) +
          (j + 1 < seq.length ? cost(seq[j], flips[j], seq[j + 1], flips[j + 1]) : 0);
        // 反转 i+1..j 并翻转其中每块方向
        const sub = seq.slice(i + 1, j + 1).reverse();
        const subF = flips.slice(i + 1, j + 1).reverse().map(f => !f);
        const oldSub = seq.slice(i + 1, j + 1), oldF = flips.slice(i + 1, j + 1);
        seq.splice(i + 1, sub.length, ...sub); flips.splice(i + 1, subF.length, ...subF);
        const after = cost(seq[i], flips[i], seq[i + 1], flips[i + 1]) +
          (j + 1 < seq.length ? cost(seq[j], flips[j], seq[j + 1], flips[j + 1]) : 0);
        if (after + 1e-6 < before) improved = true;
        else { seq.splice(i + 1, oldSub.length, ...oldSub); flips.splice(i + 1, oldF.length, ...oldF); }
      }
    }
  }
  return seq.map((index, i) => ({ index, flip: flips[i] }));
}

// 全局路由：按绣作顺序（颜色首次出现顺序）排，同色最近邻 + 2-opt，自动插剪线/跳针
export function routeDesign(blocks, shapes, trimGapMm = DEFAULT_TRIM_GAP_MM) {
  const colorOrder = [];
  for (const b of blocks) {
    if (!colorOrder.includes(b.colorId)) colorOrder.push(b.colorId);
  }
  const records = [];
  const routedBlocks = [];
  let cur = null, curColor = null;
  let trimCount = 0, jumpCount = 0, colorChanges = 0;

  const appendMove = (target, isColorChange) => {
    const gap = cur ? dist(cur, target) : 0;
    if (!cur) { records.push(rec(target.x, target.y, isColorChange ? F.COLOR : F.NORMAL)); cur = { ...target }; return; }
    if (gap < 0.5) return;
    const gapMm = toMM(gap);
    if (isColorChange || gapMm > trimGapMm) {
      records.push(rec(cur.x, cur.y, F.TRIM)); trimCount++;
      const maxJ = mm(DEFAULT_JUMP_MM);
      let remain = gap;
      const dir = norm(sub(target, cur));
      while (remain > maxJ) {
        cur = add(cur, scale(dir, maxJ));
        records.push(rec(cur.x, cur.y, F.JUMP)); jumpCount++;
        remain -= maxJ;
      }
      records.push(rec(target.x, target.y, F.JUMP)); jumpCount++;
    } else if (gapMm > MAX_STITCH_MM) {
      const maxJ = mm(MAX_STITCH_MM);
      const n = Math.ceil(gap / maxJ);
      for (let k = 1; k <= n; k++) {
        const pt = { x: cur.x + (target.x - cur.x) * k / n, y: cur.y + (target.y - cur.y) * k / n };
        records.push(rec(pt.x, pt.y, F.JUMP)); jumpCount++;
      }
    } else {
      records.push(rec(target.x, target.y, F.NORMAL));
    }
    cur = { ...target };
  };

  for (const colorId of colorOrder) {
    const group = blocks.filter(b => b.colorId === colorId);
    const getEnds = (b) => [b.first, b.last];
    let order = nearestNeighborOrder(group, cur, getEnds);
    order = twoOpt(order, group, getEnds);
    for (const { index, flip } of order) {
      const block = group[index];
      const change = curColor !== null && curColor !== colorId;
      if (change) { colorChanges++; appendMove(flip ? block.last : block.first, true); }
      else appendMove(flip ? block.last : block.first, false);
      const list = flip ? [...block.stitches].reverse() : block.stitches;
      const startIdx = records.length;
      for (const s of list) records.push(rec(s.x, s.y, s.flag));
      cur = flip ? { ...block.first } : { ...block.last };
      routedBlocks.push({
        ...block,
        flipped: flip,
        recordStart: startIdx,
        recordEnd: records.length
      });
      curColor = colorId;
    }
  }
  if (records.length) {
    const last = records[records.length - 1];
    records.push(rec(last.x, last.y, F.END));
  }
  return { records, routedBlocks, colorOrder, routeStats: { trimCount, jumpCount, colorChanges } };
}

// 完整工程 -> 针迹结果（worker 与主线程共用）
export function buildDesign(project) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const shapes = (project.shapes || []).filter(s => s.visible !== false);
  const blocks = shapes.map(buildBlock).filter(Boolean);
  const trimGap = project.settings?.trimGap ?? DEFAULT_TRIM_GAP_MM;
  const routed = routeDesign(blocks, shapes, trimGap);
  const stats = computeStats(routed.records, routed.routeStats, project.settings);
  stats.computeMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
  return {
    records: routed.records,
    blocks: routed.routedBlocks,
    colorOrder: routed.colorOrder,
    stats,
    shapeCount: shapes.length
  };
}

export function computeStats(records, routeStats, settings) {
  let normal = 0, lengthMm = 0, prev = null;
  for (const r of records) {
    const isSew = (r.flag === F.NORMAL || r.flag === F.LOCK);
    if (isSew) {
      normal++;
      if (prev) lengthMm += toMM(dist(prev, r));
      prev = r;
    } else {
      // 跳针/剪线/换色/结束：不累计用线，断开连续针迹
      prev = null;
    }
  }
  const speed = settings?.machineSpeed || 700; // 针/分钟
  const trimSec = (routeStats.trimCount || 0) * 3;
  const colorSec = (routeStats.colorChanges || 0) * 6;
  const sewSec = normal / speed * 60;
  const totalSec = Math.round(sewSec + trimSec + colorSec);
  return {
    stitchCount: normal,
    jumpCount: routeStats.jumpCount || 0,
    trimCount: routeStats.trimCount || 0,
    colorChanges: routeStats.colorChanges || 0,
    threadLengthMm: Math.round(lengthMm),
    estimatedSeconds: totalSec,
    estimatedText: formatDuration(totalSec)
  };
}

export function formatDuration(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + '时' : '') + (m || h ? m + '分' : '') + s + '秒';
}

export { pointInPolygon, bbox };
