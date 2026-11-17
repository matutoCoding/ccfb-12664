// 配线配色页：按绣作顺序排列、换色排序、插剪线/跳针、色板管理
import { state, markDirty, requestBuild } from '../../app.js';
import { uid } from '../../core/constants.js';
import { F } from '../../core/constants.js';
import { toast, escapeHtml, promptDialog } from '../ui.js';

export async function renderColors(container) {
  const project = state.current;
  if (!project) { location.hash = '#/projects'; return; }
  const result = state.stitchResult || await requestBuild();

  container.innerHTML = `
    <div class="page">
      <div class="page-head">
        <h2>配线配色</h2>
        <div class="toolbar">
          <button id="btnAddColor">＋ 新增线色</button>
          <button id="btnRecalc">重新计算针迹</button>
        </div>
      </div>
      <div class="color-layout">
        <div>
          <h3 style="margin:0 0 10px;color:var(--fg-dim);font-size:13px">绣作顺序（按针迹实际出线顺序）</h3>
          <div id="seqList"></div>
          <h3 style="margin:22px 0 10px;color:var(--fg-dim);font-size:13px">剪线 / 跳针规则</h3>
          <div class="card">
            <div class="field">
              <label>空跳超过该长度自动插剪线 <b id="trimLabel">${project.settings.trimGap} mm</b></label>
              <input type="range" id="trimGap" min="2" max="20" step="0.5" value="${project.settings.trimGap}">
            </div>
            <div id="manualMarkers"></div>
            <p class="hint">规则说明：同色块内部按最短路径（最近邻 + 2-opt 去交叉）连接；
            空跳距离超过阈值时自动插入剪线码，超长空跳自动拆分为多条跳针（DST 单条最大 12.1mm）。</p>
          </div>
        </div>
        <div>
          <h3 style="margin:0 0 10px;color:var(--fg-dim);font-size:13px">线号色板（Madeira 等，可自定义）</h3>
          <div class="card">
            <div class="row2" style="margin-bottom:10px">
              <input id="newName" placeholder="颜色名，如 宝蓝">
              <input id="newCode" placeholder="线号，如 1320">
            </div>
            <div class="inline" style="margin-bottom:10px">
              <input type="color" id="newHex" value="#4f9cf5" style="flex:1">
              <button class="primary" id="btnChipAdd" style="flex:1">加入色板</button>
            </div>
            <div class="palette-grid" id="paletteGrid"></div>
          </div>
        </div>
      </div>
    </div>`;

  renderSeqList(result);
  renderPalette();

  container.querySelector('#trimGap').oninput = (e) => {
    project.settings.trimGap = parseFloat(e.target.value);
    container.querySelector('#trimLabel').textContent = project.settings.trimGap + ' mm';
    markDirty();
    requestBuild().then(r => renderSeqList(r));
  };
  container.querySelector('#btnRecalc').onclick = async () => {
    const r = await requestBuild(); renderSeqList(r); toast('针迹已重算', 'success', 1500);
  };
  container.querySelector('#btnAddColor').onclick = async () => {
    const name = await promptDialog('新颜色名称', '新线色');
    if (!name) return;
    project.palette.push({ id: uid('col'), code: '自定义', name, hex: '#888888', brand: '自定义' });
    markDirty(); renderPalette();
  };
  container.querySelector('#btnChipAdd').onclick = () => {
    const name = container.querySelector('#newName').value.trim() || '自定义色';
    const code = container.querySelector('#newCode').value.trim() || '-';
    const hex = container.querySelector('#newHex').value;
    project.palette.push({ id: uid('col'), code, name, hex, brand: '自定义' });
    markDirty(); renderPalette(); toast('已加入色板', 'success', 1500);
  };
}

