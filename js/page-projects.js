'use strict';
/* 工程列表页：新建/复制/删除/打开/打包导入导出 */
App.pages.projects = {
  render(el) {
    const projects = Store.list();
    el.innerHTML = `
      <div class="page-head">
        <h2>工程列表</h2>
        <div class="head-actions">
          <button class="btn primary" id="btnNew">＋ 新建空白工程</button>
          <button class="btn" id="btnSample">从内置花稿新建</button>
          <button class="btn" id="btnSvg">导入 SVG 线稿</button>
          <button class="btn" id="btnDst">导入 DST 针迹</button>
          <button class="btn" id="btnPkg">导入工程包</button>
          <button class="btn" id="btnExportAll" ${projects.length ? '' : 'disabled'}>打包导出全部</button>
        </div>
      </div>
      <div class="proj-grid" id="grid"></div>
      <input type="file" id="fileSvg" accept=".svg" hidden>
      <input type="file" id="fileDst" accept=".dst,.DST" hidden>
      <input type="file" id="filePkg" accept=".json,.embpkg" hidden>`;
    const grid = el.querySelector('#grid');
    if (!projects.length) {
      grid.innerHTML = '<div class="empty">还没有工程，点上面「新建」或「导入 SVG」开始打版</div>';
    }
    for (const p of projects) {
      const card = document.createElement('div');
      card.className = 'proj-card';
      card.innerHTML = `
        <div class="thumb">${p.thumb ? `<img src="${p.thumb}" alt="">` : '<span class="no-thumb">无预览</span>'}</div>
        <div class="proj-name" title="${U.escapeHtml(p.name)}">${U.escapeHtml(p.name)}</div>
        <div class="proj-meta">${U.fmtInt(p.stitches || 0)} 针 · ${new Date(p.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
        <div class="proj-ops">
          <button class="btn small primary" data-act="open">打开</button>
          <button class="btn small" data-act="dup">复制</button>
          <button class="btn small" data-act="exp">导出</button>
          <button class="btn small danger" data-act="del">删除</button>
        </div>`;
      card.querySelector('[data-act=open]').onclick = () => App.openProject(p.id);
      card.querySelector('[data-act=dup]').onclick = () => { Store.duplicate(p.id); App.route(); App.toast('已复制'); };
      card.querySelector('[data-act=exp]').onclick = () => {
        U.download(p.name + '.embpkg.json', Store.exportPackage([p.id]), 'application/json');
      };
      card.querySelector('[data-act=del]').onclick = () => {
        if (confirm(`确定删除工程「${p.name}」？此操作不可恢复。`)) {
          Store.remove(p.id);
          if (App.project && App.project.id === p.id) App.closeProject();
          App.route();
        }
      };
      grid.appendChild(card);
    }

    el.querySelector('#btnNew').onclick = () => {
      const name = prompt('工程名称', '未命名花稿');
      if (name !== null) App.newProject(name || '未命名花稿');
    };
    el.querySelector('#btnSample').onclick = () => {
      const names = Samples.list.map((s, i) => `${i + 1}. ${s.name}`).join('\n');
      const pick = prompt('选择内置花稿（输入编号）：\n' + names, '1');
      const i = parseInt(pick, 10) - 1;
      if (i >= 0 && i < Samples.list.length) {
        const d = Samples.make(Samples.list[i].key);
        d.settings = U.defaultSettings();
        App.newProject(Samples.list[i].name.split('（')[0], d);
      }
    };
    el.querySelector('#btnSvg').onclick = () => el.querySelector('#fileSvg').click();
    el.querySelector('#fileSvg').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try {
        const text = await U.readFile(f, true);
        const d = SvgImport.importSvg(text);
        d.settings = U.defaultSettings();
        App.newProject(f.name.replace(/\.svg$/i, ''), d);
        App.toast(`SVG 导入成功：${d.shapes.length} 个图形，已自动配色`);
      } catch (err) { App.toast(err.message, 'err'); }
    };
    el.querySelector('#btnDst').onclick = () => el.querySelector('#fileDst').click();
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
    el.querySelector('#btnPkg').onclick = () => el.querySelector('#filePkg').click();
    el.querySelector('#filePkg').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try {
        const n = Store.importPackage(await U.readFile(f, true));
        App.toast(`成功导入 ${n} 个工程`);
        App.route();
      } catch (err) { App.toast(err.message, 'err'); }
    };
    el.querySelector('#btnExportAll').onclick = () => {
      const ids = Store.list().map(p => p.id);
      U.download('绣花工程包-' + new Date().toISOString().slice(0, 10) + '.embpkg.json', Store.exportPackage(ids), 'application/json');
    };
  },
};
