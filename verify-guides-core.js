/* ============================================================
   缩进参考线 · Node 无浏览器验收
   在假的 DOM 里跑真实的 guides.js：Range 实测字宽、按级生成
   连续线段、折叠箭头、滚动平移、活动块高亮，全部走同一份代码。
   运行：node verify-guides-core.js
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, 'guides.js'), 'utf8');

const GLYPH_W = 8;      // 假字体：等宽 8px
const PAD_L = 24;
const PAD_T = 16;
const LH = 22;
const MAIN_LEFT = 54;
const MAIN_W = 900;
const MAIN_H = 600;

let passed = 0;
const failed = [];

function check(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS', name, extra == null ? '' : extra); }
  else { failed.push(name); console.log('  FAIL', name, extra == null ? '' : extra); }
}

function near(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 0.51 : tol); }

/* ---------------- 假 DOM ---------------- */

class TextNode {
  constructor(data, line, lineStart) {
    this.nodeType = 3;
    this.data = data;
    this.__line = line == null ? -1 : line;
    this.__lineStart = lineStart || 0;
  }
}

class El {
  constructor(tag, ns) {
    this.nodeType = 1;
    this.tagName = tag;
    this.namespaceURI = ns || null;
    this.childNodes = [];
    this.parentElement = null;
    this.style = {};
    this.attrs = {};
    this._html = '';
    this.clientWidth = MAIN_W;
    this.clientHeight = MAIN_H;
  }
  get firstChild() { return this.childNodes[0] || null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  appendChild(c) { c.parentElement = this; this.childNodes.push(c); return c; }
  insertBefore(c, ref) {
    c.parentElement = this;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c);
    return c;
  }
  removeChild(c) {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) this.childNodes.splice(i, 1);
    c.parentElement = null;
    return c;
  }
  get textContent() {
    if (this._html) return this._html;
    return this.childNodes.map(n => n.nodeType === 3 ? n.data : n.textContent).join('');
  }
  set textContent(v) { this.childNodes = []; this._html = String(v); }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); }
  getBoundingClientRect() {
    return { left: MAIN_LEFT, top: 0, width: MAIN_W, height: MAIN_H,
      right: MAIN_LEFT + MAIN_W, bottom: MAIN_H };
  }
  closest(sel) { return sel === '.ed-main' ? mainEl : null; }
  addEventListener() {}
  removeEventListener() {}
}

class FakeRange {
  setStart(node, off) { this.startNode = node; this.startOffset = off; }
  setEnd(node, off) { this.endNode = node; this.endOffset = off; }
  getBoundingClientRect() {
    const s = this.startNode;
    if (!s || s.nodeType !== 3) return { left: 0, top: 0, width: 0, height: 0 };
    const line = s.__line;
    const startCol = (s.__lineStart || 0) + this.startOffset;
    let endCol;
    if (this.endNode && this.endNode.__line === line) {
      endCol = (this.endNode.__lineStart || 0) + this.endOffset;
    } else {
      endCol = startCol + s.data.length - this.startOffset;
    }
    const left = MAIN_LEFT + PAD_L - scrollLeft + startCol * GLYPH_W;
    const width = Math.max(0, endCol - startCol) * GLYPH_W;
    return { left, top: PAD_T + line * LH - scrollTop, width, height: LH,
      right: left + width, bottom: PAD_T + line * LH - scrollTop + LH };
  }
}

let scrollLeft = 0, scrollTop = 0;

const hlEl = new El('pre');
const taEl = new El('textarea');
taEl.value = '';
taEl.scrollLeft = 0;
taEl.scrollTop = 0;
taEl.selectionStart = 0;
taEl.selectionEnd = 0;
taEl.selectionDirection = 'none';
const mainEl = new El('div');
mainEl.appendChild(hlEl);
mainEl.appendChild(taEl);

const document = {
  addEventListener() {},
  getElementById(id) {
    if (id === 'edInput') return taEl;
    if (id === 'edHl') return hlEl;
    if (id === 'code') return mainEl;
    return null;
  },
  createRange() { return new FakeRange(); },
  createElement(tag) {
    if (tag === 'canvas') {
      return { getContext() { return { font: '', measureText(t) { return { width: t.length * GLYPH_W }; } }; } };
    }
    return new El(tag);
  },
  createElementNS(ns, tag) { return new El(tag, ns); },
  fonts: undefined
};

