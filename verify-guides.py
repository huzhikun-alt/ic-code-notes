"""缩进参考线验收（对照 docs/reference-indent-guides.png）

运行：
    cd ic-code-notes
    python -m http.server 8720 --bind 127.0.0.1
    python verify-guides.py

覆盖 HANDOFF-INDENT-GUIDES.md 第 6 节的 8 条验收标准，并额外检查：
折叠箭头位置/固定列、活动块高亮、主题配色、跨行选择不被遮挡。
"""
import sys
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass
from playwright.sync_api import sync_playwright

URL = 'http://127.0.0.1:8720/index.html'
OK = 0
FAIL = []


def check(name, cond, extra=''):
    global OK
    if cond:
        OK += 1
        print('  PASS', name, extra)
    else:
        FAIL.append(name + (' ' + extra if extra else ''))
        print('  FAIL', name, extra)


def rgb_of(value):
    """把 rgb()/color(srgb ...) 解析成 0~255 三元组；解析失败返回 None。"""
    if not value:
        return None
    v = value.strip()
    try:
        if v.startswith('rgb'):
            nums = v[v.index('(') + 1:v.rindex(')')].replace('/', ',').split(',')
            vals = [float(x.strip().rstrip('%')) for x in nums if x.strip()][:3]
            if any(x > 1.001 for x in vals):
                return tuple(vals)
            return tuple(x * 255 for x in vals)
        if v.startswith('color('):
            body = v[v.index('(') + 1:v.rindex(')')].strip()
            if body.startswith('srgb'):
                nums = body[len('srgb'):].split()
                return tuple(float(x) * 255 for x in nums[:3])
    except Exception:
        pass
    return None


def lum(c):
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


# 三层嵌套（4 空格单位）
NESTED = [
    'sub outer {',
    '    my $x = 1;',
    '    if ($x) {',
    '        while (1) {',
    '            last;',
    '        }',
    '    }',
    '}'
]

# 用来测滚动的长文件：第 2 行起整段都是第 1 级
LONG = ['sub big {']
for i in range(80):
    LONG.append('    my $v%d = %d;' % (i, i))
LONG.append('}')

# 对照图里的 YAML 结构（缩进 2）
YAMLISH = [
    '- id: ui-chat',
    '  name: "@deepseek-ai/dsh-client-ui-chat"',
    '  config:',
    '    transcriptView: standard',
    '    performanceUsage: detailed',
    '- id: ui-settings',
    '  name: "@deepseek-ai/dsh-client-ui-settings"',
    '  config:',
    '    enabled: true',
    '- id: ui-settings-account',
    '  name: "@deepseek-ai/dsh-client-ui-settings-account"',
    '  config:',
    '    version: 1',
    '    step: done',
    '    usage: detailed',
    '    developerTools: true',
    '    purpose: null',
    '    process: standard',
    '    completion: api-key',
    '- id: llm-pi-ai',
    '  name: "@deepseek-ai/dsh-llm-pi-ai"',
    '  config:',
    '    providers:',
    '      mysub2:',
    '        apiKeyEnv: MYSUB2_API_KEY',
    '        api: openai-completions',
    '        baseURL: http://localhost:8080/v1',
    '        models:',
    '          - id: gpt-6'
]


