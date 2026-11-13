/* Indent guide overlay, independent of folding ranges and gutter decorations.
 * Semantics: docs/vscode-reference/indentGuides.ts (MIT, Microsoft), especially
 * getGuidesByLine's source merge. Whitespace resolution follows VS Code's
 * GuidesTextModelPart; Python is an off-side language. Model/lexer offsets are
 * zero-based; ED.caretLine() is one-based. No folding ranges are consulted.
 */
(() => {
  'use strict';
  const DEFAULT_GUIDES = Object.freeze({
    indentation: true, highlightActiveIndentation: true, bracketPairs: false,
    bracketPairsHorizontal: 'active', highlightActiveBracketPair: true
  });
  let layer, input, pre, main, probe, resizeObserver, fontObserver;
  let frame = 0, hookedED = null, cached = null;
  const boundInputs = new WeakSet();

  function currentFile() {
    try { return typeof hasFile === 'function' && hasFile() ? files()[cur] : null; }
    catch (_) { return null; }
  }
  function options() {
    const value = (window.EditorFolding && window.EditorFolding.options) || {};
    const tabSize = Number(value.tabSize) > 0 ? Number(value.tabSize) : 4;
    // "auto" is resolved against the shared indentation detector, never against
    // a folding range. Explicit indentSize remains independent of tab stops.
    return { guides: Object.assign({}, DEFAULT_GUIDES, value.guides), tabSize,
      indentSize: value.indentSize === 'auto' ? 'auto' : (Number(value.indentSize) > 0 ? Number(value.indentSize) : 4) };
  }
  function visualColumn(text, end, tabSize) {
    let col = 0;
    for (let i = 0; i < end; i++) col += text[i] === '\t' ? tabSize - col % tabSize : 1;
    return col;
  }
  function indentation(text, tabSize) {
    const match = /^[ \t]*/.exec(text)[0];
    return match.length === text.length ? -1 : visualColumn(match, match.length, tabSize);
  }
  function indentSizeOf(lines, opt) {
    if (opt.indentSize !== 'auto') return opt.indentSize;
    const counts = new Map();
    let previous = 0;
    for (const line of lines.slice(0, 1000)) {
      const col = indentation(line, opt.tabSize);
      if (col < 0) continue;
      const delta = col - previous;
      if (delta > 0 && delta <= 8) counts.set(delta, (counts.get(delta) || 0) + 1);
      previous = col;
    }
    let size = 4, score = 0;
    for (const [candidate, count] of counts) {
      if (count > score || (count === score && candidate === 4)) { size = candidate; score = count; }
    }
    return size;
  }
  function levelsOf(lines, tabSize, size, offSide) {
    const raw = lines.map(text => indentation(text, tabSize));
    const below = new Array(raw.length);
    let next = -1;
    for (let i = raw.length - 1; i >= 0; i--) { below[i] = next; if (raw[i] >= 0) next = raw[i]; }
    let above = -1;
    return raw.map((indent, i) => {
      if (indent >= 0) { above = indent; return Math.ceil(indent / size); }
      const after = below[i];
      if (above < 0 || after < 0) return 0; // leading/trailing whitespace
      if (above < after) return 1 + Math.floor(above / size);
      if (above === after || offSide) return Math.ceil(after / size);
      return 1 + Math.floor(after / size);
    });
  }
  function activeIndent(levels, caret) {
    if (caret < 0 || caret >= levels.length) return null;
    const initial = levels[caret];
    let from = caret, to = caret, level = initial;
    // Exactly one indentation level deeper activates the child scope at its
    // header, or the preceding scope at its closing line (VS Code behavior).
    if (caret + 1 < levels.length && levels[caret + 1] === initial + 1) {
      from = to = caret + 1; level = initial + 1;
      while (to + 1 < levels.length && levels[to + 1] >= level) to++;
    } else if (caret > 0 && levels[caret - 1] === initial + 1) {
      from = to = caret - 1; level = initial + 1;
      while (from > 0 && levels[from - 1] >= level) from--;
    } else if (level > 0) {
      while (from > 0 && levels[from - 1] >= level) from--;
      while (to + 1 < levels.length && levels[to + 1] >= level) to++;
    }
    return { from, to, level };
  }
  function modelData(f, opt) {
    // Compare content, not array identity: the editor can mutate existing arrays.
    const text = f.lines.join('\n');
    const size = indentSizeOf(f.lines, opt);
    const key = [f.lang, opt.tabSize, size].join('|');
    if (!cached || cached.text !== text || cached.key !== key) {
      cached = { text, key, size, levels: levelsOf(f.lines, opt.tabSize, size, /^(python|py)$/i.test(f.lang)), lex: null };
    }
    if (opt.guides.bracketPairs !== false && !cached.lex && window.EditorFolding && window.EditorFolding.lex) {
      cached.lex = window.EditorFolding.lex(f.lines, f.lang);
    }
    return cached;
  }

  function ensureDOM() {
    const nextInput = document.getElementById('edInput');
    const nextPre = document.getElementById('edHl');
    const nextMain = nextInput && nextInput.closest('.ed-main');
    if (!nextInput || !nextPre || !nextMain) { if (layer) layer.replaceChildren(); return false; }
    if (main !== nextMain) {
      if (layer) layer.remove();
      if (probe) probe.remove();
      main = nextMain;
      layer = document.createElement('div');
      layer.className = 'ed-guide-layer';
      layer.setAttribute('aria-hidden', 'true');
      layer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:3;';
      // Guide lane may extend left of the text viewport, into the space after the folding icon.
      const editor = main.closest('.ed');
      editor.style.position = 'relative';
      editor.appendChild(layer);
      probe = document.createElement('pre');
      probe.className = 'ed-guide-measure';
      probe.setAttribute('aria-hidden', 'true');
      probe.style.cssText = 'position:absolute;left:0;top:0;margin:0;border:0;padding:0;white-space:pre;visibility:hidden;pointer-events:none;';
      probe.textContent = ' '.repeat(64) + '\n ';
      main.appendChild(probe);
      if (resizeObserver) resizeObserver.disconnect();
      if (window.ResizeObserver) {
        resizeObserver = new ResizeObserver(schedule);
        resizeObserver.observe(main); resizeObserver.observe(nextInput);
      }
      if (fontObserver) fontObserver.disconnect();
      if (window.MutationObserver) {
        fontObserver = new MutationObserver(schedule);
        // Class/style changes alter font metrics without necessarily resizing.
        for (let node = main; node; node = node.parentElement)
          fontObserver.observe(node, { attributes: true, attributeFilter: ['class', 'style'] });
        fontObserver.observe(nextPre, { attributes: true, attributeFilter: ['class', 'style'] });
      }
    }
    input = nextInput; pre = nextPre;
    if (!boundInputs.has(input)) {
      boundInputs.add(input);
      for (const name of ['scroll', 'input', 'keyup', 'click', 'select']) input.addEventListener(name, schedule, { passive: true });
    }
    return true;
  }
  function metrics() {
    const cs = getComputedStyle(pre);
    for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch',
      'fontVariant', 'fontFeatureSettings', 'fontVariationSettings', 'fontKerning', 'letterSpacing', 'lineHeight', 'tabSize']) {
      probe.style[property] = cs[property];
    }
    const range = document.createRange();
    range.setStart(probe.firstChild, 0); range.setEnd(probe.firstChild, 64);
    const spaceWidth = range.getBoundingClientRect().width / 64;
    range.setStart(probe.firstChild, 65); range.setEnd(probe.firstChild, 66);
    const second = range.getBoundingClientRect();
    range.setStart(probe.firstChild, 0); range.setEnd(probe.firstChild, 1);
    const first = range.getBoundingClientRect();
    const lineHeight = second.top - first.top || parseFloat(cs.lineHeight) || 22;
    const rect = pre.getBoundingClientRect(), container = main.getBoundingClientRect();
    return { spaceWidth, lineHeight,
      left: rect.left - container.left + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0),
      top: rect.top - container.top + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0) };
  }
  function textChunks() {
    const rows = [[]];
    const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
    let node, row = 0;
    while ((node = walker.nextNode())) {
      let offset = 0;
      const parts = node.data.split('\n');
      parts.forEach((part, index) => {
        if (index) { row++; rows[row] = []; }
        if (part.length) rows[row].push({ node, offset, length: part.length });
        offset += part.length + 1;
      });
    }
    return rows;
  }
  function bracketX(chunks, row, col, fallback) {
    let remaining = col;
    for (const chunk of chunks[row] || []) {
      if (remaining < chunk.length) {
        const range = document.createRange();
        range.setStart(chunk.node, chunk.offset + remaining);
        range.setEnd(chunk.node, chunk.offset + remaining + 1);
        return range.getBoundingClientRect().left - main.getBoundingClientRect().left;
      }
      remaining -= chunk.length;
    }
    return fallback;
  }
  function caretPosition(view) {
    const before = input.value.slice(0, input.selectionStart);
    const row = before.split('\n').length - 1;
    const entry = view && view.map[row];
    return { line: window.ED && ED.caretLine ? ED.caretLine() - 1 : (entry ? entry.model : row),
      col: before.length - before.lastIndexOf('\n') - 1 };
  }
  function contains(pair, caret) {
    return (caret.line > pair.open.line || caret.line === pair.open.line && caret.col > pair.open.col) &&
      (caret.line < pair.close.line || caret.line === pair.close.line && caret.col <= pair.close.col);
  }
  function appendGuide(fragment, row, model, x, y, width, height, type, level, active, horizontal) {
    if (!(width > 0) || !(height > 0) || x + width < 0 || x > input.clientWidth) return;
    const div = document.createElement('div');
    div.className = 'core-guide ed-guide ' + (type === 'indent' ? 'core-guide-indent' : 'bracket-indent-guide') +
      ' lvl-' + (level % 30) + ' ' + (horizontal || 'vertical') + (active ? ' indent-active' : '');
    div.dataset.model = String(model); div.dataset.row = String(row); div.dataset.level = String(level + 1);
    const fallback = active ? 'color-mix(in srgb,var(--ink) 55%,var(--paper))' : 'color-mix(in srgb,var(--ink) 18%,var(--paper))';
    const base = type === 'indent' ? '--indent-guide-' : '--bracket-guide-';
    const name = base + (active ? 'active-color' : 'color');
    const color = type === 'indent' ? 'var(' + name + ',' + fallback + ')'
      : 'var(' + name + '-' + (level % 6 + 1) + ',var(' + name + ',' + fallback + '))';
    div.style.cssText = 'position:absolute;box-sizing:border-box;pointer-events:none;left:' + x + 'px;top:' + y +
      'px;width:' + width + 'px;height:' + height + 'px;';
    if (horizontal) div.style[horizontal === 'horizontal-top' ? 'borderTop' : 'borderBottom'] = '1px solid ' + color;
    else div.style.boxShadow = 'inset 1px 0 0 0 ' + color;
    fragment.appendChild(div);
  }

  class IndentGuidesRenderer {
    draw() {
      if (!ensureDOM()) return;
      const f = currentFile();
      if (!f || !main.clientWidth || !main.clientHeight) { layer.replaceChildren(); return; }
      const opt = options(), guides = opt.guides, data = modelData(f, opt), m = metrics();
      const editorRect = main.closest('.ed').getBoundingClientRect();
      const contentOffset = main.getBoundingClientRect().left - editorRect.left;
      // Each level's guide is at the CENTER of the first character cell where that
      // level starts (user's rule): col 0 -> center of the first code character,
      // col 4 -> center of the first character at that indent, etc.
      const guideX = col => contentOffset + m.left + col * m.spaceWidth + m.spaceWidth / 2;
      const view = window.ED && ED.getFoldView ? ED.getFoldView() : null;
      const map = view ? view.map : f.lines.map((_, model) => ({ model }));
      const caret = caretPosition(view), active = activeIndent(data.levels, caret.line);
      const layout = window.EditorViewLayout && EditorViewLayout.refresh(view);
      const first = layout ? Math.max(0, EditorViewLayout.rowAt(input.scrollTop) - 1)
        : Math.max(0, Math.floor(-m.top / m.lineHeight) - 1);
      const last = layout ? Math.min(map.length - 1, EditorViewLayout.rowAt(input.scrollTop + input.clientHeight) + 1)
        : Math.min(map.length - 1, Math.ceil((input.clientHeight - m.top) / m.lineHeight) + 1);
      const pairs = data.lex && data.lex.pairs || [];
      const activePair = pairs.filter(pair => contains(pair, caret)).sort((a, b) => b.depth - a.depth || b.open.line - a.open.line || b.open.col - a.open.col)[0];
      const selectedPairs = guides.bracketPairs === false ? [] : pairs.filter(pair => guides.bracketPairs === true || pair === activePair);
      const chunks = selectedPairs.length ? textChunks() : [];
      const visibleRows = new Map();
      map.forEach((entry, row) => { if (entry && !entry.ph && Number.isInteger(entry.model)) visibleRows.set(entry.model, row); });
      const fragment = document.createDocumentFragment();
      for (let row = first; row <= last; row++) {
        const entry = map[row];
        if (!entry || entry.ph || !Number.isInteger(entry.model)) continue;
        const model = entry.model, y = layout ? layout.rows[row].top - input.scrollTop : m.top + row * m.lineHeight;
        const rowHeight = layout ? layout.rows[row].height : m.lineHeight;
        const brackets = [];
        for (const pair of selectedPairs) {
          const a = pair.open, b = pair.close;
          if (model < a.line || model > b.line) continue;
          const startCol = visualColumn(f.lines[a.line], a.col, opt.tabSize);
          const endCol = visualColumn(f.lines[b.line], b.col, opt.tabSize);
          const highlighted = pair === activePair && guides.highlightActiveBracketPair !== false;
          const horizontal = guides.bracketPairsHorizontal === true || guides.bracketPairsHorizontal === 'active' && pair === activePair;
          if (a.line === b.line) {
            if (horizontal) {
              const x1 = bracketX(chunks, row, a.col + 1, m.left + (startCol + 1) * m.spaceWidth);
              const x2 = bracketX(chunks, row, b.col, m.left + endCol * m.spaceWidth);
              brackets.push({ x: x1, width: x2 - x1, horizontal: 'horizontal-bottom', level: pair.depth, active: highlighted });
            }
            continue;
          }
          // Guide columns are bracket-derived, not folding-depth-derived. The
          // minimum body indent is the third constraint in VS Code's model.
          let col = Math.min(startCol, endCol);
          for (let line = a.line + 1; line < b.line; line++) {
            const body = indentation(f.lines[line], opt.tabSize);
            if (body >= 0) col = Math.min(col, body);
          }
          const openRow = visibleRows.get(a.line), closeRow = visibleRows.get(b.line);
          const x = col === startCol && openRow !== undefined ? bracketX(chunks, openRow, a.col, m.left + col * m.spaceWidth)
            : col === endCol && closeRow !== undefined ? bracketX(chunks, closeRow, b.col, m.left + col * m.spaceWidth)
            : m.left + col * m.spaceWidth;
          const textBeforeClose = /\S/.test(f.lines[b.line].slice(0, b.col));
          if (model > a.line && (model < b.line || textBeforeClose)) brackets.push({ x, col, width: m.spaceWidth, level: pair.depth, active: highlighted });
          if (horizontal && model === a.line && startCol > col) brackets.push({ x, width: bracketX(chunks, row, a.col, m.left + startCol * m.spaceWidth) - x, horizontal: 'horizontal-bottom', level: pair.depth, active: highlighted });
          if (horizontal && model === b.line && endCol > col) brackets.push({ x, width: bracketX(chunks, row, b.col, m.left + endCol * m.spaceWidth) - x, horizontal: textBeforeClose ? 'horizontal-bottom' : 'horizontal-top', level: pair.depth, active: highlighted });
        }
        // Include the line's own indent boundary (YAML first image): a one-level
        // body gets columns 0 and indentSize; deeper lines get one per level.
        if (guides.indentation) for (let level = 1; level <= (data.levels[model] >= 1 ? data.levels[model] + 1 : 0); level++) {
          const col = (level - 1) * data.size;
          // A vertical bracket guide owns its source position. Horizontal-only
          // guides do not suppress indentation (pinned overlay lines 220-222).
          if (brackets.some(guide => !guide.horizontal && guide.col === col)) continue;
          const highlighted = guides.highlightActiveIndentation !== false && active && active.level === level &&
            model >= active.from && model <= active.to && (guides.highlightActiveIndentation === 'always' || !brackets.length);
          appendGuide(fragment, row, model, guideX(col), y, m.spaceWidth, rowHeight, 'indent', level - 1, highlighted);
        }
        for (const guide of brackets) appendGuide(fragment, row, model, guide.horizontal ? contentOffset + guide.x : guideX(guide.col === undefined ? 0 : guide.col), y, guide.width, rowHeight, 'bracket', guide.level, guide.active, guide.horizontal);
      }
      layer.dataset.indentSize = String(data.size);
      layer.dataset.bracketPairs = String(guides.bracketPairs);
      layer.replaceChildren(fragment);
    }
    reset() { cached = null; schedule(); }
  }
  const renderer = new IndentGuidesRenderer();
  function schedule() {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; renderer.draw(); });
  }
  function start() {
    if (window.ED && ED.afterRender && hookedED !== ED) { hookedED = ED; ED.afterRender(schedule); }
    schedule();
  }
  window.EditorGuides = { draw: schedule, reset: () => renderer.reset() };
  window.addEventListener('resize', schedule, { passive: true });
  document.addEventListener('selectionchange', () => { if (document.activeElement === input) schedule(); });
  if (document.fonts) {
    document.fonts.ready.then(schedule);
    if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', schedule);
  }
  // Scripts normally follow ed.js. DOMContentLoaded also supports deferred or
  // head loading without polling timers or a second editor initialization.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  start();
})();
