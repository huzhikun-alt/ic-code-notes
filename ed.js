/* ============================================================
   代码编辑器（单一文本编辑面）
   textarea 负责输入与原生选择，pre 负责语法高亮，行号与笔记列同步滚动
   ============================================================ */
(() => {
  const HOST_ID = 'code';
  const LH = 22;          // 行高，必须与 CSS 一致
  const PAD_T = 16;       // 顶部内边距，必须与 CSS 一致
  const NOTE_W = 340;

  let built = false;
  let host, ta, hl, gutter, notesCol, notesInner, splitter;

  const $ = s => document.querySelector(s);
  const curFile = () => (hasFile() ? files()[cur] : null);
  const noteMap = () => (NOTES[nkey()] = NOTES[nkey()] || {});

  /* ---------------- 构建 ---------------- */
  function build() {
    if (built) return;
    host = document.getElementById(HOST_ID);
    if (!host) return;
    host.innerHTML = '';
    host.classList.add('ed-host');

    const wrap = document.createElement('div');
    wrap.className = 'ed';
    wrap.innerHTML =
      '<div class="ed-gutter"><div class="ed-gutter-in" id="edGutter"></div></div>' +
      '<div class="ed-main">' +
        '<pre class="ed-hl" id="edHl" aria-hidden="true"></pre>' +
        '<textarea class="ed-input" id="edInput" spellcheck="false" autocapitalize="off" ' +
          'autocomplete="off" wrap="off"></textarea>' +
      '</div>' +
      '<div class="ed-notes"><div class="ed-notes-in" id="edNotes"></div></div>';
    host.appendChild(wrap);

    ta = $('#edInput');
    hl = $('#edHl');
    gutter = $('#edGutter');
    notesCol = host.querySelector('.ed-notes');
    notesInner = $('#edNotes');

    ta.addEventListener('input', onInput);
    ta.addEventListener('scroll', syncScroll);
    ta.addEventListener('keydown', onKey);
    ta.addEventListener('click', () => { paintNotes(true); paintCaretInfo(); });
    ta.addEventListener('keyup', paintCaretInfo);

    notesCol.addEventListener('dblclick', onNotesDblClick);

    built = true;
  }

  /* ---------------- 滚动同步 ---------------- */
  function syncScroll() {
    if (!ta) return;
    const x = ta.scrollLeft, y = ta.scrollTop;
    hl.style.transform = 'translate(' + (-x) + 'px,' + (-y) + 'px)';
    gutter.style.transform = 'translateY(' + (-y) + 'px)';
    notesInner.style.transform = 'translateY(' + (-y) + 'px)';
  }

  /* ---------------- 锚点：按内容指纹跟随代码 ---------------- */
  function resolveAnchors(f) {
    const nm = NOTES[nkey()] || {};
    const keys = Object.keys(nm).map(Number).sort((a, b) => a - b);
    const next = {};
    keys.forEach(k => {
      const n = nm[k];
      if (!n || typeof n !== 'object') return;
      if (n.fp == null) n.fp = hashLine(f.lines[k - 1] || '');
      if (n.anchorText == null) n.anchorText = f.lines[k - 1] || '';

      /* 锚在空行上的笔记无法区分彼此：保持原位，不做跳跃式匹配 */
      if (!String(n.anchorText).trim()) { if (!next[k]) next[k] = n; return; }

      let target = -1;
      if (k >= 1 && f.lines[k - 1] !== undefined && hashLine(f.lines[k - 1]) === n.fp) {
        target = k;
      } else {
        let best = -1, bestD = Infinity;
        f.lines.forEach((l, i) => {
          let hit = hashLine(l) === n.fp;
          if (!hit && n.anchorText) {
            const a = n.anchorText.trim();
            hit = a.length > 0 && (l.trim() === a || l.trim().startsWith(a) || a.startsWith(l.trim()));
          }
          if (!hit) return;
          const d = Math.abs((i + 1) - k);
          if (d < bestD) { bestD = d; best = i + 1; }
        });
        if (best > 0) target = best;
      }
      if (target > 0 && !next[target]) next[target] = n;
    });
    NOTES[nkey()] = next;
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    const f = curFile();
    host = document.getElementById(HOST_ID);
    if (!f) {
      host.innerHTML = '<div class="emptyfile">这个工程还没有文件。<br>' +
        '<button id="eNew">＋ 新建一个文件</button></div>';
      const b = document.getElementById('eNew');
      if (b) b.onclick = newFileDialog;
      built = false;
      return;
    }
    build();

    const text = f.lines.join('\n');
    if (ta.value !== text) {
      const st = ta.scrollTop, sl = ta.scrollLeft;
      ta.value = text;
      ta.scrollTop = st; ta.scrollLeft = sl;
    }
    resolveAnchors(f);
    paintAll(); paintCaretInfo();

    const pathEl = document.getElementById('fpath');
    const langEl = document.getElementById('flang');
    if (pathEl) pathEl.textContent = curProj + '/' + f.path;
    if (langEl) langEl.textContent = (window.LANGS || {})[f.lang] || f.lang;

    document.getElementById('fmeta').textContent =
      f.lines.length + ' 行 · ' + Object.keys(noteMap()).length + ' 条笔记';
  }

  function paintAll() {
    paintHighlight();
    paintGutter();
    paintNotes();
    syncScroll();
  }

  function paintHighlight() {
    const f = curFile(); if (!f) return;
    const names = new Set(((window.LIB || {})[f.lang] || []).map(x => x.name));
    const kws = new Set((window.KEYWORDS || {})[f.lang] || []);
    const out = [];
    for (let i = 0; i < f.lines.length; i++) {
      const line = f.lines[i];
      if (!line) { out.push(' '); continue; }
      let html = '';
      tokenize(line, f.lang).forEach(tk => {
        let cls;
        if (tk.t === 'id' && names.has(tk.v)) cls = 'fx';
        else cls = 'tk-' + (tk.t === 'id' ? (kws.has(tk.v) ? 'k' : 'p') : tk.t);
        html += '<span class="' + cls + '">' + esc(tk.v) + '</span>';
      });
      out.push(html);
    }
    hl.innerHTML = out.join('\n') + '\n';
  }

  function paintGutter() {
    const f = curFile(); if (!f) return;
    let s = '';
    for (let i = 1; i <= f.lines.length; i++) s += i + '\n';
    gutter.textContent = s;
  }

  /* ---------------- 笔记列 ---------------- */
  function paintNotes(keepFocus) {
    const f = curFile(); if (!f || !notesInner) return;
    const active = keepFocus ? document.activeElement.closest('.ed-note') : null;
    const activeId = active && active.dataset.id;

    const entries = [];
    const nm = noteMap();
    Object.keys(nm).forEach(k => {
      const n = nm[k];
      if (!n || typeof n !== 'object') return;
      entries.push({ line: +k, note: n });
    });
    entries.sort((a, b) => a.line - b.line);

    notesInner.innerHTML = '';
    let lastBottom = 0;
    const seen = new Set();

    entries.forEach(({ line, note }) => {
      const baseY = PAD_T + (line - 1) * LH;
      let y = baseY;
      const pushed = y < lastBottom + 3;
      if (pushed) y = lastBottom + 3;

      const card = buildNote(line, note);
      card.style.top = y + 'px';
      if (pushed) card.classList.add('pushed');
      notesInner.appendChild(card);

      lastBottom = y + card.offsetHeight;
      seen.add(line);
    });

    notesInner.style.height = (PAD_T * 2 + f.lines.length * LH) + 'px';

    if (activeId) {
      const again = notesInner.querySelector('.ed-note[data-id="' + activeId + '"] .ed-note-body');
      if (again) { again.focus(); }
    }
  }

  function buildNote(line, note) {
    const el = document.createElement('div');
    el.className = 'ed-note' + (note.author === 'ai' ? ' ai' : '') + (note.kind === 'comment' ? ' cmt' : '');
    el.dataset.id = note.id;
    el.dataset.line = line;
    el.tabIndex = 0;

    const head = document.createElement('div');
    head.className = 'ed-note-head';
    const tag = document.createElement('span');
    tag.className = 'ed-note-tag';
    tag.textContent = 'L' + line;
    head.appendChild(tag);
    el.appendChild(head);

    const body = document.createElement('div');
    body.className = 'ed-note-body';
    body.contentEditable = 'true';
    body.textContent = note.text || '';
    el.appendChild(body);

    if (note.extracted) {
      const x = document.createElement('div');
      x.className = 'ed-note-extracted';
      x.textContent = note.extracted;
      el.appendChild(x);
    }

    body.addEventListener('input', () => {
      if (!note._touched) { note._touched = true; snapshot('编辑笔记'); }
      note.text = body.innerText;
      note.updatedAt = Date.now();
      saveAll();
      el.style.height = 'auto';
    });

    body.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); body.blur(); }
      else if (ev.key === 'Escape') { body.blur(); }
    });

    body.addEventListener('blur', () => {
      note._touched = false;
      if (!String(note.text || '').trim()) {
        snapshot('删除笔记');
        delete noteMap()[line];
        saveAll();
        render();
      }
    });

    body.addEventListener('dblclick', () => {
      const r = document.createRange(); r.selectNodeContents(body);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    });

    el.addEventListener('mousedown', ev => {
      if (ev.target.closest('.ed-note-body')) return;
      ev.preventDefault();
      el.classList.add('focused');
      el.focus();
    });

    el.addEventListener('keydown', ev => {
      if (document.activeElement === el && (ev.key === 'Delete' || ev.key === 'Backspace')) {
        ev.preventDefault();
        snapshot('删除笔记');
        delete noteMap()[line];
        saveAll();
        render();
      }
    });

    el.addEventListener('focusin', () => el.classList.add('focused'));
    el.addEventListener('focusout', () => el.classList.remove('focused'));

    return el;
  }

  /* 空白处双击：在这一行的位置新建笔记 */
  function onNotesDblClick(ev) {
    if (ev.target.closest('.ed-note')) return;
    const rect = notesInner.getBoundingClientRect();
    const y = ev.clientY - rect.top - PAD_T;
    const line = Math.max(1, Math.min(curFile().lines.length, Math.round(y / LH) + 1));
    addNote(line);
  }

  /* ---------------- 编辑 ---------------- */
  function onInput() {
    const f = curFile(); if (!f) return;
    const old = f.lines.slice();
    const lines = ta.value.split('\n');
    f.lines = lines.length ? lines : [''];

    /* 只有“行数没变”的原地改写才更新指纹；
       插入/删除整行时交给指纹匹配去迁移，直接改指纹会把锚点冲掉 */
    if (old.length === f.lines.length) {
      const nm = noteMap();
      for (let i = 0; i < f.lines.length; i++) {
        if (old[i] === f.lines[i]) continue;
        const n = nm[i + 1];
        if (n) { n.fp = hashLine(f.lines[i]); n.anchorText = f.lines[i]; }
      }
    }

    saveAll();
    resolveAnchors(f);
    paintHighlight();
    paintGutter();
    paintNotes();
    paintCaretInfo();
  }

  function onKey(ev) {
    const f = curFile(); if (!f) return;

    if (ev.key === 'Tab') {
      ev.preventDefault();
      const unit = (typeof detectIndentUnit === 'function')
        ? detectIndentUnit(f.lines, f.lang) : 2;
      insert(' '.repeat(unit), ev.shiftKey);
      return;
    }

    if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey) {
      ev.preventDefault();
      const pos = ta.selectionStart;
      const before = ta.value.slice(0, pos);
      const lineStart = before.lastIndexOf('\n') + 1;
      const lineText = before.slice(lineStart);
      const indent = (typeof nextIndent === 'function') ? nextIndent(lineText, 0) : '';
      insert('\n' + indent, false);
      return;
    }
  }

  /* 在光标处插入文本（支持替换选区），并保持撤销栈 */
  function insert(text, outdent) {
    const start = ta.selectionStart, end = ta.selectionEnd;
    let add = text;
    if (outdent) {
      // Shift+Tab：删掉行首一个缩进单位
      const f = curFile();
      const unit = (typeof detectIndentUnit === 'function') ? detectIndentUnit(f.lines, f.lang) : 2;
      const before = ta.value.slice(0, start);
      const ls = before.lastIndexOf('\n') + 1;
      const line = ta.value.slice(ls, end);
      const m = line.match(/^ +/);
      const n = Math.min(unit, m ? m[0].length : 0);
      if (n) {
        ta.setSelectionRange(ls, ls + n);
        document.execCommand('delete');
        ta.setSelectionRange(Math.max(ls, start - n), Math.max(ls, end - n));
      }
      return;
    }
    ta.setRangeText(add, start, end, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* ---------------- 对外 API ---------------- */
  function addNote(line, text, opts) {
    if (!curFile()) return null;
    const f = curFile();
    line = Math.max(1, Math.min(f.lines.length, line || 1));
    const nm = noteMap();
    if (nm[line]) {
      // 已有笔记 → 把内容追加进去，而不是再建一张卡
      nm[line].text = (nm[line].text ? nm[line].text + '\n' : '') + (text || '');
      nm[line].updatedAt = Date.now();
    } else {
      nm[line] = {
        id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        text: text || '',
        fp: hashLine(f.lines[line - 1] || ''),
        kind: (opts && opts.kind) || 'note',
        author: (opts && opts.author) || 'me',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        rangeEnd: (opts && opts.rangeEnd) || null,
        extracted: (opts && opts.extracted) || ''
      };
    }
    saveAll();
    render();
    const card = notesInner.querySelector('.ed-note[data-line="' + line + '"] .ed-note-body');
    if (card) requestAnimationFrame(() => card.focus());
    return nm[line];
  }

  function noteAt(line) { return noteMap()[line] || null; }
  function removeNote(line) { delete noteMap()[line]; saveAll(); render(); }

  /* 覆盖写入（AI「替换」时用） */
  function putNote(line, text, opts) {
    if (!curFile()) return null;
    const f = curFile();
    line = Math.max(1, Math.min(f.lines.length, line || 1));
    const old = noteMap()[line];
    noteMap()[line] = {
      id: (old && old.id) || ('n' + Date.now().toString(36)),
      text: text || '',
      fp: hashLine(f.lines[line - 1] || ''),
      kind: (opts && opts.kind) || (old && old.kind) || 'note',
      author: (opts && opts.author) || 'me',
      createdAt: (old && old.createdAt) || Date.now(),
      updatedAt: Date.now(),
      rangeEnd: (opts && opts.rangeEnd) || null,
      extracted: ''
    };
    saveAll();
    render();
    return noteMap()[line];
  }

  /* ---------------- 光标所在函数（替代悬停气泡） ---------------- */
  let fnBar = null;
  function paintCaretInfo() {
    const f = curFile(); if (!f || !ta) return;
    if (!fnBar) {
      fnBar = document.createElement('div');
      fnBar.className = 'ed-fnbar';
      host.appendChild(fnBar);
    }
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos);
    const lineNo = before.split('\n').length;
    const col = before.length - (before.lastIndexOf('\n') + 1);
    const text = f.lines[lineNo - 1] || '';

    let i = col, j = col;
    while (i > 0 && /[A-Za-z0-9_$]/.test(text[i - 1])) i--;
    while (j < text.length && /[A-Za-z0-9_$]/.test(text[j])) j++;
    const word = text.slice(i, j);

    const lib = (window.LIB || {})[f.lang] || [];
    const hit = word && lib.find(e => e.name === word);
    if (hit) {
      fnBar.innerHTML = '<b></b><span></span>';
      fnBar.querySelector('b').textContent = hit.name;
      fnBar.querySelector('span').textContent = hit.desc || '（函数库里还没有描述）';
      fnBar.classList.add('on');
    } else {
      fnBar.classList.remove('on');
    }
  }

  function caretLine() {
    const pos = ta ? ta.selectionStart : 0;
    return ta ? ta.value.slice(0, pos).split('\n').length : 1;
  }

  function selectedLines() {
    if (!ta) return null;
    if (ta.selectionStart === ta.selectionEnd) return { from: caretLine(), to: caretLine(), text: '' };
    const before = ta.value.slice(0, ta.selectionStart);
    const from = before.split('\n').length;
    const to = ta.value.slice(0, ta.selectionEnd).split('\n').length;
    return { from, to, text: ta.value.slice(ta.selectionStart, ta.selectionEnd) };
  }

  /* ---------------- 挂到全局 ---------------- */
  window.ED = {
    render, addNote, putNote, noteAt, removeNote, caretLine, selectedLines,
    focusBody(line) {
      const c = notesInner && notesInner.querySelector('.ed-note[data-line="' + line + '"] .ed-note-body');
      if (c) c.focus();
    }
  };

  window.renderCode = render;

  const addBtn = document.getElementById('btnAddNote');
  if (addBtn) addBtn.addEventListener('click', () => {
    const line = (window.ED && ED.caretLine) ? ED.caretLine() : 1;
    addNote(line);
  });

  /* 页面初始化脚本先跑了旧渲染，这里接管一次 */
  try { render(); } catch (e) { console.error('editor init failed', e); }
})();