function renderSeqList(result) {
  const project = state.current;
  const el = document.getElementById('seqList');
  if (!el) return;
  const colorMap = new Map(project.palette.map(c => [c.id, c]));
  // 每色统计
  const statsByColor = new Map();
  if (result) {
    for (const b of result.blocks) {
      const cur = statsByColor.get(b.colorId) || { stitches: 0, blocks: 0 };
      cur.stitches += b.stitches.length; cur.blocks++;
      statsByColor.set(b.colorId, cur);
    }
  }
  const order = result?.colorOrder || [...new Set(project.shapes.map(s => s.colorId))];
  el.innerHTML = order.map((colorId, idx) => {
    const c = colorMap.get(colorId) || { hex: '#888', name: '缺失色', code: '-' };
    const st = statsByColor.get(colorId);
    return `
      <div class="thread-row" data-id="${colorId}">
        <span class="order">${idx + 1}</span>
        <span class="swatch" style="background:${c.hex};width:34px;height:34px;border-radius:6px"></span>
        <div class="meta">
          <div class="t-name">${escapeHtml(c.name)} <span class="badge">${escapeHtml(c.brand || '')}</span></div>
          <div class="t-code">线号 ${escapeHtml(c.code)} · ${st ? st.stitches + ' 针 / ' + st.blocks + ' 块' : '未使用'}</div>
        </div>
        <button data-act="up" ${idx === 0 ? 'disabled' : ''}>↑</button>
        <button data-act="down" ${idx === order.length - 1 ? 'disabled' : ''}>↓</button>
        <button data-act="assign">换色</button>
      </div>`;
  }).join('') || '<p class="hint">当前没有针迹，请先在编辑器中绘制形状。</p>';

  el.onclick = async (e) => {
    const row = e.target.closest('.thread-row'); if (!row) return;
    const act = e.target.dataset.act;
    const colorId = row.dataset.id;
    const orderNow = result?.colorOrder || [...new Set(project.shapes.map(s => s.colorId))];
    const i = orderNow.indexOf(colorId);
    if (act === 'up' || act === 'down') {
      const j = act === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= orderNow.length) return;
      // 排序通过交换两色在所有形状上的 colorId 实现（保持色板不动）
      const other = orderNow[j];
      project.shapes.forEach(s => {
        if (s.colorId === colorId) s.colorId = other;
        else if (s.colorId === other) s.colorId = colorId;
      });
      markDirty();
      const r = await requestBuild();
      renderSeqList(r);
    }
    if (act === 'assign') {
      const options = project.palette.map(c =>
        `<option value="${c.id}" ${c.id === colorId ? 'selected' : ''}>${escapeHtml(c.code)} ${escapeHtml(c.name)}</option>`).join('');
      const root = document.getElementById('modalRoot');
      root.innerHTML = `<div class="modal-mask"><div class="modal">
        <h3>更换绣线</h3>
        <select id="selColor">${options}</select>
        <div class="modal-actions"><button data-v="0">取消</button><button class="primary" data-v="1">应用</button></div>
      </div></div>`;
      root.onclick = async (ev) => {
        if (ev.target.classList.contains('modal-mask') || ev.target.dataset.v !== undefined) {
          if (ev.target.dataset.v === '1') {
            const newId = root.querySelector('#selColor').value;
            project.shapes.filter(s => s.colorId === colorId).forEach(s => s.colorId = newId);
            markDirty();
            const r = await requestBuild(); renderSeqList(r);
          }
          root.innerHTML = ''; root.onclick = null;
        }
      };
    }
  };

  // 剪线/跳针实际发生情况
  const markerEl = document.getElementById('manualMarkers');
  if (markerEl && result) {
    const s = result.stats;
    markerEl.innerHTML = `
      <div class="stat-grid" style="margin:10px 0">
        <div class="stat-box"><div class="v">${s.trimCount}</div><div class="l">剪线次数</div></div>
        <div class="stat-box"><div class="v">${s.jumpCount}</div><div class="l">跳针次数</div></div>
        <div class="stat-box"><div class="v">${s.colorChanges}</div><div class="l">换色次数</div></div>
        <div class="stat-box"><div class="v">${(s.threadLengthMm / 1000).toFixed(2)}m</div><div class="l">用线总长</div></div>
      </div>`;
  }
}

function renderPalette() {
  const project = state.current;
  const grid = document.getElementById('paletteGrid');
  if (!grid) return;
  grid.innerHTML = project.palette.map(c => `
    <div class="palette-chip" data-id="${c.id}" title="${escapeHtml(c.name)}">
      <div class="color" style="background:${c.hex}"></div>
      <div class="code">${escapeHtml(c.code)}</div>
      <div class="nm">${escapeHtml(c.name)}</div>
    </div>`).join('');
  grid.onclick = (e) => {
    const chip = e.target.closest('.palette-chip'); if (!chip) return;
    const c = project.palette.find(x => x.id === chip.dataset.id);
    const root = document.getElementById('modalRoot');
    root.innerHTML = `<div class="modal-mask"><div class="modal">
      <h3>编辑线色</h3>
      <div class="field"><label>颜色名</label><input id="edName" value="${escapeHtml(c.name)}"></div>
      <div class="field"><label>线号</label><input id="edCode" value="${escapeHtml(c.code)}"></div>
      <div class="field"><label>颜色</label><input type="color" id="edHex" value="${c.hex}"></div>
      <div class="modal-actions">
        <button class="danger" data-v="del">删除</button>
        <button data-v="0">取消</button>
        <button class="primary" data-v="1">保存</button>
      </div></div></div>`;
    root.onclick = async (ev) => {
      if (ev.target.classList.contains('modal-mask') || ev.target.dataset.v !== undefined) {
        const v = ev.target.dataset.v;
        if (v === '1') {
          c.name = root.querySelector('#edName').value.trim() || c.name;
          c.code = root.querySelector('#edCode').value.trim() || c.code;
          c.hex = root.querySelector('#edHex').value;
          markDirty(); renderPalette();
        } else if (v === 'del') {
          if (project.shapes.some(s => s.colorId === c.id)) { toast('该颜色正在使用中，不能删除', 'error'); }
          else { project.palette = project.palette.filter(x => x.id !== c.id); markDirty(); renderPalette(); }
        }
        root.innerHTML = ''; root.onclick = null;
      }
    };
  };
}
