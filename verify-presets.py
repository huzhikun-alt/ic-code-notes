import json
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = Path(__file__).with_name('index.html').resolve().as_uri()

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--no-sandbox'])
    page = b.new_page(viewport={'width':1440,'height':900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(URL); page.evaluate('localStorage.clear()'); page.reload(); page.wait_for_timeout(300)
    r = {}

    # --- 1. hover card closes when clicking elsewhere ---
    page.locator('.fx', has_text='normalize').first.hover(); page.wait_for_timeout(300)
    r['tip_opens'] = page.locator('#tip').is_visible()
    page.locator('#tip .ds').click(); page.wait_for_timeout(100)
    page.keyboard.press('Escape')
    page.mouse.click(1100, 700); page.wait_for_timeout(250)
    r['tip_closes_on_outside_click'] = not page.locator('#tip').is_visible()

    # --- 2. palettes ---
    page.locator('#btnMenu').click(); page.wait_for_timeout(120)
    page.locator('#themeToggle').click(); page.wait_for_timeout(250)
    r['preset_dialog'] = page.locator('#mask').is_visible()
    r['preset_count'] = page.locator('.preset').count()
    r['preset_names'] = [n.inner_text().replace('\n', ' ') for n in page.locator('.preset').all()]
    page.locator('.preset[data-preset-id="gruvbox-dark"]').click(); page.wait_for_timeout(200)
    r['gruvbox_applied'] = page.evaluate("document.documentElement.dataset.preset")
    r['gruvbox_bg'] = page.evaluate("getComputedStyle(document.body).backgroundColor")
    page.locator('.preset[data-preset-id="nord"]').click(); page.wait_for_timeout(200)
    r['nord_accent'] = page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()")
    page.locator('.preset[data-preset-id="paper"]').click(); page.wait_for_timeout(150)
    page.locator('#dlgCancel').click(); page.wait_for_timeout(150)
    r['persisted'] = page.evaluate("localStorage.getItem('icn-preset')")

    # --- 3. typing a trailing comment converts it to a card ---
    page.locator('.line .src').nth(1).click(); page.wait_for_timeout(200)
    page.keyboard.press('End')
    page.keyboard.type('   # 手写的行末注释')
    page.keyboard.press('Enter'); page.wait_for_timeout(400)
    r['line2_text'] = page.locator('.line .src').nth(1).inner_text()
    cards = page.locator('.nb.cmt')
    r['comment_cards'] = cards.count()
    r['has_typed_comment'] = any('手写的行末注释' in t for t in [c.inner_text() for c in cards.all()])

    # string with # must NOT convert
    page.locator('.line .src').nth(2).click(); page.wait_for_timeout(200)
    page.keyboard.press('End')
    page.keyboard.type(' my $s = "a#b";')
    page.keyboard.press('Enter'); page.wait_for_timeout(400)
    r['string_kept'] = 'a#b' in page.locator('.line .src').nth(2).inner_text()

    r['errors'] = errors
    print(json.dumps(r, ensure_ascii=False, indent=2))

    assert r['tip_opens'] and r['tip_closes_on_outside_click'], 'tooltip does not dismiss'
    assert r['preset_dialog'] and r['preset_count'] >= 8
    assert r['gruvbox_applied'] == 'gruvbox-dark'
    assert r['has_typed_comment'], 'typed trailing comment was not converted'
    assert r['string_kept'], 'string with # was wrongly treated as comment'
    assert not errors, errors
    b.close()
