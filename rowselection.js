/* ============================================================
   行选择（按行选，不是按字符选）
   - 点行号 → 选中该行
   - Shift + 点任意行 → 连续选到那里
   - 选中后浮条：加批注 / 让 AI 注释 / 取消
   - Esc 取消
   ============================================================ */
(() => {
  const $ = s => document.querySelector(s);
  const codeEl = document.getElementById('code');
  if (!codeEl) return;

  let from = 0, to = 0;          // 1-based，0 表示无选择
  let bar = null;

  const lineRows = () => [...codeEl.querySelectorAll('.line')];
  const hasSel = () => from > 0 && to > 0;

  function clearRows() {
    from = to = 0;
    codeEl.querySelectorAll('.line.rowsel').forEach(r => r.classList.remove('rowsel'));
    codeEl.querySelectorAll('.line.rowsel-edge').forEach(r => r.classList.remove('rowsel-edge'));
    hideBar();
  }

  function paintRows() {
    const rows = lineRows();
    rows.forEach((r, i) => {
      const ln = i + 1;
      r.classList.toggle('rowsel', hasSel() && ln >= from && ln <= to);
      r.classList.toggle('rowsel-edge', hasSel() && (ln === from || ln === to));
    });
    showBar();
  }

  function selectRow(ln, extend) {
    if (!extend || !hasSel()) { from = to = ln; }
    else if (ln < from) { to = from; from = ln; }
    else { to = ln; }
    paintRows();
  }

  /* 浮动操作条 */
  function hideBar() { if (bar) { bar.remove(); bar = null; } }

  function showBar() {
    hideBar();
    if (!hasSel()) return;
    const rows = lineRows();
    const a = rows[from - 1], b = rows[to - 1];
    if (!a || !b) return;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();

    bar = document.createElement('div');
    bar.className = 'rowsel-bar';
    bar.innerHTML =
      '<span class="rs-label">' + from + '–' + to + ' 行</span>' +
      '<button data-act="note"><svg class="ic"><use href="#i-pencil"/></svg>批注</button>' +
      '<button data-act="ai"><svg class="ic"><use href="#i-sparkles"/></svg>AI 注释</button>' +
      '<button data-act="cancel" title="取消选择 (Esc)"><svg class="ic"><use href="#i-x"/></svg></button>';

    document.body.appendChild(bar);
    const top = Math.max(8, Math.min(ra.top, rb.bottom) - 44);
    bar.style.top = top + 'px';
    bar.style.left = Math.round(ra.left + 70) + 'px';

    /* 用 mousedown 触发：避免点击时先失焦触发重渲染，导致这次点击丢失 */
    const bind = (el, fn) => {
      if (!el) return;
      el.addEventListener('mousedown', ev => {
        ev.preventDefault(); ev.stopPropagation(); fn(ev);
      });
    };

    bind(bar.querySelector('[data-act="cancel"]'), clearRows);
    bind(bar.querySelector('[data-act="note"]'), () => {
      const t = window.prompt(from === to ? ('第 ' + from + ' 行的批注') : (from + '–' + to + ' 行这段在做什么？'), '');
      if (t && t.trim()) {
        if (from === to && typeof addNote === 'function') {
          addNote(from);
          // addNote 会创建空卡片并聚焦，这里把文字填进去
          setTimeout(() => {
            const body = document.querySelector('.nb[data-ln="' + from + '"] .body');
            if (body) {
              body.textContent = t.trim();
              body.dispatchEvent(new Event('input', { bubbles: true }));
              body.blur();
            }
          }, 60);
        } else if (window.icAddRange) {
          window.icAddRange(from, to, t.trim(), 'me');
        }
        clearRows();
      }
    });
    bind(bar.querySelector('[data-act="ai"]'), () => {
      window.__rowSel = { from, to };
      document.getElementById('aiToggle').click();
      const act = document.querySelector('.ai-act[data-act="sel"]');
      if (act) act.click();
    });
  }

  /* 行号上按下 = 开始拖选；行内空白处按下也可以 */
  let dragging = false, anchor = 0;

  const rowIndexOf = el => {
    const row = el && el.closest && el.closest('.line');
    return row ? lineRows().indexOf(row) + 1 : 0;
  };
  const rowAtY = y => {
    const rows = lineRows();
    if (!rows.length) return 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) return i + 1;
    }
    const first = rows[0].getBoundingClientRect();
    return y < first.top ? 1 : rows.length;
  };

  codeEl.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (e.target.closest('.nb') || e.target.closest('button')) return;
    /* 只有行号栏才按行拖选；正文里按下交给浏览器做文字选择 */
    if (!e.target.closest('.num')) return;

    const idx = rowIndexOf(e.target);
    if (idx < 1) return;

    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    if (e.shiftKey && hasSel()) {
      anchor = from;
      to = Math.max(from, idx);
      from = Math.min(from, idx);
      paintRows();
    } else {
      anchor = idx;
      selectRow(idx, false);
    }
  }, true);

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const idx = rowAtY(e.clientY);
    if (idx < 1) return;
    from = Math.min(anchor, idx);
    to = Math.max(anchor, idx);
    paintRows();
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    if (window.getSelection) {
      const s = window.getSelection();
      if (s && s.removeAllRanges) s.removeAllRanges();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && hasSel()) { clearRows(); }
  });

  /* 重绘后保持选择 */
  const orig = window.renderCode;
  if (typeof orig === 'function') {
    window.renderCode = function () {
      const had = hasSel(), f = from, t = to;
      orig.apply(this, arguments);
      if (had) {
        const n = lineRows().length;
        from = Math.min(f, n); to = Math.min(t, n);
        paintRows();
      }
    };
  }

  window.__rowSelection = () => (hasSel() ? { from, to } : null);
  window.__setRowSelection = (a, b) => { from = a; to = b; paintRows(); };
  /* 从“正在编辑的那一行”开始拖时，由 multiselect.js 调用，切到按行拖选 */
  window.__beginRowDrag = y => {
    const idx = rowAtY(y);
    if (idx < 1) return;
    dragging = true;
    anchor = idx;
    selectRow(idx, false);
  };

  /* 选中行后 Ctrl+C 复制原文 */
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'c') return;
    if (!hasSel()) return;
    const ae = document.activeElement;
    if (ae && (ae.isContentEditable || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
    const lines = files()[cur].lines.slice(from - 1, to);
    e.preventDefault();
    navigator.clipboard.writeText(lines.join('\n')).then(
      () => toast('已复制 ' + (to - from + 1) + ' 行'),
      () => {}
    );
  });
  window.__clearRowSelection = clearRows;
})();
