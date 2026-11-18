'use strict';
/* 导出页：统计报表、DST 导出/导回、工单 CSV、工程包 */
const ExportPage = {
  /* DST 解码结果 → 设计数据（raw 成品针迹图形，可继续编辑） */
  designFromDst(decoded) {
    const shapes = [], sequence = [];
    decoded.blocks.forEach((blk, i) => {
      const thread = MADEIRA[(i * 7 + 6) % MADEIRA.length];
      const pts = blk.stitches.filter(s => s.f === 0).map(s => [s.x, s.y]);
      if (!pts.length) pts.push([0, 0]);
      const shape = {
        id: U.uid(), name: '针迹块' + (i + 1), type: 'raw', closed: false,
        points: pts, holes: [], stitches: blk.stitches,
        color: thread.code, params: {},
      };
      shapes.push(shape);
      sequence.push({ kind: 'block', id: U.uid(), threadId: thread.code, shapeIds: [shape.id] });
    });
    return { shapes, sequence };
  },
};

App.pages.export = {
  render(el) {
    el.innerHTML = `
      <div class="export-wrap">
        <div class="page-head"><h2>统计与导出</h2></div>
        <div id="statArea"></div>
        <div class="export-actions">
          <button class="btn primary" id="btnDst">⬇ 导出 DST 针迹文件</button>
          <button class="btn" id="btnCsv">⬇ 工单另存 CSV</button>
          <button class="btn" id="btnPkg">⬇ 导出工程包（可发给别人）</button>
          <button class="btn" id="btnImportDst">⬆ 导入 DST 为新工程</button>
          <input type="file" id="fileDst" accept=".dst,.DST" hidden>
        </div>
        <div class="note">
          DST 说明：跳针/剪线按 Tajima 标准编码（跳针 0x83、换色 0xC3、剪线为原地跳针），
          导出的文件可以再导回本系统继续修改。工单 CSV 含 Excel 兼容 BOM，可直接打开。
        </div>
      </div>`;
    this.el = el;
    this.renderStats();

    el.querySelector('#btnDst').onclick = () => {
      if (!App.lastCompute) { App.toast('针迹还没算好，稍等一下', 'err'); return; }
      const buf = DST.encode(App.lastCompute.blocks, { name: App.project.name });
      U.download(App.project.name + '.dst', new Blob([buf], { type: 'application/octet-stream' }));
      App.toast('DST 已导出');
    };
    el.querySelector('#btnCsv').onclick = () => this.exportCsv();
    el.querySelector('#btnPkg').onclick = () => {
      U.download(App.project.name + '.embpkg.json', Store.exportPackage([App.project.id]), 'application/json');
    };
    el.querySelector('#btnImportDst').onclick = () => el.querySelector('#fileDst').click();
    el.querySelector('#fileDst').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try {
        const buf = await U.readFile(f, false);
        const d = ExportPage.designFromDst(DST.decode(buf));
        d.settings = U.defaultSettings();
        App.newProject(f.name.replace(/\.dst$/i, ''), d);
        App.toast('DST 导入成功，可继续编辑');
      } catch (err) { App.toast('DST 导入失败：' + err.message, 'err'); }
    };
  },

  onCompute() { this.renderStats(); },

  renderStats() {
    const area = this.el.querySelector('#statArea');
    if (!App.lastCompute) { area.innerHTML = '<div class="empty">针迹计算中…</div>'; return; }
    const s = App.lastCompute.stats;
    let rows = '';
    let no = 0;
    for (const blk of App.lastCompute.blocks) {
      const t = threadByCode(blk.threadId);
      rows += `<tr>
        <td>${++no}</td>
        <td><span class="sw" style="background:${t.hex}"></span> ${t.code}</td>
        <td>${U.escapeHtml(t.name)}</td>
        <td class="num">${U.fmtInt(blk.stitches)}</td>
        <td class="num">${U.fmt1(blk.length / 1000)}</td>
        <td class="num">${blk.trims}</td>
      </tr>`;
    }
    area.innerHTML = `
      <div class="stat-cards">
        <div class="stat-card"><b>${U.fmtInt(s.stitches)}</b><span>总针数</span></div>
        <div class="stat-card"><b>${U.fmt1(s.lengthMm / 1000)} m</b><span>用线长度</span></div>
        <div class="stat-card"><b>${s.colorChanges}</b><span>换色次数</span></div>
        <div class="stat-card"><b>${s.trims}</b><span>剪线次数</span></div>
        <div class="stat-card"><b>${s.timeMin} 分</b><span>预估工时</span></div>
        <div class="stat-card"><b>${s.w}×${s.h}</b><span>尺寸 mm</span></div>
      </div>
      <table class="stat-table">
        <thead><tr><th>#</th><th>线号</th><th>颜色</th><th>针数</th><th>用线(m)</th><th>剪线</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  },

  exportCsv() {
    if (!App.lastCompute) { App.toast('针迹还没算好，稍等一下', 'err'); return; }
    const s = App.lastCompute.stats;
    const p = App.project;
    const lines = [];
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    lines.push(['绣花工单', '', '', '', '', ''].map(q).join(','));
    lines.push(['花稿名称', p.name, '导出日期', new Date().toLocaleDateString('zh-CN'), '', ''].map(q).join(','));
    lines.push(['总针数', s.stitches, '尺寸(mm)', `${s.w}×${s.h}`, '预估工时(分)', s.timeMin].map(q).join(','));
    lines.push(['换色次数', s.colorChanges, '剪线次数', s.trims, '用线总长(m)', U.fmt1(s.lengthMm / 1000)].map(q).join(','));
    lines.push('');
    lines.push(['序号', '线号', '颜色', '针数', '用线(m)', '剪线次数'].map(q).join(','));
    let no = 0;
    for (const blk of App.lastCompute.blocks) {
      const t = threadByCode(blk.threadId);
      lines.push([++no, t.code, t.name, blk.stitches, U.fmt1(blk.length / 1000), blk.trims].map(q).join(','));
    }
    U.download(p.name + '-工单.csv', '﻿' + lines.join('\r\n'), 'text/csv');
    App.toast('工单 CSV 已导出');
  },
};
