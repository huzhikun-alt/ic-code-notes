/* ============================================================
   缩进参考线 + 折叠箭头
   参考 docs/reference-indent-guides.png 1:1 复刻：
   - 每一级缩进列都有一条竖线，连续区间贯通，块结束即断
   - 竖线画在「祖先缩进列」上（列 0、列 4、列 8…）
   - 折叠箭头固定在行号与代码之间的窄条里，不随横向滚动
   - 编辑器里正在编辑的块，对应的那条线高亮
   ============================================================ */
(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const TAB_SIZE = 4;

  /* 折叠箭头：宽 11.5、高 6、固定中心 x = 11.5（.ed-main 坐标；正文从 24 开始） */
  const CHEV_CX = 11.5;
  const CHEV_HALF_W = 5.4;
  const CHEV_HALF_H = 2.4;
  const CHEV_LIFT = 1.4;
  const CULL = 120;

  let svg = null;
  let ta = null, hl = null, main = null;
  let met = null;              // {charW, textLeft, padT, padL, lh, sig}
  let scheduled = 0;
  let boundTa = null;
  let ro = null;

  /* ============================================================
     纯逻辑：缩进 → 级 → 连续线段 → 可折叠行
     ============================================================ */

  /* 视觉列数：Tab 按 tabSize 展开 */
  function visualIndent(line, tabSize) {
    let col = 0;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === ' ') col++;
      else if (ch === '\t') col += tabSize - (col % tabSize);
      else break;
    }
    return col;
  }

  /* 缩进单位：优先「能整除最多行缩进」的单位，同分再看缩进差，最后取较大值。
     这样单行临时多缩进一级不会把整篇的单位带跑。 */
  function detectUnit(lines, lang, tabSize) {
    const fallback = lang === 'verilog' ? 2 : 4;
    const indents = [];
    const diffs = [];
    let prev = -1;
    let seen = 0;
    for (let i = 0; i < lines.length && seen < 400; i++) {
      const text = lines[i];
      if (!text || !text.trim()) continue;
      const col = visualIndent(text, tabSize);
      indents.push(col);
      if (prev >= 0 && col > prev) diffs.push(col - prev);
      prev = col;
      seen++;
    }
    if (!indents.length || !indents.some(c => c > 0)) return fallback;

    let best = fallback, bestScore = -Infinity;
    for (let u = 1; u <= 8; u++) {
      let fit = 0;
      for (let i = 0; i < indents.length; i++) if (indents[i] % u === 0) fit++;
      let steps = 0;
      for (let i = 0; i < diffs.length; i++) if (diffs[i] % u === 0) steps++;
      const score = fit * 10 + steps;
      if (score > bestScore || (score === bestScore && u > best)) {
        best = u; bestScore = score;
      }
    }
    return best;
  }

  /* 每行缩进级；空行用 -1 占位 */
  function levelsOf(lines, unit, tabSize) {
    const out = new Array(lines.length);
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i];
      out[i] = (!text || !text.trim()) ? -1 : Math.floor(visualIndent(text, tabSize) / unit);
    }
    return out;
  }

  /* 空行沿用上一非空行的级（VS Code 就是这样，参考线不因空行断开） */
  function inheritBlankLevels(levels) {
    const out = levels.slice();
    let prev = 0;
    for (let i = 0; i < out.length; i++) {
      if (out[i] < 0) out[i] = prev;
      else prev = out[i];
    }
    return out;
  }

  /* 按「级 × 连续区间」生成竖线。
     第 k 级画在列 (k-1)*unit；一行缩进 n 级，就有 k=1..n 共 n 条线。 */
  function segmentsOf(levels) {
    let max = 0;
    for (let i = 0; i < levels.length; i++) if (levels[i] > max) max = levels[i];
    const out = [];
    for (let level = 1; level <= max; level++) {
      let from = -1;
      for (let i = 0; i <= levels.length; i++) {
        const on = i < levels.length && levels[i] >= level;
        if (on && from < 0) from = i;
        else if (!on && from >= 0) {
          out.push({ level, from, to: i - 1 });
          from = -1;
        }
      }
    }
    return out;
  }

  /* 纯收尾行（);  }  endfunction 等）不是块头，别给折叠箭头 */
  const CLOSER_ONLY = /^[)\]};]+[;,]?$/;
  const CLOSER_KW = /^(end\w*|join(?:_any|_none)?|else|elif|except|finally)\b/;

  /* 可折叠行：下一非空行比本行更深 */
  function foldLinesOf(lines, levels) {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const body = lines[i] ? lines[i].trim() : '';
      if (!body) continue;
      /* 去掉行尾注释放进收尾判断：); // xxx 也算收尾行 */
      const bare = body.replace(/\s*\/\/.*$/, '').replace(/\s*#.*$/, '').trim();
      if (CLOSER_ONLY.test(bare) || CLOSER_KW.test(bare)) continue;
      let j = i + 1;
      while (j < lines.length && (!lines[j] || !lines[j].trim())) j++;
      if (j < lines.length && levels[j] > levels[i]) out.push(i);
    }
    return out;
  }

  /* 光标所在行对应的块：该行缩进列 → 第 (depth+1) 级；只在下方确实更深时高亮 */
  function activeRangeOf(levels, caretLine) {
    let i = caretLine;
    if (i < 0 || i >= levels.length) return null;
    while (i >= 0 && levels[i] < 0) i--;
    if (i < 0) return null;
    const level = levels[i] + 1;
    let j = i + 1;
    while (j < levels.length && levels[j] < 0) j++;
    if (j >= levels.length || levels[j] < level) return null;
    let to = j;
    for (let k = j + 1; k < levels.length; k++) {
      if (levels[k] < 0) continue;
      if (levels[k] >= level) to = k;
      else break;
    }
    return { level, from: i, to };
  }

  /* ============================================================
     量尺寸：Range 实测字宽与正文左边界
     ============================================================ */

  /* 把 .ed-hl 的节点按行拆成 [{node, off, len}]，供 Range 取字符 */
  function lineChunks() {
    const map = [];
    let cur = [];
    let line = 0;
    const pushChunk = (node, off, len) => {
      if (len > 0) cur.push({ node, off, len });
    };
    for (let n = 0; n < hl.childNodes.length; n++) {
      const node = hl.childNodes[n];
      if (node.nodeType === 1) {
        /* token span：内容不会跨行 */
        const t = node.firstChild;
        if (t && t.nodeType === 3 && t.data) pushChunk(t, 0, t.data.length);
      } else if (node.nodeType === 3) {
        const data = node.data || '';
        let p = 0;
        while (p <= data.length) {
          const nl = data.indexOf('\n', p);
          const end = nl < 0 ? data.length : nl;
          if (end > p) pushChunk(node, p, end - p);
          if (nl < 0) break;
          map[line] = cur;
          cur = [];
          line++;
          p = nl + 1;
        }
      }
    }
    map[line] = cur;
    return map;
  }

  /* 一行里 [start, start+count) 个字符的 Range；不足 count 就取到行尾 */
  function makeRange(chunks, start, count) {
    let total = 0;
    for (let i = 0; i < chunks.length; i++) total += chunks[i].len;
    if (!total || start < 0 || start >= total) return null;
    const r = document.createRange();
    let gi = 0, started = false, ended = false;
    for (let c = 0; c < chunks.length && !ended; c++) {
      const ch = chunks[c];
      for (let k = 0; k < ch.len; k++, gi++) {
        if (gi === start) { r.setStart(ch.node, ch.off + k); started = true; }
        if (gi === start + count) { r.setEnd(ch.node, ch.off + k); ended = true; break; }
      }
    }
    if (!started) return null;
    if (!ended) {
      const last = chunks[chunks.length - 1];
      r.setEnd(last.node, last.off + last.len);
    }
    return r;
  }

  function canvasCharWidth(cs) {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      ctx.font = [cs.fontStyle, cs.fontWeight, cs.fontSize, cs.fontFamily]
        .filter(Boolean).join(' ');
      const w = ctx.measureText('0000000000').width / 10;
      return w > 0 ? w : 8;
    } catch (e) {
      return 8;
    }
  }

  function measureMetrics(modelLines) {
    const cs = getComputedStyle(hl);
    const sig = [cs.fontStyle, cs.fontWeight, cs.fontSize, cs.fontFamily,
      cs.lineHeight, cs.paddingTop, cs.paddingLeft].join('|');
    if (met && met.sig === sig) return met;

    const padT = parseFloat(cs.paddingTop) || 16;
    const padL = parseFloat(cs.paddingLeft) || 24;
    const lh = parseFloat(cs.lineHeight) || 22;
    /* 用模型里的代码行选测量行：避开只有行内笔记的空行，也避开
       「换行符 + 空格」被解析在同一个文本节点里的边界情况 */
    const lines = (modelLines && modelLines.length)
      ? modelLines : hl.textContent.split('\n');

    /* 量字宽：优先量行首连续空格（空格绝不会连字），
       没有缩进再找 10 个纯 ASCII 字符；都失败就用 canvas 兜底。 */
    const map = lineChunks();
    let best = -1, bestOff = 0, bestCount = 0;
    for (let i = 0; i < lines.length && i < map.length; i++) {
      if (!map[i] || !map[i].length) continue;
      if (!lines[i] || !lines[i].trim()) continue;
      const lead = /^ +/.exec(lines[i]);
      if (lead && lead[0].length >= 2) {
        best = i; bestOff = 0; bestCount = Math.min(lead[0].length, 10);
        break;
      }
    }
    if (best < 0) {
      for (let i = 0; i < lines.length && i < map.length; i++) {
        if (!map[i] || !map[i].length) continue;
        if (!lines[i] || !lines[i].trim()) continue;
        const s = lines[i];
        for (let off = 0; off + 10 <= s.length; off++) {
          if (/^[A-Za-z0-9_ ]{10}$/.test(s.slice(off, off + 10))) {
            best = i; bestOff = off; bestCount = 10;
            break;
          }
        }
        if (best >= 0) break;
      }
    }

    let charW = 0;
    let textLeft = padL;
    let exact = false;
    const mainRect = main.getBoundingClientRect();
    const sx = ta.scrollLeft || 0;

    if (best >= 0) {
      const rw = makeRange(map[best], bestOff, bestCount);
      if (rw) {
        const w = rw.getBoundingClientRect().width;
        if (w > 0) { charW = w / bestCount; exact = true; }
      }
      const r1 = makeRange(map[best], 0, 1);
      if (r1) {
        const left = r1.getBoundingClientRect().left;
        if (isFinite(left)) textLeft = left - mainRect.left + sx;
      }
    }
    if (!charW) charW = canvasCharWidth(cs);

    const result = { charW, textLeft, padT, padL, lh, sig };
    /* 只有真的用 Range 量到了才缓存；空文件/全平文件下次重新量 */
    if (exact) met = result;
    return result;
  }

  /* ============================================================
     渲染
     ============================================================ */

  function ensureRefs() {
    const nextTa = document.getElementById('edInput');
    const nextHl = document.getElementById('edHl');
    const nextMain = nextTa && nextTa.closest ? nextTa.closest('.ed-main') : null;
    if (!nextTa || !nextHl || !nextMain) return false;
    if (nextTa !== ta) {
      ta = nextTa;
      if (boundTa !== ta) {
        boundTa = ta;
        ta.addEventListener('scroll', () => {
          /* 先同步平移，避免参考线比文字慢一帧 */
          if (svg) svg.style.transform = 'translate(' + (-ta.scrollLeft) + 'px,' + (-ta.scrollTop) + 'px)';
          schedule();
        }, { passive: true });
        ta.addEventListener('input', () => schedule());
        ta.addEventListener('keyup', () => schedule());
        ta.addEventListener('click', () => schedule());
        ta.addEventListener('select', () => schedule());
      }
    }
    const mainChanged = nextMain !== main;
    hl = nextHl;
    main = nextMain;
    if (mainChanged && window.ResizeObserver) {
      if (ro) { try { ro.disconnect(); } catch (e) {} }
      ro = new window.ResizeObserver(() => schedule());
      ro.observe(main);
    }
    if (!svg || svg.parentElement !== main) {
      if (svg && svg.parentElement) svg.parentElement.removeChild(svg);
      svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'ed-guides');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      main.insertBefore(svg, nextTa);
    }
    return true;
  }

  function currentFile() {
    try {
      if (typeof hasFile !== 'function' || !hasFile()) return null;
      return files()[cur] || null;
    } catch (e) {
      return null;
    }
  }

  function caretLine() {
    const pos = ta.selectionDirection === 'backward' ? ta.selectionStart : ta.selectionEnd;
    let n = 0;
    for (let i = 0; i < pos && i < ta.value.length; i++) if (ta.value.charCodeAt(i) === 10) n++;
    return n;
  }

  const snap = v => (Math.round(v) + 0.5).toFixed(1);
  const fmt = v => (Math.round(v * 10) / 10).toFixed(1);

  function draw() {
    scheduled = 0;
    if (!ensureRefs()) return;
    const f = currentFile();
    if (!f) { if (svg) svg.innerHTML = ''; return; }

    const m = measureMetrics(f.lines);
    const unit = detectUnit(f.lines, f.lang, TAB_SIZE);
    const raw = levelsOf(f.lines, unit, TAB_SIZE);
    const eff = inheritBlankLevels(raw);
    const segs = segmentsOf(eff);
    const folds = foldLinesOf(f.lines, raw);
    const active = activeRangeOf(raw, caretLine());

    const sx = ta.scrollLeft || 0;
    const sy = ta.scrollTop || 0;
    const viewW = main.clientWidth;
    const viewH = main.clientHeight;
    if (viewW <= 0 || viewH <= 0) { svg.innerHTML = ''; return; }

    /* 画布覆盖整篇内容：滚动后可视区永远不会被 SVG 自己的视口裁掉 */
    const docW = Math.max(viewW, hl.scrollWidth || 0, sx + viewW + 40);
    const docH = Math.max(viewH, hl.scrollHeight || 0, sy + viewH + 40);
    svg.setAttribute('width', docW);
    svg.setAttribute('height', docH);
    svg.style.transform = 'translate(' + (-sx) + 'px,' + (-sy) + 'px)';
    svg.setAttribute('data-unit', unit);
    svg.setAttribute('data-charw', m.charW.toFixed(3));

    const out = [];
    const vTop = sy - CULL, vBot = sy + viewH + CULL;

    function pushLine(level, from, to, isActive) {
      if (to < from) return;
      const x = snap(m.textLeft + (level - 1) * unit * m.charW);
      const y1 = m.padT + from * m.lh;
      const y2 = m.padT + (to + 1) * m.lh;
      if (y2 < vTop || y1 > vBot) return;
      out.push('<line x1="' + x + '" y1="' + fmt(y1) + '" x2="' + x + '" y2="' + fmt(y2) +
        '" class="gline' + (isActive ? ' active' : '') + '" data-level="' + level +
        '" data-from="' + (from + 1) + '" data-to="' + (to + 1) + '"/>');
    }

    for (let s = 0; s < segs.length; s++) {
      const seg = segs[s];
      if (!active || active.level !== seg.level) {
        pushLine(seg.level, seg.from, seg.to, false);
        continue;
      }
      const a = Math.max(seg.from, active.from);
      const b = Math.min(seg.to, active.to);
      if (a > b) {
        pushLine(seg.level, seg.from, seg.to, false);
      } else {
        pushLine(seg.level, seg.from, a - 1, false);
        pushLine(seg.level, a, b, true);
        pushLine(seg.level, b + 1, seg.to, false);
      }
    }

    /* 折叠箭头固定在屏幕列：加回 scrollLeft 抵消 SVG 的横向平移 */
    for (let i = 0; i < folds.length; i++) {
      const idx = folds[i];
      const cy = m.padT + idx * m.lh + m.lh / 2 - CHEV_LIFT;
      if (cy < vTop || cy > vBot) continue;
      const cx = CHEV_CX + sx;
      const d = 'M' + fmt(cx - CHEV_HALF_W) + ' ' + fmt(cy - CHEV_HALF_H) +
        ' L' + fmt(cx) + ' ' + fmt(cy + CHEV_HALF_H) +
        ' L' + fmt(cx + CHEV_HALF_W) + ' ' + fmt(cy - CHEV_HALF_H);
      out.push('<path d="' + d + '" class="fold" data-line="' + (idx + 1) + '"/>');
    }

    svg.innerHTML = out.join('');
  }

  function schedule() {
    if (scheduled) return;
    const raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
    scheduled = raf(() => { scheduled = 0; draw(); });
  }

  function bindGlobal() {
    window.addEventListener('resize', () => { met = null; schedule(); });
    if (document.addEventListener) {
      document.addEventListener('selectionchange', () => {
        if (document.activeElement === ta) schedule();
      });
    }
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(() => { met = null; schedule(); });
    }
  }

  function start() {
    if (!window.ED || !window.ED.afterRender) { setTimeout(start, 120); return; }
    window.ED.afterRender(() => schedule());
    bindGlobal();
    schedule();
  }

  /* 供测试读取纯函数；浏览器里也可用于调试 */
  window.__ED_GUIDES__ = {
    visualIndent, detectUnit, levelsOf, inheritBlankLevels,
    segmentsOf, foldLinesOf, activeRangeOf,
    measure: () => measureMetrics(currentFile() ? currentFile().lines : null),
    draw, schedule,
    reset() { met = null; schedule(); }
  };

  start();
})();
