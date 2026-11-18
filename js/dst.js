'use strict';
/* Tajima DST 针迹文件编解码。单位 0.1mm，y 轴向上（与画布相反，编解码时翻转）。
   记录 3 字节：普通针 0x03，跳针 0x83，换色 0xC3，结束 0xF3。
   剪线编码为 (0,0) 跳针记录，导回时可还原。 */
const DST = (() => {
  const F_STITCH = 0, F_JUMP = 1, F_TRIM = 2;

  function encodeRecord(dx, dy, flag) {
    // dx,dy: 0.1mm 整数，范围 [-121,121]
    const b = [0, 0, 0];
    let x = dx, y = dy;
    const bits = [
      [1, 0, 6, 7],   // ±1:  x byte0 bit6/7
      [3, 1, 6, 7],   // ±3:  x byte1 bit6/7
      [9, 0, 4, 5],   // ±9:  x byte0 bit4/5
      [27, 1, 4, 5],  // ±27: x byte1 bit4/5
      [81, 2, 4, 5],  // ±81: x byte2 bit4/5
    ];
    for (const [v, bi, posP, posN] of bits) {
      if (x >= v) { b[bi] |= (1 << posP); x -= v; }
      else if (x <= -v) { b[bi] |= (1 << posN); x += v; }
    }
    const ybits = [
      [1, 0, 0, 1], [3, 1, 0, 1], [9, 0, 2, 3], [27, 1, 2, 3], [81, 2, 2, 3],
    ];
    for (const [v, bi, posP, posN] of ybits) {
      if (y >= v) { b[bi] |= (1 << posP); y -= v; }
      else if (y <= -v) { b[bi] |= (1 << posN); y += v; }
    }
    b[2] |= flag; // 0x03 / 0x83 / 0xC3
    return b;
  }

  function decodeRecord(b) {
    let x = 0, y = 0;
    const xb = [[0, 6, 1], [0, 7, -1], [1, 6, 3], [1, 7, -3], [0, 4, 9], [0, 5, -9], [1, 4, 27], [1, 5, -27], [2, 4, 81], [2, 5, -81]];
    const yb = [[0, 0, 1], [0, 1, -1], [1, 0, 3], [1, 1, -3], [0, 2, 9], [0, 3, -9], [1, 2, 27], [1, 3, -27], [2, 2, 81], [2, 3, -81]];
    for (const [bi, bit, v] of xb) if (b[bi] & (1 << bit)) x += v;
    for (const [bi, bit, v] of yb) if (b[bi] & (1 << bit)) y += v;
    return [x, y];
  }

  /* blocks: [{xy:Float32Array(mm), flags:Uint8Array}], meta: {name} */
  function encode(blocks, meta) {
    const recs = [];
    let px = 0, py = 0; // 0.1mm
    let minX = 0, maxX = 0, minY = 0, maxY = 0, stCount = 0, coCount = 0;

    const emitMove = (tx, ty, flag) => {
      let dx = tx - px, dy = ty - py;
      if (dx === 0 && dy === 0) return;
      // 拆成 <=121 的多段
      do {
        const sx = Math.max(-121, Math.min(121, dx));
        const sy = Math.max(-121, Math.min(121, dy));
        recs.push(encodeRecord(sx, sy, flag));
        px += sx; py += sy;
        dx -= sx; dy -= sy;
        if (flag === 0x03) stCount++;
      } while (dx !== 0 || dy !== 0);
      minX = Math.min(minX, px); maxX = Math.max(maxX, px);
      minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    };

    let firstBlock = true;
    for (const blk of blocks) {
      if (!blk.xy.length) continue;
      if (!firstBlock) { recs.push(encodeRecord(0, 0, 0xC3)); coCount++; }
      firstBlock = false;
      for (let i = 0, j = 0; j < blk.flags.length; i += 2, j++) {
        const tx = Math.round(blk.xy[i] * 10);
        const ty = Math.round(-blk.xy[i + 1] * 10); // y 翻转
        const f = blk.flags[j];
        if (f === F_TRIM) { recs.push(encodeRecord(0, 0, 0x83)); continue; }
        emitMove(tx, ty, f === F_JUMP ? 0x83 : 0x03);
      }
    }
    recs.push([0, 0, 0xF3]); // 结束

    // 512 字节头
    const header = new Uint8Array(512).fill(0x20);
    const put = (off, s) => { for (let i = 0; i < s.length && off + i < 512; i++) header[off + i] = s.charCodeAt(i); };
    const pad = (v, n) => String(v).slice(0, n).padStart(n, ' ');
    let o = 0;
    put(o, 'LA:' + (meta.name || 'untitled').slice(0, 16).padEnd(16, ' ') + '\r'); o += 20;
    put(o, 'ST:' + pad(stCount, 7) + '\r'); o += 11;
    put(o, 'CO:' + pad(coCount, 3) + '\r'); o += 7;
    put(o, '+X:' + pad(Math.max(0, maxX), 5) + '\r'); o += 9;
    put(o, '-X:' + pad(Math.max(0, -minX), 5) + '\r'); o += 9;
    put(o, '+Y:' + pad(Math.max(0, maxY), 5) + '\r'); o += 9;
    put(o, '-Y:' + pad(Math.max(0, -minY), 5) + '\r'); o += 9;
    put(o, 'AX:+' + pad(0, 5) + '\r'); o += 10;
    put(o, 'AY:+' + pad(0, 5) + '\r'); o += 10;
    put(o, 'MX:+' + pad(0, 5) + '\r'); o += 10;
    put(o, 'MY:+' + pad(0, 5) + '\r'); o += 10;
    put(o, 'PD:******\r');
    const out = new Uint8Array(512 + recs.length * 3);
    out.set(header, 0);
    recs.forEach((r, i) => out.set(r, 512 + i * 3));
    return out.buffer;
  }

  /* 解码 → { blocks: [{stitches:[{x,y,f}]}] }，mm，y 翻回画布方向 */
  function decode(buf) {
    const d = new Uint8Array(buf);
    if (d.length < 512 + 3) throw new Error('文件太小，不是有效的 DST');
    const blocks = [];
    let cur = { stitches: [] };
    let x = 0, y = 0;
    const pushCur = () => { if (cur.stitches.length) blocks.push(cur); };
    for (let o = 512; o + 2 < d.length; o += 3) {
      const b = [d[o], d[o + 1], d[o + 2]];
      if (b[2] === 0xF3) break; // 结束
      const [dx, dy] = decodeRecord(b);
      x += dx; y += dy;
      const mmx = x / 10, mmy = -y / 10;
      if ((b[2] & 0xC3) === 0xC3) { // 换色
        pushCur(); cur = { stitches: [] };
      } else if ((b[2] & 0x83) === 0x83) { // 跳针；(0,0) 跳针 = 剪线
        cur.stitches.push({ x: mmx, y: mmy, f: (dx === 0 && dy === 0) ? F_TRIM : F_JUMP });
      } else {
        cur.stitches.push({ x: mmx, y: mmy, f: F_STITCH });
      }
    }
    pushCur();
    if (!blocks.length) throw new Error('DST 中没有针迹数据');
    return { blocks };
  }

  return { encode, decode, F_STITCH, F_JUMP, F_TRIM };
})();
