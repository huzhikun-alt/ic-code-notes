/* ============================================================
   项目结构思维导图
   工程 → 文件 → 符号（module / function / sub / def）
   节点悬停显示作用说明
   ============================================================ */
(() => {
  const $ = s => document.querySelector(s);
  const W = { nodeH: 26, gapY: 18, colGap: 46 };

  let mode = 'mind';
  let tip = null;

  /* ---------------- 解析结构 ---------------- */
  const SYM = {
    perl: /^\s*sub\s+([A-Za-z_]\w*)/,
    python: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/,
    verilog: /^\s*(module|function|task)\s+(?:automatic\s+)?(?:[\w\[\]: ]+\s+)?([A-Za-z_]\w*)/
  };

  function symbolsOf(file) {
    const re = SYM[file.lang];
    if (!re) return [];
    const out = [];
    file.lines.forEach((l, i) => {
      const m = l.match(re);
      if (!m) return;
      const name = m[2] || m[1];
      const kind = m[1] === 'module' ? 'module' : (m[1] === 'function' ? 'function' : 'sub');
      if (name) out.push({ name, kind, line: i + 1 });
    });
    return out;
  }

  function refCounts() {
    // 简单统计：谁 include/require/import 了谁（与关系图同源规则）
    const f = files();
    const idx = {};
    Object.values(f).forEach(x => { idx[base(x.path)] = x.path; });
    const counts = {};
    const edges = [];
    Object.values(f).forEach(x => {
      x.lines.forEach(l => {
        let m = l.match(/(?:require|use|do)\s+['"]?([^'";\s]+)/) ||
                l.match(/`include\s+["<]([^">]+)[">]/) ||
                l.match(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/);
        if (!m) return;
        const raw = m[1] || m[2];
        if (!raw) return;
        const target = idx[base(raw)] || idx[base(raw) + '.pl'] || idx[base(raw) + '.sv'];
        if (!target || target === x.path) return;
        counts[target] = (counts[target] || 0) + 1;
        const key = x.path + '→' + target;
        if (!edges.some(e => e.key === key)) edges.push({ key, from: x.path, to: target });
      });
    });
    return { counts, edges };
  }

  const base = p => p.split('/').pop();

  function buildTree() {
    const f = files();
    const { counts: refs, edges: deps } = refCounts();
    const root = { id: '#root', label: curProj, kind: 'project', children: [] };

    const byDir = {};
    Object.entries(f).forEach(([key, file]) => {
      const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
      (byDir[dir] = byDir[dir] || []).push({ key, file });
    });

    Object.keys(byDir).sort().forEach(dir => {
      const group = { id: '#dir:' + dir, label: dir || '（根目录）', kind: 'dir', children: [] };
      byDir[dir].forEach(({ key, file }) => {
        const node = {
          id: key, label: base(file.path), kind: 'file', lang: file.lang,
          fileKey: key, lines: file.lines.length,
          refs: refs[file.path] || 0,
          children: []
        };
        symbolsOf(file).slice(0, 10).forEach(s => {
          node.children.push({
            id: key + '#' + s.line, label: s.name, kind: s.kind,
            line: s.line, fileKey: key, lang: file.lang
          });
        });
        if (symbolsOf(file).length > 10) {
          node.children.push({ id: key + '#more', label: '还有 ' + (symbolsOf(file).length - 10) + ' 个…', kind: 'more' });
        }
        group.children.push(node);
      });
      root.children.push(group);
    });
    root.deps = deps;
    return root;
  }

  /* ---------------- 布局：横向树 ---------------- */
  function layout(root) {
    let cursor = 0;
    const nodes = [];
    const links = [];

    function place(node, depth) {
      node.depth = depth;
      node.x = depth * 250;
      if (!node.children || !node.children.length) {
        node.y = cursor;
        cursor += W.nodeH + W.gapY;
      } else {
        node.children.forEach(c => place(c, depth + 1));
        const first = node.children[0], last = node.children[node.children.length - 1];
        node.y = (first.y + last.y) / 2;
      }
      node.w = Math.max(92, Math.min(240, node.label.length * 7.6 + 34));
      nodes.push(node);
    }
    place(root, 0);

    nodes.forEach(n => (n.children || []).forEach(c => {
      if (c.depth !== undefined) links.push({ a: n, b: c });
    }));

    const maxY = Math.max(...nodes.map(n => n.y)) + 40;
    return { nodes, links, height: maxY };
  }

  function colorOf(n) {
    if (n.kind === 'project') return 'var(--ink)';
    if (n.kind === 'dir') return 'var(--muted)';
    if (n.kind === 'file') return n.lang === 'perl' ? '#4a7fd0' : n.lang === 'python' ? '#c9a227' : '#8a63c9';
    return 'var(--teal)';
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    const host = document.getElementById('mindCanvas');
    if (!host) return;
    const root = buildTree();
    const { nodes, links, height } = layout(root);

    const width = Math.max(900, Math.max(...nodes.map(n => n.x + n.w)) + 120);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'mind-svg');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);

    links.forEach(({ a, b }) => {
      const x1 = a.x + a.w, y1 = a.y + W.nodeH / 2;
      const x2 = b.x, y2 = b.y + W.nodeH / 2;
      const mid = (x1 + x2) / 2;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`);
      p.setAttribute('class', 'mind-link');
      svg.appendChild(p);
    });

    nodes.forEach(n => {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'mind-node k-' + n.kind);
      g.setAttribute('transform', `translate(${n.x},${n.y})`);
      const cls = n.kind === 'file' ? 'f-' + n.lang : '';
      g.innerHTML =
        `<rect x="0" y="9" width="${n.w}" height="${W.nodeH}" rx="7" class="${cls}"></rect>` +
        `<circle cx="10" cy="${W.nodeH / 2 + 9}" r="3" fill="${colorOf(n)}"></circle>` +
        `<text x="20" y="${W.nodeH / 2 + 13}">${esc(n.label)}</text>` +
        (n.kind === 'file' && n.refs ? `<text x="${n.w - 8}" y="${W.nodeH / 2 + 13}" text-anchor="end" class="mind-ref">←${n.refs}</text>` : '');
      g.addEventListener('mouseenter', ev => showTip(ev, n));
      g.addEventListener('mousemove', ev => moveTip(ev));
      g.addEventListener('mouseleave', hideTip);
      g.addEventListener('dblclick', () => openNode(n));
      g.addEventListener('contextmenu', ev => {
        ev.preventDefault();
        editDescription(n);
      });
      svg.appendChild(g);
    });

    host.innerHTML = '';
    host.appendChild(svg);

    /* 依赖箭头：文件之间的引用关系（虚线） */
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = '<marker id="mindArrow" viewBox="0 0 10 10" refX="9" refY="5" ' +
      'markerWidth="6" markerHeight="6" orient="auto">' +
      '<path d="M0,0 L10,5 L0,10 z" fill="#7c6bd6"/></marker>';
    svg.appendChild(defs);

    const byPath = {};
    nodes.forEach(n => {
      if (n.kind !== 'file') return;
      byPath[n.fileKey] = n;
      const f = files()[n.fileKey];
      if (f) byPath[f.path] = n;          // 依赖边用的是完整路径
    });
    ((root.deps) || []).forEach(d => {
      const a = byPath[d.from], b = byPath[d.to];
      if (!a || !b) return;
      const x1 = a.x + a.w / 2, y1 = a.y + W.nodeH + 9;
      const x2 = b.x + b.w / 2, y2 = b.y + W.nodeH + 9;
      const midY = (y1 + y2) / 2 + 34;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', `M${x1},${y1} Q${(x1 + x2) / 2},${midY} ${x2},${y2}`);
      p.setAttribute('class', 'mind-dep');
      p.setAttribute('marker-end', 'url(#mindArrow)');
      svg.appendChild(p);
    });
    const stat = document.getElementById('mindStat');
    if (stat) {
      const filesN = Object.keys(files()).length;
      const symN = nodes.filter(n => ['sub', 'function', 'module'].includes(n.kind)).length;
      stat.textContent = filesN + ' 个文件 · ' + symN + ' 个符号 · 悬停看作用';
    }
  }

  /* ---------------- 悬停说明 ---------------- */
  function describe(n) {
    if (n.kind === 'project') {
      return { title: n.label, kind: '工程', body: '当前打开的工程，包含 ' + Object.keys(files()).length + ' 个文件。' };
    }
    if (n.kind === 'dir') {
      return { title: n.label, kind: '目录', body: '工程内的一个目录分组。' };
    }
    if (n.kind === 'file') {
      const f = files()[n.fileKey] || {};
      const syms = symbolsOf(f);
      const parts = [];
      parts.push((f.lines || []).length + ' 行');
      if (syms.length) parts.push(syms.length + ' 个符号');
      parts.push(n.refs ? '被 ' + n.refs + ' 个文件引用' : '没有其它文件引用它');
      return {
        title: n.label,
        kind: (window.LANGS || {})[n.lang] || n.lang,
        body: parts.join(' · ') + '。双击打开。'
      };
    }
    if (n.kind === 'more') return { title: n.label, kind: '', body: '符号较多，这里只展示前 10 个。' };
    const lib = ((window.LIB || {})[n.lang] || []).find(e => e.name === n.label);
    return {
      title: n.label,
      kind: n.kind + ' · 第 ' + n.line + ' 行',
      body: lib && lib.desc ? lib.desc : '函数库里还没有这条说明，右键函数名可以补上。'
    };
  }

  function showTip(ev, n) {
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'mind-tip';
      document.body.appendChild(tip);
    }
    const d = describe(n);
    tip.innerHTML = '<div class="mt-head"><b></b><i></i></div><div class="mt-body"></div>';
    tip.querySelector('b').textContent = d.title;
    tip.querySelector('i').textContent = d.kind;
    tip.querySelector('.mt-body').textContent = d.body;
    if (n.kind !== 'file' && n.kind !== 'dir' && n.kind !== 'project' && n.kind !== 'more') {
      const hint = document.createElement('div');
      hint.className = 'mt-hint';
      hint.textContent = '右键可编辑这条说明';
      tip.appendChild(hint);
    }
    tip.classList.add('on');
    moveTip(ev);
  }

  function moveTip(ev) {
    if (!tip || !tip.classList.contains('on')) return;
    const pad = 14;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    const r = tip.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - pad;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }

  function hideTip() { if (tip) tip.classList.remove('on'); }

  function openNode(n) {
    if (!n.fileKey) return;
    cur = n.fileKey;
    if (typeof renderNav === 'function') renderNav();
    if (typeof showView === 'function') showView('code');
    if (window.ED) {
      window.ED.render();
      if (n.line) setTimeout(() => window.ED.gotoLine && window.ED.gotoLine(n.line), 60);
    }
  }

  /* 右键：编辑这个符号在函数库里的说明 */
  function editDescription(n) {
    if (n.kind === 'file' || n.kind === 'dir' || n.kind === 'project' || n.kind === 'more') {
      toast('文件级说明暂不支持编辑');
      return;
    }
    hideTip();
    const exists = (window.LIB && LIB[n.lang] || []).find(e => e.name === n.label) || null;
    if (typeof openLibDialog === 'function') openLibDialog(n.label, exists, n.lang);
  }

  /* ---------------- 挂到「结构」视图 ---------------- */
  function ensureView() {
    if (document.getElementById('v-mind')) return;
    const main = document.querySelector('.main');
    const sec = document.createElement('section');
    sec.className = 'view';
    sec.id = 'v-mind';
    sec.innerHTML =
      '<div class="chead"><span class="p">项目结构</span>' +
      '<span class="m" id="mindStat"></span>' +
      '<button class="editbtn" id="mindRefresh"><svg class="ic"><use href="#i-rotate-ccw"/></svg>重新扫描</button></div>' +
      '<div class="mindwrap"><div id="mindCanvas" class="mindcanvas"></div></div>';
    main.appendChild(sec);

    const tabs = document.querySelector('.tabs');
    const graphBtn = tabs && tabs.querySelector('[data-v="graph"]');
    if (graphBtn && !tabs.querySelector('[data-v="mind"]')) {
      const b = document.createElement('button');
      b.dataset.v = 'mind';
      b.textContent = '结构图';
      graphBtn.after(b);
      b.onclick = () => showView('mind');
    }
    const r = document.getElementById('mindRefresh');
    if (r) r.onclick = () => { render(); toast('已重新扫描'); };
  }

  const origShow = window.showView;
  if (typeof origShow === 'function') {
    window.showView = function (v) {
      origShow.apply(this, arguments);
      if (v === 'mind') { ensureView(); render(); }
    };
  }

  ensureView();
  window.icRenderMind = render;
})();
