// 轻量 UI 工具
let toastTimer = null;
export function toast(msg, type = '', ms = 2600) {
  const el = document.getElementById('toast');
  el.className = 'toast ' + type;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

export function confirmDialog(title, message) {
  return new Promise((resolve) => {
    const root = document.getElementById('modalRoot');
    root.innerHTML = `
      <div class="modal-mask">
        <div class="modal">
          <h3>${escapeHtml(title)}</h3>
          <p style="color:var(--fg-dim);line-height:1.7">${escapeHtml(message)}</p>
          <div class="modal-actions">
            <button data-v="0">取消</button>
            <button class="danger" data-v="1">确认</button>
          </div>
        </div>
      </div>`;
    root.onclick = (e) => {
      if (e.target.classList.contains('modal-mask') || e.target.dataset.v !== undefined) {
        const v = e.target.dataset.v === '1';
        root.innerHTML = ''; root.onclick = null;
        resolve(v);
      }
    };
  });
}

export function promptDialog(title, defaultValue = '') {
  return new Promise((resolve) => {
    const root = document.getElementById('modalRoot');
    root.innerHTML = `
      <div class="modal-mask">
        <div class="modal">
          <h3>${escapeHtml(title)}</h3>
          <input id="modalInput" value="${escapeHtml(defaultValue)}" />
          <div class="modal-actions">
            <button data-v="0">取消</button>
            <button class="primary" data-v="1">确定</button>
          </div>
        </div>
      </div>`;
    const input = root.querySelector('#modalInput');
    input.focus(); input.select();
    root.onclick = (e) => {
      if (e.target.classList.contains('modal-mask') || e.target.dataset.v !== undefined) {
        const v = e.target.dataset.v === '1' ? input.value.trim() : null;
        root.innerHTML = ''; root.onclick = null;
        resolve(v);
      }
    };
    input.onkeydown = (e) => { if (e.key === 'Enter') root.querySelector('[data-v="1"]').click(); };
  });
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function formatTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 全局错误兜底：任何页面渲染异常都显示友好提示，绝不白屏
export function showFatalError(err) {
  const view = document.getElementById('view');
  view.innerHTML = `
    <div class="page">
      <div class="card" style="border-color:var(--red)">
        <h2 style="color:var(--red)">页面出现问题</h2>
        <p style="line-height:1.8;color:var(--fg-dim)">${escapeHtml(err.message || err)}</p>
        <p class="hint">数据仍保存在浏览器本地，可返回工程列表重新打开。若问题持续，请导出工程包后清除浏览器数据重试。</p>
        <p><a href="#/projects">← 返回工程列表</a></p>
      </div>
    </div>`;
}
