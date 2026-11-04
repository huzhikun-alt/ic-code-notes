/* ============================================================
   文件关系图（G1 + G2）
   扫描各语言的外部引用，画出有向图
   ============================================================ */
(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  /* ---------------- 路径工具 ---------------- */
  const dirOf = p => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
  const baseOf = p => { const i = p.lastIndexOf('/'); return i < 0 ? p : p.slice(i + 1); };
  const stemOf = p => baseOf(p).replace(/\.[^.]+$/, '');

  function normalize(p) {
    const parts = [];
    p.split('/').forEach(seg => {
      if (!seg || seg === '.') return;
      if (seg === '..') parts.pop();
      else parts.push(seg);
    });
    return parts.join('/');
  }

  /* ---------------- 扫描 ---------------- */
  const RE = {
    perlRequire: /^\s*(?:require|use|do)\s+['"]?([^'";\s]+)['"]?/,
    vInclude: /`include\s+["<]([^">]+)[">]/,
    vModuleDef: /^\s*module\s+([A-Za-z_]\w*)/,
    vInstantiate: /^\s*([A-Za-z_]\w*)\s*(?:#\s*\([^;]*?\)\s*)?([A-Za-z_]\w*)\s*\(/,
    pyImport: /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/,
  };

  function scanFile(entry, allPaths, moduleIndex) {
    const edges = [];
    const dir = dirOf(entry.path);
    const add = (raw, kind, line) => {
      if (!raw) return;
      edges.push({ from: entry.path, raw, kind, line, to: null, status: 'missing' });
    };

    entry.lines.forEach((text, i) => {
      const line = i + 1;

      if (entry.lang === 'perl') {
        const m = text.match(RE.perlRequire);
        if (m) add(m[1], 'require', line);
      } else if (entry.lang === 'verilog') {
        const inc = text.match(RE.vInclude);
        if (inc) { add(inc[1], 'include', line); return; }
        const inst = text.match(RE.vInstantiate);
        if (inst) {
          const mod = inst[1];
          if (moduleIndex[mod] && !['module','input','output','always','assign','initial',
              'wire','reg','logic','if','else','for','case','begin','function','task'].includes(mod)) {
            add(mod, 'instantiate', line);
          }
        }
      } else if (entry.lang === 'python') {
        const m = text.match(RE.pyImport);
        if (m) add(m[1] || m[2], 'import', line);
      }
    });

    /* 解析目标 */
    edges.forEach(e => {
      const candidates = [];
      if (e.kind === 'instantiate') {
        const target = moduleIndex[e.raw];
        if (target) { e.to = target; e.status = 'resolved'; return; }
      }
      const raw = e.raw.replace(/^\.\//, '');
      const withExt = [raw, raw + '.pl', raw + '.pm', raw + '.py', raw + '.sv', raw + '.svh', raw + '.v', raw + '.vh'];
      withExt.forEach(c => {
        const rel = normalize((dir ? dir + '/' : '') + c);
        if (allPaths.has(rel)) candidates.push(rel);
      });
      if (!candidates.length) {
        withExt.forEach(c => {
          const b = baseOf(c);
          allPaths.forEach(p => { if (baseOf(p) === b) candidates.push(p); });
        });
      }
      if (candidates.length) { e.to = candidates[0]; e.status = 'resolved'; }
      else if (/^(strict|warnings|vars|POSIX|Data::|File::|Getopt|List::)/.test(e.raw)) e.status = 'external';
      else if (e.kind === 'import' && !raw.includes('.') && !raw.includes('/')) e.status = 'external';
      else e.status = 'missing';
    });

    return edges.filter(e => e.status !== 'external');
  }

  function scanProject() {
    const f = files();
    const allPaths = new Set(Object.values(f).map(x => x.path));
    const moduleIndex = {};
    Object.values(f).forEach(x => {
      if (x.lang !== 'verilog') return;
      x.lines.forEach(t => {
        const m = t.match(RE.vModuleDef);
        if (m && !moduleIndex[m[1]]) moduleIndex[m[1]] = x.path;
      });
    });

    const edges = [];
    Object.values(f).forEach(entry => {
      scanFile(entry, allPaths, moduleIndex).forEach(e => edges.push(e));
    });

    /* 合并同一对文件的重复引用 */
    const merged = {};
    edges.forEach(e => {
      if (!e.to) return;
      const k = e.from + '→' + e.to;
      if (!merged[k]) merged[k] = { ...e, count: 1, lines: [e.line] };
      else { merged[k].count++; merged[k].lines.push(e.line); }
    });
    return Object.values(merged);
  }

  /* ---------------- 力导向布局 ---------------- */
  function layout(nodes, edges, w, h) {
    const n = nodes.length;
    if (!n) return;
    nodes.forEach((nd, i) => {
      const a = (i / n) * Math.PI * 2;
      nd.x = w / 2 + Math.cos(a) * Math.min(w, h) * 0.3;
      nd.y = h / 2 + Math.sin(a) * Math.min(w, h) * 0.3;
      nd.vx = 0; nd.vy = 0;
    });
    const idx = {}; nodes.forEach((nd, i) => idx[nd.id] = i);

    for (let step = 0; step < 320; step++) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = nodes[i], b = nodes[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          let d2 = dx * dx + dy * dy || 0.01;
          const d = Math.sqrt(d2);
          const push = 9000 / d2;
          const ux = dx / d, uy = dy / d;
          a.vx -= ux * push; a.vy -= uy * push;
          b.vx += ux * push; b.vy += uy * push;
        }
      }
      edges.forEach(e => {
        const a = nodes[idx[e.from]], b = nodes[idx[e.to]];
        if (!a || !b) return;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const pull = (d - 170) * 0.012;
        const ux = dx / d, uy = dy / d;
        a.vx += ux * pull * 60; a.vy += uy * pull * 60;
        b.vx -= ux * pull * 60; b.vy -= uy * pull * 60;
      });
      nodes.forEach(nd => {
        nd.vx += (w / 2 - nd.x) * 0.002;
        nd.vy += (h / 2 - nd.y) * 0.002;
        nd.x += Math.max(-18, Math.min(18, nd.vx * 0.05));
        nd.y += Math.max(-18, Math.min(18, nd.vy * 0.05));
        nd.vx *= 0.82; nd.vy *= 0.82;
        nd.x = Math.max(90, Math.min(w - 90, nd.x));
        nd.y = Math.max(50, Math.min(h - 50, nd.y));
      });
    }
  }

  /* ---------------- 渲染 ---------------- */
  let container, svgEl;

  function langColor(lang) {
    return lang === 'perl' ? '#4a7fd0' : lang === 'python' ? '#c9a227' : '#8a63c9';
  }

  function render() {
    container = document.getElementById('graphCanvas');
    if (!container) return;
    const edges = scanProject();
    const f = files();
    const noteCount = {};
    Object.keys(NOTES).forEach(k => {
      const [proj, file] = k.split('::');
      if (proj !== curProj) return;
      noteCount[file] = Object.keys(NOTES[k] || {}).length;
    });

    const nodes = Object.values(f).map(x => ({
      id: x.path, name: baseOf(x.path), lang: x.lang,
      lines: x.lines.length, notes: noteCount[x.path] || 0
    }));

    const w = container.clientWidth || 900;
    const h = Math.max(420, container.clientHeight || 520);
    layout(nodes, edges, w, h);

    const idx = {}; nodes.forEach(nd => idx[nd.id] = nd);
    const pos = nd => ({ x: nd.x, y: nd.y });

    container.innerHTML = '';
    svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgEl.setAttribute('class', 'graph-svg');
    /* 按节点实际范围裁切视图，避免散在大画布里显得空 */
    const xs = nodes.map(nd => nd.x), ys = nodes.map(nd => nd.y);
    const padX = 150, padY = 90;
    const minX = Math.min(...xs) - padX, maxX = Math.max(...xs) + padX;
    const minY = Math.min(...ys) - padY, maxY = Math.max(...ys) + padY;
    const vbW = Math.max(420, maxX - minX), vbH = Math.max(300, maxY - minY);
    svgEl.setAttribute('viewBox', `${minX} ${minY} ${vbW} ${vbH}`);
    svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svgEl.innerHTML = `
      <defs>
        <marker id="arw" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="#9aa7b8"/>
        </marker>
        <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" fill="#dfe5ee"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#dots)"/>`;

    edges.forEach(e => {
      const a = pos(idx[e.from]), b = pos(idx[e.to]);
      if (!a || !b) return;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - 26;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', `M${a.x + 60},${a.y} Q${mx},${my} ${b.x + 60},${b.y}`);
      p.setAttribute('class', 'gedge ' + e.status);
      p.setAttribute('data-from', e.from); p.setAttribute('data-to', e.to);
      p.setAttribute('marker-end', 'url(#arw)');
      svgEl.appendChild(p);
      if (e.count > 1) {
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('x', mx); t.setAttribute('y', my); t.setAttribute('class', 'gcount');
        t.textContent = '×' + e.count;
        svgEl.appendChild(t);
      }
    });

    nodes.forEach(nd => {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'gnode');
      g.setAttribute('transform', `translate(${nd.x},${nd.y})`);
      g.dataset.id = nd.id;
      const label = nd.name.length > 18 ? nd.name.slice(0, 17) + '…' : nd.name;
      g.innerHTML = `
        <rect x="-62" y="-17" width="124" height="34" rx="8"></rect>
        <circle cx="-46" cy="0" r="3.5" fill="${langColor(nd.lang)}"></circle>
        <text x="-36" y="4" class="gname">${label}</text>
        <text x="54" y="4" class="gnotes" text-anchor="end">${nd.notes ? '✎' + nd.notes : ''}</text>`;
      g.addEventListener('mouseenter', () => focusNode(nd.id));
      g.addEventListener('mouseleave', () => focusNode(null));
      g.addEventListener('dblclick', () => {
        if (typeof cur !== 'undefined') {
          cur = Object.keys(files()).find(k => files()[k].path === nd.id) || cur;
          if (typeof renderNav === 'function') renderNav();
          if (typeof renderCode === 'function') renderCode();
          if (typeof showView === 'function') showView('code');
        }
      });
      svgEl.appendChild(g);
    });

    container.appendChild(svgEl);

    const stat = document.getElementById('graphStat');
    if (stat) {
      stat.textContent = nodes.length + ' 个文件 · ' + edges.length + ' 条引用 · ' +
        edges.filter(e => e.status === 'missing').length + ' 条未解析';
    }
  }

  function focusNode(id) {
    if (!svgEl) return;
    const groups = $$('.gnode', svgEl);
    if (!id) {
      groups.forEach(g => g.classList.remove('dim', 'hl'));
      $$('.gedge', svgEl).forEach(e => e.classList.remove('dim', 'hl'));
      return;
    }
    const near = new Set([id]);
    $$('.gedge', svgEl).forEach(e => {
      const a = e.getAttribute('data-from'), b = e.getAttribute('data-to');
      if (a === id || b === id) { near.add(a); near.add(b); }
    });
    groups.forEach(g => {
      const on = near.has(g.dataset.id);
      g.classList.toggle('hl', g.dataset.id === id);
      g.classList.toggle('dim', !on);
    });
    $$('.gedge', svgEl).forEach(e => {
      const on = e.getAttribute('data-from') === id || e.getAttribute('data-to') === id;
      e.classList.toggle('hl', on);
      e.classList.toggle('dim', !on);
    });
  }

  /* ---------------- 挂到视图上 ---------------- */
  function ensureView() {
    if (document.getElementById('v-graph')) return;
    const main = document.querySelector('.main');
    const sec = document.createElement('section');
    sec.className = 'view';
    sec.id = 'v-graph';
    sec.innerHTML =
      '<div class="chead"><span class="p">文件关系</span>' +
      '<span class="m" id="graphStat"></span>' +
      '<button class="editbtn" id="graphRefresh"><svg class="ic"><use href="#i-rotate-ccw"/></svg>重新扫描</button></div>' +
      '<div class="graphwrap"><div id="graphCanvas" class="graphcanvas"></div>' +
      '<div class="legend"><span><i class="dot perl"></i>Perl</span><span><i class="dot python"></i>Python</span>' +
      '<span><i class="dot verilog"></i>Verilog</span><span class="sep"></span>' +
      '<span><i class="ln"></i>已解析</span><span><i class="ln miss"></i>未解析</span></div></div>';
    main.appendChild(sec);

    const tabs = document.querySelector('.tabs');
    if (tabs && !tabs.querySelector('[data-v="graph"]')) {
      const b = document.createElement('button');
      b.dataset.v = 'graph'; b.textContent = '关系图';
      tabs.appendChild(b);
      b.onclick = () => showView('graph');
    }
    const r = document.getElementById('graphRefresh');
    if (r) r.onclick = () => { render(); toast('已重新扫描'); };
  }

  const origShow = window.showView;
  if (typeof origShow === 'function') {
    window.showView = function (v) {
      origShow.apply(this, arguments);
      if (v === 'graph') { ensureView(); render(); }
    };
  }

  ensureView();
  window.icRenderGraph = render;
})();
