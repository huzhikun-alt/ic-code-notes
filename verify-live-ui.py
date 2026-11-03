from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1440, 'height': 950})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('https://huzhikun-alt.github.io/ic-code-notes/', wait_until='domcontentloaded', timeout=60000)
    page.wait_for_function("document.documentElement.dataset.noteMode === 'inline'")
    assert page.locator('html').get_attribute('data-theme') == 'light'
    assert page.locator('#btnMenu').count() == 1
    assert page.locator('.top > button:not(#btnMenu)').count() == 0
    assert page.locator('#noteMode').count() == 1
    h = page.locator('.line:not(.an)').first.evaluate('e=>e.getBoundingClientRect().height')
    assert 28 <= h <= 32, h
    page.locator('#btnMenu').click()
    assert page.locator('#appMenu').is_visible()
    page.select_option('#noteMode', 'side')
    assert page.locator('#splitter').is_visible()
    page.select_option('#noteMode', 'inline')
    assert not page.locator('#splitter').is_visible()
    assert not errors, errors
    print('LIVE VERIFIED: one-menu toolbar, light default, inline/side modes, compact rows, zero JS errors')
    browser.close()
