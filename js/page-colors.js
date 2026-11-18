'use strict';
/* 配线配色页：绣作顺序、换色排序、插剪线、Madeira 色板 */
App.pages.colors = {
  render(el) {
    el.innerHTML = `
      <div class="colors-wrap">
        <div class="colors-main">
          <div class="page-head"><h2>绣作顺序</h2>
            <div class="head-actions">
              <label class="chk">空跳剪线阈值 <input type="number" id="inpTrim" min="1" max="20" step="0.5" style="width:56px"> mm</label>
              <label class="chk">转速 <input type="number" id="inpSpeed" min="200" max="1500" step="50" style="width:64px"> 针/分</label>
            </div>
          </div>
          <div class="seq-list" id="seqList"></div>
        </div>
        <div class="colors-side">
          <div class="panel-title">Madeira 色板（点击替换选中色块）</div>
          <input type="search" id="paletteSearch" placeholder="搜索线号/颜色名…" class="palette-search">
          <div class="palette-grid" id="paletteGrid"></div>
        </div>
      </div>`;
    this.el = el;
    this.selectedBlock = null;
    const st = App.project.design.settings;
    const inpTrim = el.querySelector('#inpTrim');
    inpTrim.value = st.trimThreshold;
    inpTrim.onchange = () => { st.trimThreshold = U.clamp(+inpTrim.value || 4, 1, 20); App.touch(); };
    const inpSpeed = el.querySelector('#inpSpeed');
    inpSpeed.value = st.speed;
    inpSpeed.onchange = () => { st.speed = U.clamp(+inpSpeed.value || 750, 200, 1500); App.touch(); };
    el.querySelector('#paletteSearch').oninput = (e) => this.renderPalette(e.target.value.trim());
    this.renderSeq();
    this.renderPalette('');
  },

  onCompute() { this.renderSeq(); },

  renderSeq() {
    const list = this.el.querySelector('#seqList');
    const d = App.project.design;
    list.innerHTML = '';
    const compute = App.lastCompute;
    let colorNo = 0;
    d.sequence.forEach((item, idx) => {
      const row = document.createElement('div');
      if (item.kind === 'trim') {
        row.className = 'seq-row trim-row';
        row.innerHTML = `<span class="seq-ico">✂</span><span class="seq-name">剪线</span>
          <span class="seq-info"></span>
          <span class="seq-ops"><button class="btn small" data-act="del">删除</button></span>`;
        row.querySelector('[data-act=del]').onclick = () => {
          d.sequence.splice(idx, 1); App.touch(); this.renderSeq();
        };
        list.appendChild(row);
        return;
      }
      colorNo++;
      const t = threadByCode(item.threadId);
      const blk = compute && compute.blocks.find(b => b.blockId === item.id);
      row.className = 'seq-row' + (this.selectedBlock === item.id ? ' sel' : '');
      row.innerHTML = `
        <span class="seq-no">${colorNo}</span>
        <span class="sw big" style="background:${t.hex}"></span>
        <span class="seq-name">${t.code}<br><small>${U.escapeHtml(t.name)}</small></span>
        <span class="seq-info">${item.shapeIds.length} 个图形${blk ? ' · ' + U.fmtInt(blk.stitches) + ' 针 · ' + U.fmt1(blk.length / 1000) + 'm' : ''}</span>
        <span class="seq-ops">
          <button class="btn small" data-act="up" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn small" data-act="down" ${idx === d.sequence.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn small" data-act="trim" title="在此色块后插入剪线">✂</button>
          <button class="btn small danger" data-act="del" title="删除色块（图形并入上一色块）">删</button>
        </span>`;
      row.onclick = (e) => {
        if (e.target.tagName === 'BUTTON') return;
        this.selectedBlock = item.id;
        this.renderSeq();
      };
      row.querySelector('[data-act=up]').onclick = () => { this.move(idx, -1); };
      row.querySelector('[data-act=down]').onclick = () => { this.move(idx, 1); };
      row.querySelector('[data-act=trim]').onclick = () => {
        d.sequence.splice(idx + 1, 0, { kind: 'trim', id: U.uid() });
        App.touch(); this.renderSeq();
      };
      row.querySelector('[data-act=del]').onclick = () => {
        // 图形并入前一个色块；没有则并入后一个；都没有则连图形一起删
        const prev = d.sequence.slice(0, idx).reverse().find(i => i.kind === 'block');
        const next = d.sequence.slice(idx + 1).find(i => i.kind === 'block');
        if (prev) prev.shapeIds.push(...item.shapeIds);
        else if (next) next.shapeIds.push(...item.shapeIds);
        else d.shapes = d.shapes.filter(s => !item.shapeIds.includes(s.id));
        d.sequence.splice(idx, 1);
        App.touch(); this.renderSeq();
      };
      list.appendChild(row);
    });
    if (!d.sequence.length) list.innerHTML = '<div class="empty">还没有色块，去编辑器里画图形</div>';
  },

  move(idx, dir) {
    const seq = App.project.design.sequence;
    const j = idx + dir;
    if (j < 0 || j >= seq.length) return;
    [seq[idx], seq[j]] = [seq[j], seq[idx]];
    App.touch(); this.renderSeq();
  },

  renderPalette(q) {
    const grid = this.el.querySelector('#paletteGrid');
    grid.innerHTML = '';
    const list = MADEIRA.filter(t => !q || t.code.includes(q) || t.name.toLowerCase().includes(q.toLowerCase()));
    for (const t of list) {
      const c = document.createElement('div');
      c.className = 'pal-cell';
      c.title = `${t.code} ${t.name}`;
      c.innerHTML = `<span class="sw big" style="background:${t.hex}"></span><small>${t.code}</small>`;
      c.onclick = () => {
        if (!this.selectedBlock) { App.toast('先在左侧点选一个色块'); return; }
        const blk = App.project.design.sequence.find(i => i.kind === 'block' && i.id === this.selectedBlock);
        if (!blk) return;
        blk.threadId = t.code;
        for (const s of App.project.design.shapes) {
          if (blk.shapeIds.includes(s.id)) s.color = t.code;
        }
        App.touch(); this.renderSeq();
        App.toast(`已换色 ${t.code} ${t.name}`);
      };
      grid.appendChild(c);
    }
    if (!list.length) grid.innerHTML = '<div class="empty">没有匹配的线号</div>';
  },
};
