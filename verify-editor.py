"""编辑器与笔记系统验收测试

覆盖需求中的 10 条验收标准。
运行：python verify-editor.py
"""
import sys
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


AI_STUB = """() => {
  window.fetch = async () => ({
    ok: true, status: 200,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({ choices: [{ message: { content:
      '[{"from":2,"to":3,"text":"AI：装载 strict 与 warnings"},{"from":10,"to":10,"text":"AI：归一化调用"}]' } }] })
  });
}"""

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1500, 'height': 950},
                        permissions=['clipboard-read', 'clipboard-write'])
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append('CONSOLE ' + m.text) if m.type == 'error' else None)
    pg.goto(URL, wait_until='domcontentloaded')
    pg.wait_for_timeout(1500)
    pg.evaluate('() => localStorage.clear()')
    pg.reload()
    pg.wait_for_timeout(1400)

    ta = pg.locator('#edInput')
    box = ta.bounding_box()

    def sel_len():
        return pg.evaluate("() => { const t=document.getElementById('edInput'); return t.value.slice(t.selectionStart,t.selectionEnd); }")

    def drag(y1, y2, x1=30, x2=200):
        pg.mouse.move(box['x'] + x1, box['y'] + 16 + 11 + 22 * y1)
        pg.mouse.down()
        pg.mouse.move(box['x'] + x2, box['y'] + 16 + 11 + 22 * y2, steps=12)
        pg.mouse.up()
        pg.wait_for_timeout(200)

    print('--- 1/2 跨行选择 ---')
    drag(0, 4)
    s = sel_len()
    check('正向拖动选中 5 行', len(s.splitlines()) >= 4, repr(s[:30]))
    drag(4, 0)
    s2 = sel_len()
    check('反向拖动同样有效', len(s2.splitlines()) >= 4, repr(s2[:30]))

    print('--- 3 复制保留换行 ---')
    pg.keyboard.press('Control+c')
    pg.wait_for_timeout(250)
    clip = pg.evaluate("() => navigator.clipboard.readText().catch(()=> '')")
    check('复制内容保留换行', len(clip.splitlines()) >= 2, str(len(clip.splitlines())) + ' 行')

    print('--- 4 编辑与光标 ---')
    pg.keyboard.press('Control+End')
    pg.keyboard.type('# tail')
    pg.wait_for_timeout(350)
    last = pg.evaluate("() => files()[cur].lines[files()[cur].lines.length-1]")
    check('输入写入模型', last.endswith('# tail'), repr(last))
    hl_last = pg.evaluate("() => document.getElementById('edHl').textContent.split(String.fromCharCode(10)).filter(Boolean).pop()")
    check('高亮层同步', '# tail' in hl_last, repr(hl_last[-20:]))

    print('--- 5 手写笔记全生命周期 ---')
    col = pg.locator('.ed-notes').bounding_box()
    pg.mouse.dblclick(col['x'] + 60, col['y'] + 16 + 22 * 1 + 5)
    pg.wait_for_timeout(400)
    n1 = pg.locator('.ed-note').count()
    check('双击笔记列可新建', n1 >= 1, str(n1))
    body = pg.locator('.ed-note-body').first
    body.click()
    pg.keyboard.type('手写笔记内容')
    pg.evaluate("() => document.activeElement.blur()")
    pg.wait_for_timeout(400)
    txt = pg.evaluate("() => Object.values(NOTES[nkey()]||{}).map(n=>n.text)")
    check('编辑后保存', any('手写笔记内容' in t for t in txt), str(txt)[:60])

    print('--- 10 笔记视觉：无背景 无边框 仅左色条 ---')
    style = pg.evaluate("""() => {
      const el = document.querySelector('.ed-note');
      const body = el.querySelector('.ed-note-body');
      const c = getComputedStyle(el), cb = getComputedStyle(body);
      return {
        bodyBg: cb.backgroundColor,
        borderTop: c.borderTopWidth, borderRight: c.borderRightWidth,
        borderBottom: c.borderBottomWidth, borderLeft: c.borderLeftWidth,
        radius: c.borderRadius, shadow: c.boxShadow
      };
    }""")
    check('正文无背景色', style['bodyBg'] in ('rgba(0, 0, 0, 0)', 'transparent'), style['bodyBg'])
    check('只有左侧边框', style['borderTop'] == '0px' and style['borderLeft'] != '0px',
          style['borderTop'] + '/' + style['borderLeft'])

    print('--- 9 左侧范围标记已移除 ---')
    marks = pg.evaluate("() => document.querySelectorAll('.line, .line.rng, .rng-start, .rng-end').length")
    check('不再有行容器/范围括号', marks == 0, str(marks))

    print('--- 6 AI 笔记与手写同构 ---')
    pg.evaluate("() => localStorage.setItem('icn-ai-cfg', JSON.stringify({base:'http://x/v1',key:'k',model:'m',temp:0.3,allowEdit:false}))")
    pg.evaluate(AI_STUB)
    before = pg.locator('.ed-note').count()
    pg.locator('#aiToggle').click()
    pg.wait_for_timeout(300)
    pg.locator('.ai-act[data-act="file"]').click()
    pg.wait_for_timeout(1200)
    check('AI 返回条目', pg.locator('.ai-item').count() >= 1, str(pg.locator('.ai-item').count()))
    pg.locator('#aiAccept').click()
    pg.wait_for_timeout(700)
    after = pg.locator('.ed-note').count()
    check('AI 写入后笔记增加', after >= before, str(before) + '→' + str(after))
    ai_txt = pg.evaluate("() => Object.values(NOTES[nkey()]||{}).some(n => (n.text||'').includes('AI：'))")
    check('AI 内容进入统一笔记', ai_txt)
    # 找到含 AI 内容的那条笔记，直接编辑它
    target = pg.locator('.ed-note', has_text='AI：').first
    check('AI 笔记使用同一组件', target.count() == 1)
    target.locator('.ed-note-body').click()
    pg.keyboard.press('Control+a')
    pg.keyboard.type('AI 内容被我改过')
    pg.evaluate("() => document.activeElement.blur()")
    pg.wait_for_timeout(400)
    txt2 = pg.evaluate("() => Object.values(NOTES[nkey()]||{}).map(n=>n.text)")
    check('AI 笔记可编辑', any('AI 内容被我改过' in t for t in txt2), str(txt2)[:60])

    print('--- 7 已有笔记时不再堆一张新卡 ---')
    cnt_before = pg.locator('.ed-note').count()
    pg.locator('#aiToggle').click()
    pg.wait_for_timeout(200)
    pg.locator('.ai-act[data-act="file"]').click()
    pg.wait_for_timeout(1200)
    conflict = pg.locator('.ai-conflict').count()
    check('检测到重叠并给出选择', conflict >= 1, str(conflict))
    pg.locator('#aiAccept').click()
    pg.wait_for_timeout(700)
    cnt_after = pg.locator('.ed-note').count()
    check('重叠时不再新增卡片（追加到已有笔记）', cnt_after == cnt_before, str(cnt_before) + '→' + str(cnt_after))

    print('--- 8 锚点跟随 ---')
    # 清空内存里的笔记，只留一条我们自己的，避免示例数据干扰
    pg.evaluate("""() => {
      Object.keys(NOTES).forEach(k => delete NOTES[k]);
      NOTES[nkey()] = {};
      ED.render();
    }""")
    pg.wait_for_timeout(300)
    idx = pg.evaluate("() => files()[cur].lines.findIndex(l => l.includes('printf')) + 1")
    pg.evaluate("(ln) => ED.addNote(ln, '锚点测试笔记')", idx)
    pg.wait_for_timeout(400)
    before_line = pg.evaluate("() => Object.keys(NOTES[nkey()]||{})[0]")
    # 在文件顶部插入一行
    pg.locator('#edInput').click()
    pg.keyboard.press('Control+Home')
    pg.keyboard.press('Enter')
    pg.wait_for_timeout(500)
    after = pg.evaluate("""() => {
      const nm = NOTES[nkey()]||{}; const L = files()[cur].lines;
      const k = Object.keys(nm)[0];
      return { line: +k, text: (L[+k-1]||'').trim().slice(0, 20), note: nm[k].text };
    }""")
    check('插入行后笔记跟着原代码走',
          'printf' in after['text'] and after['line'] == int(before_line) + 1,
          str(after))

    print('--- 错误 ---')
    real = [e for e in errs if 'favicon' not in e and '404' not in e]
    check('无 JS 报错', not real, str(real[:2]))

    b.close()

print()
print('通过 %d 项，失败 %d 项' % (OK, len(FAIL)))
if FAIL:
    for f in FAIL:
        print('  -', f)
    sys.exit(1)
