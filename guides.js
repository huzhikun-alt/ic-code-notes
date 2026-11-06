/* ============================================================
   缩进参考线 / 括号作用域线
   在代码层之上叠一层 SVG，滚动时与文本同步
   ============================================================ */
(() => {
  const LH = 22, PAD_T = 16, PAD_L = 24;

  let svg = null;
  let charW = 0;

  /* 等宽字号测量 */
  function measure() {
    if (charW) return charW;
    const hl = document.getElementById('edHl');
    if (!hl) return 8;
    const probe = document.createElement('span');
    probe.textContent = '0'.repeat(50);
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;';
    hl.appendChild(probe);
    charW = probe.getBoundingClientRect().width / 50;
    probe.remove();
    return charW || 8;
  }

  /* 去掉行尾注释与字符串，避免把括号算错 */
  function strip(line, lang) {
    let out = '';
    let q = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i], n = line[i + 1];
      if (q) {
        if (c === '\\') { i++; continue; }
        if (c === q) q = null;
        continue;
      }
      if (c === '"' || c === "'") { q = c; continue; }
      if (lang === 'verilog' && c === '/' && n === '/') break;
      if ((lang === 'perl' || lang === 'python') && c === '#') break;
      out += c;
    }
    return out;
  }

  const indentOf = l => (l.match(/^[ \t]*/) || [''])[0].replace(/\t/g, '    ').length;

  /* Verilog 关键字块 */
  const V_OPEN = /^(module|function|task|generate|case[xz]?|begin|fork)\b/;
  const V_CLOSE = /^(end|endmodule|endfunction|endtask|endgenerate|endcase|join|join_any|join_none)\b/;

  function blocksOf(lines, lang) {
    const blocks = [];
    if (lang === 'verilog') {
      const stack = [];
      lines.forEach((raw, i) => {
        const t = strip(raw, lang).trim();
        if (!t) return;
        if (V_CLOSE.test(t)) {
          const open = stack.pop();
          if (open !== undefined) blocks.push({ from: open.line, to: i, col: open.indent, split: open.split });
          return;
        }
        if (V_OPEN.test(t)) {
          const split = !/\bbegin\b/.test(t) && /;\s*$/.test(t);   // module/function 头
          stack.push({ line: i, indent: indentOf(raw) + 2, split });
          if (split) {
            // 头部单独一行：作用域从下一行开始
            return;
          }
        }
      });
      return blocks;
    }

    /* Perl / Python：先看花括号，再看缩进块 */
    const stack = [];
    lines.forEach((raw, i) => {
      const t = strip(raw, lang);
      for (let c = 0; c < t.length; c++) {
        if (t[c] === '{') stack.push({ line: i, indent: indentOf(raw) + 2 });
        else if (t[c] === '}' && stack.length) {
          const open = stack.pop();
          if (i > open.line) blocks.push({ from: open.line, to: i, col: open.indent });
        }
      }
    });

    /* 缩进块（Python 的 def/if/for，Perl 的 sub） */
    lines.forEach((raw, i) => {
      const t = strip(raw, lang).replace(/\s+$/, '');
      if (!/:$/.test(t.trim()) && !/^\s*sub\b/.test(t)) return;
      const base = indentOf(raw);
      let end = i;
      for (let j = i + 1; j < lines.length; j++) {
        if (strip(lines[j], lang).trim() === '') continue;
        if (indentOf(lines[j]) <= base) break;
        end = j;
      }
      if (end > i) blocks.push({ from: i, to: end, col: base + 2 });
    });

    return blocks;
  }

  function draw() {
    const host = document.getElementById('code');
    const main = host && host.querySelector('.ed-main');
    const ta = document.getElementById('edInput');
    if (!main || !ta) return;
    const f = (typeof hasFile === 'function' && hasFile()) ? files()[cur] : null;
    if (!f) return;

    const w = measure();
    if (!svg || svg.parentElement !== main) {
      if (svg) svg.remove();
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'ed-guides');
      main.insertBefore(svg, main.querySelector('.ed-input'));
    }

    const blocks = blocksOf(f.lines, f.lang);
    const viewH = main.clientHeight + 40;
    const sx = ta.scrollLeft, sy = ta.scrollTop;
    svg.setAttribute('width', main.clientWidth);
    svg.setAttribute('height', main.clientHeight);
    svg.style.transform = 'translate(' + (-sx) + 'px,' + (-sy) + 'px)';

    const out = [];
    blocks.forEach(b => {
      if (b.to <= b.from) return;
      const depth = Math.round(b.col / 2);
      const x = PAD_L + b.col * w - 4;
      const y1 = PAD_T + b.from * LH + LH;
      const y2 = PAD_T + b.to * LH + LH - 2;
      if (y2 - sy < -40 || y1 - sy > viewH) return;
      out.push('<line x1="' + x.toFixed(1) + '" y1="' + y1 + '" x2="' + x.toFixed(1) +
        '" y2="' + y2 + '" class="gline d' + Math.min(depth, 6) + '"/>');
    });
    svg.innerHTML = out.join('');
  }

  function start() {
    if (!window.ED || !ED.afterRender) { setTimeout(start, 200); return; }
    ED.afterRender(draw);
    draw();
  }
  start();
  window.addEventListener('resize', () => { charW = 0; draw(); });
})();
