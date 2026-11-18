'use strict';
/* 主框架：路由 / 工程状态 / Worker 调度 / 自动保存 */
const App = {
  project: null,       // 当前工程 {id,name,design}
  lastCompute: null,   // {blocks, stats}
  computeSeq: 0,
  worker: null,
  pages: {},           // 页面控制器 {render(el), destroy?}
  currentPage: null,

  init() {
    // Worker：函数转字符串 + Blob，file:// 也能跑
    const src = '(' + stitchWorkerMain.toString() + ')()';
    this.worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    this.worker.onmessage = (e) => this.onCompute(e.data);
    this.worker.onerror = (e) => this.toast('针迹计算出错：' + (e.message || '未知错误'), 'err');

    window.addEventListener('hashchange', () => this.route());
    this.route();
  },

  /* ---------- 路由 ---------- */
  route() {
    const hash = location.hash || '#/projects';
    const name = hash.replace('#/', '') || 'projects';
    if (name !== 'projects' && !this.project) { location.hash = '#/projects'; return; }
    if (this.currentPage && this.pages[this.currentPage] && this.pages[this.currentPage].destroy) {
      try { this.pages[this.currentPage].destroy(); } catch (e) {}
    }
    this.currentPage = name;
    document.querySelectorAll('#nav a').forEach(a => {
      a.classList.toggle('active', a.getAttribute('href') === '#/' + name);
      if (a.dataset.needProject) a.classList.toggle('disabled', !this.project);
    });
    const el = document.getElementById('page');
    el.innerHTML = '';
    const page = this.pages[name] || this.pages.projects;
    try { page.render(el); } catch (e) {
      console.error(e);
      el.innerHTML = '<div class="err-box">页面渲染出错：' + U.escapeHtml(e.message) + '</div>';
    }
  },
  go(name) { location.hash = '#/' + name; },

  /* ---------- 工程 ---------- */
  openProject(id) {
    const p = Store.load(id);
    if (!p) { this.toast('工程不存在或已损坏', 'err'); return; }
    if (!p.design.settings) p.design.settings = U.defaultSettings();
    this.project = p;
    this.lastCompute = null;
    Store.setLast(id);
    this.scheduleCompute();
    this.go('edit');
  },
  closeProject() {
    this.flushSave();
    this.project = null;
    this.lastCompute = null;
  },
  newProject(name, design) {
    const p = Store.create(name, design);
    this.project = p;
    this.lastCompute = null;
    Store.setLast(p.id);
    this.scheduleCompute();
    this.go('edit');
  },

  /* 设计变更后调用：自动保存 + 重算针迹 */
  touch() { this.saveSoon(); this.scheduleCompute(); },

  saveSoon: null, // init 后赋值
  flushSave() {
    if (!this.project) return;
    if (this.lastCompute) {
      this.project.cachedStitches = this.lastCompute.stats.stitches;
      try { this.project.thumb = Preview.makeThumb(this.project, this.lastCompute); } catch (e) {}
    }
    Store.save(this.project);
    this.updateTitle();
  },

  /* ---------- 针迹计算 ---------- */
  scheduleCompute: null,
  computeNow() {
    if (!this.project) return;
    const seq = ++this.computeSeq;
    // 深拷贝设计数据传给 worker（transferable 只用于返回）
    const design = JSON.parse(JSON.stringify(this.project.design));
    this.worker.postMessage({ seq, design });
    this.setComputing(true);
  },
  onCompute(msg) {
    if (msg.seq !== this.computeSeq) return; // 过期结果
    this.setComputing(false);
    if (!msg.ok) { this.toast('针迹计算失败：' + msg.error, 'err'); return; }
    this.lastCompute = msg;
    if (this.project) this.project.cachedStitches = msg.stats.stitches;
    this.updateStatsBar();
    if (this.currentPage && this.pages[this.currentPage] && this.pages[this.currentPage].onCompute) {
      try { this.pages[this.currentPage].onCompute(msg); } catch (e) { console.error(e); }
    }
    this.saveSoon();
  },
  setComputing(on) {
    const el = document.getElementById('computing');
    if (el) el.style.display = on ? 'inline' : 'none';
  },
  updateStatsBar() {
    const el = document.getElementById('statsbar');
    if (!el) return;
    if (!this.lastCompute || !this.project) { el.textContent = ''; return; }
    const s = this.lastCompute.stats;
    el.textContent = `针数 ${U.fmtInt(s.stitches)} · 用线 ${U.fmt1(s.lengthMm / 1000)}m · 换色 ${s.colorChanges} · 剪线 ${s.trims} · 约 ${s.timeMin} 分钟 · ${s.w}×${s.h}mm · 重算 ${s.computeMs}ms`;
  },
  updateTitle() {
    const el = document.getElementById('projname');
    if (el) el.textContent = this.project ? this.project.name : '';
  },

  /* ---------- 提示 ---------- */
  toast(msg, type) {
    const box = document.getElementById('toast');
    const div = document.createElement('div');
    div.className = 'toast ' + (type || 'info');
    div.textContent = msg;
    box.appendChild(div);
    setTimeout(() => { div.classList.add('out'); setTimeout(() => div.remove(), 400); }, 3200);
  },
};

App.saveSoon = U.debounce(() => App.flushSave(), 800);
App.scheduleCompute = U.debounce(() => App.computeNow(), 150);

window.addEventListener('DOMContentLoaded', () => App.init());
window.addEventListener('beforeunload', () => App.flushSave());
