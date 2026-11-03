import json
from pathlib import Path
from playwright.sync_api import sync_playwright

PASTE = """(el, text) => {
  const data = new DataTransfer();
  data.setData('text/plain', text);
  el.dispatchEvent(new ClipboardEvent('paste', {bubbles:true, cancelable:true, clipboardData:data}));
}"""

SOURCE = 'my $s = "a#b"; # comment\n# first\n# second\nprint $s;'

with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width':1440,'height':950})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(Path(__file__).with_name('index.html').resolve().as_uri())
    page.evaluate('localStorage.clear()'); page.reload()

    # 1. 改内置示例 → 刷新后仍在（以前 usingCustomData 为 false 时会丢）
    page.locator('.line .src').nth(1).click()
    page.locator('.src[contenteditable=true]').fill('use strict; # persisted')
    page.locator('#savedText').click()
    page.reload()
    assert page.locator('.line .src').nth(1).inner_text() == 'use strict; # persisted', 'sample edit lost'

    # 2. 新建文件 → 第一行可见可编辑
    page.locator('#btnNewFile').click()
    page.locator('#mName').fill('workflow_check.pl')
    page.locator('#dlgOk').click()
    editor = page.locator('.src[contenteditable=true]')
    editor.wait_for(state='visible', timeout=8000)
    assert editor.evaluate('e=>e.getBoundingClientRect().height') >= 20, 'empty line has no height'

    # 3. 整段粘贴 → 拆成 4 行
    editor.evaluate(PASTE, SOURCE)
    page.wait_for_timeout(300)
    page.locator('#savedText').click()
    assert page.locator('.line').count() == 4, page.locator('.line').count()

    # 4. 摘注释 → 剩 2 行、2 张注释卡、字符串里的 # 保留
    page.locator('#btnMenu').click()
    page.locator('#btnExtract').click()
    page.wait_for_timeout(300)
    assert page.locator('.line').count() == 2
    assert 'a#b' in page.locator('.line .src').first.inner_text()
    cards = page.locator('.nb.cmt')
    assert cards.count() == 2, cards.count()
    assert cards.nth(1).inner_text().startswith('first\nsecond'), cards.nth(1).inner_text()

    # 5. 三种模式来回切 → 数据不丢
    for mode in ['side', 'plain', 'inline']:
        page.select_option('#noteMode', mode)
    assert cards.count() == 2

    # 6. 刷新 + 切回文件 → 内容还在
    page.reload()
    page.locator('.file', has_text='workflow_check.pl').click()
    assert page.locator('.line').count() == 2
    assert page.locator('.nb.cmt').count() == 2
    assert not errors, errors
    print(json.dumps({
        'sample_edit_persists': True,
        'new_file_first_line_visible': True,
        'paste_splits_into_lines': True,
        'string_hash_preserved': True,
        'comments_merged': True,
        'mode_switch_keeps_data': True,
        'errors': errors
    }, ensure_ascii=False, indent=2))
    browser.close()
