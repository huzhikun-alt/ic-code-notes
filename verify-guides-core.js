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
  const re = /<path d="([^"]+)" class="fold(?: collapsed)?" data-line="(\d+)"(?: data-model="(\d+)")?\/>/g;
  let m;
  while ((m = re.exec(html))) {
    const nums = m[1].match(/-?\d+(?:\.\d+)?/g).map(Number);
    out.push({ line: +m[2], model: m[3] ? +m[3] : +m[2], collapsed: /collapsed/.test(m[0]),
      x1: nums[0], y1: nums[1], cx: nums[2], cy: nums[3], x3: nums[4], y3: nums[5] });
  }
  return out;
}

const byLevel = (lines, lv) => lines.filter(l => l.level === lv);
const spanText = l => (l ? l.from + '-' + l.to : 'none');

/* ============================================================
   1. 单列范围线：箭头右侧、所有代码行行首左侧
   ============================================================ */
console.log('--- 1 单列位置 ---');
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
let base = lines.filter(l => !l.active);
let act = lines.filter(l => l.active);
check('只有一条 gutter 列', new Set(lines.map(l => l.x)).size === 1, lines.map(l => l.x).join(','));
check('列在正文左边界左侧（不进入代码缩进）', lines[0].x < 24, String(lines[0].x));
check('列在折叠箭头右侧', lines[0].x > parseFolds(svg)[0].x3, lines[0].x + ' > ' + parseFolds(svg)[0].x3);
check('底纹覆盖 top-level 块 2~7 行', base.length === 1 && base[0].level === 1 &&
  base[0].from === 2 && base[0].to === 7, JSON.stringify(base));
check('活动块范围叠在同一列', act.length === 1 && act[0].level === 1 &&
  act[0].from === 2 && act[0].to === 7 && act[0].x === base[0].x, JSON.stringify(act));
check('线从第 2 行顶到第 7 行底（y=38..170）',
  near(base[0].y1, 38) && near(base[0].y2, 170), base[0].y1 + '..' + base[0].y2);
check('块结束即断线（第 1 级只到 } 前一行）', base[0].to === 7);
check('折叠箭头只出现在块起始行 1/3/4',
  parseFolds(svg).map(f => f.line).join(',') === '1,3,4', parseFolds(svg).map(f => f.line).join(','));
check('三个箭头都固定在 x=11.5', parseFolds(svg).every(f => near(f.cx, 11.5, 0.01)));
check('箭头尺寸 8.4×3.8', near(parseFolds(svg)[0].x3 - parseFolds(svg)[0].x1, 8.4, 0.05) &&
  near(parseFolds(svg)[0].y3 - parseFolds(svg)[0].y1, 0, 0.05));

/* 高亮层是 token span 时也不影响列位置 */
svg = boot(NESTED, 'perl', { spans: true });
const spanLines = parseLines(svg);
check('token span 渲染下仍是同一 gutter 列',
  new Set(spanLines.map(l => l.x)).size === 1 && spanLines[0].x === 20.5,
  spanLines.map(l => l.x).join(','));

/* ============================================================
   折叠范围 / 显示副本（纯逻辑）
   ============================================================ */
console.log('--- 折叠范围 ---');
const core = sandbox.window.__ED_GUIDES__;
const perlFold = ['sub a {', '    x;', '    y;', '}'];
check('Perl 折叠到匹配的 }', JSON.stringify(core.foldRangeOf(perlFold, [0, 1, 1, 0], 0, 'perl')) ===
  JSON.stringify({ start: 0, end: 3 }));
const vfold = ['module m (', '    input a', ');', '  function f;', '    x;', '  endfunction', 'endmodule'];
check('Verilog module 折叠到 endmodule',
  JSON.stringify(core.foldRangeOf(vfold, [0, 2, 0, 1, 2, 1, 0], 0, 'verilog')) ===
  JSON.stringify({ start: 0, end: 6 }));
check('Verilog function 折叠到 endfunction',
  JSON.stringify(core.foldRangeOf(vfold, [0, 2, 0, 1, 2, 1, 0], 3, 'verilog')) ===
  JSON.stringify({ start: 3, end: 5 }));
check('Python 按缩进折叠', JSON.stringify(core.foldRangeOf(['def f():', '    x', 'y'], [0, 1, 0], 0, 'python')) ===
  JSON.stringify({ start: 0, end: 1 }));
const disp = core.buildDisplay(perlFold, [{ start: 0, end: 3 }], 4, [0, 1, 1, 0]);
check('显示副本用占位行代替隐藏行', disp.lines.length === 2 && disp.map[1].ph &&
  disp.lines[1].startsWith('    …') && disp.map[1].count === 3, JSON.stringify(disp));

/* ============================================================
   2. 空行不打断；块结束后断线；同列重启
   ============================================================ */
