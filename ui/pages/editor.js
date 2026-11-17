// 打版编辑页
import { state, markDirty, pushHistory, undo, redo, requestBuild, updateStatus } from '../../app.js';
import { STITCH_TYPE_LABELS, uid, defaultParams } from '../../core/constants.js';
import { mm } from '../../core/math.js';
import { EditorCanvas } from '../../canvas/editor-canvas.js';
import { HOOPS } from '../../data/palette.js';
import { parseSvg } from '../../core/svg-parser.js';
import { readFileAsUint8, fromUtf8 } from '../../core/store.js';
import { dstToShapes } from '../../core/dst.js';
import { toast, escapeHtml } from '../ui.js';

let canvasCtl = null;
let showStitch = true;
let tool = 'select';
let penPoints = null;

export async function renderEditor(container) {
  const project = state.current;
  if (!project) { location.hash = '#/projects'; return; }
  container.innerHTML = `
    <div class="editor-layout">
      <aside class="side">
        <h3>工具</h3>
        <div class="tool-grid" id="toolGrid">
          <button data-tool="select" class="active">选择/框选</button>
          <button data-tool="pen">钢笔描线</button>
          <button data-act="rect">矩形</button>
          <button data-act="ellipse">椭圆</button>
          <button data-act="svg">导入 SVG</button>
          <button data-act="dst">导入 DST</button>
        </div>
        <input type="file" id="svgFile" accept=".svg,image/svg+xml" hidden>
        <input type="file" id="dstFile" accept=".dst" hidden>
        <h3>视图</h3>
        <div class="check-row"><input type="checkbox" id="chkStitch" ${showStitch ? 'checked' : ''}><label for="chkStitch">显示针迹</label></div>
        <div class="check-row"><input type="checkbox" id="chkSnap" ${project.settings.snap ? 'checked' : ''}><label for="chkSnap">网格吸附 (${project.settings.gridSize}mm)</label></div>
        <p class="hint">滚轮缩放 · 右键/空格平移 · 双击钢笔结束 · Del 删除选中 · Ctrl+Z 撤销</p>
        <h3>图层 (${project.shapes.length})</h3>
        <div id="layerList"></div>
      </aside>

      <div class="canvas-wrap">
        <canvas id="editorCanvas"></canvas>
        <div class="canvas-info" id="canvasInfo"></div>
        <div class="canvas-hud">
          <button id="btnFit">适应窗口</button>
          <button id="btnUndo" title="Ctrl+Z">↶ 撤销</button>
          <button id="btnRedo" title="Ctrl+Y">↷ 重做</button>
          <button id="btnFinishPen" hidden>结束描线</button>
        </div>
      </div>

      <aside class="side right">
        <h3>形状参数</h3>
        <div id="paramPanel"></div>
      </aside>
    </div>`;

  const canvas = container.querySelector('#editorCanvas');
  canvasCtl = new EditorCanvas(canvas, project, {
    getSelectedIds: () => project.selection,
    setSelection: (ids) => { project.selection = ids; refreshLayersAndParams(); },
    toggleSelection: (id) => {
      project.selection = project.selection.includes(id)
        ? project.selection.filter(x => x !== id) : [...project.selection, id];
      refreshLayersAndParams();
    },
    onModify: (commit) => {
      if (commit) pushHistory();
      markDirty();
      scheduleRebuild();
      updateInfo();
    },
    getTool: () => tool,
    getStitchResult: () => state.stitchResult,
    getShowStitch: () => showStitch,
    getHoop: () => HOOPS.find(h => h.id === project.settings.hoopId),
    onPenPoint: (pt, shift) => handlePen(pt, shift),
    onDelete: () => deleteSelected()
  });

  // ---- 工具按钮 ----
  container.querySelector('#toolGrid').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.tool) {
      tool = b.dataset.tool;
      container.querySelectorAll('#toolGrid button').forEach(x => x.classList.toggle('active', x === b));
      canvasCtl.setTool(tool);
      if (tool !== 'pen') penPoints = null, container.querySelector('#btnFinishPen').hidden = true;
    }
    if (b.dataset.act === 'rect') addPrimitive('rect');
    if (b.dataset.act === 'ellipse') addPrimitive('ellipse');
    if (b.dataset.act === 'svg') container.querySelector('#svgFile').click();
    if (b.dataset.act === 'dst') container.querySelector('#dstFile').click();
  };

  container.querySelector('#chkStitch').onchange = (e) => { showStitch = e.target.checked; };
  container.querySelector('#chkSnap').onchange = (e) => {
    project.settings.snap = e.target.checked; markDirty();
  };
  container.querySelector('#btnFit').onclick = () => canvasCtl.fitOnce();
  container.querySelector('#btnUndo').onclick = () => doUndo();
  container.querySelector('#btnRedo').onclick = () => doRedo();
  container.querySelector('#btnFinishPen').onclick = () => finishPen();

  // 双击结束钢笔
  canvas.ondblclick = () => { if (tool === 'pen') finishPen(); };

  // SVG 导入
  container.querySelector('#svgFile').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const bytes = await readFileAsUint8(file);
      const text = fromUtf8(bytes);
      const parsed = parseSvg(text);
      const colorId = project.palette[Math.min(project.shapes.length, project.palette.length - 1)].id;
      const created = [];
      for (const path of parsed.paths) {
        const sh = {
          id: uid('shape'), type: path.closed ? 'tatami' : 'run',
          name: file.name.replace(/\.svg$/i, '') + (created.length + 1),
          points: path.points.map(p => ({ ...p })),
          closed: path.closed, visible: true, colorId,
          params: defaultParams(path.closed ? 'tatami' : 'run')
        };
        project.shapes.push(sh); created.push(sh);
      }
      project.selection = created.map(s => s.id);
      pushHistory(); markDirty();
      toast(`识别到 ${created.length} 条轮廓，已自动生成针迹区域`, 'success', 3500);
      refreshLayersAndParams(); scheduleRebuild();
    } catch (err) {
      toast('SVG 导入失败：' + err.message, 'error', 5000);
    }
    e.target.value = '';
  };

  // DST 导入（可继续编辑）
  container.querySelector('#dstFile').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const bytes = await readFileAsUint8(file);
      const { shapes } = dstToShapes(bytes, project.palette);
      project.shapes.push(...shapes);
      project.selection = shapes.map(s => s.id);
      pushHistory(); markDirty();
      toast(`DST 已导入：${shapes.length} 个针迹块，可移动/换色后继续导出`, 'success', 4000);
      refreshLayersAndParams(); scheduleRebuild();
    } catch (err) {
      toast('DST 导入失败：' + err.message, 'error', 5000);
    }
    e.target.value = '';
  };

  // 快捷键
  container._onKey = (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault(); project.selection = project.shapes.map(s => s.id); refreshLayersAndParams();
    }
  };
  window.addEventListener('keydown', container._onKey);

  refreshLayersAndParams();
  scheduleRebuild();
  updateInfo();
  const timer = setInterval(() => { if (!document.getElementById('editorCanvas')) { clearInterval(timer); return; } updateInfo(); }, 800);
}