const window = {
  addEventListener() {},
  requestAnimationFrame(fn) { fn(); return 0; },
  ED: { afterRender(fn) { hooks.push(fn); } }
};
const hooks = [];

const filesMap = { 'test.pl': { path: 'test.pl', lang: 'perl', lines: [] } };
let cur = 'test.pl';

const sandbox = {
  window, document, console,
  getComputedStyle() {
    return {
      fontStyle: 'normal', fontWeight: '400', fontSize: '13px',
      fontFamily: 'Consolas, monospace', lineHeight: LH + 'px',
      paddingTop: PAD_T + 'px', paddingLeft: PAD_L + 'px'
    };
  },
  hasFile() { return true; },
  files() { return filesMap; },
  cur,
  setTimeout(fn) { return 0; },
  Math, Map, Array, Object, String, Number, isFinite, parseFloat, JSON
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(SRC, sandbox, { filename: 'guides.js' });

function boot(lines, lang, opts) {
  opts = opts || {};
  filesMap['test.pl'] = { path: 'test.pl', lang: lang || 'perl', lines: lines.slice() };
  const chunks = [];
  hlEl.childNodes = [];
  hlEl._html = '';
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i] === '' ? ' ' : lines[i];
    if (opts.spans) {
      let n = 0;
      while (n < text.length) {
        const part = text.slice(n, n + 3);
        const span = new El('span');
        const tn = new TextNode(part, i, n);
        span.appendChild(tn);
        hlEl.childNodes.push(span);
        n += part.length;
      }
    } else {
      const node = new TextNode(text, i, 0);
      hlEl.childNodes.push(node);
      chunks.push(node);
    }
    if (i < lines.length - 1) hlEl.childNodes.push(new TextNode('\n'));
  }
  hlEl.childNodes.push(new TextNode('\n'));
  taEl.value = lines.join('\n');
  taEl.selectionStart = 0;
  taEl.selectionEnd = 0;
  scrollLeft = opts.sx || 0;
  scrollTop = opts.sy || 0;
  taEl.scrollLeft = scrollLeft;
  taEl.scrollTop = scrollTop;
  taEl.selectionDirection = 'none';
  sandbox.cur = 'test.pl';
  sandbox.window.__ED_GUIDES__.reset();
  return readSvg();
}

function readSvg() {
  const html = mainEl.childNodes.find(n => n.tagName === 'svg');
  return html ? html.innerHTML : '';
}

function parseLines(html) {
  const out = [];
  const re = /<line ([^>]*)\/>/g;
  let m;
  while ((m = re.exec(html))) {
    const a = {};
    m[1].replace(/([\w-]+)="([^"]*)"/g, (_, k, v) => { a[k] = v; });
    out.push({
      x: parseFloat(a.x1), y1: parseFloat(a.y1), y2: parseFloat(a.y2),
      level: +a['data-level'], from: +a['data-from'], to: +a['data-to'],
      active: (a.class || '').split(/\s+/).includes('active')
    });
  }
  return out;
}

function parseFolds(html) {
  const out = [];
  const re = /<path d="([^"]+)" class="fold" data-line="(\d+)"\/>/g;
  let m;
  while ((m = re.exec(html))) {
    const nums = m[1].match(/-?\d+(?:\.\d+)?/g).map(Number);
    out.push({ line: +m[2], x1: nums[0], y1: nums[1], cx: nums[2], cy: nums[3], x3: nums[4], y3: nums[5] });
  }
  return out;
}

const byLevel = (lines, lv) => lines.filter(l => l.level === lv);
const spanText = l => (l ? l.from + '-' + l.to : 'none');

/* ============================================================
   1. 三层嵌套：每级一条线、间距 = 单位 × 字宽
   ============================================================ */
