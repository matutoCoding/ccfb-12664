'use strict';
/* 内置花稿：花朵 / 星星 / 爱心。坐标单位 mm，原点左上 */
const Samples = (() => {

  function shape(name, type, points, color, extra) {
    return Object.assign({
      id: U.uid(), name, type, closed: type !== 'running' && type !== 'satin',
      points, holes: [], color,
      params: U.defaultParams(type),
    }, extra || {});
  }

  function ellipsePts(cx, cy, rx, ry, rot, n) {
    const pts = [], c = Math.cos(rot), s = Math.sin(rot);
    for (let i = 0; i < (n || 48); i++) {
      const t = i / (n || 48) * Math.PI * 2;
      const x = rx * Math.cos(t), y = ry * Math.sin(t);
      pts.push([cx + x * c - y * s, cy + x * s + y * c]);
    }
    return pts;
  }

  /* 六瓣花：榻榻米花瓣 + 花心 + 平针花茎 + 包针叶子 */
  function flower() {
    const cx = 65, cy = 55, shapes = [];
    for (let k = 0; k < 6; k++) {
      const ang = k * Math.PI / 3;
      const px = cx + Math.cos(ang) * 24, py = cy + Math.sin(ang) * 24;
      const p = shape('花瓣' + (k + 1), 'fill', ellipsePts(px, py, 20, 10, ang), '1023');
      p.params.angle = Math.round(ang * 180 / Math.PI);
      shapes.push(p);
    }
    const center = shape('花心', 'fill', ellipsePts(cx, cy, 12, 12, 0), '1014');
    center.params.angle = 90;
    shapes.push(center);
    const stem = shape('花茎', 'running', [[cx, cy + 14], [cx - 2, 85], [cx + 1, 105], [cx, 125]], '1049');
    stem.closed = false;
    shapes.push(stem);
    const leaf = shape('叶子', 'satin', [[cx + 1, 100], [cx + 14, 92], [cx + 26, 84]], '1047',
      { widths: [1.5, 6, 1.5], closed: false });
    shapes.push(leaf);
    return {
      shapes,
      sequence: [
        { kind: 'block', id: U.uid(), threadId: '1023', shapeIds: shapes.slice(0, 6).map(s => s.id) },
        { kind: 'block', id: U.uid(), threadId: '1014', shapeIds: [center.id] },
        { kind: 'block', id: U.uid(), threadId: '1049', shapeIds: [stem.id] },
        { kind: 'block', id: U.uid(), threadId: '1047', shapeIds: [leaf.id] },
      ],
    };
  }

  /* 五角星：榻榻米填充 + 平针勾边 */
  function star() {
    const cx = 65, cy = 62, R = 42, r = 17, pts = [];
    for (let i = 0; i < 10; i++) {
      const rad = (i % 2 === 0 ? R : r);
      const a = -Math.PI / 2 + i * Math.PI / 5;
      pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
    }
    const fill = shape('星形填充', 'fill', pts, '1027');
    fill.params.angle = 30;
    const outline = shape('勾边', 'running', pts.map(p => [p[0], p[1]]), '1014');
    outline.closed = true;
    outline.params.stitchLength = 2;
    return {
      shapes: [fill, outline],
      sequence: [
        { kind: 'block', id: U.uid(), threadId: '1027', shapeIds: [fill.id] },
        { kind: 'block', id: U.uid(), threadId: '1014', shapeIds: [outline.id] },
      ],
    };
  }

  /* 爱心：榻榻米填充 + 包针滚边（宽度两头尖自动收口） */
  function heart() {
    const cx = 65, cy = 60, pts = [];
    for (let i = 0; i < 64; i++) {
      const t = i / 64 * Math.PI * 2;
      const x = 16 * Math.pow(Math.sin(t), 3);
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      pts.push([cx + x * 2.4, cy - y * 2.4]);
    }
    const fill = shape('爱心填充', 'fill', pts, '1025');
    fill.params.angle = 60;
    // 包针滚边：沿轮廓走，宽度中间宽两头窄
    const borderPts = pts.filter((_, i) => i % 2 === 0).map(p => [p[0], p[1]]);
    const n = borderPts.length, widths = [];
    for (let i = 0; i < n; i++) widths.push(1.6 + 0.8 * Math.sin(i / n * Math.PI * 2) ** 2);
    const border = shape('滚边', 'satin', borderPts, '1029', { widths, closed: true });
    border.params.spacing = 0.45;
    return {
      shapes: [fill, border],
      sequence: [
        { kind: 'block', id: U.uid(), threadId: '1025', shapeIds: [fill.id] },
        { kind: 'block', id: U.uid(), threadId: '1029', shapeIds: [border.id] },
      ],
    };
  }

  return {
    list: [
      { key: 'flower', name: '六瓣花（榻榻米+包针+平针）', make: flower },
      { key: 'star', name: '五角星（榻榻米+勾边）', make: star },
      { key: 'heart', name: '爱心（榻榻米+包针滚边）', make: heart },
    ],
    make(key) { const s = this.list.find(x => x.key === key); return s ? s.make() : null; },
  };
})();