function doUndo() { if (undo()) { canvasCtl?.setProject(state.current); refreshLayersAndParams(); scheduleRebuild(); toast('已撤销', '', 1200); } }
function doRedo() { if (redo()) { canvasCtl?.setProject(state.current); refreshLayersAndParams(); scheduleRebuild(); toast('已重做', '', 1200); } }

let rebuildTimer = null;
function scheduleRebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(async () => {
    updateStatus('计算中… <span class="spinner"></span>');
    const r = await requestBuild();
    if (r) updateStatus(`针迹计算完成：${r.stats.stitchCount} 针，耗时 ${r.stats.computeMs}ms`, false);
  }, 150);
}

function updateInfo() {
  const el = document.getElementById('canvasInfo');
  if (!el) return;
  const s = state.stitchResult?.stats;
  el.innerHTML = s
    ? `针数: ${s.stitchCount}<br>用线: ${(s.threadLengthMm / 1000).toFixed(2)} m<br>计算: ${state.stitchResult.stats.computeMs} ms`
    : '等待计算…';
}

function addPrimitive(kind) {
  const project = state.current;
  const colorId = project.palette[Math.min(project.shapes.length, project.palette.length - 1)].id;
  const base = 400;
  let points, type, closed;
  if (kind === 'rect') {
    points = [{ x: -base, y: -base }, { x: base, y: -base }, { x: base, y: base }, { x: -base, y: base }, { x: -base, y: -base }];
    type = 'tatami'; closed = true;
  } else {
    points = [];
    for (let i = 0; i <= 40; i++) {
      const a = i / 40 * Math.PI * 2;
      points.push({ x: Math.round(Math.cos(a) * base), y: Math.round(Math.sin(a) * base * 0.7) });
    }
    type = 'satin'; closed = true;
  }
  const sh = {
    id: uid('shape'), type, name: (kind === 'rect' ? '矩形' : '椭圆') + (project.shapes.length + 1),
    points, closed, visible: true, colorId, params: defaultParams(type)
  };
  project.shapes.push(sh);
  project.selection = [sh.id];
  pushHistory(); markDirty();
  refreshLayersAndParams(); scheduleRebuild();
}