console.log('--- 1/3 三层嵌套：每级一条线且等距 ---');
const NESTED = [
  'sub outer {',
  '    my $x = 1;',
  '    if ($x) {',
  '        while (1) {',
  '            last;',
  '        }',
  '    }',
  '}'
];
let svg = boot(NESTED, 'perl');
let lines = parseLines(svg);
let levels = [...new Set(lines.map(l => l.level))].sort();
check('data-level 覆盖 1/2/3', levels.join(',') === '1,2,3', levels.join(','));
check('第 1 级区间 = 第 2~7 行', spanText(byLevel(lines, 1)[0]) === '2-7', spanText(byLevel(lines, 1)[0]));
check('第 2 级区间 = 第 4~6 行', spanText(byLevel(lines, 2)[0]) === '4-6', spanText(byLevel(lines, 2)[0]));
check('第 3 级区间 = 第 5 行', spanText(byLevel(lines, 3)[0]) === '5-5', spanText(byLevel(lines, 3)[0]));
const xs = [1, 2, 3].map(lv => byLevel(lines, lv)[0].x);
check('x 依次为 24/56/88（单位 4 × 字宽 8）',
  near(xs[0], 24.5) && near(xs[1], 56.5) && near(xs[2], 88.5), xs.join(','));
check('相邻两级间距 = 32px',
  near(xs[1] - xs[0], 32) && near(xs[2] - xs[1], 32), (xs[1] - xs[0]) + ',' + (xs[2] - xs[1]));
check('线从第 2 行顶到第 7 行底（y=38..170）',
  near(byLevel(lines, 1)[0].y1, 38) && near(byLevel(lines, 1)[0].y2, 170),
  byLevel(lines, 1)[0].y1 + '..' + byLevel(lines, 1)[0].y2);
check('块结束即断线（第 1 级只到 } 前一行）', byLevel(lines, 1)[0].to === 7);
check('折叠箭头只出现在块起始行 1/3/4',
  parseFolds(svg).map(f => f.line).join(',') === '1,3,4', parseFolds(svg).map(f => f.line).join(','));
check('三个箭头都固定在 x=11.5', parseFolds(svg).every(f => near(f.cx, 11.5, 0.01)));
check('箭头尺寸 10.8×4.8', near(parseFolds(svg)[0].x3 - parseFolds(svg)[0].x1, 10.8, 0.05) &&
  near(parseFolds(svg)[0].y3 - parseFolds(svg)[0].y1, 0, 0.05));

/* 活动块：光标在第 1 行，第一级高亮 */
check('光标所在块的第 1 级高亮', byLevel(lines, 1).some(l => l.active), '');

/* 纯收尾行不当作块头：Verilog 的 ); / } 不应有折叠箭头 */
svg = boot(['module m (', '    input a', ');', '  function f (', '      input b', '  );', '    logic c;', '  endfunction', 'endmodule'], 'verilog');
const vf = parseFolds(svg).map(f => f.line);
check('); 这类收尾行没有折叠箭头', vf.join(',') === '1,4', vf.join(','));

/* 高亮层是 token span 时，Range 实测仍要对齐 */
svg = boot(NESTED, 'perl', { spans: true });
const spanLines = parseLines(svg);
check('token span 渲染下 x 仍为 24.5/56.5/88.5',
  near(byLevel(spanLines, 1)[0].x, 24.5) && near(byLevel(spanLines, 2)[0].x, 56.5) &&
  near(byLevel(spanLines, 3)[0].x, 88.5),
  [1, 2, 3].map(lv => byLevel(spanLines, lv)[0].x).join(','));

/* ============================================================
   2. 空行不打断；块结束后断线
   ============================================================ */
console.log('--- 2/4 空行不打断 / 块结束断线 ---');
const BLANK = [
  'sub outer {',
  '    my $x = 1;',
  '',
  '    if ($x) {',
  '        last;',
  '    }',
  '}',
  '',
  'sub next {',
  '    return;',
  '}'
];
svg = boot(BLANK, 'perl');
lines = parseLines(svg);
check('空行不打断第 1 级：2-6 行连续', spanText(byLevel(lines, 1)[0]) === '2-6', spanText(byLevel(lines, 1)[0]));
check('第 2 级只覆盖 if 内 5 行', spanText(byLevel(lines, 2)[0]) === '5-5', spanText(byLevel(lines, 2)[0]));
check('第二个 sub 的线从第 10 行重新开始', byLevel(lines, 1).some(l => l.from === 10 && l.to === 10),
  byLevel(lines, 1).map(l => l.from + '-' + l.to).join(' | '));
check('空行不产生箭头', !parseFolds(svg).some(f => f.line === 8));

/* ============================================================
   3. 切换语言 / 缩进单位
   ============================================================ */
