// 工程存储：IndexedDB 优先，localStorage 降级；自动保存、撤销/重做、导入导出
import { SCHEMA_VERSION, uid, defaultParams } from './constants.js';
import { createPalette } from '../data/palette.js';
import { SAMPLES } from '../data/samples.js';
import { zipSync, unzipSync, fromUtf8, utf8 } from './zip.js';

const DB_NAME = 'embroidery-studio';
const DB_VERSION = 1;
const STORE = 'projects';
const LS_KEY = 'embroidery_studio_projects_v1';
const SETTINGS_KEY = 'embroidery_studio_settings_v1';
const MAX_UNDO = 50;

function openDB() {
  return new Promise((resolve, reject) => {
    if (!indexedDB) return reject(new Error('no-idb'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IDB 打开失败'));
  });
}

async function idbAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(project) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(project);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function lsAll() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
  catch { return []; }
}
function lsPutAll(list) { localStorage.setItem(LS_KEY, JSON.stringify(list)); }

export const storage = {
  async list() {
    try { return await idbAll(); }
    catch { return lsAll(); }
  },
  async save(project) {
    project.updatedAt = Date.now();
    try { await idbPut(project); }
    catch {
      const list = lsAll();
      const i = list.findIndex(p => p.id === project.id);
      if (i >= 0) list[i] = project; else list.push(project);
      lsPutAll(list);
    }
  },
  async remove(id) {
    try { await idbDelete(id); }
    catch { lsPutAll(lsAll().filter(p => p.id !== id)); }
  },
  readSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; }
  },
  writeSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }
};

export function createProject(name) {
  const palette = createPalette();
  const now = Date.now();
  return {
    id: uid('prj'),
    schema: SCHEMA_VERSION,
    name: name || '未命名花样',
    createdAt: now,
    updatedAt: now,
    settings: {
      trimGap: 7.0,
      machineSpeed: 700,
      fabricId: 'white',
      hoopId: 'h180',
      gridSize: 10,       // mm
      snap: true,
      threadWidthMm: 0.4
    },
    palette,
    shapes: [],
    selection: []
  };
}

// 从内置花稿创建（把 colorIdx 解析为色板 colorId）
export function projectFromSample(index) {
  const fn = SAMPLES[index];
  const project = createProject(fn.name);
  const built = fn();
  project.shapes = built.shapes.map(s => {
    const { colorIdx, ...rest } = s;
    return {
      ...rest,
      colorId: project.palette[Math.min(s.colorIdx, project.palette.length - 1)].id,
      params: { ...defaultParams(s.type), ...s.params }
    };
  });
  return project;
}

export function cloneProject(project, newName) {
  const copy = structuredClone(project);
  copy.id = uid('prj');
  copy.name = newName || project.name + ' 副本';
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  copy.shapes.forEach(s => { s.id = uid('shape'); });
  copy.palette = copy.palette.map(c => ({ ...c, id: uid('col') }));
  const oldToNew = new Map();
  project.palette.forEach((c, i) => oldToNew.set(c.id, copy.palette[i].id));
  copy.shapes.forEach(s => { s.colorId = oldToNew.get(s.colorId) || copy.palette[0].id; });
  return copy;
}

// ---- 撤销 / 重做（针对 shapes + palette 的结构快照）----
export class History {
  constructor() { this.stack = []; this.index = -1; }
  push(state) {
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(state);
    if (this.stack.length > MAX_UNDO) this.stack.shift();
    this.index = this.stack.length - 1;
  }
  undo() { return this.index > 0 ? this.stack[--this.index] : null; }
  redo() { return this.index < this.stack.length - 1 ? this.stack[++this.index] : null; }
  canUndo() { return this.index > 0; }
  canRedo() { return this.index < this.stack.length - 1; }
  reset(state) { this.stack = [state]; this.index = 0; }
}

export function snapshot(project) {
  return structuredClone({ shapes: project.shapes, palette: project.palette });
}
export function restoreSnapshot(project, snap) {
  project.shapes = structuredClone(snap.shapes);
  project.palette = structuredClone(snap.palette);
}

// ---- 工程包（.embz 实际为 zip）----
const MANIFEST = 'manifest.json';
const PROJECT_JSON = 'project.json';

export function exportProjectPackage(project) {
  const manifest = JSON.stringify({
    app: 'embroidery-studio',
    schema: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    files: [PROJECT_JSON]
  }, null, 2);
  const data = JSON.stringify(project, null, 2);
  return zipSync([
    { name: MANIFEST, content: manifest },
    { name: PROJECT_JSON, content: data }
  ]);
}

export async function importProjectPackage(uint8) {
  let files;
  try { files = unzipSync(uint8); }
  catch (e) {
    // 也允许直接导入裸 JSON
    try {
      const proj = JSON.parse(fromUtf8(uint8));
      return validateProject(proj);
    } catch { throw e; }
  }
  const pf = files.find(f => f.name === PROJECT_JSON);
  if (!pf) throw new Error('工程包缺少 project.json，不是有效的工程文件');
  let proj;
  try { proj = JSON.parse(fromUtf8(pf.data)); }
  catch { throw new Error('project.json 解析失败，工程文件已损坏'); }
  return validateProject(proj);
}

export function validateProject(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.shapes) || !Array.isArray(p.palette)) {
    throw new Error('工程数据结构不完整（缺少 shapes 或 palette），文件可能已损坏');
  }
  if (!p.id) p.id = uid('prj');
  if (!p.settings) p.settings = createProject().settings;
  p.shapes = p.shapes.filter(s => s && Array.isArray(s.points) && s.points.length >= 2);
  if (!p.palette.length) p.palette = createPalette();
  const colorIds = new Set(p.palette.map(c => c.id));
  for (const s of p.shapes) {
    if (!s.id) s.id = uid('shape');
    if (!colorIds.has(s.colorId)) s.colorId = p.palette[0].id;
    s.params = { ...defaultParams(s.type), ...(s.params || {}) };
    s.visible = s.visible !== false;
  }
  return p;
}

export function downloadBytes(filename, bytes, mime = 'application/octet-stream') {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileAsUint8(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result));
    r.onerror = () => reject(new Error('文件读取失败：' + file.name));
    r.readAsArrayBuffer(file);
  });
}

export { utf8, fromUtf8 };