function handlePen(pt) {
  const project = state.current;
  if (!penPoints) {
    penPoints = [];
    document.getElementById('btnFinishPen').hidden = false;
  }
  penPoints.push({ ...pt });
  // 临时形状预览
  const tmpId = '__pen_tmp';
  let tmp = project.shapes.find(s => s.id === tmpId);
  if (!tmp) {
    tmp = { id: tmpId, type: 'run', name: '描线中', points: penPoints, closed: false, visible: true, colorId: project.palette[0].id, params: defaultParams('run') };
    project.shapes.push(tmp);
  } else tmp.points = penPoints;
  canvasCtl?.render();
}

function finishPen() {
  const project = state.current;
  const tmp = project.shapes.find(s => s.id === '__pen_tmp');
  document.getElementById('btnFinishPen').hidden = true;
  if (!tmp || tmp.points.length < 2) {
    project.shapes = project.shapes.filter(s => s.id !== '__pen_tmp');
    penPoints = null; return;
  }
  tmp.id = uid('shape');
  tmp.name = '手绘线' + project.shapes.length;
  project.selection = [tmp.id];
  penPoints = null;
  pushHistory(); markDirty();
  refreshLayersAndParams(); scheduleRebuild();
}

function deleteSelected() {
  const project = state.current;
  if (!project.selection.length) return;
  const ids = new Set(project.selection);
  project.shapes = project.shapes.filter(s => !ids.has(s.id));
  project.selection = [];
  pushHistory(); markDirty();
  refreshLayersAndParams(); scheduleRebuild();
  toast('已删除选中形状', '', 1200);
}

function refreshLayersAndParams() {
  const project = state.current; if (!project) return;
  const list = document.getElementById('layerList');
  if (list) {
    const colorMap = new Map(project.palette.map(c => [c.id, c]));
    list.innerHTML = project.shapes.map((s, i) => `
      <div class="layer-item ${project.selection.includes(s.id) ? 'selected' : ''}" data-id="${s.id}">
        <span class="swatch" style="background:${colorMap.get(s.colorId)?.hex || '#888'}"></span>
        <span class="name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)} <span class="badge">${STITCH_TYPE_LABELS[s.type] || s.type}</span></span>
        <button class="eye" data-eye="${s.id}" title="显隐">${s.visible ? '👁' : '🚫'}</button>
      </div>`).join('') || '<p class="hint">暂无形状，从左侧工具开始绘制</p>';
    list.onclick = (e) => {
      const eye = e.target.closest('[data-eye]');
      const item = e.target.closest('.layer-item'); if (!item) return;
      const sh = project.shapes.find(x => x.id === item.dataset.id);
      if (eye) { sh.visible = !sh.visible; markDirty(); scheduleRebuild(); refreshLayersAndParams(); return; }
      project.selection = e.shiftKey
        ? (project.selection.includes(sh.id) ? project.selection.filter(x => x !== sh.id) : [...project.selection, sh.id])
        : [sh.id];
      refreshLayersAndParams();
    };
  }
  renderParamPanel();
}

