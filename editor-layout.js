/* Shared source-row geometry for the textarea/highlight editor. No text is
 * rewritten: soft wrapping is performed by the browser, including tabs, CJK,
 * surrogate pairs and proportional/fallback glyphs. All y coordinates include
 * the editor's top padding and exclude scrollTop; row indices are zero-based
 * indices in view.lines (NOT model line numbers or visual continuation rows).
 *
 * Integration: apply() before painting; refresh(view) after textarea.value and
 * gutter width are updated; draw(view) after painting. ED.afterRender supplies
 * the latter automatically. Notes/fold placeholders MUST be absolute overlays
 * when wrapping: use positionAt(row, sourceColumn) for an anchor, never append
 * decoration text to the source flow. Do not use row * lineHeight elsewhere.
 */
(() => {
  'use strict';
  const FONT_PROPERTIES = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
    'fontStretch', 'fontVariant', 'fontFeatureSettings', 'fontVariationSettings',
    'fontKerning', 'fontOpticalSizing', 'letterSpacing', 'wordSpacing', 'lineHeight',
    'tabSize', 'textIndent', 'textTransform', 'textRendering', 'direction',
    'wordBreak', 'lineBreak', 'hyphens'];
  let input, pre, main, probe, resizeObserver, hookedEditor;
  let frame = 0, configuredWrap = 'off', heightCache = new Map(), metricKey = '';
  let state = null;
  const boundInputs = new WeakSet();
  const number = value => parseFloat(value) || 0;
  const viewNow = () => window.ED && ED.getFoldView ? ED.getFoldView() : null;
  const wrapping = () => ((window.EditorFolding && EditorFolding.options.wordWrap) || configuredWrap) === 'on';
  const setStyle = (node, name, value) => { if (node.style[name] !== value) node.style[name] = value; };

  function ensureDOM() {
    const next = document.getElementById('edInput');
    const highlight = document.getElementById('edHl');
    const container = next && next.closest('.ed-main');
    if (!next || !highlight || !container) { state = null; return false; }
    if (main !== container || input !== next) {
      if (probe) probe.remove();
      if (resizeObserver) resizeObserver.disconnect();
      input = next; pre = highlight; main = container;
      probe = document.createElement('pre');
      probe.className = 'ed-layout-measure';
      probe.setAttribute('aria-hidden', 'true');
      // Outside the editor's scroll area; visibility:hidden still performs layout.
      probe.style.cssText = 'position:fixed;left:-100000px;top:0;margin:0;padding:0;border:0;box-sizing:content-box;visibility:hidden;pointer-events:none;min-width:0;max-width:none;height:auto;overflow:visible;';
      document.body.appendChild(probe);
      heightCache.clear(); metricKey = ''; state = null;
      if (window.ResizeObserver) {
        resizeObserver = new ResizeObserver(schedule);
        resizeObserver.observe(main); resizeObserver.observe(input);
      }
    }
    input = next; pre = highlight;
    if (!boundInputs.has(input)) {
      boundInputs.add(input);
      input.addEventListener('input', schedule, { passive: true });
      // A vertical scrollbar can appear/disappear while resizing or editing.
      input.addEventListener('scroll', schedule, { passive: true });
    }
    return true;
  }

  function configure(options) {
    if (typeof options === 'string') options = { wordWrap: options };
    options = options || {};
    if (options.wordWrap !== undefined) {
      configuredWrap = options.wordWrap === 'on' ? 'on' : 'off';
      if (window.EditorFolding) EditorFolding.options.wordWrap = configuredWrap;
    }
    apply();
    return draw();
  }

  function apply() {
    if (!ensureDOM()) return null;
    const on = wrapping(), whiteSpace = on ? 'pre-wrap' : 'pre';
    const wrap = on ? 'soft' : 'off';
    if (input.wrap !== wrap) input.wrap = wrap;
    for (const node of [input, pre]) {
      setStyle(node, 'whiteSpace', whiteSpace);
      setStyle(node, 'overflowWrap', on ? 'anywhere' : 'normal');
      // Prevent inherited word-break rules from disagreeing with measurement.
      setStyle(node, 'wordBreak', 'normal');
    }
    setStyle(input, 'overflowX', on ? 'hidden' : 'auto');
    if (on && input.scrollLeft) input.scrollLeft = 0;
    // clientWidth excludes the native vertical scrollbar. pre's padding is
    // included in this width, exactly as in the textarea's padding box.
    setStyle(pre, 'boxSizing', 'border-box');
    setStyle(pre, 'width', on ? input.clientWidth + 'px' : '');
    setStyle(pre, 'minWidth', on ? '0px' : '');
    return { input, pre, main, wordWrap: on ? 'on' : 'off' };
  }

  function measureMetrics() {
    const cs = getComputedStyle(input), ps = getComputedStyle(pre);
    for (const property of FONT_PROPERTIES) probe.style[property] = cs[property];
    const padTop = number(cs.paddingTop), padLeft = number(cs.paddingLeft);
    const padBottom = number(cs.paddingBottom), padRight = number(cs.paddingRight);
    // Source/highlight padding must be identical, even with a user stylesheet.
    for (const property of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) {
      if (ps[property] !== cs[property]) setStyle(pre, property, cs[property]);
    }
    probe.style.whiteSpace = 'pre'; probe.style.overflowWrap = 'normal';
    probe.style.width = 'max-content';
    probe.textContent = ' '.repeat(64) + '\n ';
    const range = document.createRange(), text = probe.firstChild;
    range.setStart(text, 0); range.setEnd(text, 64);
    const charWidth = range.getBoundingClientRect().width / 64;
    range.setStart(text, 0); range.setEnd(text, 1);
    const first = range.getBoundingClientRect();
    range.setStart(text, 65); range.setEnd(text, 66);
    const lineHeight = range.getBoundingClientRect().top - first.top || number(cs.lineHeight) || 22;
    const contentWidth = Math.max(1, input.clientWidth - padLeft - padRight);
    const on = wrapping();
    probe.textContent = '';
    probe.style.whiteSpace = on ? 'pre-wrap' : 'pre';
    probe.style.overflowWrap = on ? 'anywhere' : 'normal';
    probe.style.width = contentWidth + 'px';
    const key = [on, contentWidth, ...FONT_PROPERTIES.map(p => cs[p])].join('|');
    if (metricKey !== key) { metricKey = key; heightCache.clear(); }
    return { lineHeight, padTop, padLeft, padBottom, padRight, charWidth,
      contentWidth, width: input.clientWidth, wordWrap: on ? 'on' : 'off' };
  }

  function refresh(view) {
    if (!apply()) return null;
    view = view || viewNow() || { lines: [], map: [] };
    const m = measureMetrics(), lines = view.lines || [], map = view.map || [];
    const fragment = document.createDocumentFragment(), pending = new Map();
    if (m.wordWrap === 'on') for (const source of lines) {
      const text = String(source);
      if (heightCache.has(text) || pending.has(text)) continue;
      const row = document.createElement('div');
      // A zero-width sentinel gives empty source rows one native line box.
      row.textContent = text || '\u200b';
      row.style.cssText = 'display:block;margin:0;padding:0;border:0;min-height:0;';
      pending.set(text, row); fragment.appendChild(row);
    }
    probe.replaceChildren(fragment);
    // Batch writes above and reads below, rather than one layout per source row.
    for (const [text, node] of pending) heightCache.set(text, Math.max(m.lineHeight, node.getBoundingClientRect().height));
    let top = m.padTop;
    const rows = lines.map((source, row) => {
      const height = m.wordWrap === 'on' ? heightCache.get(String(source)) || m.lineHeight : m.lineHeight;
      const entry = { top, height, model: map[row] && Number.isInteger(map[row].model) ? map[row].model : row };
      top += height; return entry;
    });
    state = Object.assign(m, { rows, view, contentHeight: top - m.padTop,
      totalHeight: top + m.padBottom, lineTop, rowAt, positionAt });
    // Bound memory across long editing sessions. Existing rows remain valid.
    if (heightCache.size > 4096) heightCache.clear();
    return state;
  }

  function get() { return state || refresh(); }
  function lineTop(row) {
    const layout = get();
    if (!layout) return 0;
    if (row >= layout.rows.length) return layout.padTop + layout.contentHeight;
    return layout.rows[Math.max(0, row)] ? layout.rows[Math.max(0, row)].top : layout.padTop;
  }
  function rowAt(contentY) {
    const layout = get();
    if (!layout || !layout.rows.length) return -1;
    let low = 0, high = layout.rows.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >>> 1;
      if (layout.rows[middle].top <= contentY) low = middle; else high = middle - 1;
    }
    return low;
  }

  // Native glyph position for absolute decorations. Columns are UTF-16 offsets,
  // as in textarea.selectionStart; no fixed-width or ASCII-only approximation.
  function positionAt(row, column) {
    const layout = get(), entry = layout && layout.rows[row];
    if (!entry) return null;
    const source = String(layout.view.lines[row] || '');
    column = Math.max(0, Math.min(source.length, Number(column) || 0));
    probe.textContent = source || '\u200b';
    const range = document.createRange(), node = probe.firstChild;
    range.setStart(node, column); range.setEnd(node, column);
    let rect = range.getBoundingClientRect();
    // Empty lines do not reliably expose a collapsed range in every engine.
    if (!source.length) { range.setEnd(node, 1); rect = range.getBoundingClientRect(); }
    const origin = probe.getBoundingClientRect();
    return { left: layout.padLeft + rect.left - origin.left,
      top: entry.top + Math.max(0, Math.round((rect.top - origin.top) / layout.lineHeight)) * layout.lineHeight,
      height: layout.lineHeight, model: entry.model, row };
  }

  function draw(view) {
    const layout = refresh(view);
    if (!layout) return null;
    const gutter = document.getElementById('edGutter');
    if (gutter) {
      if (layout.wordWrap === 'on') {
        const fragment = document.createDocumentFragment();
        for (let row = 0; row < layout.rows.length; row++) {
          const entry = layout.rows[row], line = document.createElement('div');
          line.className = 'ed-layout-line-number';
          line.dataset.row = String(row); line.dataset.model = String(entry.model);
          line.textContent = String(entry.model + 1);
          line.style.cssText = 'position:absolute;left:0;right:0;top:' + entry.top +
            'px;height:' + layout.lineHeight + 'px;line-height:' + layout.lineHeight + 'px;padding-right:inherit;';
          fragment.appendChild(line);
        }
        setStyle(gutter, 'position', 'relative');
        setStyle(gutter, 'height', layout.totalHeight + 'px');
        setStyle(gutter, 'boxSizing', 'border-box');
        gutter.dataset.softWrap = 'on'; gutter.replaceChildren(fragment);
      } else if (gutter.dataset.softWrap === 'on') {
        gutter.textContent = layout.rows.map(row => row.model + 1).join('\n') + '\n';
        gutter.removeAttribute('data-soft-wrap');
        setStyle(gutter, 'height', '');
      }
    }
    return layout;
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; draw(); });
  }
  function start() {
    if (window.ED && ED.afterRender && hookedEditor !== ED) {
      hookedEditor = ED;
      ED.afterRender(() => draw());
    }
    schedule();
  }
  window.EditorViewLayout = { configure, apply, refresh, get, draw, lineTop, rowAt, positionAt,
    get totalHeight() { const layout = get(); return layout ? layout.totalHeight : 0; } };
  window.addEventListener('resize', schedule, { passive: true });
  if (document.fonts) {
    document.fonts.ready.then(schedule);
    if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', schedule);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  start();
})();
