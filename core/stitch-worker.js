// 针迹计算 Worker：重算丢后台，不阻塞缩放拖动
import { buildDesign } from './engine.js';

let seq = 0;
self.onmessage = (e) => {
  const { type, payload, id } = e.data || {};
  if (type === 'build') {
    try {
      const result = buildDesign(payload);
      self.postMessage({ type: 'result', id, ok: true, payload: result });
    } catch (err) {
      self.postMessage({ type: 'result', id, ok: false, error: err.message || String(err) });
    }
  } else if (type === 'ping') {
    self.postMessage({ type: 'pong', id });
  }
};
