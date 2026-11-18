'use strict';
/* SVG 线稿导入：解析 → 采样轮廓 → 自动识别填充/描边 → 生成花型。
   填充区域 → 榻榻米；描边线 → 包针(粗)或平针(细)；颜色就近匹配 Madeira 色卡。 */
const SvgImport = (() => {

  function fail(msg) { throw new Error('SVG 导入失败：' + msg); }

  function parseSvg(text) {
    let doc;
    try { doc = new DOMParser().parseFromString(text, 'image/svg+xml'); }
    catch (e) { fail('文件无法解析（' + e.message + '）'); }
    if (!doc || doc.querySelector('parsererror')) fail('XML 格式错误，请检查文件是否完整');
    const svg = doc.querySelector('svg');
    if (!svg) fail('找不到 <svg> 根元素');
    return svg;
  }

  /* 把解析出的 svg 挂到隐藏节点上，才能用 getCTM / getPointAtLength */
  function mountHidden(svgNode) {
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-99999px;top:0;width:1px;height:0;overflow:hidden;';
    const imported = document.importNode(svgNode, true);
    host.appendChild(imported);
    document.body.appendChild(host);
    return { root: imported, dispose: () => host.remove() };
  }

  function getScale(svg) {
    let w = parseFloat(svg.getAttribute('width'));
    let h = parseFloat(svg.getAttribute('height'));
    const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if ((!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) && vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
      w = vb[2]; h = vb[3];
    }
    if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) fail('无法确定画布尺寸（缺少 width/height/viewBox）');
    // 缩放到最长边 120mm
    return { scale: 120 / Math.max(w, h), w, h };
  }

  /* 采样一条几何元素为若干子路径（[[x,y]..]..），已应用变换与缩放 */
  function sampleEl(el, scale) {
    let total;
    try { total = el.getTotalLength(); } catch (e) { return []; }
    if (!isFinite(total) || total <= 0) return [];
    const ctm = el.getCTM ? el.getCTM() : null;
    const step = Math.max(total / 600, 0.5 / scale); // 约 0.5mm 采样
    const n = Math.max(2, Math.ceil(total / step));
    const paths = [];
    let cur = [];
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const pt = el.getPointAtLength(total * i / n);
      let x = pt.x, y = pt.y;
      if (ctm) {
        const X = ctm.a * x + ctm.c * y + ctm.e;
        const Y = ctm.b * x + ctm.d * y + ctm.f;
        x = X; y = Y;
      }
      x *= scale; y *= scale;
      // 子路径跳转检测（M 移动）
      if (prev && Math.hypot(x - prev[0], y - prev[1]) > step * scale * 4) {
        if (cur.length > 1) paths.push(cur);
        cur = [];
      }
      cur.push([x, y]);
      prev = [x, y];
    }
    if (cur.length > 1) paths.push(cur);
    return paths;
  }

  function isClosed(pts, tol) {
    const a = pts[0], b = pts[pts.length - 1];
    return Math.hypot(a[0] - b[0], a[1] - b[1]) < (tol || 1.5);
  }

  function colorOf(el, attr, inherited) {
    let v = el.getAttribute(attr);
    const st = el.getAttribute('style');
    if (st) {
      const m = st.match(new RegExp(attr + '\\s*:\\s*([^;]+)'));
      if (m) v = m[1].trim();
    }
    if (v == null || v === '') v = inherited;
    if (v == null) return null;
    v = String(v).trim();
    if (v === 'none' || v === 'transparent') return null;
    if (v === 'currentColor') return '#000000';
    const m = v.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(',').map(s => parseFloat(s));
      return U.rgbToHex(p[0], p[1], p[2]);
    }
    if (/^#[0-9a-fA-F]{3,6}$/.test(v)) return v.length === 4 ? '#' + v.slice(1).split('').map(c => c + c).join('') : v.toLowerCase();
    const named = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080', orange: '#ffa500', purple: '#800080', pink: '#ffc0cb', brown: '#a52a2a' };
    return named[v.toLowerCase()] || '#000000';
  }

  /* 洞识别：evenodd —— 被奇数层包含的子路径是洞 */
  function buildFills(subpaths, tol) {
    const closed = subpaths.filter(p => isClosed(p, tol) && U.polyLength(p, true) > 2);
    const depth = closed.map(p => {
      const q = p[Math.floor(p.length / 3)];
      let d = 0;
      for (const other of closed) {
        if (other === p) continue;
        if (U.pointInPoly(q[0], q[1], other)) d++;
      }
      return d;
    });
    const outers = [], holesOf = new Map();
    closed.forEach((p, i) => { if (depth[i] % 2 === 0) { outers.push(p); holesOf.set(p, []); } });
    closed.forEach((p, i) => {
      if (depth[i] % 2 === 1) {
        // 找最小包含外轮廓
        const q = p[0];
        let best = null, bestArea = Infinity;
        for (const o of outers) {
          if (U.pointInPoly(q[0], q[1], o)) {
            const b = U.boundsOf(o), a = b.w * b.h;
            if (a < bestArea) { bestArea = a; best = o; }
          }
        }
        if (best) holesOf.get(best).push(p);
      }
    });
    return outers.map(o => ({ outer: o, holes: holesOf.get(o) }));
  }

  /* 主入口：SVG 文本 → design {shapes, sequence} */
  function importSvg(text) {
    const svgNode = parseSvg(text);
    const { root, dispose } = mountHidden(svgNode);
    try {
      const { scale } = getScale(root);
      const shapes = [];
      const geomSel = 'path,rect,circle,ellipse,line,polyline,polygon';
      const els = root.querySelectorAll(geomSel);
      if (!els.length) fail('SVG 中没有可识别的图形元素');
      // 按填充色分组收集闭合子路径
      const fillGroups = new Map(); // color -> [subpath]
      const strokes = []; // {color, width, pts}
      els.forEach(el => {
        const sub = sampleEl(el, scale);
        if (!sub.length) return;
        const fill = colorOf(el, 'fill', '#000000');
        const stroke = colorOf(el, 'stroke', null);
        let sw = parseFloat(el.getAttribute('stroke-width'));
        const st = el.getAttribute('style');
        if (st) { const m = st.match(/stroke-width\s*:\s*([\d.]+)/); if (m) sw = parseFloat(m[1]); }
        if (!isFinite(sw)) sw = stroke ? 1 : 0;
        sw *= scale;
        if (fill) for (const p of sub) { if (!fillGroups.has(fill)) fillGroups.set(fill, []); fillGroups.get(fill).push(p); }
        else if (stroke) for (const p of sub) strokes.push({ color: stroke, width: sw, pts: p });
      });

      const sequence = [];
      const blockByColor = new Map();
      const blockFor = (hex) => {
        const t = U.nearestThread(hex, MADEIRA);
        if (!blockByColor.has(t.code)) {
          const b = { kind: 'block', id: U.uid(), threadId: t.code, shapeIds: [] };
          blockByColor.set(t.code, b);
          sequence.push(b);
        }
        return blockByColor.get(t.code);
      };

      let idx = 0;
      for (const [color, subs] of fillGroups) {
        const fills = buildFills(subs, 1.5);
        const blk = blockFor(color);
        for (const f of fills) {
          const s = {
            id: U.uid(), name: '填充' + (++idx), type: 'fill', closed: true,
            points: f.outer, holes: f.holes, color: blk.threadId,
            params: U.defaultParams('fill'),
          };
          shapes.push(s); blk.shapeIds.push(s.id);
        }
        // 未闭合的填充路径按描边处理
        for (const p of subs) {
          if (!isClosed(p, 1.5) && U.polyLength(p, false) > 2) {
            const s = {
              id: U.uid(), name: '轮廓' + (++idx), type: 'running', closed: false,
              points: p, holes: [], color: blk.threadId,
              params: U.defaultParams('running'),
            };
            shapes.push(s); blk.shapeIds.push(s.id);
          }
        }
      }
      for (const st of strokes) {
        const blk = blockFor(st.color);
        const closedPath = isClosed(st.pts, 1.5);
        let s;
        if (st.width >= 1.2) {
          // 粗描边 → 包针，宽度沿线恒定为描边宽
          s = {
            id: U.uid(), name: '包针' + (++idx), type: 'satin', closed: closedPath,
            points: st.pts, holes: [], widths: st.pts.map(() => Math.min(st.width, 8)),
            color: blk.threadId, params: U.defaultParams('satin'),
          };
        } else {
          s = {
            id: U.uid(), name: '平针' + (++idx), type: 'running', closed: closedPath,
            points: st.pts, holes: [], color: blk.threadId,
            params: U.defaultParams('running'),
          };
        }
        shapes.push(s); blk.shapeIds.push(s.id);
      }
      if (!shapes.length) fail('没有可用的闭合轮廓或描边路径');
      return { shapes, sequence };
    } finally {
      dispose();
    }
  }

  return { importSvg };
})();
