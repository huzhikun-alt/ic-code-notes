/* Monaco Editor integration for the existing DSH code view.
 * Replaces the hand-written textarea/pre/folding/guide editor with the
 * official VS Code editor component (MIT, vendored under vendor/monaco).
 * Keeps the app's ED API, notes, AI selection integration and file model.
 */
(() => {
  'use strict';

  const HOST_ID = 'code';
  const LANG_MAP = {
    verilog: 'verilog', systemverilog: 'verilog', sv: 'verilog', v: 'verilog',
    perl: 'perl', pl: 'perl', python: 'python', py: 'python',
    javascript: 'javascript', js: 'javascript', typescript: 'typescript', ts: 'typescript',
    yaml: 'yaml', yml: 'yaml', json: 'json', markdown: 'markdown', md: 'markdown',
    c: 'c', cpp: 'cpp', cxx: 'cpp', h: 'cpp', hpp: 'cpp',
    csharp: 'csharp', java: 'java', go: 'go', rust: 'rust', html: 'html', css: 'css',
    shell: 'shell', bash: 'shell', sh: 'shell', sql: 'sql', lua: 'lua'
  };

  let host = null, wrap = null, monaco = null, editor = null, model = null;
  let ready = false, pending = false, suppress = false;
  let noteDecos = null, noteEditor = null, themeObserver = null;
  let currentKey = '';
  const models = new Map();
  const viewStates = new Map();
  const hooks = [];

  const curFile = () => (typeof hasFile === 'function' && hasFile()) ? files()[cur] : null;
  const noteMap = () => (NOTES[nkey()] = NOTES[nkey()] || {});
  const langOf = f => LANG_MAP[String(f && f.lang || '').toLowerCase()] || 'plaintext';
  const isLight = () => document.documentElement.dataset.theme === 'light';
  const themeName = () => isLight() ? 'dsh-light' : 'dsh-dark';

  function emit() { hooks.forEach(fn => { try { fn(); } catch (_) {} }); }

  /* ---------------- language definitions ---------------- */
  function registerLanguages(m) {
    m.languages.register({ id: 'verilog' });
    m.languages.setLanguageConfiguration('verilog', {
      comments: { lineComment: '//', blockComment: ['/*', '*/'] },
      brackets: [['{', '}'], ['[', ']'], ['(', ')']],
      autoClosingPairs: [
        { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' },
        { open: '"', close: '"' }, { open: "'", close: "'" }
      ]
    });
    const vKeywords = ['module','endmodule','input','output','inout','logic','wire','reg','always','always_ff','always_comb','always_latch','begin','end','function','endfunction','task','endtask','if','else','case','casez','casex','endcase','for','while','repeat','forever','assign','parameter','localparam','generate','endgenerate','initial','final','posedge','negedge','signed','unsigned','integer','real','time','typedef','struct','enum','package','endpackage','import','export','interface','endinterface','class','endclass','virtual','extends','new','return','break','continue','default','unique','priority','fork','join','join_any','join_none','disable','wait','event','specify','endspecify','primitive','endprimitive','table','endtable','program','endprogram','covergroup','endgroup','property','endproperty','sequence','endsequence','assert','assume','cover','restrict','expect','rand','randc','const','static','automatic','local','protected','pure','extern','super','this','null','void','string','bit','byte','shortint','int','longint','shortreal','genvar','supply0','supply1','tri','tri0','tri1','wand','wor','uwire','pulldown','pullup','buf','not','and','or','nand','nor','xor','xnor','bufif0','bufif1','notif0','notif1','nmos','pmos','cmos','tran','tranif0','tranif1','rtran','rtranif0','rtranif1'];
    m.languages.setMonarchTokensProvider('verilog', {
      keywords: vKeywords,
      tokenizer: {
        root: [
          [/\/\*/, 'comment', '@blockComment'],
          [/\/\/.*$/, 'comment'],
          [/`[A-Za-z_]\w*/, 'metatag'],
          [/\$[A-Za-z_]\w*/, 'predefined'],
          [/"([^"\\]|\\.)*"/, 'string'],
          [/'[bBoOdDhH][0-9a-fA-FxXzZ_?]+/, 'number'],
          [/'[01xXzZ]/, 'number'],
          [/\b\d+'(?:[bBoOdDhH])?[0-9a-fA-FxXzZ_?]+\b/, 'number'],
          [/\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/, 'number'],
          [/[A-Za-z_]\w*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
          [/[{}()[\]]/, '@brackets'],
          [/[=!<>+\-*\/%&|^~?:]+/, 'operator'],
          [/[;,.]/, 'delimiter']
        ],
        blockComment: [
          [/[^*/]+/, 'comment'],
          [/\*\//, 'comment', '@pop'],
          [/[*/]/, 'comment']
        ]
      }
    });

    m.languages.register({ id: 'perl' });
    m.languages.setLanguageConfiguration('perl', {
      comments: { lineComment: '#' },
      brackets: [['{', '}'], ['[', ']'], ['(', ')']],
      autoClosingPairs: [
        { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' },
        { open: '"', close: '"' }, { open: "'", close: "'" }
      ]
    });
    m.languages.setMonarchTokensProvider('perl', {
      keywords: ['sub','my','our','local','use','no','package','require','while','until','for','foreach','if','elsif','else','unless','do','last','next','redo','return','print','printf','say','open','close','die','warn','eval','chomp','chop','length','scalar','keys','values','push','pop','shift','unshift','split','join','map','grep','sort','reverse','defined','exists','delete','ref','bless','new','continue','given','when','default','state','say','fc','lc','uc','ucfirst','lcfirst','sprintf','substr','index','rindex','sprintf'],
      tokenizer: {
        root: [
          [/#.*$/, 'comment'],
          [/\$[A-Za-z_]\w*/, 'variable'],
          [/[@%][A-Za-z_]\w*/, 'variable'],
          [/"([^"\\]|\\.)*"/, 'string'],
          [/'([^'\\]|\\.)*'/, 'string'],
          [/\/([^\/\\\n]|\\.)+\/[a-z]*/, 'regexp'],
          [/\b\d+(?:\.\d+)?\b/, 'number'],
          [/[A-Za-z_]\w*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
          [/[{}()[\]]/, '@brackets'],
          [/[=!<>+\-*\/%&|^~?:.]+/, 'operator'],
          [/[;,.]/, 'delimiter']
        ]
      }
    });
  }

  function defineThemes(m) {
    const dark = {
      base: 'vs-dark', inherit: true,
      rules: [
        { token: 'keyword', foreground: '7fb3ff' },
        { token: 'string', foreground: 'a8d98a' },
        { token: 'comment', foreground: '6f7f91', fontStyle: 'italic' },
        { token: 'number', foreground: 'e0b36a' },
        { token: 'type', foreground: 'c9a7ff' },
        { token: 'predefined', foreground: '7fd1c7' },
        { token: 'metatag', foreground: 'd7a6ff' },
        { token: 'variable', foreground: 'e3c48b' },
        { token: 'regexp', foreground: 'a8d98a' },
        { token: 'operator', foreground: '9fb0c3' },
        { token: 'delimiter', foreground: '9fb0c3' }
      ],
      colors: {
        'editor.background': '#0f141a',
        'editor.foreground': '#d9e4ee',
        'editorLineNumber.foreground': '#5b6b7c',
        'editorLineNumber.activeForeground': '#c9d6e4',
        'editorGutter.background': '#0f141a',
        'editorIndentGuide.background1': '#2a3440',
        'editorIndentGuide.activeBackground1': '#4f6b82',
        'editorBracketGuide.background1': '#2a3440',
        'editorBracketGuide.activeBackground1': '#4f6b82',
        'editor.foldBackground': '#122028',
        'editor.selectionBackground': '#2a4a5a',
        'editor.inactiveSelectionBackground': '#22333d',
        'editorCursor.foreground': '#d9e4ee',
        'editor.lineHighlightBackground': '#141b22',
        'editorWidget.background': '#151c24',
        'editorWidget.border': '#2a3440',
        'editorSuggestWidget.background': '#151c24',
        'editorSuggestWidget.selectedBackground': '#22333d',
        'editorHoverWidget.background': '#151c24',
        'editorHoverWidget.border': '#2a3440'
      }
    };
    const light = {
      base: 'vs', inherit: true,
      rules: [
        { token: 'keyword', foreground: '2f6fb0' },
        { token: 'string', foreground: '3f7a3f' },
        { token: 'comment', foreground: '8a8f98', fontStyle: 'italic' },
        { token: 'number', foreground: 'a05a2c' },
        { token: 'type', foreground: '6a4fb0' },
        { token: 'predefined', foreground: '2f7f78' },
        { token: 'metatag', foreground: '8a4fb0' },
        { token: 'variable', foreground: '8a5a1a' },
        { token: 'regexp', foreground: '3f7a3f' },
        { token: 'operator', foreground: '4f5b66' },
        { token: 'delimiter', foreground: '4f5b66' }
      ],
      colors: {
        'editor.background': '#fbfaf7',
        'editor.foreground': '#1f2933',
        'editorLineNumber.foreground': '#9aa7b4',
        'editorLineNumber.activeForeground': '#3b4652',
        'editorGutter.background': '#fbfaf7',
        'editorIndentGuide.background1': '#e3e1da',
        'editorIndentGuide.activeBackground1': '#b9b3a7',
        'editorBracketGuide.background1': '#e3e1da',
        'editorBracketGuide.activeBackground1': '#b9b3a7',
        'editor.foldBackground': '#eef3f2',
        'editor.selectionBackground': '#cfe3e9',
        'editor.inactiveSelectionBackground': '#e2edf0',
        'editorCursor.foreground': '#1f2933',
        'editor.lineHighlightBackground': '#f3f1ea',
        'editorWidget.background': '#ffffff',
        'editorWidget.border': '#d9d5ca',
        'editorSuggestWidget.background': '#ffffff',
        'editorSuggestWidget.selectedBackground': '#e2edf0',
        'editorHoverWidget.background': '#ffffff',
        'editorHoverWidget.border': '#d9d5ca'
      }
    };
    m.editor.defineTheme('dsh-dark', dark);
    m.editor.defineTheme('dsh-light', light);
  }

  /* ---------------- build ---------------- */
  function build() {
    host = document.getElementById(HOST_ID);
    if (!host) return;
    host.innerHTML = '';
    host.classList.add('monaco-code-host');
    wrap = document.createElement('div');
    wrap.className = 'monaco-wrap';
    host.appendChild(wrap);

    editor = monaco.editor.create(wrap, {
      value: '', language: 'plaintext', theme: themeName(),
      fontFamily: 'Consolas, "Cascadia Mono", monospace',
      fontSize: 13, lineHeight: 22,
      minimap: { enabled: false },
      folding: true, foldingStrategy: 'auto', showFoldingControls: 'mouseover',
      foldingHighlight: true, unfoldOnClickAfterEndOfLine: false,
      guides: {
        indentation: true, highlightActiveIndentation: true,
        bracketPairs: false, bracketPairsHorizontal: 'active',
        highlightActiveBracketPair: true
      },
      lineNumbersMinChars: 3, lineDecorationsWidth: 22, glyphMargin: false,
      scrollBeyondLastLine: false, automaticLayout: true,
      padding: { top: 16, bottom: 60 },
      renderLineHighlight: 'line', wordWrap: 'off', tabSize: 4, insertSpaces: true,
      smoothScrolling: false,
      scrollbar: { verticalScrollbarSize: 14, horizontalScrollbarSize: 12 },
      overviewRulerLanes: 0, hideCursorInOverviewRuler: true,
      fixedOverflowWidgets: true, contextmenu: true
    });

    noteDecos = editor.createDecorationsCollection([]);
    editor.onDidChangeModelContent(onChange);
    editor.onDidChangeCursorPosition(() => { paintCaretInfo(); emit(); });
    editor.onDidScrollChange(() => emit());
    editor.onDidFocusEditorText(() => emit());
    editor.onDidBlurEditorText(() => emit());

    const addBtn = document.getElementById('btnAddNote');
    if (addBtn) addBtn.addEventListener('click', () => openNoteEditor(caretLine()));
    document.addEventListener('keydown', ev => {
      if (ev.altKey && ev.ctrlKey && (ev.key === 'm' || ev.key === 'M')) {
        ev.preventDefault(); openNoteEditor(caretLine());
      }
    });
    for (const [id, action] of [['btnUndo', 'undo'], ['btnRedo', 'redo']]) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', ev => {
        if (editor && document.activeElement && host.contains(document.activeElement)) {
          ev.preventDefault(); ev.stopImmediatePropagation(); editor.trigger('toolbar', action, null);
        }
      }, true);
    }
    themeObserver = new MutationObserver(() => {
      if (monaco && editor) monaco.editor.setTheme(themeName());
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-preset'] });
    window.addEventListener('resize', () => { if (editor) editor.layout(); });
  }

  /* ---------------- model / render ---------------- */
  function modelFor(f) {
    const key = nkey(), text = f.lines.join('\n');
    let m = models.get(key);
    if (!m) {
      m = monaco.editor.createModel(text, langOf(f));
      models.set(key, m);
    } else {
      if (m.getValue() !== text) {
        suppress = true;
        m.setValue(text);
        suppress = false;
      }
      const wanted = langOf(f);
      if (m.getLanguageId() !== wanted) monaco.editor.setModelLanguage(m, wanted);
    }
    return m;
  }

  function updateMeta() {
    const f = curFile();
    const pathEl = document.getElementById('fpath');
    const langEl = document.getElementById('flang');
    const metaEl = document.getElementById('fmeta');
    if (pathEl) pathEl.textContent = f ? curProj + '/' + f.path : curProj;
    if (langEl) langEl.textContent = f ? (typeof LANGS !== 'undefined' ? LANGS[f.lang] : f.lang) : '—';
    if (metaEl) metaEl.textContent = f ? f.lines.length + ' 行 · ' + Object.keys(NOTES[nkey()] || {}).length + ' 条批注' : '';
  }

  function updateNotes() {
    if (!editor || !noteDecos || !curFile()) return;
    const f = curFile(), nm = NOTES[nkey()] || {}, decos = [];
    const mark = f.lang === 'verilog' ? '  // ' : '  # ';
    for (const key of Object.keys(nm)) {
      const ln = Number(key), n = nm[key];
      if (!n || !String(n.text || '').trim() || !Number.isInteger(ln) || ln < 1 || ln > f.lines.length) continue;
      const raw = String(n.text).replace(/\s+/g, ' ').trim();
      const shown = raw.length > 72 ? raw.slice(0, 72) + '…' : raw;
      const col = model.getLineMaxColumn(ln);
      // Monaco 0.57 renders injected after-content only for a non-empty range;
      // a collapsed end-of-line range silently drops it.
      decos.push({
        range: new monaco.Range(ln, 1, ln, col),
        options: {
          after: {
            content: mark + shown,
            inlineClassName: 'nl-inline' + (n.author === 'ai' ? ' ai' : '')
          },
          hoverMessage: { value: raw },
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
        }
      });
    }
    noteDecos.set(decos);
  }

  function render() {
    if (!ready) { pending = true; return; }
    const f = curFile();
    updateMeta();
    if (!f) { if (editor) editor.setModel(null); return; }
    if (!editor) return;
    if (currentKey && currentKey !== nkey()) {
      try { viewStates.set(currentKey, editor.saveViewState()); } catch (_) {}
    }
    const m = modelFor(f);
    if (editor.getModel() !== m) editor.setModel(m);
    model = m;
    currentKey = nkey();
    if (viewStates.has(currentKey)) {
      try { editor.restoreViewState(viewStates.get(currentKey)); } catch (_) {}
    }
    updateNotes();
    paintCaretInfo();
    emit();
    pending = false;
  }

  function onInputDebounced() {
    let timer = null;
    return () => {
      clearTimeout(timer);
      timer = setTimeout(() => { try { saveAll(); } catch (_) {} updateMeta(); }, 250);
    };
  }
  const scheduleSave = onInputDebounced();

  function onChange() {
    if (suppress || !model) return;
    const f = curFile(); if (!f) return;
    f.lines = model.getValue().split('\n');
    resolveAnchors(f);
    scheduleSave();
    updateMeta();
    updateNotes();
    emit();
  }

  /* ---------------- notes (ported from the old editor) ---------------- */
  function resolveAnchors(f) {
    const nm = NOTES[nkey()] || {};
    const keys = Object.keys(nm).map(Number).sort((a, b) => a - b);
    const next = {};
    keys.forEach(k => {
      const n = nm[k];
      if (!n || typeof n !== 'object') return;
      if (n.fp == null) n.fp = hashLine(f.lines[k - 1] || '');
      if (n.anchorText == null) n.anchorText = f.lines[k - 1] || '';
      if (!String(n.anchorText).trim()) { if (!next[k]) next[k] = n; return; }
      let target = -1;
      if (k >= 1 && f.lines[k - 1] !== undefined && hashLine(f.lines[k - 1]) === n.fp) target = k;
      else {
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

  function addNote(line, text, opts) {
    const f = curFile(); if (!f) return null;
    line = Math.max(1, Math.min(f.lines.length, line || 1));
    const nm = noteMap();
    if (nm[line]) {
      nm[line].text = (nm[line].text ? nm[line].text + '\n' : '') + (text || '');
      nm[line].updatedAt = Date.now();
    } else {
      nm[line] = {
        id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        text: text || '', fp: hashLine(f.lines[line - 1] || ''),
        anchorText: f.lines[line - 1] || '',
        kind: (opts && opts.kind) || 'note',
        author: (opts && opts.author) || 'me',
        createdAt: Date.now(), updatedAt: Date.now(),
        rangeEnd: (opts && opts.rangeEnd) || null, extracted: ''
      };
    }
    saveAll(); updateNotes(); updateMeta(); emit();
    if (!(opts && opts.quiet)) requestAnimationFrame(() => openNoteEditor(line));
    return nm[line];
  }

  function putNote(line, text, opts) {
    const f = curFile(); if (!f) return null;
    line = Math.max(1, Math.min(f.lines.length, line || 1));
    const old = noteMap()[line];
    noteMap()[line] = {
      id: (old && old.id) || ('n' + Date.now().toString(36)),
      text: text || '', fp: hashLine(f.lines[line - 1] || ''),
      anchorText: f.lines[line - 1] || '',
      kind: (opts && opts.kind) || (old && old.kind) || 'note',
      author: (opts && opts.author) || 'me',
      createdAt: (old && old.createdAt) || Date.now(), updatedAt: Date.now(),
      rangeEnd: (opts && opts.rangeEnd) || null, extracted: ''
    };
    saveAll(); updateNotes(); updateMeta(); emit();
    return noteMap()[line];
  }

  function noteAt(line) { return noteMap()[line] || null; }
  function removeNote(line) { delete noteMap()[line]; saveAll(); updateNotes(); updateMeta(); emit(); }

  function closeNoteEditor() {
    if (noteEditor && noteEditor.parentNode) noteEditor.parentNode.removeChild(noteEditor);
    noteEditor = null;
  }

  function openNoteEditor(line) {
    const f = curFile(); if (!f || !editor) return;
    closeNoteEditor();
    line = Math.max(1, Math.min(f.lines.length, line || 1));
    editor.revealLineInCenterIfOutsideViewport(line);
    const note = noteMap()[line];
    const box = document.createElement('div');
    box.className = 'nl-editor';
    const area = document.createElement('textarea');
    area.spellcheck = false;
    area.value = note ? (note.text || '') : '';
    area.placeholder = '写这一行的笔记…（Ctrl+Enter 保存，Esc 取消）';
    box.appendChild(area);
    const info = editor.getLayoutInfo();
    box.style.left = (info.contentLeft + 8) + 'px';
    box.style.width = Math.max(240, Math.min(520, info.contentWidth - 24)) + 'px';
    box.style.top = Math.max(4, editor.getTopForLineNumber(line) - editor.getScrollTop() + 2) + 'px';
    host.appendChild(box);
    noteEditor = box;
    setTimeout(() => { area.focus(); area.setSelectionRange(area.value.length, area.value.length); }, 10);

    const save = () => {
      const text = area.value.trim();
      const old = noteMap()[line];
      if (!text) {
        if (old) { snapshot('删除笔记'); delete noteMap()[line]; saveAll(); }
      } else if (!old || (old.text || '') !== text) {
        snapshot('编辑笔记');
        if (!old) {
          noteMap()[line] = {
            id: 'n' + Date.now().toString(36), text, fp: hashLine(f.lines[line - 1] || ''),
            anchorText: f.lines[line - 1] || '', kind: 'note', author: 'me',
            createdAt: Date.now(), updatedAt: Date.now()
          };
        } else { old.text = text; old.updatedAt = Date.now(); }
        saveAll();
      }
      updateNotes(); updateMeta(); emit();
      if (noteEditor === box) closeNoteEditor();
    };
    area.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') { ev.preventDefault(); closeNoteEditor(); area.blur(); }
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); save(); }
    });
    area.addEventListener('blur', () => { if (noteEditor === box) save(); });
  }
  window.openNoteEditor = openNoteEditor;

  /* ---------------- caret / selection / navigation ---------------- */
  function caretLine() {
    return editor && editor.getPosition() ? editor.getPosition().lineNumber : 1;
  }

  function gotoLine(line) {
    const f = curFile(); if (!f || !editor) return;
    line = Math.max(1, Math.min(f.lines.length, Number(line) || 1));
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.focus();
    paintCaretInfo();
  }

  function selectedLines() {
    if (!editor || !model) return null;
    const sel = editor.getSelection();
    if (!sel) return null;
    if (sel.isEmpty()) {
      const l = caretLine();
      return { from: l, to: l, text: '' };
    }
    return {
      from: sel.startLineNumber,
      to: sel.endLineNumber,
      text: model.getValueInRange(sel)
    };
  }

  function getModelSelection() {
    if (!editor || !model) return { start: 0, end: 0, direction: 'none' };
    const sel = editor.getSelection();
    return {
      start: model.getOffsetAt(sel.getStartPosition()),
      end: model.getOffsetAt(sel.getEndPosition()),
      direction: sel.isEmpty() ? 'none' : (sel.getPosition() === sel.getStartPosition() ? 'ltr' : 'rtl')
    };
  }

  function setModelSelection(start, end, direction) {
    if (!editor || !model) return;
    const a = model.getPositionAt(Math.max(0, Math.min(model.getValueLength(), Number(start) || 0)));
    const b = model.getPositionAt(Math.max(0, Math.min(model.getValueLength(), Number(end) || 0)));
    editor.setSelection(new monaco.Selection(a.lineNumber, a.column, b.lineNumber, b.column));
    editor.focus();
  }

  /* ---------------- function-name hint bar (kept) ---------------- */
  let fnBar = null;
  function paintCaretInfo() {
    const f = curFile(); if (!f || !editor) return;
    if (!fnBar) {
      fnBar = document.createElement('div');
      fnBar.className = 'ed-fnbar';
      host.appendChild(fnBar);
    }
    const pos = editor.getPosition(); if (!pos) return;
    const line = f.lines[pos.lineNumber - 1] || '';
    let i = pos.column - 1, j = pos.column - 1;
    while (i > 0 && /[A-Za-z0-9_$]/.test(line[i - 1])) i--;
    while (j < line.length && /[A-Za-z0-9_$]/.test(line[j])) j++;
    const word = line.slice(i, j);
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

  /* ---------------- public API ---------------- */
  function getFoldView() {
    const f = curFile();
    if (!f) return { lines: [], map: [], collapsedByStart: new Map() };
    return { lines: f.lines.slice(), map: f.lines.map((_, i) => ({ model: i })), collapsedByStart: new Map() };
  }

  function init(m) {
    monaco = m;
    window.monaco = m;
    registerLanguages(m);
    defineThemes(m);
    build();
    ready = true;
    render();
    if (pending) render();
  }

  window.ED = {
    afterRender(fn) { hooks.push(fn); },
    render, refreshView: render,
    addNote, putNote, noteAt, removeNote, openNoteEditor,
    caretLine, gotoLine, selectedLines,
    getModelSelection, setModelSelection,
    getFoldView,
    isFolded() { return !!(host && host.querySelectorAll('.codicon-folding-collapsed').length); },
    focusBody(line) { openNoteEditor(line); },
    metrics() {
      const f = curFile();
      return { charW: 7.75, lineHeight: 22, textLeft: 64, lines: f ? f.lines.length : 0 };
    },
    monaco: () => monaco,
    editor: () => editor,
    layout() { if (editor) editor.layout(); }
  };
  window.renderCode = render;

  require.config({ paths: { vs: 'vendor/monaco/vs' } });
  require(['vs/editor/editor.main'], init, function (err) {
    console.error('Monaco failed to load', err);
    if (host) host.textContent = 'Monaco 加载失败：' + err;
  });
})();
