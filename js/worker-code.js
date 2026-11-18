'use strict';
/* 针迹计算 Worker 主体：以函数形式定义，主线程用 toString()+Blob 创建 Worker，
   这样 file:// 直接打开也能跑。必须完全自包含，不能引用外部变量。 */
function stitchWorkerMain() {
  'use strict';

  /* ---------- 基础几何 ---------- */
  function resample(pts, step, closed) {
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
    return out;
  }
  function boundsOf(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[0] > x1) x1 = p[0]; if (p[1] > y1) y1 = p[1]; }
    return { x0, y0, x1, y1 };
  }
  function scanline(poly, y) {
    const xs = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const x1 = poly[j][0], y1 = poly[j][1], x2 = poly[i][0], y2 = poly[i][1];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + (y - y1) / (y2 - y1) * (x2 - x1));
    }
    xs.sort((a, b) => a - b);
    return xs;
  }
  function rotPts(pts, cx, cy, cos, sin) {
    return pts.map(p => {
      const dx = p[0] - cx, dy = p[1] - cy;
      return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
    });
  }
  /* 闭合轮廓起点旋转到离 (x,y) 最近的点，减少空跳 */
  function rotateStart(pts, x, y) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = (pts[i][0] - x) ** 2 + (pts[i][1] - y) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    return pts.slice(bi).concat(pts.slice(0, bi));
  }
  /* 区间相减：segs=[[a,b]..] 减去 holes=[[a,b]..]（均按 a 排序） */
  function subtractSegs(segs, holes) {
    let cur = segs;
    for (const h of holes) {
      const next = [];
      for (const s of cur) {
        if (h[1] <= s[0] || h[0] >= s[1]) { next.push(s); continue; }
        if (h[0] > s[0]) next.push([s[0], h[0]]);
        if (h[1] < s[1]) next.push([h[1], s[1]]);
      }
      cur = next;
    }
    return cur;
  }

  /* ---------- 针迹发射器 ---------- */
  const F_STITCH = 0, F_JUMP = 1, F_TRIM = 2;
  function Emitter(x, y) {
    this.xy = []; this.flags = [];
    this.x = x || 0; this.y = y || 0;
    this.stitches = 0; this.jumps = 0; this.trims = 0;
    this.len = 0; // 用线长度 mm（含跳针）
  }
  Emitter.prototype.stitch = function (x, y) {
    this.len += Math.hypot(x - this.x, y - this.y);
    this.x = x; this.y = y;
    this.xy.push(x, y); this.flags.push(F_STITCH); this.stitches++;
  };
  Emitter.prototype.jump = function (x, y) {
    this.len += Math.hypot(x - this.x, y - this.y);
    this.x = x; this.y = y;
    this.xy.push(x, y); this.flags.push(F_JUMP); this.jumps++;
  };
  Emitter.prototype.trim = function () {
    this.xy.push(this.x, this.y); this.flags.push(F_TRIM); this.trims++;
  };

  /* ---------- 各针法 ---------- */
  function genRunning(shape, em) {
    const pts = resample(shape.points, shape.params.stitchLength || 2.5, !!shape.closed);
    for (const p of pts) em.stitch(p[0], p[1]);
  }

  /* 榻榻米：旋转后按行扫描，错针排列，行内多段之间跳空 */
  function genTatami(shape, em) {
    const p = shape.params;
    const spacing = Math.max(0.2, p.spacing || 0.45);
    const stLen = Math.max(0.8, p.stitchLength || 3.2);
    const pc = p.pullComp || 0;
    const pat = p.offsetPattern || 3;
    const ang = (p.angle || 0) * Math.PI / 180;
    const b = boundsOf(shape.points);
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const cos = Math.cos(-ang), sin = Math.sin(-ang);
    const outer = rotPts(shape.points, cx, cy, cos, sin);
    const holes = (shape.holes || []).map(h => rotPts(h, cx, cy, cos, sin));
    const rb = boundsOf(outer);
    const icos = Math.cos(ang), isin = Math.sin(ang);
    const back = (x, y) => {
      const dx = x - cx, dy = y - cy;
      return [cx + dx * icos - dy * isin, cy + dx * isin + dy * icos];
    };
    // 底线：沿轮廓走一圈平针
    if (p.underlay) {
      const up = resample(shape.points, 2.2, true);
      if (up.length) { em.jump(up[0][0], up[0][1]); for (const q of up) em.stitch(q[0], q[1]); }
    }
    let rowIdx = 0, dir = 1;
    let first = true;
    for (let y = rb.y0 + spacing / 2; y <= rb.y1; y += spacing, rowIdx++, dir = -dir) {
      const xs = scanline(outer, y);
      let segs = [];
      for (let i = 0; i + 1 < xs.length; i += 2) segs.push([xs[i] - pc, xs[i + 1] + pc]);
      for (const h of holes) {
        const hx = scanline(h, y), hs = [];
        for (let i = 0; i + 1 < hx.length; i += 2) hs.push([hx[i], hx[i + 1]]);
        segs = subtractSegs(segs, hs);
      }
      if (dir < 0) segs.reverse();
      const off = (rowIdx % pat) * stLen / pat;
      for (const s of segs) {
        if (s[1] - s[0] < 0.3) continue;
        const xa = dir > 0 ? s[0] : s[1], xb = dir > 0 ? s[1] : s[0];
        const start = back(xa + dir * off, y);
        // 段间：距离短直接走针，长则跳空，避免乱穿
        const gap = Math.hypot(start[0] - em.x, start[1] - em.y);
        if (first) { em.jump(start[0], start[1]); first = false; }
        else if (gap > 2.5) em.jump(start[0], start[1]);
        else em.stitch(start[0], start[1]);
        const L = Math.abs(xb - xa) - off;
        const n = Math.max(1, Math.round(L / stLen));
        for (let i = 1; i <= n; i++) {
          const q = back(xa + dir * (off + L * i / n), y);
          em.stitch(q[0], q[1]);
        }
      }
    }
  }

  /* 锯齿针：行内上下交替 */
  function genZigzag(shape, em) {
    const p = shape.params;
    const spacing = Math.max(0.3, p.spacing || 0.9);
    const stLen = Math.max(0.5, p.stitchLength || 1.4);
    const ang = (p.angle || 0) * Math.PI / 180;
    const b = boundsOf(shape.points);
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const cos = Math.cos(-ang), sin = Math.sin(-ang);
    const outer = rotPts(shape.points, cx, cy, cos, sin);
    const rb = boundsOf(outer);
    const icos = Math.cos(ang), isin = Math.sin(ang);
    const back = (x, y) => {
      const dx = x - cx, dy = y - cy;
      return [cx + dx * icos - dy * isin, cy + dx * isin + dy * icos];
    };
    const amp = spacing / 2;
    let first = true, rowIdx = 0;
    for (let y = rb.y0 + amp; y <= rb.y1; y += spacing, rowIdx++) {
      const xs = scanline(outer, y);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const x0 = xs[i], x1 = xs[i + 1];
        if (x1 - x0 < 0.5) continue;
        const n = Math.max(1, Math.round((x1 - x0) / stLen));
        const rev = rowIdx % 2 === 1;
        for (let k = 0; k <= n; k++) {
          const t = rev ? 1 - k / n : k / n;
          const yy = y + ((k % 2 === 0) ? -amp : amp);
          const q = back(x0 + (x1 - x0) * t, yy);
          if (first) { em.jump(q[0], q[1]); first = false; }
          else em.stitch(q[0], q[1]);
        }
      }
    }
  }

  /* 包针：沿中心线骨架，按各点宽度向两侧法线方向出针，宽窄自动收口 */
  function genSatin(shape, em) {
    const p = shape.params;
    const spacing = Math.max(0.2, p.spacing || 0.4);
    const pc = p.pullComp || 0;
    const pts = shape.points, closed = !!shape.closed;
    const widths = shape.widths && shape.widths.length === pts.length ? shape.widths : null;
    const wConst = shape.width || 3;
    // 先按半密度重采样中心线，保证宽窄过渡平滑
    const dense = resample(pts, spacing / 2, closed);
    if (dense.length < 2) return;
    const widthAt = (i) => {
      if (!widths) return wConst;
      const t = closed ? i / dense.length : i / (dense.length - 1);
      const fi = t * (closed ? widths.length : widths.length - 1);
      const i0 = Math.floor(fi) % widths.length, i1 = (i0 + 1) % widths.length;
      const f = fi - Math.floor(fi);
      return widths[i0] * (1 - f) + widths[i1] * f;
    };
    // 法线
    const normals = [];
    for (let i = 0; i < dense.length; i++) {
      const a = dense[(i - 1 + dense.length) % dense.length];
      const b2 = dense[(i + 1) % dense.length];
      let tx = b2[0] - a[0], ty = b2[1] - a[1];
      const L = Math.hypot(tx, ty) || 1;
      normals.push([-ty / L, tx / L]);
    }
    // 底线：中心平针 + 稀疏锯齿
    if (p.underlay) {
      const uw = resample(pts, p.stitchLength || 2, closed);
      if (uw.length) { em.jump(uw[0][0], uw[0][1]); for (const q of uw) em.stitch(q[0], q[1]); }
      const zs = Math.max(1, Math.round(1.6 / spacing));
      for (let i = 0; i < dense.length; i += zs) {
        const half = Math.max(0.3, widthAt(i) / 2 - 0.4) * 0.6;
        const sgn = (i / zs) % 2 === 0 ? 1 : -1;
        em.stitch(dense[i][0] + normals[i][0] * half * sgn, dense[i][1] + normals[i][1] * half * sgn);
      }
    }
    // 主针迹：隔点取（dense 是半密度），左右交替，相邻同侧衔接
    let first = true;
    let idx = 0;
    for (let i = 0; i < dense.length; i += 2, idx++) {
      const half = widthAt(i) / 2 + pc;
      if (half < 0.15) continue;
      const nx = normals[i][0], ny = normals[i][1];
      const lx = dense[i][0] + nx * half, ly = dense[i][1] + ny * half;
      const rx = dense[i][0] - nx * half, ry = dense[i][1] - ny * half;
      const put = (x, y) => {
        if (first) { em.jump(x, y); first = false; }
        else {
          const d = Math.hypot(x - em.x, y - em.y);
          if (d > 12.1) { // 超长针拆针，防断线
            const steps = Math.ceil(d / 12);
            for (let s = 1; s <= steps; s++) em.stitch(em.x + (x - em.x) * s / steps, em.y + (y - em.y) * s / steps);
          } else em.stitch(x, y);
        }
      };
      if (idx % 2 === 0) { put(lx, ly); put(rx, ry); }
      else { put(rx, ry); put(lx, ly); }
    }
  }

  /* DST 导回的成品针迹：原样输出 */
  function genRaw(shape, em) {
    for (const s of shape.stitches) {
      if (s.f === F_JUMP) em.jump(s.x, s.y);
      else if (s.f === F_TRIM) em.trim();
      else em.stitch(s.x, s.y);
    }
  }

  function genShape(shape, em) {
    switch (shape.type) {
      case 'fill': genTatami(shape, em); break;
      case 'zigzag': genZigzag(shape, em); break;
      case 'satin': genSatin(shape, em); break;
      case 'running': genRunning(shape, em); break;
      case 'raw': genRaw(shape, em); break;
    }
  }

  function shapeEntry(shape) {
    if (shape.type === 'raw' && shape.stitches.length) return [shape.stitches[0].x, shape.stitches[0].y];
    return shape.points[0] || [0, 0];
  }

  /* ---------- 主流程：按色块顺序、块内最近邻排序、超距插剪线 ---------- */
  function computeDesign(design) {
    const byId = {};
    for (const s of design.shapes) byId[s.id] = s;
    const trimTh = (design.settings && design.settings.trimThreshold) || 4;
    const blocks = [];
    const transfers = [];
    let curX = 0, curY = 0;
    let totSt = 0, totLen = 0, totTrims = 0, totJumps = 0;

    for (const item of design.sequence) {
      if (item.kind === 'trim') {
        const last = blocks[blocks.length - 1];
        if (last) {
          // 在上一色块末尾补剪线标记
          const xy = last.xy, fl = last.flags;
          const nxy = new Float32Array(xy.length + 2), nfl = new Uint8Array(fl.length + 1);
          nxy.set(xy); nfl.set(fl);
          nxy[xy.length] = nxy[xy.length - 2]; nxy[xy.length + 1] = nxy[xy.length - 1];
          nfl[fl.length] = F_TRIM;
          last.xy = nxy; last.flags = nfl; last.trims++;
          totTrims++;
        }
        continue;
      }
      if (item.kind !== 'block') continue;
      const shapes = item.shapeIds.map(id => byId[id]).filter(s => s && !(s.type === 'raw' && !s.stitches.length));
      if (!shapes.length) continue;

      // 最近邻排序：同色块按最短路径走，减少空跳和交叉
      const remaining = shapes.slice();
      const ordered = [];
      let px = curX, py = curY;
      while (remaining.length) {
        let bi = 0, bd = Infinity;
        for (let i = 0; i < remaining.length; i++) {
          const e = shapeEntry(remaining[i]);
          const d = (e[0] - px) ** 2 + (e[1] - py) ** 2;
          if (d < bd) { bd = d; bi = i; }
        }
        const s = remaining.splice(bi, 1)[0];
        ordered.push(s);
        const b = boundsOf(s.points);
        px = (b.x0 + b.x1) / 2; py = (b.y0 + b.y1) / 2;
      }

      const em = new Emitter(curX, curY);
      for (const s of ordered) {
        // 闭合轮廓起点对齐到最近点
        if (s.closed && s.type !== 'raw' && s.points.length > 2) s.points = rotateStart(s.points, em.x, em.y);
        const e = shapeEntry(s);
        const d = Math.hypot(e[0] - em.x, e[1] - em.y);
        if (d > 0.01) {
          // 块内第一针前不插剪线（没有可剪的线）
          if (d > trimTh && em.stitches > 0) { em.trim(); em.jump(e[0], e[1]); }
          else em.jump(e[0], e[1]);
        }
        genShape(s, em);
      }
      curX = em.x; curY = em.y;
      const xy = new Float32Array(em.xy), flags = new Uint8Array(em.flags);
      transfers.push(xy.buffer, flags.buffer);
      blocks.push({
        blockId: item.id, threadId: item.threadId,
        xy, flags,
        stitches: em.stitches, jumps: em.jumps, trims: em.trims,
        length: em.len,
      });
      totSt += em.stitches; totLen += em.len; totTrims += em.trims; totJumps += em.jumps;
    }

    // 整体尺寸
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of blocks) {
      for (let i = 0; i < b.xy.length; i += 2) {
        if (b.xy[i] < x0) x0 = b.xy[i];
        if (b.xy[i] > x1) x1 = b.xy[i];
        if (b.xy[i + 1] < y0) y0 = b.xy[i + 1];
        if (b.xy[i + 1] > y1) y1 = b.xy[i + 1];
      }
    }
    if (!blocks.length) { x0 = y0 = x1 = y1 = 0; }
    const colorChanges = Math.max(0, blocks.length - 1);
    const speed = (design.settings && design.settings.speed) || 750;
    const timeSec = totSt / speed * 60 + colorChanges * 20 + totTrims * 6;

    return {
      result: {
        blocks,
        stats: {
          stitches: totSt, lengthMm: Math.round(totLen), jumps: totJumps, trims: totTrims,
          colorChanges, timeMin: Math.round(timeSec / 60 * 10) / 10,
          w: Math.round((x1 - x0) * 10) / 10, h: Math.round((y1 - y0) * 10) / 10,
          x0: Math.round(x0 * 10) / 10, y0: Math.round(y0 * 10) / 10,
        },
      },
      transfers,
    };
  }

  self.onmessage = function (e) {
    try {
      const t0 = Date.now();
      const out = computeDesign(e.data.design);
      out.result.stats.computeMs = Date.now() - t0;
      self.postMessage(Object.assign({ ok: true, seq: e.data.seq }, out.result), out.transfers);
    } catch (err) {
      self.postMessage({ ok: false, seq: e.data.seq, error: String((err && err.stack) || err) });
    }
  };
}
