// 工程列表页
import { state, openProject } from '../../app.js';
import {
  storage, createProject, projectFromSample, cloneProject,
  importProjectPackage, readFileAsUint8, downloadBytes
} from '../../core/store.js';
import { toast, confirmDialog, promptDialog, formatTime, escapeHtml } from '../ui.js';
import { makeThumbnail } from '../../canvas/thumbnail.js';
import { SAMPLES } from '../../data/samples.js';

export async function renderProjects(container) {
  state.projects = await storage.list();
  state.projects.sort((a, b) => b.updatedAt - a.updatedAt);

  container.innerHTML = `
    <div class="page">
      <div class="page-head">
        <h2>工程列表</h2>
        <div class="toolbar">
          <button class="primary" id="btnNew">＋ 新建空白工程</button>
          <button id="btnSample">内置花稿</button>
          <button id="btnImport">导入工程包 (.embz)</button>
          <input type="file" id="fileImport" accept=".embz,.zip,.json" hidden>
        </div>
      </div>
      <div id="projectGrid"></div>
    </div>`;

  const grid = container.querySelector('#projectGrid');
  if (!state.projects.length) {
    grid.innerHTML = `
      <div class="empty">
        <div class="big">🧷</div>
        <p>还没有任何花样工程</p>
        <p>新建空白工程，或从内置花稿开始体验</p>
      </div>`;
  } else {
    grid.innerHTML = '<div class="grid-cards">' + state.projects.map(p => cardHtml(p)).join('') + '</div>';
    // 异步生成缩略图
    state.projects.forEach((p, i) => renderThumb(p, grid.querySelectorAll('.prj-card')[i]));
    grid.onclick = (e) => handleCardClick(e);
  }

  container.querySelector('#btnNew').onclick = async () => {
    const name = await promptDialog('新建工程名称', '花样 ' + new Date().toLocaleDateString('zh-CN'));
    if (!name) return;
    const p = createProject(name);
    state.projects.push(p);
    await storage.save(p);
    toast('工程已创建', 'success');
    openProject(p.id);
  };

  container.querySelector('#btnSample').onclick = async () => {
    const names = SAMPLES.map((s, i) => `${i + 1}. ${s().name}`).join('\n');
    const v = await promptDialog('选择内置花稿（输入序号 1-' + SAMPLES.length + '）\n' + names, '1');
    const idx = parseInt(v, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= SAMPLES.length) { toast('序号无效', 'error'); return; }
    const p = projectFromSample(idx);
    state.projects.push(p);
    await storage.save(p);
    toast('内置花稿已载入', 'success');
    openProject(p.id);
  };

  const fileInput = container.querySelector('#fileImport');
  container.querySelector('#btnImport').onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const bytes = await readFileAsUint8(file);
      const proj = await importProjectPackage(bytes);
      proj.id = 'prj_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      proj.name = proj.name + '（导入）';
      state.projects.push(proj);
      await storage.save(proj);
      toast('工程导入成功', 'success');
      renderProjects(container);
    } catch (err) {
      toast('导入失败：' + err.message, 'error', 4500);
    }
    fileInput.value = '';
  };
}

function cardHtml(p) {
  const stitch = (p.shapes || []).length;
  return `
    <div class="card prj-card" data-id="${p.id}">
      <div class="prj-thumb"><div class="spinner" style="margin:40px auto"></div></div>
      <h3>${escapeHtml(p.name)}</h3>
      <div class="prj-meta">
        形状数：${stitch}<br>
        更新：${formatTime(p.updatedAt)}
      </div>
      <div class="prj-actions">
        <button class="primary" data-act="open">打开</button>
        <button data-act="copy">复制</button>
        <button data-act="export">打包</button>
        <button class="danger" data-act="del">删除</button>
      </div>
    </div>`;
}

async function renderThumb(project, cardEl) {
  if (!cardEl) return;
  const thumb = cardEl.querySelector('.prj-thumb');
  try {
    const url = await makeThumbnail(project);
    thumb.innerHTML = '';
    thumb.style.backgroundImage = `url(${url})`;
  } catch {
    thumb.innerHTML = '<span style="line-height:110px;color:var(--fg-dim)">无预览</span>';
  }
}

async function handleCardClick(e) {
  const btn = e.target.closest('button');
  const card = e.target.closest('.prj-card');
  if (!card) return;
  const id = card.dataset.id;
  const proj = state.projects.find(p => p.id === id);
  if (!btn) { openProject(id); return; }
  const act = btn.dataset.act;
  if (act === 'open') return openProject(id);
  if (act === 'copy') {
    const name = await promptDialog('复制工程名称', proj.name + ' 副本');
    if (!name) return;
    const copy = cloneProject(proj, name);
    state.projects.push(copy);
    await storage.save(copy);
    toast('已复制工程', 'success');
    renderProjects(document.getElementById('view'));
  } else if (act === 'del') {
    const ok = await confirmDialog('删除工程', `确定删除「${proj.name}」吗？此操作不可恢复。`);
    if (!ok) return;
    await storage.remove(id);
    state.projects = state.projects.filter(p => p.id !== id);
    toast('工程已删除', 'success');
    renderProjects(document.getElementById('view'));
  } else if (act === 'export') {
    const { exportProjectPackage } = await import('../../core/store.js');
    const bytes = exportProjectPackage(proj);
    downloadBytes(proj.name + '.embz', bytes);
    toast('工程包已导出', 'success');
  }
}
