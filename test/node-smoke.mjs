// Node 冒烟测试：node test/node-smoke.mjs，不依赖浏览器 DOM
import { createProject, projectFromSample, exportProjectPackage, importProjectPackage, validateProject } from '../core/store.js';
import { buildDesign } from '../core/engine.js';
import { encodeDST, decodeDST } from '../core/dst.js';
import { zipSync, unzipSync, deflateRaw, inflateRaw, crc32 } from '../core/zip.js';
import { defaultParams, uid, F } from '../core/constants.js';
import { resampleByLength, nearestNeighborOrder, dist, offsetPolygon } from '../core/math.js';
import { sliceAlongAxis, scanlineRows } from '../core/geometry.js';
import { buildWorkOrderCsv } from '../core/csv.js';

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗ 失败: ' + msg); }
}
function approx(a, b, tol = 2) { return Math.abs(a - b) <= tol; }

console.log('1) 内置花稿针迹生成');
for (let i = 0; i < 4; i++) {
  const p = projectFromSample(i);
  const r = buildDesign(p);
  ok(r.records.length > 10, `花稿${i} 应产生针迹，实际 ${r.records.length}`);
  ok(r.stats.stitchCount > 10, `花稿${i} 针数统计 >10，实际 ${r.stats.stitchCount}`);
  ok(r.stats.computeMs < 5000, `花稿${i} 计算耗时合理 (${r.stats.computeMs}ms)`);
  ok(r.stats.threadLengthMm > 0, '用线长度 > 0');
  ok(r.colorOrder.length >= 1, '存在绣作颜色顺序');
}

console.log('2) 四种针法基本性质');
{
  const p = createProject('t');
  const cid = p.palette[0].id;
  const mk = (type, points, closed, extra = {}) => ({
    id: uid('s'), type, name: type, points, closed, visible: true, colorId: cid,
    params: { ...defaultParams(type), ...extra }
  });
  p.shapes = [
    mk('run', [{ x: 0, y: 0 }, { x: 500, y: 0 }], false, { runLength: 2.5 }),
    mk('satin', ellipse(0, 500, 120, 60), true),
    mk('tatami', rect(-300, -300, 600, 600), true, { density: 0.4, fillAngle: 30 }),
    mk('zigzag', [{ x: 0, y: 0 }, { x: 300, y: 200 }], false)
  ];
  const r = buildDesign(p);
  ok(r.blocks.length === 4, '4 个形状 -> 4 个针迹块');
  // 平针步长约 25 单位 (2.5mm)，跳过锁针找第一枚普通针
  const run = r.blocks.find(b => b.shapeId === p.shapes[0].id);
  const normPts = run.stitches.filter(s => !(s.flag & F.LOCK));
  const d01 = dist(normPts[0], normPts[1]);
  ok(approx(d01, 25, 3), `平针步长≈25(0.1mm)，实际 ${d01.toFixed(1)}`);
  // 榻榻米密度 0.4mm = 4 单位行距
  const tat = r.blocks.find(b => b.shapeId === p.shapes[2].id);
  ok(tat.stitches.length > 200, `榻榻米应有大量针，实际 ${tat.stitches.length}`);
  // 所有针迹坐标有限
  ok(r.records.every(s => Number.isFinite(s.x) && Number.isFinite(s.y)), '所有坐标有限');
}

console.log('3) 密度参数变化 -> 针数变化');
{
  const p = createProject('density');
  p.shapes = [{
    id: uid('s'), type: 'tatami', name: 'x', points: rect(0, 0, 800, 800), closed: true,
    visible: true, colorId: p.palette[0].id, params: { ...defaultParams('tatami'), density: 0.8 }
  }];
  const sparse = buildDesign(p).stats.stitchCount;
  p.shapes[0].params.density = 0.25;
  const dense = buildDesign(p).stats.stitchCount;
  ok(dense > sparse * 1.5, `密度变密针数应显著增加 (${sparse} -> ${dense})`);
}

console.log('4) 无交叉路由：同色最近邻 + 2-opt');
{
  const items = [
    { first: { x: 0, y: 0 }, last: { x: 100, y: 0 } },
    { first: { x: 300, y: 0 }, last: { x: 400, y: 0 } },
    { first: { x: 150, y: 50 }, last: { x: 250, y: 50 } }
  ];
  const order = nearestNeighborOrder(items, { x: -50, y: 0 }, b => [b.first, b.last]);
  ok(order[0].index === 0, '最近邻从最近块开始');
}

console.log('5) 剪线/跳针自动插入');
{
  const p = createProject('trim');
  const c1 = p.palette[0].id, c2 = p.palette[5].id;
  p.shapes = [
    { id: uid('s'), type: 'run', name: 'a', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], closed: false, visible: true, colorId: c1, params: defaultParams('run') },
    { id: uid('s'), type: 'run', name: 'b', points: [{ x: 5000, y: 5000 }, { x: 5100, y: 5000 }], closed: false, visible: true, colorId: c2, params: defaultParams('run') }
  ];
  p.settings.trimGap = 7;
  const r = buildDesign(p);
  ok(r.stats.trimCount >= 1, `远距离应插剪线，实际 ${r.stats.trimCount}`);
  ok(r.stats.colorChanges >= 1, '换色计数');
  ok(r.records.some(s => s.flag & F.TRIM), '记录含 TRIM 标志');
  ok(r.records.some(s => s.flag & F.JUMP), '记录含 JUMP 标志');
  // 超过 12.1mm 的跳针必须被拆分
  for (let i = 1; i < r.records.length; i++) {
    const a = r.records[i - 1], b = r.records[i];
    if (b.flag & F.JUMP) ok(Math.abs(b.x - a.x) <= 121 && Math.abs(b.y - a.y) <= 121, '跳针位移不超 121');
  }
}

