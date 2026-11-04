/* ============================================================
   选中文字后的浮动操作条
   —— 选一段文字，立刻看到能对它做什么
   ============================================================ */
(() => {
  const codeEl = document.getElementById('code');
  if (!codeEl) return;

  let bar = null;
  let current = null;   // {text, line, from, to}

  const IDENT = /^[A-Za-z_$][\w$]*$/;

  function hide() {
    if (bar) { bar.remove(); bar = null; }
    current = null;
  }

  function rowOf(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return el && el.closest ? el.closest('.line') : null;
  }

  function readSelection() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    const text = sel.toString();
    if (!text.trim()) return null;

    const range = sel.getRangeAt(0);
    let a = rowOf(range.startContainer), b = rowOf(range.endContainer);
    if (!a || !b) return null;
    if (a.parentElement !== codeEl && !codeEl.contains(a)) return null;

    const rows = [...codeEl.querySelectorAll('.line')];
    const from = rows.indexOf(a) + 1, to = rows.indexOf(b) + 1;
    if (from < 1 || to < 1) return null;

    return { text, line: from, from, to, rect: range.getBoundingClientRect() };
  }

  function show(info) {
    hide();
    current = info;
    bar = document.createElement('div');
    bar.className = 'textsel-bar';
    const word = IDENT.test(info.text.trim()) ? info.text.trim() : '';
    bar.innerHTML =
      '<span class="ts-label">' + (info.text.trim().length > 12
        ? info.text.trim().slice(0, 12) + '…'
        : info.text.trim()) + '</span>' +
      '<button data-act="note"><svg class="ic"><use href="#i-pencil"/></svg>批注</button>' +
      (word ? '<button data-act="lib"><svg class="ic"><use href="#i-plus"/></svg>函数库</button>' : '') +
      '<button data-act="ai"><svg class="ic"><use href="#i-sparkles"/></svg>AI 解释</button>' +
      '<button data-act="copy"><svg class="ic"><use href="#i-copy"/></svg></button>';
    document.body.appendChild(bar);

    const top = Math.max(8, info.rect.top - 42);
    const left = Math.max(8, Math.min(info.rect.left, window.innerWidth - bar.offsetWidth - 8));
    bar.style.top = top + 'px';
    bar.style.left = left + 'px';

    const bind = (el, fn) => el && el.addEventListener('mousedown', ev => {
      ev.preventDefault(); ev.stopPropagation(); fn();
    });

    bind(bar.querySelector('[data-act="note"]'), () => {
      const t = current && current.text.trim();
      const ln = current ? current.line : 0;
      hide();
      if (!ln || !t) return;
      addNote(ln);
      setTimeout(() => {
        const body = document.querySelector('.nb[data-ln="' + ln + '"] .body');
        if (body) {
          body.textContent = t;
          body.dispatchEvent(new Event('input', { bubbles: true }));
          body.blur();
        }
      }, 60);
    });

    bind(bar.querySelector('[data-act="lib"]'), () => {
      const name = current && current.text.trim();
      hide();
      if (!name) return;
      if (typeof openLibDialog === 'function') openLibDialog(name, null);
    });

    bind(bar.querySelector('[data-act="ai"]'), () => {
      hide();
      const tog = document.getElementById('aiToggle');
      if (tog && !document.getElementById('aiPanel').classList.contains('on')) tog.click();
      const act = document.querySelector('.ai-act[data-act="explain"]');
      if (act) setTimeout(() => act.click(), 260);
    });

    bind(bar.querySelector('[data-act="copy"]'), () => {
      const t = current && current.text;
      hide();
      if (t && navigator.clipboard) navigator.clipboard.writeText(t).then(() => toast('已复制'), () => {});
    });
  }

  /* 选区变化后决定是否显示 */
  let timer = null;
  function refresh() {
    const info = readSelection();
    if (!info) { hide(); return; }
    /* 整行选择由 rowselection 负责，这里只管“部分文字” */
    if (info.from === info.to && info.text.trim().length >= 2) show(info);
    else if (info.from !== info.to) hide();
    else hide();
  }

  document.addEventListener('mouseup', e => {
    if (e.target.closest('.textsel-bar') || e.target.closest('.rowsel-bar')) return;
    clearTimeout(timer);
    timer = setTimeout(refresh, 20);
  });

  document.addEventListener('keyup', e => {
    if (e.shiftKey || e.key === 'Shift') { clearTimeout(timer); timer = setTimeout(refresh, 20); }
  });

  document.addEventListener('mousedown', e => {
    if (e.target.closest('.textsel-bar')) return;
    hide();
  }, true);

  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
})();
