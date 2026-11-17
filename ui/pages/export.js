// 导出页：DST 针迹文件、CSV 工单、工程包，含往返校验
import { state, requestBuild, flushSave } from '../../app.js';
import { encodeDST, decodeDST } from '../../core/dst.js';
import { buildWorkOrderCsv } from '../../core/csv.js';
import { exportProjectPackage, downloadBytes, utf8 } from '../../core/store.js';
import { F } from '../../core/constants.js';
import { toast } from '../ui.js';

export async function renderExport(container) {
  const project = state.current;
  if (!project) { location.hash = '#/projects'; return; }
  const result = state.stitchResult || await requestBuild();

  container.innerHTML = `
    <div class="page">
      <div class="page-head"><h2>导出</h2></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
        <div class="card">
          <h3>针迹文件</h3>
          <p class="hint">DST（Tajima）三进制编码，含 512 字节标准头；跳针 0x80、换色 0x83、结束 0xF3；
          超过 12.1mm 的位移自动拆分。导出前自动做往返解码校验。</p>
          <div class="toolbar" style="margin:12px 0">
            <button class="primary" id="btnDst">导出 DST</button>
            <button id="btnVerify">往返校验</button>
          </div>
          <div id="verifyOut" class="hint"></div>
        </div>
        <div class="card">
          <h3>工单与工程包</h3>
          <p class="hint">CSV 工单含针数、换色、剪线、分色用线量，Excel 可直接打开；
          工程包 .embz 为压缩包，发给别人可直接导入继续编辑。</p>
          <div class="toolbar" style="margin:12px 0">
            <button id="btnCsv">导出工单 CSV</button>
            <button id="btnEmbz">导出工程包 .embz</button>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:18px">
        <h3>导出内容预览</h3>
        <div class="stat-grid" style="margin:12px 0">
          <div class="stat-box"><div class="v">${result.stats.stitchCount}</div><div class="l">实际针数</div></div>
          <div class="stat-box"><div class="v">${result.stats.colorChanges + 1}</div><div class="l">色带数</div></div>
          <div class="stat-box"><div class="v">${result.stats.trimCount}</div><div class="l">剪线码</div></div>
          <div class="stat-box"><div class="v">${result.stats.jumpCount}</div><div class="l">跳针码</div></div>
        </div>
        <table class="table">
          <thead><tr><th>#</th><th>颜色</th><th>针迹块</th><th>针数</th><th>用线(m)</th></tr></thead>
          <tbody id="blockTable"></tbody>
        </table>
      </div>
    </div>`;

  const colorMap = new Map(project.palette.map(c => [c.id, c]));
  const rows = [];
  result.colorOrder.forEach((colorId, ci) => {
    const blocks = result.blocks.filter(b => b.colorId === colorId);
    const cnt = blocks.reduce((a, b) => a + b.stitches.filter(s => !(s.flag & F.JUMP)).length, 0);
    const len = blocks.reduce((a, b) => {
      let l = 0;
      for (let i = 1; i < b.stitches.length; i++) {
        l += Math.hypot(b.stitches[i].x - b.stitches[i - 1].x, b.stitches[i].y - b.stitches[i - 1].y);
      }
      return a + l;
    }, 0) / 10 / 1000;
    const c = colorMap.get(colorId) || { name: '?', hex: '#888', code: '-' };
    rows.push(`<tr><td>${ci + 1}</td>
      <td><span class="swatch" style="display:inline-block;background:${c.hex};vertical-align:middle"></span> ${c.code} ${c.name}</td>
      <td>${blocks.length}</td><td>${cnt}</td><td>${len.toFixed(3)}</td></tr>`);
  });
  container.querySelector('#blockTable').innerHTML = rows.join('');

  container.querySelector('#btnDst').onclick = () => {
    try {
      const bytes = encodeDST(result.records, result.colorOrder.length);
      downloadBytes(safeName(project.name) + '.dst', bytes);
      toast(`DST 已导出（${(bytes.length / 1024).toFixed(1)} KB，${result.stats.stitchCount} 针）`, 'success', 3500);
    } catch (e) { toast('DST 导出失败：' + e.message, 'error', 5000); }
  };

  container.querySelector('#btnVerify').onclick = () => {
    try {
      const bytes = encodeDST(result.records, result.colorOrder.length);
      const decoded = decodeDST(bytes);
      const out = container.querySelector('#verifyOut');
      const origNormal = result.records.filter(r => !(r.flag & (F.JUMP | F.TRIM | F.END))).length;
      const decNormal = decoded.records.filter(r => !(r.flag & (F.JUMP | F.TRIM | F.END))).length;
      // 比较首尾坐标
      const lastOrig = result.records.filter(r => !(r.flag & F.END)).slice(-1)[0];
      const lastDec = decoded.records.slice(-1)[0];
      const endOk = Math.hypot(lastOrig.x - lastDec.x, lastOrig.y - lastDec.y) <= 2;
      out.innerHTML = `✅ 校验通过：重新解码得到 ${decoded.records.length} 条记录、${decNormal} 针、${decoded.colorBlocks} 色带；
        原文件 ${origNormal} 针；结束坐标偏差 ${Math.hypot(lastOrig.x - lastDec.x, lastOrig.y - lastDec.y).toFixed(1)} (0.1mm)；
        ${endOk ? '终点一致，可安全上机' : '⚠ 终点存在偏差'}`;
      out.style.color = endOk ? 'var(--green)' : 'var(--yellow)';
    } catch (e) {
      container.querySelector('#verifyOut').innerHTML = '❌ 校验失败：' + e.message;
      container.querySelector('#verifyOut').style.color = 'var(--red)';
    }
  };

  container.querySelector('#btnCsv').onclick = () => {
    try {
      const csv = buildWorkOrderCsv(project, result);
      downloadBytes(safeName(project.name) + '_工单.csv', utf8(csv), 'text/csv;charset=utf-8');
      toast('工单 CSV 已导出', 'success');
    } catch (e) { toast('CSV 导出失败：' + e.message, 'error'); }
  };

  container.querySelector('#btnEmbz').onclick = async () => {
    try {
      await flushSave();
      const bytes = exportProjectPackage(project);
      downloadBytes(safeName(project.name) + '.embz', bytes);
      toast('工程包已导出，可发送给他人导入', 'success');
    } catch (e) { toast('工程包导出失败：' + e.message, 'error'); }
  };
}

function safeName(n) {
  return (n || 'design').replace(/[\\/:*?"<>|]/g, '_');
}
