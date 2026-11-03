import json
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = Path(__file__).with_name('index.html').resolve().as_uri()

with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(URL); page.evaluate('localStorage.clear()'); page.reload()
    page.wait_for_timeout(300)
    r = {}

    # 1. toolbar collapsed into one menu
    r['top_buttons'] = page.locator('.top > button:not(#btnMenu)').count()
    r['menu_opens'] = (page.locator('#btnMenu').click() or page.locator('#appMenu').is_visible())
    r['menu_items'] = page.locator('#appMenu button:visible').all_inner_texts()
    page.keyboard.press('Escape'); page.wait_for_timeout(150)
    r['menu_closes'] = not page.locator('#appMenu').is_visible()

    # 2. no lost box in the reading area
    r['lostbox_in_body'] = page.locator('#code #lostbox, code #lostbox').count()

    # 3. code line vertically centered against a tall note
    tall = page.locator('.nb .body').first
    tall.click(); page.keyboard.press('End')
    for _ in range(2):
        page.keyboard.press('Shift+Enter'); page.keyboard.type('追加一行')
    page.keyboard.press('Enter'); page.wait_for_timeout(250)
    centred = page.evaluate("""() => {
      const rows=[...document.querySelectorAll('.line.an')];
      for (const row of rows) {
        const nb=row.querySelector('.nb'); if(!nb) continue;
        if (nb.getBoundingClientRect().height < 50) continue;
        const src=row.querySelector('.src').getBoundingClientRect();
        const n= nb.getBoundingClientRect();
        return Math.round((src.top+src.height/2) - (n.top+n.height/2));
      }
      return null;
    }""")
    r['centre_delta_px'] = centred

    # 4. note does not wrap without manual newline
    first = page.locator('.nb .body').first
    r['one_line_height'] = first.evaluate('e=>Math.round(e.getBoundingClientRect().height)')
    r['no_soft_wrap'] = first.evaluate('e=>e.getClientRects().length===1||e.scrollHeight<=32')

    # 5. note controls sit to the right of the card and never cover the text
    card = page.locator('.nb').first
    card.hover(); page.wait_for_timeout(250)
    tools = card.locator('.h')
    r['tools_opacity'] = tools.evaluate('e=>getComputedStyle(e).opacity')
    r['tools_outside_card'] = tools.evaluate("""e=>{
      const c=e.closest('.nb').getBoundingClientRect(), t=e.getBoundingClientRect();
      return t.left >= c.right - 1;
    }""")
    r['tools_clear_of_text'] = tools.evaluate("""e=>{
      const b=e.closest('.nb').querySelector('.body').getBoundingClientRect();
      const t=e.getBoundingClientRect();
      return t.left >= b.right - 1;
    }""")

    # 6. function tooltip is editable and saves
    page.locator('.fx', has_text='normalize').first.hover(); page.wait_for_timeout(350)
    desc = page.locator('#tip [data-role="desc"]')
    r['tip_editable'] = desc.get_attribute('contenteditable')
    desc.click(); page.keyboard.press('Control+A'); page.keyboard.type('改过的描述')
    page.keyboard.press('Enter'); page.wait_for_timeout(250)
    r['tip_saved'] = page.evaluate("()=>{const e=(LIB['perl']||[]).find(x=>x.name==='normalize');return e&&e.desc;}")

    # 7. lost notes moved into a dialog
    page.locator('#btnMenu').click(); page.wait_for_timeout(150)
    page.locator('#btnLost').click(); page.wait_for_timeout(250)
    r['lost_dialog_open'] = page.locator('#mask').is_visible()
    r['lost_rows'] = page.locator('.lostrow').count()
    page.locator('#dlgOk').click(); page.wait_for_timeout(150)

    # 8. nav typography
    r['nav_font_px'] = page.locator('.file').first.evaluate('e=>getComputedStyle(e).fontSize')
    r['nav_row_h'] = page.locator('.file').first.evaluate('e=>Math.round(e.getBoundingClientRect().height)')

    r['errors'] = errors
    print(json.dumps(r, ensure_ascii=False, indent=2))

    assert r['top_buttons'] == 0, 'toolbar buttons still visible'
    assert r['menu_opens'] and r['menu_closes']
    assert r['lostbox_in_body'] == 0
    assert centred is not None and abs(centred) <= 2, f'code line not centred: {centred}'
    assert r['tools_outside_card'] and r['tools_clear_of_text']
    assert r['tip_editable'] == 'true' and r['tip_saved'] == '改过的描述'
    assert r['lost_dialog_open'] and r['lost_rows'] == 1
    assert not errors, errors
    browser.close()