console.log('6) DST 编码/解码往返一致');
{
  const p = projectFromSample(0);
  const r = buildDesign(p);
  const bytes = encodeDST(r.records, r.colorOrder.length);
  ok(bytes.length > 512 && (bytes.length - 512) % 3 === 0, 'DST 长度=512头+3倍记录');
  ok(bytes[bytes.length - 1] === 0xF3, '结束字节 0xF3');
  const dec = decodeDST(bytes);
  ok(dec.records.length > 0, '解码出针迹');
  const endO = r.records.filter(x => !(x.flag & F.END)).slice(-1)[0];
  const endD = dec.records.slice(-1)[0];
  ok(approx(endO.x, endD.x, 2) && approx(endO.y, endD.y, 2), '往返终点坐标一致');
}

console.log('7) DST 损坏文件报错而非崩溃');
{
  let threw = false;
  try { decodeDST(new Uint8Array([1, 2, 3])); } catch (e) { threw = /损坏|过小|截断/.test(e.message); }
  ok(threw, '小文件应抛中文损坏错误');
  let threw2 = false;
  try { decodeDST(new Uint8Array(600).fill(0)); } catch (e) { threw2 = true; }
  ok(threw2, '无结束符应报错');
}

console.log('8) ZIP 打包/解包往返 + deflate 哈夫曼解码');
{
  const text = '绣花打版测试数据 '.repeat(500) + '结尾标记XYZ';
  const raw = new TextEncoder().encode(text);
  // 自实现 deflate 固定哈夫曼往返（验证位级编解码正确性）
  const comp = deflateRaw(raw);
  const back = inflateRaw(comp);
  ok(back.length === raw.length && new TextDecoder().decode(back) === text, 'deflate/inflate 往返一致');
  const zipped = zipSync([{ name: 'a.txt', content: text }, { name: 'b.bin', content: new Uint8Array([1, 2, 3, 250]) }]);
  const files = unzipSync(zipped);
  ok(files.length === 2, 'zip 含 2 个文件');
  ok(new TextDecoder().decode(files[0].data) === text, 'zip 文本内容一致');
  ok(files[1].data[3] === 250, 'zip 二进制内容一致');
  // crc
  ok(crc32(raw) === crc32(back), 'crc32 一致');
}

console.log('9) 工程包导出/导入往返');
{
  const p = projectFromSample(1);
  const bytes = exportProjectPackage(p);
  const imported = await importProjectPackage(bytes);
  ok(imported.shapes.length === p.shapes.length, '形状数量一致');
  ok(imported.palette.length === p.palette.length, '色板数量一致');
  const r2 = buildDesign(validateProject(imported));
  ok(r2.stats.stitchCount > 10, '导入工程可重新计算');
}

console.log('10) 包针收口：宽度随轮廓变化');
{
  // 中间宽两头尖的菱形
  const diamond = [{ x: 0, y: -200 }, { x: 100, y: 0 }, { x: 0, y: 200 }, { x: -100, y: 0 }, { x: 0, y: -200 }];
  const { rows } = sliceAlongAxis(diamond, 25);
  ok(rows.length > 4, '切出多道横档');
  const widths = rows.map(r => r.width);
  ok(Math.max(...widths) > Math.min(...widths) * 1.5, '宽度有变化（收口）');
}

console.log('11) 十万针性能');
{
  const p = createProject('perf');
  p.shapes = [];
  // 多个大矩形榻榻米凑够十万针量级
  for (let i = 0; i < 6; i++) {
    p.shapes.push({
      id: uid('s'), type: 'tatami', name: 'b' + i,
      points: rect(i * 900, 0, 800, 1600), closed: true, visible: true,
      colorId: p.palette[i % p.palette.length].id,
      params: { ...defaultParams('tatami'), density: 0.3, fillAngle: 45 }
    });
  }
  const t0 = Date.now();
  const r = buildDesign(p);
  const ms = Date.now() - t0;
  console.log(`    针数=${r.stats.stitchCount}, 耗时=${r.stats.computeMs}ms (外部计时 ${ms}ms)`);
  ok(r.stats.stitchCount > 50000, '针数达到十万量级');
  ok(r.stats.computeMs < 1000, `重算 <1 秒，实际 ${r.stats.computeMs}ms`);
}

console.log('12) CSV 工单生成');
{
  const p = projectFromSample(2);
  const r = buildDesign(p);
  const csv = buildWorkOrderCsv(p, r);
  ok(csv.includes('绣花生产工单') && csv.includes('针数'), 'CSV 含表头');
  ok(csv.split('\r\n').length > 5, 'CSV 多行');
}

console.log('13) 几何工具边界情况');
{
  const rs = resampleByLength([{ x: 0, y: 0 }, { x: 100, y: 0 }], 25);
  ok(rs.length === 5, `重采样 100/25=5 段点，实际 ${rs.length}`);
  const off = offsetPolygon(rect(0, 0, 100, 100), 5);
  ok(off.length === 5, '偏移多边形顶点数不变');
  const rows = scanlineRows(ellipse(0, 0, 100, 100), 10, 0);
  ok(rows.length > 5, '椭圆扫描行数量合理');
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);

function rect(x, y, w, h) {
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }];
}
function ellipse(cx, cy, rx, ry, n = 40) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = i / n * Math.PI * 2;
    pts.push({ x: Math.round(cx + Math.cos(a) * rx), y: Math.round(cy + Math.sin(a) * ry) });
  }
  return pts;
}
