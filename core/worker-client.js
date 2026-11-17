// Worker 客户端：优先 Web Worker，失败/不支持时降级到主线程同步计算
import { buildDesign } from './engine.js';

class EngineClient {
  constructor() {
    this.worker = null;
    this.fallback = false;
    this.seq = 0;
    this.pending = new Map();
    this.debounceTimer = null;
    this.latestJob = null;
    try {
      this.worker = new Worker(new URL('./stitch-worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'result') {
          const job = this.pending.get(msg.id);
          if (job) {
            this.pending.delete(msg.id);
            msg.ok ? job.resolve(msg.payload) : job.reject(new Error(msg.error));
          }
        }
      };
      this.worker.onerror = () => this._switchFallback();
    } catch {
      this._switchFallback();
    }
  }

  _switchFallback() {
    this.fallback = true;
    if (this.worker) { try { this.worker.terminate(); } catch { /* noop */ } this.worker = null; }
    for (const { reject } of this.pending.values()) reject(new Error('worker 不可用'));
    this.pending.clear();
  }

  build(project) {
    if (this.fallback) {
      return new Promise((resolve, reject) => {
        // 让出一帧，保证 UI 先响应
        setTimeout(() => { try { resolve(buildDesign(project)); } catch (e) { reject(e); } }, 0);
      });
    }
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'build', id, payload: project });
    });
  }

  // 防抖重算：参数连续变化时只保留最后一次，返回 Promise
  buildDebounced(project, delayMs = 120) {
    this.latestJob = project;
    return new Promise((resolve, reject) => {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        const p = this.latestJob;
        this.build(p).then(resolve, reject);
      }, delayMs);
    });
  }
}

export const engineClient = new EngineClient();
