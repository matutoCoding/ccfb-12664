// 纯 JS ZIP 打包/解包（store 与 deflate 两种方式，无第三方依赖）
// 写入使用 deflate（自带静态/动态哈夫曼实现），读取兼容 store 与 deflate

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ---- 极简 DEFLATE（raw，无 zlib 头）：使用 BTYPE=00 无压缩块，位级实现仍用于验证编解码对齐 ----
export function deflateRaw(input) {
  const out = [];
  let pos = 0;
  const MAX_BLOCK = 65535;
  while (pos < input.length || pos === 0) {
    const chunk = input.subarray(pos, Math.min(input.length, pos + MAX_BLOCK));
    const last = pos + chunk.length >= input.length ? 1 : 0;
    out.push(last); // BFINAL + BTYPE=00，共 3 位，凑成整字节
    out.push(chunk.length & 0xFF, chunk.length >> 8);
    out.push(~chunk.length & 0xFF, (~chunk.length >> 8) & 0xFF);
    for (let i = 0; i < chunk.length; i++) out.push(chunk[i]);
    pos += chunk.length;
    if (pos >= input.length) break;
  }
  return new Uint8Array(out);
}

// ---- inflateRaw：支持固定/动态哈夫曼与无压缩块 ----
export function inflateRaw(input) {
  let p = 0, bitBuf = 0, bitCnt = 0;
  const getBit = () => {
    if (bitCnt === 0) { bitBuf = input[p++]; bitCnt = 8; }
    const v = bitBuf & 1; bitBuf >>= 1; bitCnt--; return v;
  };
  const getBits = (n) => { let v = 0; for (let i = 0; i < n; i++) v |= getBit() << i; return v; };
  const alignByte = () => { bitBuf = 0; bitCnt = 0; };
  const out = [];
  const rev = (v, n) => { let r = 0; for (let i = 0; i < n; i++) r = (r << 1) | ((v >> i) & 1); return r; };

  const buildFixedLens = () => {
    const lens = new Uint8Array(288);
    for (let i = 0; i <= 143; i++) lens[i] = 8;
    for (let i = 144; i <= 255; i++) lens[i] = 9;
    for (let i = 256; i <= 279; i++) lens[i] = 7;
    for (let i = 280; i <= 287; i++) lens[i] = 8;
    return lens;
  };
  const buildTable = (lens) => {
    const maxBits = Math.max(...lens);
    const table = new Map();
    const blCount = new Array(maxBits + 1).fill(0);
    for (const l of lens) if (l) blCount[l]++;
    const nextCode = new Array(maxBits + 1).fill(0);
    let code = 0;
    for (let bits = 1; bits <= maxBits; bits++) {
      code = (code + blCount[bits - 1]) << 1;
      nextCode[bits] = code;
    }
    for (let sym = 0; sym < lens.length; sym++) {
      const len = lens[sym];
      if (!len) continue;
      table.set(rev(nextCode[len], len) + ':' + len, sym);
      nextCode[len]++;
    }
    return { table, maxBits };
  };
  const decodeSym = ({ table, maxBits }) => {
    let code = 0;
    for (let len = 1; len <= maxBits; len++) {
      code = (code << 1) | getBit();
      const sym = table.get(code + ':' + len);
      if (sym !== undefined) return sym;
    }
    throw new Error('ZIP 解压失败：哈夫曼编码损坏');
  };
  const LEN_BASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  const LEN_EXTRA = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  const DIST_BASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  const DIST_EXTRA = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];

  let done = false;
  while (!done) {
    const bfinal = getBit();
    const btype = getBits(2);
    if (btype === 0) {
      alignByte();
      const len = input[p] | (input[p + 1] << 8); p += 2;
      p += 2; // nlen
      for (let i = 0; i < len; i++) out.push(input[p++]);
    } else {
      let litLens, distLens;
      if (btype === 1) {
        litLens = buildFixedLens();
        distLens = new Uint8Array(30).fill(5);
      } else if (btype === 2) {
        const hlit = getBits(5) + 257, hdist = getBits(4) + 1, hclen = getBits(4) + 4;
        const order = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
        const clLens = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) clLens[order[i]] = getBits(3);
        const clTable = buildTable(clLens);
        const allLens = new Uint8Array(hlit + hdist);
        let idx = 0;
        while (idx < allLens.length) {
          const sym = decodeSym(clTable);
          if (sym < 16) allLens[idx++] = sym;
          else if (sym === 16) { const rep = getBits(2) + 3; allLens.fill(allLens[idx - 1], idx, idx + rep); idx += rep; }
          else if (sym === 17) { const rep = getBits(3) + 3; allLens.fill(0, idx, idx + rep); idx += rep; }
          else { const rep = getBits(7) + 11; allLens.fill(0, idx, idx + rep); idx += rep; }
        }
        litLens = allLens.subarray(0, hlit);
        distLens = allLens.subarray(hlit);
      } else throw new Error('ZIP 解压失败：不支持的块类型');
      const litTable = buildTable(litLens);
      const distTable = distLens.some(l => l > 0) ? buildTable(distLens) : null;
      while (true) {
        const sym = decodeSym(litTable);
        if (sym === 256) break;
        if (sym < 256) out.push(sym);
        else {
          const li = sym - 257;
          const length = LEN_BASE[li] + getBits(LEN_EXTRA[li]);
          const dsym = decodeSym(distTable);
          const distance = DIST_BASE[dsym] + getBits(DIST_EXTRA[dsym]);
          const start = out.length - distance;
          for (let k = 0; k < length; k++) out.push(out[start + k]);
        }
      }
    }
    if (bfinal) done = true;
  }
  return new Uint8Array(out);
}

