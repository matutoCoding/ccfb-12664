// 仿真预览页
import { state, markDirty, requestBuild } from '../../app.js';
import { Simulation } from '../../canvas/simulation.js';
import { FABRICS, HOOPS } from '../../data/palette.js';
import { formatDuration } from '../../core/engine.js';

let sim = null;
let playTimer = null;

export async function renderPreview(container) {
  const project = state.current;
  if (!project) { location.hash = '#/projects'; return; }
  const result = state.stitchResult || await requestBuild();

  container.innerHTML = `
    <div class="preview-layout" style="padding:16px">
      <div style="position:relative;min-height:420px">
        <canvas id="previewCanvas"></canvas>
      </div>
      <aside class="side" style="border:1px solid var(--border);border-radius:8px;height:fit-content">
        <h3>统计（参数改动实时更新）</h3>
        <div class="stat-grid" id="statGrid"></div>
        <h3>绣作顺序</h3>
        <div class="seq-bar" id="seqBar"></div>
        <h3>仿真设置</h3>
        <div class="field">
          <label>布料底色</label>
          <select id="selFabric">${FABRICS.map(f => `<option value="${f.id}" ${f.id === project.settings.fabricId ? 'selected' : ''}>${f.name}</option>`).join('')}</select>
        </div>
        <div class="field">
          <label>绷子型号</label>
          <select id="selHoop">${HOOPS.map(h => `<option value="${h.id}" ${h.id === project.settings.hoopId ? 'selected' : ''}>${h.name}</option>`).join('')}</select>
        </div>
        <div class="field">
          <label>模拟线径 <b id="threadLabel">${project.settings.threadWidthMm}mm</b></label>
          <input type="range" id="threadW" min="0.15" max="1.2" step="0.05" value="${project.settings.threadWidthMm}">
        </div>
        <div class="field">
          <label>侧向观察（线光泽）<b id="tiltLabel">0°</b></label>
          <input type="range" id="tilt" min="0" max="1" step="0.05" value="0">
        </div>
        <div class="field">
          <label>绣作进度 <b id="progLabel">100%</b></label>
          <input type="range" id="progress" min="0" max="1" step="0.01" value="1">
        </div>
        <div class="toolbar">
          <button id="btnPlay" class="primary">▶ 播放绣作</button>
          <button id="btnZoomIn">放大</button>
          <button id="btnZoomOut">缩小</button>
          <button id="btnFit">适应</button>
        </div>
        <label class="check-row" style="margin-top:10px"><input type="checkbox" id="chkDots" checked>显示针脚点（放大可见）</label>
      </aside>
    </div>`;

  const canvas = container.querySelector('#previewCanvas');
  sim = new Simulation(canvas, project);
  sim.setResult(result);
  updateStats(result);

  const wire = () => {
    sim.fabric = FABRICS.find(f => f.id === project.settings.fabricId);
    sim.hoop = HOOPS.find(h => h.id === project.settings.hoopId);
    sim.threadWidthMm = project.settings.threadWidthMm;
  };
  container.querySelector('#selFabric').onchange = (e) => { project.settings.fabricId = e.target.value; wire(); markDirty(); };
  container.querySelector('#selHoop').onchange = (e) => { project.settings.hoopId = e.target.value; wire(); markDirty(); };
  container.querySelector('#threadW').oninput = (e) => {
    project.settings.threadWidthMm = parseFloat(e.target.value);
    container.querySelector('#threadLabel').textContent = project.settings.threadWidthMm + 'mm';
    wire(); markDirty();
  };
  container.querySelector('#tilt').oninput = (e) => {
    sim.tilt = parseFloat(e.target.value);
    container.querySelector('#tiltLabel').textContent = Math.round(sim.tilt * 70) + '°';
  };
  container.querySelector('#progress').oninput = (e) => {
    sim.progress = parseFloat(e.target.value);
    container.querySelector('#progLabel').textContent = Math.round(sim.progress * 100) + '%';
  };
  container.querySelector('#chkDots').onchange = (e) => { sim.showStitchDots = e.target.checked; };
  container.querySelector('#btnZoomIn').onclick = () => sim.zoomAt({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, 1.2);
  container.querySelector('#btnZoomOut').onclick = () => sim.zoomAt({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, 0.83);
  container.querySelector('#btnFit').onclick = () => sim.fit();

  // 滚轮缩放与拖动平移
  canvas.onwheel = (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    sim.zoomAt({ x: e.clientX - r.left, y: e.clientY - r.top }, e.deltaY < 0 ? 1.12 : 0.89);
  };
  let panStart = null;
  canvas.onpointerdown = (e) => { panStart = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; };
  canvas.onpointermove = (e) => {
    if (!panStart) return;
    sim.pan(e.clientX - panStart.x, e.clientY - panStart.y);
    panStart = { x: e.clientX, y: e.clientY };
  };
  canvas.onpointerup = () => { panStart = null; canvas.style.cursor = 'default'; };

  container.querySelector('#btnPlay').onclick = () => {
    const btn = container.querySelector('#btnPlay');
    if (playTimer) { clearInterval(playTimer); playTimer = null; btn.textContent = '▶ 播放绣作'; return; }
    sim.progress = 0; btn.textContent = '⏸ 暂停';
    playTimer = setInterval(() => {
      sim.progress = Math.min(1, sim.progress + 0.012);
      const pr = container.querySelector('#progress');
      if (pr) { pr.value = sim.progress; container.querySelector('#progLabel').textContent = Math.round(sim.progress * 100) + '%'; }
      if (sim.progress >= 1) { clearInterval(playTimer); playTimer = null; btn.textContent = '▶ 播放绣作'; }
    }, 60);
  };

  // 监听工程变化（参数页改了之后切回来）刷新
  container._refresh = async () => {
    const r = await requestBuild();
    sim.setResult(r); updateStats(r);
  };
}

function updateStats(result) {
  const grid = document.getElementById('statGrid');
  if (!grid || !result) return;
  const s = result.stats;
  const items = [
    ['v', s.stitchCount, '总针数'],
    ['v', (s.threadLengthMm / 1000).toFixed(2) + ' m', '用线长度'],
    ['v', s.colorChanges, '换色次数'],
    ['v', s.trimCount, '剪线次数'],
    ['v', s.jumpCount, '跳针次数'],
    ['v', formatDuration(s.estimatedSeconds), '预估工时'],
    ['v', result.stats.computeMs + ' ms', '重算耗时'],
    ['v', result.shapeCount, '形状数量']
  ];
  grid.innerHTML = items.map(([, v, l]) => `<div class="stat-box"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');

  const bar = document.getElementById('seqBar');
  if (bar) {
    const colorMap = new Map(state.current.palette.map(c => [c.id, c]));
    bar.innerHTML = result.colorOrder.map((id, i) => {
      const c = colorMap.get(id) || { hex: '#888', name: '?' };
      return `<span class="seq-dot" style="background:${c.hex}" title="${i + 1}. ${c.name}">${i + 1}</span>`;
    }).join('');
  }
}
