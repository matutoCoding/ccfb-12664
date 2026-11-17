// 工单 CSV 导出（UTF-8 BOM，Excel 直接打开不乱码）
import { toMM } from './math.js';

function esc(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function buildWorkOrderCsv(project, result) {
  const rows = [];
  rows.push(['绣花生产工单']);
  rows.push(['工程名称', project.name]);
  rows.push(['导出时间', new Date().toLocaleString('zh-CN')]);
  rows.push(['针距密度(mm)', '针数', '换色次数', '剪线次数', '跳针次数', '用线总长(m)', '预估工时']);
  const s = result.stats;
  rows.push([
    '-', s.stitchCount, s.colorChanges, s.trimCount, s.jumpCount,
    (s.threadLengthMm / 1000).toFixed(2), s.estimatedText
  ]);
  rows.push([]);
  rows.push(['绣作顺序', '线号/颜色名', '色号', '针数', '用线长度(m)']);
  const colorMap = new Map(project.palette.map(c => [c.id, c]));
  result.colorOrder.forEach((colorId, idx) => {
    const c = colorMap.get(colorId) || { name: '未知', code: '-', hex: '#000' };
    let n = 0, len = 0, prev = null;
    for (const r of result.records) {
      // 用 routedBlocks 更准确，这里按块统计
    }
    const blockLen = result.blocks.filter(b => b.colorId === colorId).reduce((acc, b) => {
      let l = 0;
      for (let i = 1; i < b.stitches.length; i++) {
        const a = b.stitches[i - 1], q = b.stitches[i];
        if (!(q.flag & 1) || true) l += Math.hypot(q.x - a.x, q.y - a.y);
      }
      return acc + l;
    }, 0);
    const cnt = result.blocks.filter(b => b.colorId === colorId)
      .reduce((acc, b) => acc + b.stitches.filter(r => !(r.flag & 1)).length, 0);
    rows.push([idx + 1, c.name, c.code, cnt, (toMM(blockLen) / 1000).toFixed(3)]);
  });
  rows.push([]);
  rows.push(['形状明细']);
  rows.push(['形状', '针法', '颜色', '可见']);
  for (const sh of project.shapes) {
    const c = colorMap.get(sh.colorId);
    rows.push([sh.name, sh.type, c ? c.name : '-', sh.visible ? '是' : '否']);
  }
  return '﻿' + rows.map(r => r.map(esc).join(',')).join('\r\n');
}
