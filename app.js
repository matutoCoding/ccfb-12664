// 应用入口：hash 路由 + 全局状态 + 自动保存
import { storage, History, snapshot, restoreSnapshot } from './core/store.js';
import { engineClient } from './core/worker-client.js';
import { showFatalError, toast } from './ui/ui.js';
import { renderProjects } from './ui/pages/projects.js';
import { renderEditor } from './ui/pages/editor.js';
import { renderColors } from './ui/pages/colors.js';
import { renderPreview } from './ui/pages/preview.js';
import { renderExport } from './ui/pages/export.js';

export const state = {
  projects: [],
  current: null,          // 当前工程（可变对象，各页面共享引用）
  history: new History(),
  stitchResult: null,     // 最近一次 worker 计算结果
  computing: false,
  saveTimer: null,
  dirty: false
};

const ROUTES = {
  projects: renderProjects,
  editor: renderEditor,
  colors: renderColors,
  preview: renderPreview,
  export: renderExport
};

export function markDirty() {
  state.dirty = true;
  scheduleSave();
}

export function scheduleSave(delay = 600) {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(autoSave, delay);
}

async function autoSave() {
  if (!state.current || !state.dirty) return;
  try {
    await storage.save(state.current);
    state.dirty = false;
    updateStatus('已自动保存 ' + new Date().toLocaleTimeString('zh-CN'), false);
  } catch (e) {
    updateStatus('保存失败：' + e.message, true);
  }
}

export async function flushSave() {
  clearTimeout(state.saveTimer);
  if (state.current && state.dirty) {
    await storage.save(state.current);
    state.dirty = true; // 保存成功后标志由调用方控制；这里仅落盘
    state.dirty = false;
  }
}

export function updateStatus(text, error = false) {
  const s = document.getElementById('topStatus');
  s.textContent = text;
  s.style.color = error ? 'var(--red)' : 'var(--fg-dim)';
}

// 历史记录
export function pushHistory() {
  if (!state.current) return;
  state.history.push(snapshot(state.current));
  markDirty();
}
export function undo() {
  const snap = state.history.undo();
  if (snap && state.current) {
    restoreSnapshot(state.current, snap);
    markDirty();
    return true;
  }
  return false;
}
export function redo() {
  const snap = state.history.redo();
  if (snap && state.current) {
    restoreSnapshot(state.current, snap);
    markDirty();
    return true;
  }
  return false;
}

// 打开工程（从列表进入编辑器等页面）
export async function openProject(id) {
  await flushSave();
  const p = state.projects.find(x => x.id === id);
  if (!p) { toast('工程不存在', 'error'); location.hash = '#/projects'; return; }
  state.current = p;
  state.history.reset(snapshot(p));
  state.stitchResult = null;
  location.hash = '#/editor';
}

export function closeProject() {
  flushSave();
  state.current = null;
  state.stitchResult = null;
  location.hash = '#/projects';
}

// 请求重算针迹（worker，防抖）。pages 通过回调拿结果
export async function requestBuild(project = state.current) {
  if (!project) return null;
  state.computing = true;
  try {
    const result = await engineClient.buildDebounced(project, 80);
    state.stitchResult = result;
    return result;
  } catch (e) {
    toast('针迹计算失败：' + e.message, 'error', 5000);
    return null;
  } finally {
    state.computing = false;
  }
}

async function route() {
  const name = (location.hash.replace('#/', '') || 'projects').split('?')[0];
  const fn = ROUTES[name] || renderProjects;
  document.querySelectorAll('#nav a').forEach(a =>
    a.classList.toggle('active', a.dataset.route === name));
  const view = document.getElementById('view');
  try {
    await fn(view);
  } catch (err) {
    console.error(err);
    showFatalError(err);
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('error', (e) => {
  console.error(e.error || e.message);
});

async function boot() {
  try {
    state.projects = await storage.list();
  } catch (e) {
    state.projects = [];
    toast('本地存储不可用：' + e.message, 'error', 5000);
  }
  // 刷新后若 hash 指向需要工程的页面但没有 current，回列表
  const name = (location.hash.replace('#/', '') || 'projects');
  if (name !== 'projects' && !state.current) location.hash = '#/projects';
  if (!location.hash) location.hash = '#/projects';
  route();
}

boot();
