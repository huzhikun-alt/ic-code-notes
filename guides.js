/* ============================================================
   范围参考线 + 折叠箭头
   - 每一级作用域一条竖线，画在「这一层代码的左边」（正文左侧 3px）
   - 线按连续区间贯通，块结束即断；空行不打断
   - 折叠箭头固定在行号与代码之间的窄条里，可点击折叠/展开
   - 光标所在块的范围线高亮；折叠时用占位行代替隐藏行
   ============================================================ */
(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const TAB_SIZE = 4;

  /* 折叠箭头：宽 8.4、高 3.8，固定中心 x = 11.5（.ed-main 坐标；正文从 24 开始） */
  const CHEV_CX = 11.5;
  const CHEV_HALF_W = 4.2;
  const CHEV_HALF_H = 1.9;
  const CHEV_RIGHT_W = 1.9;
  const CHEV_RIGHT_H = 3.0;
  const CHEV_LIFT = 1.2;
  const CULL = 120;
  /* 范围线贴在正文左边：线心比字符单元左边界再左 3px */
  const GUIDE_GAP = 3;

  let svg = null;
  let ta = null, hl = null, main = null;
  let met = null;              // {charW, textLeft, padT, padL, lh, sig}
  let scheduled = 0;
  let boundTa = null;
  let boundMain = null;
  let ro = null;
  let lastCursor = '';
  let foldStore = {};          // 文件 key -> [{start,end}]（模型行，0 基，end 含）
  let lastFileKey = '';

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

  /* 光标所表示的「范围线」：
     - 光标在块起始行 → 高亮这个块的内容（第 depth+1 级，画在正文左侧）
     - 光标在普通行/叶子 → 高亮它所在块的内容（第 depth 级，画在正文左侧） */
  function activeRangeOf(levels, caretLine) {
    let i = caretLine;
    if (i < 0 || i >= levels.length) return null;
    while (i >= 0 && levels[i] < 0) i--;
    if (i < 0) return null;
    const d = levels[i];

    let j = i + 1;
    while (j < levels.length && levels[j] < 0) j++;
    if (j < levels.length && levels[j] > d) {
      const level = d + 1;
      let to = j;
      for (let k = j + 1; k < levels.length; k++) {
        if (levels[k] < 0) continue;
        if (levels[k] >= level) to = k;
        else break;
      }
      return { level, from: j, to };
    }

    if (d < 1) return null;
    const level = d;
    let from = i, to = i;
    while (from - 1 >= 0 && (levels[from - 1] >= level || levels[from - 1] < 0)) from--;
    while (to + 1 < levels.length && (levels[to + 1] >= level || levels[to + 1] < 0)) to++;
    return { level, from, to };
  }

  /* ============================================================
     折叠范围（模型行）
     ============================================================ */

  /* 去注释/字符串，避免把 } / end 算错 */
  function codeOnly(line, lang) {
    let out = '', q = null;
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

  const V_CLOSE_TYPE = {
    endmodule: 'module', endfunction: 'function', endtask: 'task',
    endgenerate: 'generate', endcase: 'case', join: 'fork',
    join_any: 'fork', join_none: 'fork', end: 'begin'
  };

  function verilogRange(lines, start) {
    const stack = [];
    const feed = (code) => {
      const re = /[A-Za-z_]\w*/g;
      let m;
      while ((m = re.exec(code))) {
        const w = m[0];
        if (w === 'module' || w === 'function' || w === 'task' || w === 'generate' ||
            w === 'begin' || w === 'fork' || w === 'case' || w === 'casex' || w === 'casez') {
          stack.push(w === 'casex' || w === 'casez' ? 'case' : w);
        } else if (V_CLOSE_TYPE[w]) {
          const want = V_CLOSE_TYPE[w];
          for (let k = stack.length - 1; k >= 0; k--) {
            if (stack[k] === want) { stack.length = k; break; }
          }
        }
      }
    };
    feed(codeOnly(lines[start], 'verilog'));
    if (!stack.length) return null;
    for (let j = start + 1; j < lines.length; j++) {
      feed(codeOnly(lines[j], 'verilog'));
      if (!stack.length) return j > start ? { start, end: j } : null;
    }
    return null;
  }

  function perlRange(lines, start) {
    let depth = 0;
    const feed = (code) => {
      for (let i = 0; i < code.length; i++) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}') depth--;
      }
    };
    feed(codeOnly(lines[start], 'perl'));
    if (depth <= 0) return null;
    for (let j = start + 1; j < lines.length; j++) {
      feed(codeOnly(lines[j], 'perl'));
      if (depth <= 0) return j > start ? { start, end: j } : null;
    }
    return null;
  }

  function indentRange(lines, raw, start) {
    let end = start;
    for (let j = start + 1; j < lines.length; j++) {
      if (!lines[j] || !lines[j].trim()) continue;
      if (raw[j] > raw[start]) end = j;
      else break;
    }
    return end > start ? { start, end } : null;
  }

  /* 点击箭头时真正要隐藏的模型行区间 [start, end]（end 含） */
  function foldRangeOf(lines, raw, start, lang) {
    if (start < 0 || start >= lines.length) return null;
    let j = start + 1;
    while (j < lines.length && (!lines[j] || !lines[j].trim())) j++;
    if (j >= lines.length || raw[j] <= raw[start]) return null;
    let r = null;
    if (lang === 'verilog') r = verilogRange(lines, start);
    else if (lang === 'perl') r = perlRange(lines, start);
    if (!r) r = indentRange(lines, raw, start);
    return (r && r.end > r.start) ? r : null;
  }

  /* 显示副本：隐藏行 → 一行 "… (N 行已折叠)" */
  function buildDisplay(lines, ranges, unit, raw) {
    const byStart = {};
    ranges.forEach(r => { byStart[r.start] = r; });
    const hidden = new Uint8Array(lines.length);
    ranges.forEach(r => {
      for (let i = r.start + 1; i <= r.end && i < lines.length; i++) hidden[i] = 1;
    });
    const out = [], map = [];
    for (let i = 0; i < lines.length; i++) {
      if (hidden[i]) continue;
      out.push(lines[i]);
      map.push({ model: i });
      const r = byStart[i];
      if (r) {
        const count = r.end - r.start;
        const indent = ' '.repeat(Math.max(0, (raw[i] + 1) * unit));
        out.push(indent + '… (' + count + ' 行已折叠)');
        map.push({ ph: true, start: r.start, from: r.start + 1, to: r.end, count });
      }
    }
    return { lines: out, map };
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
     折叠视图：状态、映射、展开/收起
     ============================================================ */

  function fileKey() {
    try { return (typeof nkey === 'function') ? nkey() : ''; } catch (e) { return ''; }
  }
  function foldRanges() {
    const k = fileKey();
    return foldStore[k] || [];
  }
  function setFoldRanges(r) {
    foldStore[fileKey()] = r;
  }
  function isFoldedModel(model) {
    const rs = foldRanges();
    for (let i = 0; i < rs.length; i++) if (rs[i].start === model) return true;
    return false;
  }
  function viewOf() {
    return (window.ED && window.ED.getFoldView) ? window.ED.getFoldView() : null;
  }
  function displayIndexOfModel(view, model) {
    if (!view) return model;
    for (let i = 0; i < view.map.length; i++) {
      const e = view.map[i];
      if (e.ph) { if (model >= e.from && model <= e.to) return i; }
      else if (e.model === model) return i;
    }
    return -1;
  }
  function focusModelLine(model) {
    const f = currentFile(); if (!f) return;
    const view = viewOf();
    const di = displayIndexOfModel(view, model);
    if (di < 0) return;
    const lines = view ? view.lines : f.lines;
    let off = 0;
    for (let i = 0; i < di; i++) off += lines[i].length + 1;
    off += lines[di].length;
    const st = ta.scrollTop, sl = ta.scrollLeft;
    ta.setSelectionRange(off, off);
    ta.focus();
    /* focus() 可能把视口滚到选区；折叠时不能因此跳走 */
    ta.scrollTop = st;
    ta.scrollLeft = sl;
  }

  function applyFoldView() {
    const f = currentFile(); if (!f) return;
    const docTa = ta || document.getElementById('edInput');
    if (!docTa) return;
    const mm = met || measureMetrics(f.lines);
    const oldView = viewOf();
    /* 以「视口顶部那一行」为锚，折叠/展开上方块时画面不跳 */
    const top = Math.max(0, Math.floor((docTa.scrollTop + mm.padT) / mm.lh));
    const topEntry = oldView ? oldView.map[top] : null;
    const anchor = topEntry ? (topEntry.ph ? topEntry.from : topEntry.model) : top;
    const oldDi = displayIndexOfModel(oldView, anchor);
    const beforeY = oldDi >= 0 ? mm.padT + oldDi * mm.lh - docTa.scrollTop : null;

    const unit = detectUnit(f.lines, f.lang, TAB_SIZE);
    const raw = levelsOf(f.lines, unit, TAB_SIZE);
    const ranges = foldRanges().filter(r => r.start >= 0 && r.start < f.lines.length &&
      r.end > r.start && r.end < f.lines.length);
    let view = null;
    if (ranges.length) view = buildDisplay(f.lines, ranges, unit, raw);
    if (!view || view.lines.length === f.lines.length) {
      setFoldRanges([]);
      view = null;
    }
    if (window.ED && ED.setFoldView) ED.setFoldView(view);
    else return;

    if (beforeY != null) {
      const nv = viewOf();
      const ndi = displayIndexOfModel(nv, anchor);
      if (ndi >= 0) docTa.scrollTop = Math.max(0, mm.padT + ndi * mm.lh - beforeY);
    }
    docTa.dispatchEvent(new Event('scroll'));
    schedule();
  }

  function toggleFold(modelStart) {
    const f = currentFile(); if (!f) return;
    const unit = detectUnit(f.lines, f.lang, TAB_SIZE);
    const raw = levelsOf(f.lines, unit, TAB_SIZE);
    let ranges = foldRanges().slice();
    const idx = ranges.findIndex(r => r.start === modelStart);
    if (idx >= 0) {
      ranges.splice(idx, 1);
    } else {
      const range = foldRangeOf(f.lines, raw, modelStart, f.lang);
      if (!range) return;
      ranges = ranges.filter(r => !(r.start > range.start && r.start <= range.end));
      ranges.push(range);
    }
    ranges.sort((a, b) => a.start - b.start);
    setFoldRanges(ranges);
    applyFoldView();
    focusModelLine(modelStart);
  }

  function expandFold(start) {
    setFoldRanges(foldRanges().filter(r => r.start !== start));
    applyFoldView();
    focusModelLine(start);
  }

  function expandAll() {
    const f = currentFile(); if (!f) return;
    const docTa = ta || document.getElementById('edInput');
    const view = viewOf();
    const mm = met || measureMetrics(f.lines);
    let anchor = null, beforeY = null;
    if (view && docTa) {
      const top = Math.max(0, Math.floor((docTa.scrollTop + mm.padT) / mm.lh));
      const e = view.map[top];
      anchor = e ? (e.ph ? e.from : e.model) : top;
      const di = displayIndexOfModel(view, anchor);
      if (di >= 0) beforeY = mm.padT + di * mm.lh - docTa.scrollTop;
    }
    setFoldRanges([]);
    if (window.ED && ED.setFoldView) ED.setFoldView(null);
    if (docTa) {
      if (anchor != null && beforeY != null) {
        docTa.scrollTop = Math.max(0, mm.padT + anchor * mm.lh - beforeY);
      }
      docTa.dispatchEvent(new Event('scroll'));
    }
    schedule();
  }

  /* 在折叠视图里开始编辑：先展开，再把光标映射回模型坐标 */
  function expandForEdit() {
    const f = currentFile(); if (!f) return;
    const view = viewOf(); if (!view) return;
    const docTa = ta || document.getElementById('edInput');
    if (!docTa) return;
    const mm = met || measureMetrics(f.lines);
    const mstarts = [];
    let macc = 0;
    for (let i = 0; i < f.lines.length; i++) { mstarts.push(macc); macc += f.lines[i].length + 1; }
    const mapPos = (pos, isEnd) => {
      const before = docTa.value.slice(0, pos);
      const parts = before.split('\n');
      const dl = parts.length - 1;
      const col = parts[parts.length - 1].length;
      const e = view.map[dl];
      if (!e) return pos;
      if (e.ph) {
        if (!isEnd) return mstarts[Math.min(e.from, f.lines.length - 1)];
        if (e.to + 1 < f.lines.length) return mstarts[e.to + 1];
        return macc;
      }
      return mstarts[e.model] + Math.min(col, f.lines[e.model].length);
    };
    const collapsed = docTa.selectionStart === docTa.selectionEnd;
    const s = mapPos(docTa.selectionStart, false);
    const e = collapsed ? s : mapPos(docTa.selectionEnd, true);
    setFoldRanges([]);
    if (window.ED && ED.setFoldView) ED.setFoldView(null);
    docTa.focus();
    const max = docTa.value.length;
    docTa.setSelectionRange(Math.min(s, max), Math.min(e, max));
    const line = docTa.value.slice(0, Math.min(s, max)).split('\n').length;
    docTa.scrollTop = Math.max(0, (line - 1) * mm.lh - 120);
    docTa.dispatchEvent(new Event('scroll'));
    schedule();
  }

  function isEditKey(ev) {
    const k = ev.key;
    if (!k) return false;
    if (k === 'Process') return true;
    if (k === 'Enter' || k === 'Backspace' || k === 'Delete' || k === 'Tab') return true;
    if ((ev.ctrlKey || ev.metaKey) && /^[vxzy]$/i.test(k)) return true;
    if (ev.shiftKey && k === 'Insert') return true;
    if (k.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) return true;
    return false;
  }

  function foldHitAt(x, y) {
    if (!svg) return null;
    const paths = svg.querySelectorAll('path.fold');
    for (let i = 0; i < paths.length; i++) {
      const r = paths[i].getBoundingClientRect();
      if (x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 4) {
        const dl = +paths[i].getAttribute('data-line');
        const model = +paths[i].getAttribute('data-model');
        return { line: dl - 1, model: model > 0 ? model - 1 : dl - 1 };
      }
    }
    return null;
  }

  function placeholderAt(x, y) {
    const view = viewOf(); if (!view) return null;
    const f = currentFile(); if (!f) return null;
    const mm = met || measureMetrics(f.lines);
    const mr = main.getBoundingClientRect();
    const yc = y - mr.top + (ta.scrollTop || 0);
    const dl = Math.floor((yc - mm.padT) / mm.lh);
    const e = view.map[dl];
    return e && e.ph ? e : null;
  }

  function onFoldMouseDown(ev) {
    if (ev.target !== ta) return;
    const hit = foldHitAt(ev.clientX, ev.clientY);
    if (hit) {
      ev.preventDefault(); ev.stopPropagation();
      toggleFold(hit.model);
      return;
    }
    const ph = placeholderAt(ev.clientX, ev.clientY);
    if (ph) {
      ev.preventDefault(); ev.stopPropagation();
      expandFold(ph.start);
    }
  }

  function onFoldMouseMove(ev) {
    if (!ta || ev.target !== ta) return;
    const over = !!(foldHitAt(ev.clientX, ev.clientY) || placeholderAt(ev.clientX, ev.clientY));
    const want = over ? 'pointer' : '';
    if (want !== lastCursor) { ta.style.cursor = want; lastCursor = want; }
  }

  function onFoldKeyDown(ev) {
    if (ev.target !== ta) return;
    if (!viewOf()) return;
    if (!isEditKey(ev)) return;
    expandForEdit();
  }

  function onFoldBeforeInput(ev) {
    if (ev.target !== ta) return;
    if (!viewOf()) return;
    const t = ev.inputType || '';
    if (/^(insert|delete|history)/.test(t)) expandForEdit();
  }

  function onFoldComposition(ev) {
    if (ev && ev.target !== ta) return;
    if (viewOf()) expandForEdit();
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
    if (mainChanged && boundMain !== main) {
      boundMain = main;
      main.addEventListener('keydown', onFoldKeyDown, true);
      main.addEventListener('mousedown', onFoldMouseDown, true);
      main.addEventListener('beforeinput', onFoldBeforeInput, true);
      main.addEventListener('compositionstart', onFoldComposition, true);
      main.addEventListener('mousemove', onFoldMouseMove, { passive: true });
    }
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
  const downChevron = (cx, cy) =>
    'M' + fmt(cx - CHEV_HALF_W) + ' ' + fmt(cy - CHEV_HALF_H) +
    ' L' + fmt(cx) + ' ' + fmt(cy + CHEV_HALF_H) +
    ' L' + fmt(cx + CHEV_HALF_W) + ' ' + fmt(cy - CHEV_HALF_H);
  const rightChevron = (cx, cy) =>
    'M' + fmt(cx - CHEV_RIGHT_W) + ' ' + fmt(cy - CHEV_RIGHT_H) +
    ' L' + fmt(cx + CHEV_RIGHT_W) + ' ' + fmt(cy) +
    ' L' + fmt(cx - CHEV_RIGHT_W) + ' ' + fmt(cy + CHEV_RIGHT_H);

  function draw() {
    scheduled = 0;
    if (!ensureRefs()) return;
    const f = currentFile();
    if (!f) { if (svg) svg.innerHTML = ''; return; }

    /* 折叠状态与 ed.js 的显示副本保持同步 */
    const fk = fileKey();
    if (fk !== lastFileKey) { lastFileKey = fk; foldStore = {}; }
    const view = viewOf();
    if (view) {
      setFoldRanges(view.map.filter(e => e.ph).map(e => ({ start: e.start, end: e.to })));
    } else if (foldRanges().length) {
      setFoldRanges([]);
    }
    const lines = view ? view.lines : f.lines;

    const m = measureMetrics(f.lines);
    const unit = detectUnit(f.lines, f.lang, TAB_SIZE);
    const raw = levelsOf(lines, unit, TAB_SIZE);
    const eff = inheritBlankLevels(raw);
    const segs = segmentsOf(eff);
    const folds = foldLinesOf(lines, raw);
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
    svg.setAttribute('data-folded', view ? '1' : '0');

    const out = [];
    const vTop = sy - CULL, vBot = sy + viewH + CULL;

    function pushLine(level, from, to, isActive) {
      if (to < from) return;
      const x = snap(m.textLeft + level * unit * m.charW - GUIDE_GAP);
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
      const entry = view ? view.map[idx] : null;
      const modelLine = entry ? (entry.ph ? entry.from : entry.model) : idx;
      const collapsed = isFoldedModel(modelLine);
      const cy = m.padT + idx * m.lh + m.lh / 2 - CHEV_LIFT;
      if (cy < vTop || cy > vBot) continue;
      const cx = CHEV_CX + sx;
      const d = collapsed ? rightChevron(cx, cy) : downChevron(cx, cy);
      out.push('<path d="' + d + '" class="fold' + (collapsed ? ' collapsed' : '') +
        '" data-line="' + (idx + 1) + '" data-model="' + (modelLine + 1) + '"/>');
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
    foldRangeOf, buildDisplay,
    measure: () => measureMetrics(currentFile() ? currentFile().lines : null),
    draw, schedule,
    reset() { met = null; schedule(); }
  };

  window.__ED_FOLDS__ = {
    toggleFold, expandFold, expandAll,
    ranges: () => foldRanges(),
    clear() { setFoldRanges([]); if (window.ED && ED.setFoldView) ED.setFoldView(null); }
  };

  start();
})();
