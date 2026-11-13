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
  let host, ta, hl, gutter;
  /* 权威投影：每个显示行都对应真实模型行，折叠提示不占文本行。 */
  let foldView = null;
  let viewFileKey = null;

  const $ = s => document.querySelector(s);
  const curFile = () => (hasFile() ? files()[cur] : null);
  const noteMap = () => (NOTES[nkey()] = NOTES[nkey()] || {});

  function project(f) {
    const folding = window.EditorFolding;
    if (folding) folding.beforeRender(f);
    foldView = folding ? folding.project(f) : {
      lines: f.lines.slice(), map: f.lines.map((_, model) => ({ model })),
      collapsedByStart: new Map()
    };
    viewFileKey = nkey();
    return foldView;
  }

  function lineStarts(lines) {
    let offset = 0;
    return lines.map(line => { const start = offset; offset += line.length + 1; return start; });
  }

  function viewToModel(pos, view, f) {
    const starts = lineStarts(view.lines);
    let row = 0;
    while (row + 1 < starts.length && starts[row + 1] <= pos) row++;
    const entry = view.map[row];
    if (!entry) return 0;
    const model = Math.max(0, Math.min(f.lines.length - 1, entry.model));
    return lineStarts(f.lines)[model] + Math.min(f.lines[model].length, Math.max(0, pos - starts[row]));
  }

  function modelToView(pos, view, f) {
    const starts = lineStarts(f.lines), visible = lineStarts(view.lines);
    pos = Math.max(0, Math.min(f.lines.join('\n').length, Number(pos) || 0));
    let model = 0;
    while (model + 1 < starts.length && starts[model + 1] <= pos) model++;
    let row = view.map.findIndex(entry => entry.model === model);
    if (row >= 0) return visible[row] + Math.min(f.lines[model].length, pos - starts[model]);
    // 隐藏位置落在最近可见的折叠头行末尾，不自动展开。
    row = 0;
    for (let i = 0; i < view.map.length && view.map[i].model < model; i++) row = i;
    return visible[row] + view.lines[row].length;
  }

  function getModelSelection() {
    const f = curFile();
    if (!f || !ta) return { start: 0, end: 0, direction: 'none' };
    const view = foldView || project(f);
    const all = ta.selectionStart === 0 && ta.selectionEnd === ta.value.length && ta.selectionStart !== ta.selectionEnd;
    return { start: viewToModel(ta.selectionStart, view, f),
      end: all ? f.lines.join('\n').length : viewToModel(ta.selectionEnd, view, f), direction: ta.selectionDirection || 'none' };
  }

  function setModelSelection(start, end, direction) {
    const f = curFile(); if (!f || !ta) return;
    const view = foldView || project(f);
    ta.setSelectionRange(modelToView(start, view, f), modelToView(end, view, f), direction || 'none');
    paintCaretInfo();
  }

  function onClipboard(ev) {
    const f = curFile(); if (!f || !ev.clipboardData || ta.selectionStart === ta.selectionEnd) return;
    const selection = getModelSelection();
    ev.preventDefault();
    ev.clipboardData.setData('text/plain', f.lines.join('\n').slice(selection.start, selection.end));
    if (ev.type === 'cut') {
      if(window.EditorFolding){
        const source=f.lines.join('\n');
        const identity={lines:f.lines.slice(),map:f.lines.map((_,model)=>({model}))};
        EditorFolding.applyViewEdit(source,source.slice(0,selection.start)+source.slice(selection.end),identity,f);
        render();setModelSelection(selection.start,selection.start);saveAll();
      }else{ta.setRangeText('', ta.selectionStart, ta.selectionEnd, 'start');onInput();}
    }
  }

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
      '';
    host.appendChild(wrap);

    ta = $('#edInput');
    hl = $('#edHl');
    gutter = $('#edGutter');

    ta.addEventListener('input', onInput);
    ta.addEventListener('copy', onClipboard);
    ta.addEventListener('cut', onClipboard);
    ta.addEventListener('scroll', syncScroll);
    ta.addEventListener('keydown', onKey);
    ta.addEventListener('click', () => { paintCaretInfo(); });
    ta.addEventListener('keyup', paintCaretInfo);


    built = true;
  }

  /* ---------------- 滚动同步 ---------------- */
  function syncScroll() {
    if (!ta) return;
    const x = ta.scrollLeft, y = ta.scrollTop;
    hl.style.transform = 'translate(' + (-x) + 'px,' + (-y) + 'px)';
    gutter.style.transform = 'translateY(' + (-y) + 'px)';
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
      foldView = null;
      host.innerHTML = '<div class="emptyfile">这个工程还没有文件。<br>' +
        '<button id="eNew">＋ 新建一个文件</button></div>';
      const b = document.getElementById('eNew');
      if (b) b.onclick = newFileDialog;
      built = false;
      return;
    }
    build();

    const selection = foldView && viewFileKey === nkey() ? getModelSelection() : null;
    const view = project(f);
    const text = view.lines.join('\n');
    if (ta.value !== text) {
      const st = ta.scrollTop, sl = ta.scrollLeft;
      ta.value = text;
      ta.scrollTop = st; ta.scrollLeft = sl;
    }
    ta.readOnly = false;
    ta.classList.toggle('folded', !!view.collapsedByStart.size);
    if (selection) setModelSelection(selection.start, selection.end, selection.direction);
    resolveAnchors(f);
    paintAll(); paintCaretInfo();

    const pathEl = document.getElementById('fpath');
    const langEl = document.getElementById('flang');
    if (pathEl) pathEl.textContent = curProj + '/' + f.path;
    if (langEl) langEl.textContent = (window.LANGS || {})[f.lang] || f.lang;

    document.getElementById('fmeta').textContent =
      f.lines.length + ' 行 · ' + Object.keys(noteMap()).length + ' 条笔记';
  }

  const afterHooks = [];
  function paintAll() {
    if (window.EditorViewLayout) EditorViewLayout.apply();
    paintHighlight();
    paintGutter();
    if (window.EditorViewLayout) { EditorViewLayout.draw(foldView); positionDecorations(); }
    syncScroll();
    afterHooks.forEach(fn => { try { fn(); } catch (e) {} });
  }

  function paintHighlight() {
    const f = curFile(); if (!f) return;
    const names = new Set(((window.LIB || {})[f.lang] || []).map(x => x.name));
    const kws = new Set((window.KEYWORDS || {})[f.lang] || []);
    const nm = NOTES[nkey()] || {};
    const mark = (f.lang === 'verilog') ? '  // ' : '  # ';
    const view = foldView;
    const lines = view ? view.lines : f.lines;
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const entry = view ? view.map[i] : null;
      let html = '';
      {
        const line = lines[i];
        if (line) {
          tokenize(line, f.lang).forEach(tk => {
            let cls;
            if (tk.t === 'id' && names.has(tk.v)) cls = 'fx';
            else cls = 'tk-' + (tk.t === 'id' ? (kws.has(tk.v) ? 'k' : 'p') : tk.t);
            html += '<span class="' + cls + '">' + esc(tk.v) + '</span>';
          });
        } else {
          html = ' ';
        }
        if (entry && view.collapsedByStart.has(entry.model)) {
          if(window.EditorFolding && EditorFolding.options.foldingHighlight)
            html += '<span class="fold-background" data-row="' + i + '"></span>';
          html += '<span class="fold-placeholder" data-row="' + i + '" data-model="' + entry.model + '">⋯</span>';
        }
        const modelLine = entry ? entry.model + 1 : i + 1;
        const n = nm[modelLine];
        if (n && String(n.text || '').trim()) {
          const raw = String(n.text).replace(/\s+/g, ' ').trim();
          const shown = raw.length > 72 ? raw.slice(0, 72) + '…' : raw;
          html += '<span data-row="' + i + '" class="nl-inline' + (n.author === 'ai' ? ' ai' : '') + '">' +
            esc(mark + shown) + '</span>';
        }
      }
      out.push(html);
    }
    hl.innerHTML = out.join('\n') + '\n';
  }

  function positionDecorations() {
    if (!window.EditorViewLayout || !foldView) return;
    for(const el of hl.querySelectorAll('.fold-background')){
      const row=+el.dataset.row,layout=EditorViewLayout.get();
      el.style.cssText='position:absolute;left:0;right:0;top:'+layout.rows[row].top+'px;height:'+layout.rows[row].height+'px;';
    }
    for (const el of hl.querySelectorAll('.nl-inline,.fold-placeholder')) {
      const row = +el.dataset.row;
      const point = EditorViewLayout.positionAt(row, foldView.lines[row].length);
      if (!point) continue;
      el.style.position = 'absolute'; el.style.whiteSpace = 'pre';
      el.style.left = point.left + 'px'; el.style.top = point.top + 'px';
    }
  }
  window.addEventListener('resize', () => requestAnimationFrame(() => {
    if (window.EditorViewLayout && foldView) { EditorViewLayout.draw(foldView); positionDecorations(); }
  }));

  function paintGutter() {
    const f = curFile(); if (!f) return;
    const view = foldView;
    const lines = view ? view.lines : f.lines;
    let s = '';
    for (let i = 0; i < lines.length; i++) {
      s += (view ? view.map[i].model + 1 : i + 1);
      s += '\n';
    }
    gutter.textContent = s;
  }

  /* ---------------- 编辑 ---------------- */
  function onInput() {
    const f = curFile(); if (!f) return;
    const old = f.lines.slice();
    Object.keys(noteMap()).forEach(key => {
      const note = noteMap()[key];
      if (!note || typeof note !== 'object') return;
      const source = old[Number(key) - 1] || '';
      if (note.fp == null) note.fp = hashLine(source);
      if (note.anchorText == null) note.anchorText = source;
    });
    const oldView = foldView || { lines: old.slice(), map: old.map((_, model) => ({ model })), collapsedByStart: new Map() };
    const newText = ta.value;
    const caretStart = ta.selectionStart, caretEnd = ta.selectionEnd, direction = ta.selectionDirection;
    if (window.EditorFolding) window.EditorFolding.applyViewEdit(oldView.lines.join('\n'), newText, oldView, f);
    else f.lines = newText.split('\n');
    // 输入后重算投影；textarea 和编辑器节点保持不变。
    // applyViewEdit 后的光标按变更后显示行定位。
    const view = project(f);
    const text = view.lines.join('\n');
    if (ta.value !== text) ta.value = text;
    ta.setSelectionRange(Math.min(caretStart, text.length), Math.min(caretEnd, text.length), direction || 'none');
    ta.readOnly = false;
    ta.classList.toggle('folded', !!view.collapsedByStart.size);

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
    paintAll();
    paintCaretInfo();
    const meta = document.getElementById('fmeta');
    if (meta) meta.textContent = f.lines.length + ' 行 · ' + Object.keys(noteMap()).length + ' 条笔记';
  }

  function onKey(ev) {
    const f = curFile(); if (!f) return;

    if (ev.key === 'Tab') {
      ev.preventDefault();
      const unit = (typeof detectIndentUnit === 'function')
        ? detectIndentUnit(f.lines, f.lang) : 2;
      const selection=getModelSelection(), source=f.lines.join('\n');
      const first=source.slice(0,selection.start).split('\n').length-1;
      const last=source.slice(0,selection.end>selection.start && source[selection.end-1]==='\n'?selection.end-1:selection.end).split('\n').length-1;
      if(selection.start!==selection.end && first!==last && window.EditorFolding){
        const next=f.lines.slice();
        for(let i=first;i<=last;i++) next[i]=ev.shiftKey?next[i].replace(new RegExp('^ {1,'+unit+'}'),''):' '.repeat(unit)+next[i];
        const identity={lines:f.lines.slice(),map:f.lines.map((_,model)=>({model}))};
        EditorFolding.applyViewEdit(source,next.join('\n'),identity,f);render();saveAll();
        const ss=lineStarts(f.lines);setModelSelection(ss[first],ss[last]+f.lines[last].length,selection.direction);
      }else insert(' '.repeat(unit), ev.shiftKey);
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
    if (!(opts && opts.quiet) && typeof openNoteEditor === 'function') requestAnimationFrame(() => openNoteEditor(line));
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
    const text = ta.value.split('\n')[lineNo - 1] || '';

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

  /* ---------------- 行内注释编辑器 ---------------- */
  let nlEditor = null;
  function closeNoteEditor() {
    const box = nlEditor; nlEditor = null;
    if (box && box.parentNode) box.parentNode.removeChild(box);
  }
  function openNoteEditor(line) {
    const f = curFile(); if (!f) return;
    if (window.EditorFolding) window.EditorFolding.reveal(line - 1);
    render();
    closeNoteEditor();
    const note = noteMap()[line];
    const box = document.createElement('div');
    box.className = 'nl-editor';
    const area = document.createElement('textarea');
    area.spellcheck = false;
    area.value = note ? (note.text || '') : '';
    area.placeholder = '写这一行的笔记…（Ctrl+Enter 保存，Esc 取消）';
    box.appendChild(area);
    host.querySelector('.ed-main').appendChild(box);

    const row = foldView.map.findIndex(entry => entry.model === line - 1);
    const top = (window.EditorViewLayout ? EditorViewLayout.lineTop(Math.max(0,row)) : PAD_T + Math.max(0,row)*LH) - ta.scrollTop;
    box.style.top = Math.max(4, top) + 'px';
    box.style.left = '24px';
    nlEditor = box;
    setTimeout(() => { area.focus(); area.setSelectionRange(area.value.length, area.value.length); }, 10);

    const save = () => {
      const text = area.value.trim();
      const cur0 = noteMap()[line];
      if (!text) {
        if (cur0) { snapshot('删除笔记'); delete noteMap()[line]; saveAll(); }
      } else if (!cur0 || (cur0.text || '') !== text) {
        snapshot('编辑笔记');
        if (!cur0) noteMap()[line] = {
          id: 'n' + Date.now().toString(36), text, fp: hashLine(f.lines[line - 1] || ''),
          anchorText: f.lines[line - 1] || '', kind: 'note', author: 'me',
          createdAt: Date.now(), updatedAt: Date.now()
        };
        else { cur0.text = text; cur0.updatedAt = Date.now(); }
        saveAll();
      }
      if (nlEditor === box) closeNoteEditor();
      paintAll(); paintCaretInfo();
    };

    area.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') { ev.preventDefault(); closeNoteEditor(); area.blur(); }
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); save(); }
    });
    area.addEventListener('blur', () => { if (nlEditor === box) save(); });
  }
  window.openNoteEditor = openNoteEditor;

  function caretLine() {
    if (!ta) return 1;
    const pos = ta.selectionStart;
    const dl = ta.value.slice(0, pos).split('\n').length;   // 显示行，1 基
    if (foldView && foldView.map[dl - 1]) {
      const e = foldView.map[dl - 1];
      return e.model + 1;
    }
    return dl;
  }

  /* 跳到某一行并把光标放过去 */
  function gotoLine(line) {
    const f = curFile(); if (!f) return;
    line = Math.max(1, Math.min(f.lines.length, Number(line) || 1));
    if (window.EditorFolding) window.EditorFolding.reveal(line - 1);
    render();
    const row = Math.max(0, foldView.map.findIndex(entry => entry.model === line - 1));
    const pos = lineStarts(foldView.lines)[row];
    ta.focus();
    ta.setSelectionRange(pos, pos);
    ta.scrollTop = Math.max(0, (window.EditorViewLayout ? EditorViewLayout.lineTop(row) : row*LH) - 120);
    syncScroll();
    paintCaretInfo();
  }

  function selectedLines() {
    if (!ta) return null;
    const dlOf = pos => ta.value.slice(0, pos).split('\n').length;
    const mlOf = dl => {
      if (foldView && foldView.map[dl - 1]) {
        const e = foldView.map[dl - 1];
        return e.model + 1;
      }
      return dl;
    };
    if (ta.selectionStart === ta.selectionEnd) {
      const l = caretLine();
      return { from: l, to: l, text: '' };
    }
    const from = mlOf(dlOf(ta.selectionStart));
    const to = mlOf(dlOf(ta.selectionEnd));
    const selection = getModelSelection();
    return { from, to, text: curFile().lines.join('\n').slice(selection.start, selection.end) };
  }

  /* ---------------- 挂到全局 ---------------- */
  window.ED = {
    afterRender(fn) { afterHooks.push(fn); },
    render, refreshView: render, addNote, putNote, noteAt, removeNote, caretLine, gotoLine, selectedLines,
    getModelSelection, setModelSelection,
    getFoldView() {
      const f = curFile();
      if (!f) return { lines: [], map: [], collapsedByStart: new Map() };
      return foldView && viewFileKey === nkey() ? foldView : project(f);
    },
    isFolded() { return !!(foldView && foldView.collapsedByStart.size); },
    focusBody(line) {
      if (typeof openNoteEditor === 'function') openNoteEditor(line);
    }
  };

  window.renderCode = render;

  const addBtn = document.getElementById('btnAddNote');
  if (addBtn) addBtn.addEventListener('click', () => openNoteEditor(caretLine()));
  document.addEventListener('keydown', ev => {
    if (ev.altKey && ev.ctrlKey && (ev.key === 'm' || ev.key === 'M')) {
      ev.preventDefault();
      openNoteEditor(caretLine());
    }
  });

  /* 页面初始化脚本先跑了旧渲染，这里接管一次 */
  try { render(); } catch (e) { console.error('editor init failed', e); }
})();
