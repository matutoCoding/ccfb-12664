'use strict';
/* 工程本地存储：localStorage。设计稿（轮廓+参数）持久化，针迹由 Worker 重算。 */
const Store = (() => {
  const IDX = 'emb.projects.index';
  const PREFIX = 'emb.project.';
  const LAST = 'emb.last';

  function readIndex() {
    try { return JSON.parse(localStorage.getItem(IDX)) || []; }
    catch (e) { return []; }
  }
  function writeIndex(idx) { localStorage.setItem(IDX, JSON.stringify(idx)); }

  function list() {
    return readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function load(id) {
    try {
      const raw = localStorage.getItem(PREFIX + id);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function save(project) {
    project.updatedAt = Date.now();
    localStorage.setItem(PREFIX + project.id, JSON.stringify(project));
    const idx = readIndex();
    const i = idx.findIndex(p => p.id === project.id);
    const entry = {
      id: project.id, name: project.name, updatedAt: project.updatedAt,
      stitches: project.cachedStitches || 0, thumb: project.thumb || '',
    };
    if (i >= 0) idx[i] = entry; else idx.push(entry);
    writeIndex(idx);
  }

  function create(name, design) {
    const p = {
      id: U.uid(), name: name || '未命名花稿',
      createdAt: Date.now(), updatedAt: Date.now(),
      design: design || { shapes: [], sequence: [], settings: U.defaultSettings() },
      cachedStitches: 0, thumb: '',
    };
    if (!p.design.settings) p.design.settings = U.defaultSettings();
    save(p);
    return p;
  }

  function duplicate(id) {
    const src = load(id);
    if (!src) return null;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = U.uid();
    copy.name = src.name + ' 副本';
    copy.createdAt = Date.now();
    save(copy);
    return copy;
  }

  function remove(id) {
    localStorage.removeItem(PREFIX + id);
    writeIndex(readIndex().filter(p => p.id !== id));
    if (localStorage.getItem(LAST) === id) localStorage.removeItem(LAST);
  }

  function setLast(id) { localStorage.setItem(LAST, id); }
  function getLast() { return localStorage.getItem(LAST); }

  /* 打包导出（可含多个工程） */
  function exportPackage(ids) {
    const projects = ids.map(load).filter(Boolean);
    return JSON.stringify({ app: 'emb-studio', version: 1, projects }, null, 1);
  }
  function importPackage(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('工程包不是有效的 JSON 文件'); }
    if (!data || data.app !== 'emb-studio' || !Array.isArray(data.projects)) throw new Error('工程包格式不正确');
    let n = 0;
    for (const p of data.projects) {
      if (!p.design || !Array.isArray(p.design.shapes)) continue;
      p.id = U.uid(); // 避免覆盖本地同 id 工程
      if (!p.design.settings) p.design.settings = U.defaultSettings();
      save(p); n++;
    }
    if (!n) throw new Error('工程包里没有可导入的工程');
    return n;
  }

  return { list, load, save, create, duplicate, remove, setLast, getLast, exportPackage, importPackage };
})();
