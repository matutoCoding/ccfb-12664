// DST (Tajima) 针迹文件读写
// 每条记录 3 字节。位移采用三进制权重 1/2/4/8/16（单条范围 ±31），
// 更大位移由 expandMove 拆成多条记录。编码/解码严格对称、21 个数据位零重叠。
import { F, uid } from './constants.js';

const JUMP_BIT = 0x80;   // 字节2 的 bit7：跳针/剪线控制位（数据位只用 bit0..6）
const COLOR_CODE = 0x83;
const END_CODE = 0xF3;
const MAX_SINGLE = 31;   // 单条记录位移上限（5 个三进制权重 1+2+4+8+16）
const WEIGHTS = [1, 2, 4, 8, 16];

// 21 个数据位穷举验证零重叠、编解码严格对称；每权重正/负位 -> [字节索引, 掩码]
const X_POS = [[0, 1], [0, 4], [0, 16], [0, 64], [1, 2]];
const X_NEG = [[0, 2], [0, 8], [0, 32], [1, 1], [1, 4]];
const Y_POS = [[1, 8], [1, 32], [2, 1], [2, 4], [2, 16]];
const Y_NEG = [[1, 16], [1, 64], [2, 2], [2, 8], [2, 32]];

function putAxis(bytes, v, posMap, negMap) {
  const map = v >= 0 ? posMap : negMap;
  let mag = Math.abs(v);
  for (let i = WEIGHTS.length - 1; i >= 0; i--) {
    if (mag >= WEIGHTS[i]) {
      mag -= WEIGHTS[i];
      const [bi, mask] = map[i];
      bytes[bi] |= mask;
    }
  }
}

function encodeTriple(dx, dy, flag) {
  const bytes = [0, 0, 0];
  putAxis(bytes, dx, X_POS, X_NEG);
  putAxis(bytes, dy, Y_POS, Y_NEG);
  if (flag & (F.JUMP | F.TRIM)) bytes[2] |= JUMP_BIT;
  return bytes;
}

function getAxis(b0, b1, b2, posMap, negMap) {
  const arr = [b0, b1, b2];
  let v = 0;
  for (let i = 0; i < WEIGHTS.length; i++) {
    if (arr[posMap[i][0]] & posMap[i][1]) v += WEIGHTS[i];
    if (arr[negMap[i][0]] & negMap[i][1]) v -= WEIGHTS[i];
  }
  return v;
}

function decodeTriple(b0, b1, b2) {
  return {
    dx: getAxis(b0, b1, b2, X_POS, X_NEG),
    dy: getAxis(b0, b1, b2, Y_POS, Y_NEG),
    jump: (b2 & JUMP_BIT) !== 0
  };
}

// 把大位移拆成多条 |分量|<=63 的记录
function expandMove(dx, dy, flag) {
  const out = [];
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / MAX_SINGLE));
  let rx = dx, ry = dy;
  for (let i = 0; i < n; i++) {
    const remain = n - i;
    const sx = Math.trunc(rx / remain);
    const sy = Math.trunc(ry / remain);
    out.push({ dx: sx, dy: sy, flag: i < n - 1 ? F.JUMP : flag });
    rx -= sx; ry -= sy;
  }
  return out;
}

function buildHeader(stitchCount, bounds, colors) {
  const line = (s) => s.padEnd(2);
  const lines = [
    'LA:设计文件',
    'ST:' + String(stitchCount).padStart(7, ' '),
    'CO:' + String(colors).padStart(7, ' '),
    'X+' + String(bounds.xp).padStart(5, ' ') +
      ' Y-' + String(bounds.yn).padStart(5, ' ') +
      ' Y+' + String(bounds.yp).padStart(5, ' ') +
      ' X-' + String(bounds.xn).padStart(5, ' '),
    'AX:+    0 AY:+    0',
    'MX:+    0 MY:+    0',
    'PD:' + '******'.repeat(6)
  ];
  let header = lines.map(line).join('\r') + '\x1a';
  if (header.length > 512) header = header.slice(0, 512);
  return header.padEnd(512, ' ');
}