console.log('--- 2 空行 / 多块 ---');
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
base = lines.filter(l => !l.active);
check('空行不打断：2~6 行连续', base[0].from === 2 && base[0].to === 6,
  base.map(l => l.from + '-' + l.to).join(' | '));
check('第二个 sub 的线从第 10 行重新开始', base.some(l => l.from === 10 && l.to === 10),
  base.map(l => l.from + '-' + l.to).join(' | '));
check('空行不产生箭头', !parseFolds(svg).some(f => f.line === 8));
check('多块也共用同一 gutter 列', new Set(lines.map(l => l.x)).size === 1, lines.map(l => l.x).join(','));

/* ============================================================
   3. 缩进单位 / Tab
   ============================================================ */
console.log('--- 3 缩进单位 / Tab ---');
check('Perl 探测到 4 空格', core.detectUnit(NESTED, 'perl', 4) === 4);
check('单行临时多缩进一级不会改变单位',
  core.detectUnit(['sub a {', '    x;', '        y;', '    z;', '}'], 'perl', 4) === 4);
check('全平文件按语言兜底', core.detectUnit(['a', 'b'], 'verilog', 4) === 2);
check('Verilog 探测到 2 空格',
  core.detectUnit(['module m;', '  logic a;', '  always begin', '    a = 1;', '  end', 'endmodule'], 'verilog', 4) === 2);
const TABS = ['sub x {', '\tmy $a = 1;', '\tif ($a) {', '\t\treturn;', '\t}', '}'];
const tabLevels = core.levelsOf(TABS, 4, 4);
check('Tab 按 4 列展开', tabLevels[1] === 1 && tabLevels[3] === 2, tabLevels.join(','));
svg = boot(TABS, 'perl');
lines = parseLines(svg);
base = lines.filter(l => !l.active);
check('Tab 文件同样生成一条 gutter 线', base.length === 1 && base[0].from === 2 && base[0].to === 5,
  JSON.stringify(base));

/* ============================================================
   4. 滚动：竖线 x 不变，y 由 transform 平移；箭头固定列
   ============================================================ */
console.log('--- 4 滚动对齐 ---');
svg = boot(NESTED, 'perl', { sx: 0, sy: 0 });
const before = parseLines(svg).find(l => !l.active);
const beforeFold = parseFolds(svg)[0];
const svgEl = mainEl.childNodes.find(n => n.tagName === 'svg');
svg = boot(NESTED, 'perl', { sx: 16, sy: 44 });
const after = parseLines(svg).find(l => !l.active);
const afterFold = parseFolds(svg)[0];
check('横向滚动后竖线 x 不变', near(before.x, after.x, 0.01), before.x + ' → ' + after.x);
check('纵向滚动后 y 不变（由 transform 平移）', near(before.y1, after.y1, 0.01));
check('transform 为 translate(-16,-44)',
  svgEl.style.transform === 'translate(-16px,-44px)', svgEl.style.transform);
check('箭头横向跟回固定屏幕列', near(afterFold.cx - 16, beforeFold.cx, 0.02),
  afterFold.cx + ' - 16 = ' + (afterFold.cx - 16) + ' vs ' + beforeFold.cx);

/* ============================================================
   5. 活动块高亮：始终落在同一条 gutter 列
   ============================================================ */
console.log('--- 5 活动块高亮 ---');
svg = boot(NESTED, 'perl');
taEl.selectionStart = taEl.selectionEnd = taEl.value.split('\n').slice(0, 2).join('\n').length + 1; // 第 3 行 if
core.draw();
lines = parseLines(readSvg());
base = lines.filter(l => !l.active);
act = lines.filter(l => l.active);
check('光标在 if 行时高亮 if 块的范围', act.length === 1 && act[0].level === 2 &&
  act[0].from === 4 && act[0].to === 6 && act[0].x === base[0].x,
  JSON.stringify(act));
taEl.selectionStart = taEl.selectionEnd = taEl.value.split('\n').slice(0, 4).join('\n').length + 1; // 第 5 行叶子
core.draw();
lines = parseLines(readSvg());
base = lines.filter(l => !l.active);
act = lines.filter(l => l.active);
check('叶子行高亮所在块的范围，仍在同一列', act.length === 1 && act[0].level === 3 &&
  act[0].from === 5 && act[0].to === 5 && act[0].x === base[0].x, JSON.stringify(act));

/* ============================================================
   6. 边界
   ============================================================ */
console.log('--- 6 边界 ---');
svg = boot([''], 'perl');
check('空文件不崩、无线段', parseLines(svg).length === 0 && parseFolds(svg).length === 0);
svg = boot(['', '', ''], 'perl');
check('全空文件无线段', parseLines(svg).length === 0);
svg = boot(['sub a {', '    x;', '}'], 'verilog');
check('单块文件：底纹 + 活动段 + 1 个箭头',
  parseLines(svg).length === 2 && parseFolds(svg).length === 1, JSON.stringify(parseLines(svg)));
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
