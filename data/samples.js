// 内置花稿：坐标单位 0.1mm，画布以 (0,0) 为中心区域
import { uid, defaultParams, STITCH_TYPES } from '../core/constants.js';

function shape(type, name, points, closed, colorIdx, extra = {}) {
  return {
    id: uid('shape'),
    type,
    name,
    points,
    closed,
    visible: true,
    colorIdx,
    params: { ...defaultParams(type), ...(extra.params || {}) },
    ...extra
  };
}

function ellipsePts(cx, cy, rx, ry, n = 48) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = i / n * Math.PI * 2;
    pts.push({ x: Math.round(cx + Math.cos(a) * rx), y: Math.round(cy + Math.sin(a) * ry) });
  }
  return pts;
}

function rectPts(x, y, w, h) {
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }];
}

// 1) 花朵：花瓣（榻榻米）+ 花心（包针）+ 轮廓平针 + 茎叶
export function sampleFlower() {
  const cx = 0, cy = 0;
  const shapes = [];
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    const px = cx + Math.cos(a) * 220, py = cy + Math.sin(a) * 220;
    shapes.push(shape(STITCH_TYPES.TATAMI, '花瓣' + (i + 1),
      ellipsePts(px, py, 130, 70).map(p => {
        const dx = p.x - px, dy = p.y - py;
        const ca = Math.cos(a), sa = Math.sin(a);
        return { x: Math.round(px + dx * ca - dy * sa), y: Math.round(py + dx * sa + dy * ca) };
      }), true, 10, { params: { density: 0.45, fillAngle: 45 + i * 15 } }));
  }
  shapes.push(shape(STITCH_TYPES.SATIN, '花心', ellipsePts(cx, cy, 90, 90, 40), true, 4));
  shapes.push(shape(STITCH_TYPES.RUN, '花轮廓',
    ellipsePts(cx, cy, 320, 320, 72), true, 25));
  shapes.push(shape(STITCH_TYPES.ZIGZAG, '花茎', [
    { x: 0, y: 60 }, { x: 10, y: 200 }, { x: -15, y: 380 }, { x: 0, y: 520 }
  ], false, 19));
  shapes.push(shape(STITCH_TYPES.TATAMI, '叶片',
    ellipsePts(-70, 300, 110, 45, 30).map(p => {
      const dx = p.x + 70, dy = p.y - 300, a = -0.5;
      return { x: Math.round(-70 + dx * Math.cos(a) - dy * Math.sin(a)), y: Math.round(300 + dx * Math.sin(a) + dy * Math.cos(a)) };
    }), true, 19));
  return { name: '示例·六瓣花', shapes };
}

// 2) 徽章：外环包针 + 星芒榻榻米 + 文字基线
export function sampleBadge() {
  const shapes = [];
  shapes.push(shape(STITCH_TYPES.SATIN, '外环', ellipsePts(0, 0, 300, 300, 64), true, 14,
    { params: { width: 3.5 } }));
  shapes.push(shape(STITCH_TYPES.SATIN, '内环', ellipsePts(0, 0, 230, 230, 64), true, 11));
  const star = [];
  for (let i = 0; i <= 10; i++) {
    const r = i % 2 === 0 ? 180 : 80;
    const a = -Math.PI / 2 + i / 10 * Math.PI * 2;
    star.push({ x: Math.round(Math.cos(a) * r), y: Math.round(Math.sin(a) * r) });
  }
  shapes.push(shape(STITCH_TYPES.TATAMI, '星芒', star, true, 7));
  shapes.push(shape(STITCH_TYPES.RUN, '基线', [{ x: -180, y: 260 }, { x: 180, y: 260 }], false, 14));
  return { name: '示例·圆形徽章', shapes };
}

// 3) 字母绣块（几何拼字母 EMB）
export function sampleLetters() {
  const shapes = [];
  const D = 100; // 笔画宽度
  const addRect = (x, y, w, h, t, idx, nm) =>
    shapes.push(shape(t, nm, rectPts(x, y, w, h), true, idx));
  // E
  addRect(-500, -150, D, 300, STITCH_TYPES.SATIN, 14, 'E 竖');
  addRect(-500, -150, 180, D, STITCH_TYPES.SATIN, 14, 'E 上横');
  addRect(-500, -D / 2, 140, D, STITCH_TYPES.SATIN, 14, 'E 中横');
  addRect(-500, 150 - D, 180, D, STITCH_TYPES.SATIN, 14, 'E 下横');
  // M
  addRect(-200, -150, D, 300, STITCH_TYPES.SATIN, 7, 'M 左竖');
  addRect(40, -150, D, 300, STITCH_TYPES.SATIN, 7, 'M 右竖');
  shapes.push(shape(STITCH_TYPES.ZIGZAG, 'M 斜1', [{ x: -150, y: -150 }, { x: -75, y: 40 }], false, 7));
  shapes.push(shape(STITCH_TYPES.ZIGZAG, 'M 斜2', [{ x: -75, y: 40 }, { x: 40, y: -150 }], false, 7));
  // B：榻榻米大块 + 包针外框
  addRect(200, -150, D, 300, STITCH_TYPES.SATIN, 10, 'B 竖');
  shapes.push(shape(STITCH_TYPES.TATAMI, 'B 上肚',
    ellipsePts(330, -75, 90, 75, 32), true, 10));
  shapes.push(shape(STITCH_TYPES.TATAMI, 'B 下肚',
    ellipsePts(330, 75, 90, 75, 32), true, 10));
  return { name: '示例·字母 EMB', shapes };
}

// 4) 格子手帕边：锯齿连续纹样
export function sampleBorder() {
  const shapes = [];
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    pts.push({ x: -600 + i * 50, y: (i % 2 === 0 ? -40 : 40) });
  }
  shapes.push(shape(STITCH_TYPES.ZIGZAG, '波浪边', pts, false, 5,
    { params: { zigAmplitude: 1.5 } }));
  shapes.push(shape(STITCH_TYPES.RUN, '上沿', [{ x: -600, y: -90 }, { x: 600, y: -90 }], false, 2));
  shapes.push(shape(STITCH_TYPES.RUN, '下沿', [{ x: -600, y: 90 }, { x: 600, y: 90 }], false, 2));
  for (let i = 0; i < 4; i++) {
    const x = -450 + i * 300;
    shapes.push(shape(STITCH_TYPES.SATIN, '菱花' + (i + 1),
      ellipsePts(x, 0, 55, 55, 28), true, 13));
  }
  return { name: '示例·手帕花边', shapes };
}

export const SAMPLES = [sampleFlower, sampleBadge, sampleLetters, sampleBorder];
