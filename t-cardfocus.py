from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 1500, 'height': 950})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://127.0.0.1:8720/', wait_until='domcontentloaded')
    pg.wait_for_timeout(1200)
    pg.evaluate('localStorage.clear()')
    pg.reload()
    pg.wait_for_timeout(900)

    card = pg.locator('.nb').first
    box = card.bounding_box()
    before = pg.locator('.nb').count()

    # 点卡片右侧空白（padding 区），不是文字
    pg.mouse.click(box['x'] + box['width'] - 3, box['y'] + box['height'] / 2)
    pg.wait_for_timeout(350)
    print('进入代码编辑(应为0):', pg.evaluate("() => document.querySelectorAll('.line.editing').length"))
    print('卡片获得焦点:', pg.evaluate("() => !!document.activeElement.closest('.nb')"))
    print('卡片高亮:', pg.evaluate("() => document.querySelectorAll('.nb.focused').length"))

    pg.keyboard.press('Backspace')
    pg.wait_for_timeout(500)
    print('退格前卡片数:', before, '→ 之后:', pg.locator('.nb').count())

    # 点卡片文字区仍然进入批注编辑
    card2 = pg.locator('.nb').first
    card2.locator('.body').click()
    pg.wait_for_timeout(300)
    print('点文字后焦点在正文:', pg.evaluate("() => document.activeElement.classList.contains('body')"))
    print('errors:', errs[:3])
    b.close()