function renderParamPanel() {
  const project = state.current;
  const panel = document.getElementById('paramPanel');
  if (!panel) return;
  const selected = project.shapes.filter(s => project.selection.includes(s.id));
  if (!selected.length) {
    panel.innerHTML = '<p class="hint">选中一个或多个形状后在此调整针法与参数，参数修改会立即重算针迹。</p>';
    return;
  }
  const sh = selected[0];
  const p = sh.params;
  const typeOptions = Object.entries(STITCH_TYPE_LABELS)
    .filter(([t]) => t !== 'rawStitch')
    .map(([t, label]) => `<option value="${t}" ${sh.type === t ? 'selected' : ''}>${label}</option>`).join('');
  const colorOptions = project.palette.map(c =>
    `<option value="${c.id}" ${sh.colorId === c.id ? 'selected' : ''}>${escapeHtml(c.code)} ${escapeHtml(c.name)}</option>`).join('');

  const slider = (key, label, min, max, step, unit = 'mm') => `
    <div class="field">
      <label>${label}<b>${p[key]}${unit}</b></label>
      <input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${p[key]}">
    </div>`;

  let typeFields = '';
  if (sh.type === 'run' || sh.type === 'satin' || sh.type === 'zigzag') {
    typeFields += slider('runLength', '针步长度', 0.8, 8, 0.1);
  }
  if (sh.type === 'tatami') {
    typeFields += slider('density', '针距密度', 0.15, 1.2, 0.05);
    typeFields += slider('runLength', '针步长度', 0.8, 8, 0.1);
    typeFields += `<div class="field"><label>填充角度<b>${p.fillAngle ?? 45}°</b></label>
      <input type="range" data-key="fillAngle" min="0" max="180" step="5" value="${p.fillAngle ?? 45}"></div>`;
  }
  if (sh.type === 'satin') typeFields += slider('width', '包针宽度', 0.5, 10, 0.1);
  if (sh.type === 'zigzag') typeFields += slider('zigAmplitude', '锯齿振幅', 0.3, 6, 0.1);
  if (sh.type !== 'run' && sh.type !== 'zigzag' && sh.type !== 'rawStitch') {
    typeFields += slider('pullComp', '收缩补偿', 0, 1.2, 0.05);
  }
  if (sh.type !== 'run' && sh.type !== 'zigzag' && sh.type !== 'rawStitch') {
    typeFields += slider('underlayInset', '底线下缩', 0, 1.5, 0.05);
  }

  panel.innerHTML = `
    <div class="field"><label>形状名称</label><input id="shapeName" value="${escapeHtml(sh.name)}"></div>
    <div class="field"><label>针法类型</label><select id="shapeType">${typeOptions}</select></div>
    <div class="field"><label>绣线颜色</label><select id="shapeColor">${colorOptions}</select></div>
    ${typeFields}
    <div class="check-row"><input type="checkbox" id="pUnderlay" ${p.underlay ? 'checked' : ''} ${sh.type === 'run' || sh.type === 'zigzag' || sh.type === 'rawStitch' ? 'disabled' : ''}><label for="pUnderlay">启用底线</label></div>
    <div class="check-row"><input type="checkbox" id="pShort" ${p.shortStitch ? 'checked' : ''} ${sh.type === 'run' || sh.type === 'zigzag' || sh.type === 'rawStitch' ? 'disabled' : ''}><label for="pShort">长短针</label></div>
    <div class="check-row"><input type="checkbox" id="pLock" ${p.lockStitch ? 'checked' : ''} ${sh.type === 'rawStitch' ? 'disabled' : ''}><label for="pLock">首尾锁针</label></div>
    ${selected.length > 1 ? `<p class="hint">已选 ${selected.length} 个形状，参数修改将应用到全部选中形状</p>` : ''}
    <div class="field" style="margin-top:14px">
      <label>全局：空跳剪线阈值<b>${project.settings.trimGap}mm</b></label>
      <input type="range" id="trimGap" min="2" max="20" step="0.5" value="${project.settings.trimGap}">
    </div>`;

  const applyAll = (fn) => selected.forEach(s => { if (s.type !== 'rawStitch' || !('type' in s)) fn(s); });
  panel.querySelector('#shapeName').oninput = (e) => { sh.name = e.target.value; markDirty(); refreshLayersAndParamsKeepFocus(); };
  panel.querySelector('#shapeType').onchange = (e) => {
    pushHistory();
    applyAll(s => { s.type = e.target.value; s.params = { ...defaultParams(e.target.value), ...s.params }; });
    markDirty(); refreshLayersAndParams(); scheduleRebuild();
  };
  panel.querySelector('#shapeColor').onchange = (e) => {
    applyAll(s => { s.colorId = e.target.value; });
    markDirty(); refreshLayersAndParams(); scheduleRebuild();
  };
  panel.querySelectorAll('input[type=range][data-key]').forEach(r => {
    r.oninput = () => {
      const key = r.dataset.key;
      const val = parseFloat(r.value);
      applyAll(s => { s.params[key] = val; });
      // 只更新数值标签，不重建面板，保持滑块连续拖动
      const label = r.previousElementSibling;
      if (label) {
        const b = label.querySelector('b');
        if (b) b.textContent = val + (key === 'fillAngle' ? '°' : 'mm');
      }
      markDirty(); scheduleRebuild();
    };
  });
  panel.querySelector('#pUnderlay').onchange = (e) => { applyAll(s => s.params.underlay = e.target.checked); markDirty(); scheduleRebuild(); };
  panel.querySelector('#pShort').onchange = (e) => { applyAll(s => s.params.shortStitch = e.target.checked); markDirty(); scheduleRebuild(); };
  panel.querySelector('#pLock').onchange = (e) => { applyAll(s => s.params.lockStitch = e.target.checked); markDirty(); scheduleRebuild(); };
  const trimSlider = panel.querySelector('#trimGap');
  trimSlider.oninput = (e) => {
    project.settings.trimGap = parseFloat(e.target.value);
    trimSlider.previousElementSibling.querySelector('b').textContent = project.settings.trimGap + 'mm';
    markDirty(); scheduleRebuild();
  };
}

function refreshLayersAndParamsKeepFocus() {
  refreshLayersAndParams();
}