console.log('--- 3/6 缩进单位：Perl 4 / Verilog 2 / Tab 4 ---');
check('Perl 探测到 4 空格', sandbox.window.__ED_GUIDES__.detectUnit(NESTED, 'perl', 4) === 4);
check('单行临时多缩进一级不会改变单位',
  sandbox.window.__ED_GUIDES__.detectUnit(['sub a {', '    x;', '        y;', '    z;', '}'], 'perl', 4) === 4);
check('全平文件按语言兜底', sandbox.window.__ED_GUIDES__.detectUnit(['a', 'b'], 'verilog', 4) === 2);
check('Verilog 探测到 2 空格',
  sandbox.window.__ED_GUIDES__.detectUnit(['module m;', '  logic a;', '  always begin', '    a = 1;', '  end', 'endmodule'], 'verilog', 4) === 2);
const TABS = ['sub x {', '\tmy $a = 1;', '\tif ($a) {', '\t\treturn;', '\t}', '}'];
const tabLevels = sandbox.window.__ED_GUIDES__.levelsOf(TABS, 4, 4);
check('Tab 按 4 列展开', tabLevels[1] === 1 && tabLevels[3] === 2, tabLevels.join(','));
svg = boot(TABS, 'perl');
lines = parseLines(svg);
check('Tab 文件同样生成两级线', [...new Set(lines.map(l => l.level))].join(',') === '1,2',
  [...new Set(lines.map(l => l.level))].join(','));

/* ============================================================
   4. 滚动：竖线 x 不变，y 内容坐标不变；箭头固定屏幕列
   ============================================================ */
console.log('--- 5 滚动对齐 ---');
svg = boot(NESTED, 'perl', { sx: 0, sy: 0 });
const before = parseLines(svg).find(l => l.level === 2);
const beforeFold = parseFolds(svg)[0];
const svgEl = mainEl.childNodes.find(n => n.tagName === 'svg');
svg = boot(NESTED, 'perl', { sx: 16, sy: 44 });
const after = parseLines(svg).find(l => l.level === 2);
const afterFold = parseFolds(svg)[0];
check('横向滚动后竖线 x 不变', near(before.x, after.x, 0.01), before.x + ' → ' + after.x);
check('纵向滚动后 y 不变（由 transform 平移）', near(before.y1, after.y1, 0.01));
check('transform 为 translate(-16,-44)',
  svgEl.style.transform === 'translate(-16px,-44px)', svgEl.style.transform);
check('箭头横向跟回固定屏幕列', near(afterFold.cx - 16, beforeFold.cx, 0.02),
  afterFold.cx + ' - 16 = ' + (afterFold.cx - 16) + ' vs ' + beforeFold.cx);

/* ============================================================
   5. 光标块高亮
   ============================================================ */
console.log('--- 活动块高亮跟随光标 ---');
svg = boot(NESTED, 'perl');
taEl.selectionStart = taEl.selectionEnd = taEl.value.split('\n').slice(0, 2).join('\n').length + 1; // 第 3 行 if
sandbox.window.__ED_GUIDES__.draw();
lines = parseLines(readSvg());
const act = lines.filter(l => l.active);
check('光标在 if 行时第 2 级高亮', act.length === 1 && act[0].level === 2 && act[0].from === 4 && act[0].to === 6, act.map(l => l.level + ':' + l.from + '-' + l.to).join());
taEl.selectionStart = taEl.selectionEnd = taEl.value.split('\n').slice(0, 4).join('\n').length + 1; // 第 5 行，叶子
sandbox.window.__ED_GUIDES__.draw();
check('光标在叶子行时没有块可高亮', parseLines(readSvg()).every(l => !l.active));

/* ============================================================
   6. 边界：空文件、空行、单行
   ============================================================ */
console.log('--- 边界 ---');
svg = boot([''], 'perl');
check('空文件不崩、无线段', parseLines(svg).length === 0 && parseFolds(svg).length === 0);
svg = boot(['', '', ''], 'perl');
check('全空文件无线段', parseLines(svg).length === 0);
svg = boot(['sub a {', '    x;', '}'], 'verilog');
check('单块文件：1 条线 + 1 个箭头', parseLines(svg).length === 1 && parseFolds(svg).length === 1);
svg = boot(['sub a {', '        x;', '}'], 'perl');
check('缩进不是单位整数倍也能画线', parseLines(svg).length >= 1);

/* ============================================================
   END
   ============================================================ */
console.log();
console.log('通过 ' + passed + ' 项，失败 ' + failed.length + ' 项');
if (failed.length) {
  failed.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