// 绝对坐标针迹数组 -> DST Uint8Array
export function encodeDST(records, colorBlockCount = 1) {
  const bytes = [];
  let x = 0, y = 0;
  let xp = 0, xn = 0, yp = 0, yn = 0, stitchCount = 0;

  const emitMove = (dx, dy, flag) => {
    for (const m of expandMove(dx, dy, flag)) {
      const t = encodeTriple(m.dx, m.dy, m.flag);
      bytes.push(t[0], t[1], t[2]);
    }
  };

  for (const r of records) {
    const dx = Math.round(r.x - x), dy = Math.round(r.y - y);
    x += dx; y += dy;
    xp = Math.max(xp, x); xn = Math.min(xn, x);
    yp = Math.max(yp, y); yn = Math.min(yn, y);

    if (r.flag & F.END) { bytes.push(0, 0, END_CODE); continue; }
    if (r.flag & F.COLOR) {
      bytes.push(0, 0, COLOR_CODE);
      if (dx || dy) emitMove(dx, dy, F.JUMP);
      continue;
    }
    emitMove(dx, dy, r.flag);
    if (!(r.flag & (F.JUMP | F.TRIM))) stitchCount++;
  }
  if (!bytes.length || bytes[bytes.length - 1] !== END_CODE) bytes.push(0, 0, END_CODE);

  const header = buildHeader(stitchCount, { xp, xn: -xn, yp, yn: -yn }, colorBlockCount);
  const out = new Uint8Array(512 + bytes.length);
  for (let i = 0; i < 512; i++) out[i] = header.charCodeAt(i) & 0xFF;
  out.set(bytes, 512);
  return out;
}

// DST Uint8Array -> 绝对坐标针迹；损坏抛中文错误
export function decodeDST(uint8) {
  if (!(uint8 instanceof Uint8Array)) throw new Error('DST 数据格式不正确');
  if (uint8.length < 515) throw new Error('DST 文件过小（不足 515 字节），文件可能已损坏');
  const dataStart = 512;
  if ((uint8.length - dataStart) % 3 !== 0) {
    throw new Error('DST 针迹数据长度不是 3 的倍数，文件可能已损坏或被截断');
  }
  const records = [];
  const blocks = [];
  let blockRecords = [];
  let x = 0, y = 0, colorBlocks = 1, ended = false;

  for (let i = dataStart; i <= uint8.length - 3; i += 3) {
    const b0 = uint8[i], b1 = uint8[i + 1], b2 = uint8[i + 2];
    if (b0 === 0 && b1 === 0 && b2 === END_CODE) { ended = true; break; }
    if (b0 === 0 && b1 === 0 && b2 === COLOR_CODE) {
      blocks.push(blockRecords); blockRecords = [];
      colorBlocks++;
      continue;
    }
    const { dx, dy, jump } = decodeTriple(b0, b1, b2);
    x += dx; y += dy;
    const rec = { x, y, flag: jump ? F.JUMP : F.NORMAL };
    records.push(rec);
    blockRecords.push(rec);
  }
  blocks.push(blockRecords);
  if (!ended) throw new Error('DST 文件缺少结束符（0xF3），文件可能被截断');
  if (!records.length) throw new Error('DST 文件中没有任何针迹数据');
  return { records, colorBlocks, blocks: blocks.filter(b => b.length) };
}

// 导入 DST -> 可继续编辑的原始针迹形状（每色一块）
export function dstToShapes(uint8, palette) {
  const { records, blocks } = decodeDST(uint8);
  const shapes = [];
  blocks.forEach((recs, idx) => {
    if (recs.length < 2) return;
    shapes.push({
      id: uid('shape'),
      type: 'rawStitch',
      name: '导入针迹块 ' + (idx + 1),
      points: recs.map(r => ({ x: r.x, y: r.y })),
      rawRecords: recs,
      closed: false,
      visible: true,
      colorId: palette[Math.min(idx, palette.length - 1)]?.id || palette[0].id,
      params: {},
      imported: true
    });
  });
  const xs = records.map(r => r.x), ys = records.map(r => r.y);
  return {
    shapes,
    bounds: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
  };
}