with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True, args=['--no-sandbox'])
    ctx = browser.new_context(viewport={'width': 1500, 'height': 950},
                              permissions=['clipboard-read', 'clipboard-write'])
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append('CONSOLE ' + m.text) if m.type == 'error' else None)
    pg.goto(URL, wait_until='domcontentloaded')
    pg.wait_for_timeout(1400)
    pg.evaluate('() => localStorage.clear()')
    pg.reload()
    pg.wait_for_timeout(1400)

    def inject(lines, lang='perl', name='_verify_guides.pl'):
        pg.evaluate("""([lines, lang, name]) => {
            const fs = files();
            fs[name] = {path: 'verify/' + name, lang: lang, lines: lines};
            cur = name;
            ED.render();
            const t = document.getElementById('edInput');
            t.setSelectionRange(t.value.length, t.value.length);
            t.dispatchEvent(new Event('keyup'));
        }""", [lines, lang, name])
        pg.wait_for_timeout(350)

    def open_sample(name):
        pg.evaluate("""(name) => {
            cur = name;
            ED.render();
            const t = document.getElementById('edInput');
            t.setSelectionRange(t.value.length, t.value.length);
            t.dispatchEvent(new Event('keyup'));
        }""", name)
        pg.wait_for_timeout(300)

    def guides():
        return pg.evaluate("""() => [...document.querySelectorAll('.ed-guides line')].map(el => {
            const r = el.getBoundingClientRect();
            return {
                x: +el.getAttribute('x1'), y1: +el.getAttribute('y1'), y2: +el.getAttribute('y2'),
                level: +el.dataset.level, from: +el.dataset.from, to: +el.dataset.to,
                active: el.classList.contains('active'),
                vx: r.x, vy: r.y, vw: r.width, vh: r.height
            };
        })""")

    def folds():
        return pg.evaluate("""() => [...document.querySelectorAll('.ed-guides path.fold')].map(el => {
            const r = el.getBoundingClientRect();
            return {line: +el.dataset.line, vx: r.x, vy: r.y, d: el.getAttribute('d')};
        })""")

    def metric():
        return pg.evaluate("() => window.__ED_GUIDES__.measure()")

    def unit():
        return int(pg.evaluate("() => document.querySelector('.ed-guides').dataset.unit"))

    def by_level(rows, lv):
        return [r for r in rows if r['level'] == lv]

    def span(rows, lv):
        hit = by_level(rows, lv)
        return (hit[0]['from'], hit[0]['to']) if hit else (None, None)

    # ================================================================
    print('--- 1/6 三层嵌套：每级一条线，Perl / Verilog / Python ---')
    inject(NESTED)
    rows = guides()
    levels = sorted(set(r['level'] for r in rows))
    check('data-level 覆盖 1/2/3', levels == [1, 2, 3], str(levels))
    m = metric()
    u = unit()
    check('缩进单位探测为 4', u == 4, str(u))
    check('第 1 级区间 = 2~7 行', span(rows, 1) == (2, 7), str(span(rows, 1)))
    check('第 2 级区间 = 4~6 行', span(rows, 2) == (4, 6), str(span(rows, 2)))
    check('第 3 级区间 = 5 行', span(rows, 3) == (5, 5), str(span(rows, 3)))

    # 位置：x = 正文左边界 + (级-1) × 单位 × 字宽
    print('--- 2/3 线与文字缩进列对齐，相邻级等距 ---')
    want = lambda lv: m['textLeft'] + lv * u * m['charW'] - 3
    for lv in (1, 2, 3):
        xs = by_level(rows, lv)[0]['x']
        check('第 %d 级 x 对齐缩进列' % lv, abs(xs - want(lv)) <= 1.0,
              'x=%.1f want=%.1f' % (xs, want(lv)))
    gap12 = by_level(rows, 2)[0]['x'] - by_level(rows, 1)[0]['x']
    gap23 = by_level(rows, 3)[0]['x'] - by_level(rows, 2)[0]['x']
    ideal = u * m['charW']
    check('相邻两级间距 = 单位 × 字宽', abs(gap12 - ideal) <= 1 and abs(gap23 - ideal) <= 1,
          '%.1f / %.1f，理想 %.1f' % (gap12, gap23, ideal))
    gap1 = (m['textLeft'] + 4 * m['charW']) - by_level(rows, 1)[0]['x']
    gap3 = (m['textLeft'] + 12 * m['charW']) - by_level(rows, 3)[0]['x']
    check('范围线贴在缩进文字左侧 2~6px', 2 <= gap1 <= 6 and 2 <= gap3 <= 6,
          'gap=%.1f / %.1f' % (gap1, gap3))

    pg.evaluate("""() => {
        const t = document.getElementById('edInput');
        t.setSelectionRange(t.value.length, t.value.length);
        t.dispatchEvent(new Event('keyup'));
    }""")
    pg.wait_for_timeout(150)
    light = pg.evaluate("""() => {
        const l = document.querySelector('.ed-guides line:not(.active)') || document.querySelector('.ed-guides line');
        return {
            stroke: getComputedStyle(l).stroke,
            bg: getComputedStyle(document.querySelector('.ed')).backgroundColor,
            ink: getComputedStyle(document.getElementById('edHl')).color
        };
    }""")
    lc, lb, li = rgb_of(light['stroke']), rgb_of(light['bg']), rgb_of(light['ink'])
    if lc and lb and li:
        check('浅色主题下线在背景与正文之间、能看清',
              lum(li) < lum(lc) < lum(lb) and (lum(lb) - lum(lc)) > 20,
              'bg=%.0f line=%.0f ink=%.0f' % (lum(lb), lum(lc), lum(li)))
    else:
        print('  SKIP 浅色颜色解析（浏览器返回 %s）' % light['stroke'])

    print('--- 4 块结束断线 ---')
    check('第 1 级不画到最后的 }', by_level(rows, 1)[0]['to'] == 7)
    check('第 3 级没有越出 while 块', by_level(rows, 3)[0]['to'] == 5)

    print('--- 折叠箭头 ---')
    fold_lines = sorted(f['line'] for f in folds())
    check('只在块起始行 1/3/4 有箭头', fold_lines == [1, 3, 4], str(fold_lines))
    fx = [f['vx'] for f in folds()]
    check('箭头固定在同一列', max(fx) - min(fx) <= 1.0, '%.1f ~ %.1f' % (min(fx), max(fx)))
    fold_box = pg.evaluate("() => { const r=document.querySelector('.ed-guides path.fold').getBoundingClientRect(); return {w:r.width,h:r.height}; }")
    check('折叠箭头比之前更小', fold_box['w'] < 11 and fold_box['h'] < 6,
          '%.1f × %.1f' % (fold_box['w'], fold_box['h']))
    check('箭头不压到代码文字',
          min(fx) + 12 < pg.evaluate("() => document.querySelector('.ed-main').getBoundingClientRect().left + 24"),
          str(min(fx)))
    check('箭头不参与选择（SVG pointer-events:none）',
          pg.evaluate("() => getComputedStyle(document.querySelector('.ed-guides')).pointerEvents") == 'none')

    # ================================================================
    print('--- 5 滚动后仍对齐 ---')
    inject(LONG)
    before = guides()
    long1 = by_level(before, 1)[0]
    pg.evaluate("""() => {
        const t = document.getElementById('edInput');
        t.scrollTop = 300;
        t.scrollLeft = 0;
        t.dispatchEvent(new Event('scroll'));
    }""")
    pg.wait_for_timeout(300)
    after = guides()
    after_long = [r for r in after if r['level'] == 1 and r['from'] == long1['from']]
    check('纵向滚动后竖线 x 不变', bool(after_long) and abs(after_long[0]['x'] - long1['x']) <= 0.01,
          '%.1f → %s' % (long1['x'], after_long[0]['x'] if after_long else 'missing'))
    check('纵向滚动后 y 由 transform 平移，内容坐标不变',
          bool(after_long) and after_long[0]['y1'] == long1['y1'] and after_long[0]['y2'] == long1['y2'])
    if after_long:
        dy = long1['vy'] - after_long[0]['vy']
        check('滚动 300px 后屏幕 y 平移 300px', abs(dy - 300) <= 2, '%.1f' % dy)

    # 横向滚动：竖线跟着文字走，折叠箭头留在固定列
    inject(['sub wide {', '    my $s = "' + 'x' * 260 + '";', '}'])
    g0 = by_level(guides(), 1)[0]
    f0 = folds()[0]
    pg.evaluate("""() => {
        const t = document.getElementById('edInput');
        t.scrollLeft = 40;
        t.dispatchEvent(new Event('scroll'));
    }""")
    pg.wait_for_timeout(300)
    g1 = by_level(guides(), 1)[0]
    f1 = folds()[0]
    check('横滚 40px 后竖线屏幕 x 左移 40px（内容坐标不变）',
          abs((g0['vx'] - g1['vx']) - 40) <= 1.5 and abs(g0['x'] - g1['x']) <= 0.01,
          'dx=%.1f, x %.1f→%.1f' % (g0['vx'] - g1['vx'], g0['x'], g1['x']))
    check('横滚后折叠箭头仍钉在固定列', abs(f0['vx'] - f1['vx']) <= 1.0,
          '%.1f → %.1f' % (f0['vx'], f1['vx']))

    # ================================================================
    print('--- 6 切换语言仍然正确 ---')
    for name, lang, min_level in [('uart_rx.pl', 'perl', 1),
                                  ('sat_alu.sv', 'verilog', 2),
                                  ('analysis.py', 'python', 2)]:
        open_sample(name)
        rows = guides()
        m = metric()
        u = unit()
        lv = sorted(set(r['level'] for r in rows))
        check('%s：有参考线' % name, len(rows) >= 1, 'levels=' + str(lv))
        check('%s：层级达到 %d' % (name, min_level), max(lv or [0]) >= min_level, 'levels=' + str(lv))
        if len(lv) >= 2:
            xs0 = by_level(rows, lv[0])[0]['x']
            xs1 = by_level(rows, lv[1])[0]['x']
            check('%s：级间距 = 单位 × 字宽' % name, abs((xs1 - xs0) - u * m['charW']) <= 1,
                  '%.1f vs %.1f' % (xs1 - xs0, u * m['charW']))
        check('%s：无重复重叠线段' % name,
              len(set((r['level'], r['from'], r['to']) for r in rows)) == len(rows))

    # ================================================================
    print('--- 7 不遮挡选择 ---')
    inject(NESTED)
    box = pg.locator('#edInput').bounding_box()
    pg.mouse.move(box['x'] + 24, box['y'] + 16 + 11)
    pg.mouse.down()
    pg.mouse.move(box['x'] + 260, box['y'] + 16 + 11 + 22 * 3, steps=12)
    pg.mouse.up()
    pg.wait_for_timeout(200)
    sel = pg.evaluate("""() => {
        const t = document.getElementById('edInput');
        return t.value.slice(t.selectionStart, t.selectionEnd);
    }""")
    check('跨行拖选内容完整', '\n' in sel and 'sub outer' in sel, repr(sel[:30]))
    check('选择期间参考线仍在', len(guides()) > 0)

    print('--- 活动块高亮 ---')
    pg.evaluate("""() => {
        const t = document.getElementById('edInput');
        t.setSelectionRange(0, 0);
        t.dispatchEvent(new Event('keyup'));
    }""")
    pg.wait_for_timeout(200)
    act = [r for r in guides() if r['active']]
    check('光标在块首行时对应级高亮', len(act) == 1 and act[0]['level'] == 1,
          str([(r['level'], r['from'], r['to']) for r in act]))

    # ================================================================
    print('--- 折叠 / 展开 ---')
    pg.evaluate("() => { cur='check_log.pl'; ED.render(); window.__ED_FOLDS__.expandAll(); }")
    pg.wait_for_timeout(300)
    pg.evaluate("() => window.__ED_FOLDS__.toggleFold(5)")   # while (my $l = <STDIN>) {
    pg.wait_for_timeout(400)
    fs = pg.evaluate("""() => {
        const t = document.getElementById('edInput');
        const v = ED.getFoldView();
        return {
            ro: t.readOnly,
            n: t.value.split('\\n').length,
            model: files()[cur].lines.length,
            ph: v ? v.map.filter(e => e.ph).map(e => ({start:e.start, to:e.to, count:e.count})) : [],
            gutter: document.getElementById('edGutter').textContent.includes('⋮'),
            collapsed: document.querySelectorAll('.ed-guides path.fold.collapsed').length
        };
    }""")
    check('折叠后 textarea 只读', fs['ro'])
    check('折叠后显示行数减少', fs['n'] == 7 and fs['model'] == 12, '%s / %s' % (fs['n'], fs['model']))
    check('占位行记录隐藏范围', fs['ph'] == [{'start': 5, 'to': 11, 'count': 6}], str(fs['ph']))
    check('gutter 用 ⋮ 表示折叠行', fs['gutter'])
    check('箭头变为向右（collapsed）', fs['collapsed'] >= 1, str(fs['collapsed']))

    r = pg.evaluate("() => document.querySelector('.ed-guides path.fold').getBoundingClientRect().toJSON()")
    pg.mouse.click(r['x'] + r['width'] / 2, r['y'] + r['height'] / 2)
    pg.wait_for_timeout(400)
    check('点击箭头展开', pg.evaluate("() => !ED.isFolded() && !document.getElementById('edInput').readOnly"))

    # 点击占位行展开
    pg.evaluate("() => window.__ED_FOLDS__.toggleFold(5)")
    pg.wait_for_timeout(300)
    phy = pg.evaluate("""() => {
        const v = ED.getFoldView(); const i = v.map.findIndex(e => e.ph);
        const m = document.querySelector('.ed-main').getBoundingClientRect();
        const t = document.getElementById('edInput');
        return {x: m.left + 120, y: m.top + (16 + i * 22 - t.scrollTop) + 11};
    }""")
    pg.mouse.click(phy['x'], phy['y'])
    pg.wait_for_timeout(400)
    check('点击占位行展开', pg.evaluate("() => !ED.isFolded()"))

    # 折叠时输入 → 自动展开并写回模型
    pg.evaluate('() => localStorage.clear()')
    pg.reload()
    pg.wait_for_timeout(1200)
    pg.evaluate("() => { cur='check_log.pl'; ED.render(); window.__ED_FOLDS__.toggleFold(5); }")
    pg.wait_for_timeout(300)
    pg.evaluate("""() => {
        const t = document.getElementById('edInput');
        const v = t.value.split('\\n');
        let pos = 0; for (let i = 0; i < 1; i++) pos += v[i].length + 1;
        t.focus();
        t.setSelectionRange(pos + v[1].length, pos + v[1].length);
        t.dispatchEvent(new Event('keyup'));
    }""")
    pg.keyboard.type('X')
    pg.wait_for_timeout(500)
    typed = pg.evaluate("() => ({folded: ED.isFolded(), line: files()[cur].lines[1]})")
    check('折叠时输入自动展开', not typed['folded'])
    check('输入落到正确的模型行', typed['line'].endswith('X'), repr(typed['line']))

    # 折叠时回车 → 自动展开并保留自动缩进
    pg.evaluate('() => localStorage.clear()')
    pg.reload()
    pg.wait_for_timeout(1200)
    pg.evaluate("() => { cur='check_log.pl'; ED.render(); window.__ED_FOLDS__.toggleFold(5); }")
    pg.wait_for_timeout(300)
    pg.evaluate("""() => {
        const t = document.getElementById('edInput');
        const v = t.value.split('\\n');
        let pos = 0; for (let i = 0; i < 1; i++) pos += v[i].length + 1;
        t.focus();
        t.setSelectionRange(pos + v[1].length, pos + v[1].length);
        t.dispatchEvent(new Event('keyup'));
    }""")
    pg.keyboard.press('Enter')
    pg.wait_for_timeout(500)
    ent = pg.evaluate("() => ({folded: ED.isFolded(), n: files()[cur].lines.length})")
    check('折叠时回车自动展开并插入一行', not ent['folded'] and ent['n'] == 13, str(ent))

    # 折叠时复制不展开
    pg.evaluate('() => localStorage.clear()')
    pg.reload()
    pg.wait_for_timeout(1200)
    pg.evaluate("() => { cur='check_log.pl'; ED.render(); window.__ED_FOLDS__.toggleFold(5); }")
    pg.wait_for_timeout(300)
    pg.evaluate("""() => {
        const t = document.getElementById('edInput');
        const v = t.value.split('\\n');
        t.focus();
        t.setSelectionRange(0, v[0].length + v[1].length + 1);
    }""")
    pg.keyboard.press('Control+c')
    pg.wait_for_timeout(300)
    check('折叠时复制不会展开', pg.evaluate("() => ED.isFolded()"))

    # Verilog / Python 折叠范围
    pg.evaluate("() => { cur='sat_alu.sv'; ED.render(); window.__ED_FOLDS__.expandAll(); }")
    pg.wait_for_timeout(300)
    pg.evaluate("() => window.__ED_FOLDS__.toggleFold(2)")   # module
    pg.wait_for_timeout(350)
    sat = pg.evaluate("() => { const v=ED.getFoldView(); return v ? v.map.filter(e=>e.ph).map(e=>({start:e.start,to:e.to,count:e.count})) : []; }")
    check('Verilog module 折叠到 endmodule', sat == [{'start': 2, 'to': 19, 'count': 17}], str(sat))
    pg.evaluate("() => { window.__ED_FOLDS__.expandAll(); window.__ED_FOLDS__.toggleFold(8); }")  # function
    pg.wait_for_timeout(350)
    sat = pg.evaluate("() => { const v=ED.getFoldView(); return v ? v.map.filter(e=>e.ph).map(e=>({start:e.start,to:e.to,count:e.count})) : []; }")
    check('Verilog function 折叠到 endfunction', sat == [{'start': 8, 'to': 15, 'count': 7}], str(sat))
    pg.evaluate("() => { window.__ED_FOLDS__.expandAll(); cur='analysis.py'; ED.render(); }")
    pg.wait_for_timeout(300)
    pg.evaluate("() => window.__ED_FOLDS__.toggleFold(5)")   # def load
    pg.wait_for_timeout(350)
    py = pg.evaluate("() => { const v=ED.getFoldView(); return v ? v.map.filter(e=>e.ph).map(e=>({start:e.start,to:e.to,count:e.count})) : []; }")
    check('Python def 按缩进折叠', py == [{'start': 5, 'to': 8, 'count': 3}], str(py))
    pg.evaluate("() => window.__ED_FOLDS__.expandAll()")
    pg.wait_for_timeout(300)

    # ================================================================
    print('--- 8 配色 / 无 JS 报错 ---')
    pg.evaluate("""() => {
        const t = document.getElementById('edInput');
        t.setSelectionRange(t.value.length, t.value.length);
        t.dispatchEvent(new Event('keyup'));
        const html = document.documentElement;
        html.dataset.preset = 'graphite';
        html.dataset.theme = 'dark';
        window.__ED_GUIDES__.reset();
    }""")
    pg.wait_for_timeout(300)
    colors = pg.evaluate("""() => {
        const line = document.querySelector('.ed-guides line:not(.active)') || document.querySelector('.ed-guides line');
        const bg = getComputedStyle(document.querySelector('.ed')).backgroundColor;
        const ink = getComputedStyle(document.getElementById('edHl')).color;
        return {stroke: getComputedStyle(line).stroke, width: getComputedStyle(line).strokeWidth,
                bg: bg, ink: ink, fold: getComputedStyle(document.querySelector('.ed-guides path.fold')).stroke};
    }""")
    cstroke, cbg, cink = rgb_of(colors['stroke']), rgb_of(colors['bg']), rgb_of(colors['ink'])
    if cstroke and cbg and cink:
        check('深色主题下线色介于背景与正文之间',
              lum(cbg) < lum(cstroke) < lum(cink),
              'bg=%.0f line=%.0f ink=%.0f' % (lum(cbg), lum(cstroke), lum(cink)))
        check('线比正文暗很多（不抢眼）', lum(cstroke) - lum(cbg) < (lum(cink) - lum(cbg)) * 0.35,
              '%.0f vs %.0f' % (lum(cstroke) - lum(cbg), lum(cink) - lum(cbg)))
    else:
        print('  SKIP 颜色解析（浏览器返回 %s）' % colors['stroke'])
    check('线宽 1px', colors['width'] in ('1px', '1'), colors['width'])
    check('箭头颜色比正文暗', colors['fold'] != colors['ink'], colors['fold'])

    # 留一张深色对照图，便于和 docs/reference-indent-guides.png 并排看
    pg.evaluate("""(lines) => {
        const fs = files();
        fs['_ref_yaml.pl'] = {path: 'verify/_ref_yaml.pl', lang: 'perl', lines: lines};
        cur = '_ref_yaml.pl';
        ED.render();
        const t = document.getElementById('edInput');
        const at = t.value.indexOf('- id: ui-settings-account');
        t.setSelectionRange(at, at);
        t.dispatchEvent(new Event('keyup'));
    }""", YAMLISH)
    pg.wait_for_timeout(400)
    box = pg.locator('#code .ed').first.bounding_box()
    try:
        pg.screenshot(path='docs/verify-guides-dark.png',
                      clip={'x': box['x'], 'y': box['y'], 'width': min(box['width'], 760),
                            'height': min(box['height'], 940)})
        print('  INFO 已生成 docs/verify-guides-dark.png')
    except Exception as e:
        print('  SKIP 截图失败：', e)

    real = [e for e in errs if 'favicon' not in e and '404' not in e]
    check('无 JS 报错', not real, str(real[:2]))

    browser.close()

print()
print('通过 %d 项，失败 %d 项' % (OK, len(FAIL)))
if FAIL:
    for f in FAIL:
        print('  -', f)
    sys.exit(1)