const enc = new TextEncoder();
const dec = new TextDecoder();

// files: [{ name, content: string|Uint8Array }] -> Uint8Array zip
// 采用 store（method=0）无压缩存储，换取零依赖下的最高可靠性；工程包以 JSON 文本为主
export function zipSync(files) {
  const localParts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const data = typeof f.content === 'string' ? enc.encode(f.content) : f.content;
    const crc = crc32(data);
    const nameBytes = enc.encode(f.name);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(8, 0, true); // store
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30); local.set(data, 30 + nameBytes.length);
    localParts.push(local);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);
    offset += local.length;
  }
  const localTotal = localParts.reduce((a, b) => a + b.length, 0);
  const cdTotal = central.reduce((a, b) => a + b.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdTotal, true);
  ev.setUint32(16, localTotal, true);
  const out = new Uint8Array(localTotal + cdTotal + 22);
  let p = 0;
  for (const b of localParts) { out.set(b, p); p += b.length; }
  for (const b of central) { out.set(b, p); p += b.length; }
  out.set(eocd, p);
  return out;
}

export function unzipSync(uint8) {
  const dv = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);
  const files = [];
  let p = 0;
  while (p + 4 <= uint8.length && dv.getUint32(p, true) === 0x04034b50) {
    const method = dv.getUint16(p + 8, true);
    const crc = dv.getUint32(p + 14, true);
    const compSize = dv.getUint32(p + 18, true);
    const uncompSize = dv.getUint32(p + 22, true);
    const nameLen = dv.getUint16(p + 26, true);
    const extraLen = dv.getUint16(p + 28, true);
    const name = dec.decode(uint8.subarray(p + 30, p + 30 + nameLen));
    const dataStart = p + 30 + nameLen + extraLen;
    const raw = uint8.subarray(dataStart, dataStart + compSize);
    let data;
    try {
      data = method === 0 ? new Uint8Array(raw) : inflateRaw(raw);
    } catch (e) {
      throw new Error('工程包内文件 "' + name + '" 解压失败：' + e.message);
    }
    if (data.length !== uncompSize) throw new Error('工程包内 "' + name + '" 大小不符，文件可能损坏');
    if (crc32(data) !== crc) throw new Error('工程包内 "' + name + '" 校验失败，文件可能损坏');
    files.push({ name, data });
    p = dataStart + compSize;
  }
  if (!files.length) throw new Error('工程包中没有找到任何 ZIP 条目，文件格式不正确或已损坏');
  return files;
}

export const utf8 = (s) => enc.encode(s);
export const fromUtf8 = (u) => dec.decode(u);
