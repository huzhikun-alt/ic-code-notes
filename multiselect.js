/* ============================================================
   多行选择与整段删除
   目标：和普通文本框一样，拖到哪选到哪，选中多行按 Delete 就删
   ============================================================ */
(() => {
  const codeEl = document.getElementById('code');
  if (!codeEl) return;

  const rows = () => [...codeEl.querySelectorAll('.line')];
  const rowIndexOf = node => {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    const row = el && el.closest && el.closest('.line');
    return row ? rows().indexOf(row) + 1 : 0;
  };

  /* ---------- 1. 在编辑状态里一拖动，就退出编辑，让选区能跨行 ---------- */
  let pressPoint = null;
  let pending = false;

  codeEl.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (e.target.closest('.nb') || e.target.closest('button')) return;
    if (editingLine < 0) return;
    pressPoint = { x: e.clientX, y: e.clientY };
    pending = true;
  }, true);

  document.addEventListener('mousemove', e => {
    if (!pending || editingLine < 0) return;
    if (Math.abs(e.clientX - pressPoint.x) < 5 && Math.abs(e.clientY - pressPoint.y) < 5) return;
    pending = false;
    leaveEditMode();
    if (window.__beginRowDrag) window.__beginRowDrag(e.clientY);
  });

  document.addEventListener('mouseup', () => { pending = false; });

  /* 提交当前编辑，但不重绘，保住浏览器的选区 */
  function leaveEditMode(){
    const i = editingLine;
    if (i < 0) return;
    const row = codeEl.querySelector('.line[data-i="' + i + '"]');
    const src = row && row.querySelector('.src');
    const f = files()[cur];
    if (src) {
      const text = src.innerText.replace(/\n$/, '').replace(/\u00a0/g, '');
      if (text !== f.lines[i]) {
        snapshot('编辑第 ' + (i + 1) + ' 行');
        f.lines[i] = text;
        const nm = NOTES[nkey()] || {};
        Object.keys(nm).forEach(k => { if (+k === i + 1) nm[k].fp = hashLine(text); });
        saveAll();
      }
      src.setAttribute('contenteditable', 'false');
    }
    codeEl.querySelectorAll('.line .src').forEach(s => s.setAttribute('contenteditable', 'false'));
    editingLine = -1;
    window.__needsRender = true;
  }

  /* ---------- 2. 删除一段行（连同它们的批注） ---------- */
  function deleteRange(from, to){
    if (from < 1 || to < from) return;
    const f = files()[cur];
    const n = Math.min(to, f.lines.length) - from + 1;
    if (n <= 0) return;
    snapshot('删除第 ' + from + '–' + (from + n - 1) + ' 行');

    const nm = NOTES[nkey()];
    if (nm) {
      const out = {};
      Object.keys(nm).forEach(k => {
        const ln = +k;
        if (ln >= from && ln < from + n) return;      // 范围内的批注一起删掉
        out[ln >= from + n ? ln - n : ln] = nm[k];
      });
      NOTES[nkey()] = out;
      saveAll();
    }

    f.lines.splice(from - 1, n);
    if (!f.lines.length) f.lines = [''];
    editingLine = -1;
    window.__needsRender = false;
    if (window.__clearRowSelection) window.__clearRowSelection();
    renderCode();
    toast('已删除 ' + n + ' 行');
  }
  window.icDeleteRange = deleteRange;

  /* ---------- 3. 删除选中的文字（像文本框那样，只删选中的部分） ---------- */
  function colInRow(row, node, offset, srcCache) {
    const src = (srcCache && srcCache.get(row)) || row.querySelector('.src');
    if (!src) return 0;
    if (srcCache) srcCache.set(row, src);
    try {
      const r = document.createRange();
      r.selectNodeContents(src);
      r.setEnd(node, offset);
      return r.toString().length;
    } catch (err) { return 0; }
  }

  function deleteText(si, sc, ei, ec) {
    const f = files()[cur];
    const rowsEl = rows();
    const startRow = rowsEl[si], endRow = rowsEl[ei];
    if (!startRow || !endRow) return;

    const cache = new Map();
    const sel = window.getSelection();
    const range = sel.getRangeAt(0);
    const scReal = colInRow(startRow, range.startContainer, range.startOffset, cache);
    const ecReal = colInRow(endRow, range.endContainer, range.endOffset, cache);

    snapshot('删除选中的文字');

    const a = f.lines[si] || '', b = f.lines[ei] || '';
    const merged = a.slice(0, scReal) + b.slice(ecReal);

    /* 批注：中间整行删掉，尾行之后的批注整体上移 */
    const nm = NOTES[nkey()];
    if (nm) {
      const out = {};
      Object.keys(nm).forEach(k => {
        const ln = +k;
        if (ln >= si + 2 && ln <= ei + 1) return;            // 整行消失 → 批注一起删
        if (ln === si + 1 || ln === ei + 1) {                 // 首尾行合并 → 只更新指纹
          out[si + 1] = nm[k];
          out[si + 1].fp = hashLine(merged);
          return;
        }
        out[ln > ei + 1 ? ln - (ei - si) : ln] = nm[k];
      });
      NOTES[nkey()] = out;
    }

    f.lines.splice(si, ei - si + 1, merged);
    if (!f.lines.length) f.lines = [''];
    saveAll();
    renderCode();
  }

  document.addEventListener('keydown', e => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const ae = document.activeElement;
    if (ae && (ae.classList.contains('body') || ae.classList.contains('ctext') || ae.classList.contains('rg-body'))) return;

    /* 行号栏选中的整行 → 删整行 */
    const rs = window.__rowSelection ? window.__rowSelection() : null;
    if (rs && rs.to > rs.from) {
      e.preventDefault();
      deleteRange(rs.from, rs.to);
      return;
    }

    /* 其余情况按“选中的文字”删除 */
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const si = rowIndexOf(range.startContainer) - 1;
    const ei = rowIndexOf(range.endContainer) - 1;
    if (si < 0 || ei < 0) return;
    e.preventDefault();
    deleteText(si, 0, ei, 0);
  });


  /* ---------- 5. 跨行选区：给涉及的行加底色 ---------- */
  function paintTextRows() {
    const sel = window.getSelection();
    const all = rows();
    if (!sel || !sel.rangeCount || sel.isCollapsed) {
      all.forEach(r => r.classList.remove('linesel'));
      return;
    }
    const range = sel.getRangeAt(0);
    const a = rowIndexOf(range.startContainer), b = rowIndexOf(range.endContainer);
    if (a < 1 || b < 1) { all.forEach(r => r.classList.remove('linesel')); return; }
    const lo = Math.min(a, b), hi = Math.max(a, b);
    all.forEach((r, i) => {
      const ln = i + 1;
      r.classList.toggle('linesel', ln >= lo && ln <= hi);
    });
  }

  document.addEventListener('selectionchange', () => {
    clearTimeout(window.__selPaintTimer);
    window.__selPaintTimer = setTimeout(paintTextRows, 40);
  });
  document.addEventListener('mouseup', () => setTimeout(paintTextRows, 20));
  document.addEventListener('mousedown', () => {
    rows().forEach(r => r.classList.remove('linesel'));
  }, true);
  /* 下次点击时把延迟的重绘补上 */
  codeEl.addEventListener('mousedown', () => {
    if (window.__needsRender) { window.__needsRender = false; renderCode(); }
  }, true);
})();
