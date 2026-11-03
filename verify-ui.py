import json
from pathlib import Path
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':950})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(Path(__file__).with_name('index.html').resolve().as_uri())
    page.evaluate('localStorage.clear()')
    page.reload()
    page.wait_for_timeout(300)
    results={'theme':page.locator('html').get_attribute('data-theme'),'mode':page.locator('html').get_attribute('data-note-mode')}
    results['no_note_height']=page.locator('.line:not(.an)').first.evaluate('(e)=>e.getBoundingClientRect().height')
    results['inline']=page.locator('.line.an').first.evaluate('e=>{const c=e.querySelector(".cl").getBoundingClientRect(),n=e.querySelector(".nb").getBoundingClientRect(); return {codeRight:c.right,noteLeft:n.left,rowHeight:e.getBoundingClientRect().height}}')
    page.screenshot(path=str(Path(__file__).with_name('ui-light.png')))
    note=page.locator('.nb .body').first
    note.click()
    page.keyboard.press('End')
    page.keyboard.press('Shift+Enter')
    page.keyboard.insert_text('换行验证')
    page.keyboard.press('Enter')
    results['note_newline']=note.inner_text()
    results['note_blurred']=note.evaluate('e=>document.activeElement!==e')
    page.select_option('#noteMode','side')
    results['side_display']=page.locator('.line').first.evaluate('e=>getComputedStyle(e).display')
    page.select_option('#noteMode','plain')
    results['plain_note_visible']=page.locator('.nb').first.is_visible()
    page.select_option('#noteMode','inline')
    page.locator('#btnMenu').click()
    page.locator('#themeToggle').click()
    results['dark']=page.locator('html').get_attribute('data-theme')
    page.screenshot(path=str(Path(__file__).with_name('ui-dark.png')))
    page.reload()
    results['persisted_theme']=page.locator('html').get_attribute('data-theme')
    results['errors']=errors
    print(json.dumps(results,ensure_ascii=False,indent=2))
    assert results['theme']=='light' and results['mode']=='inline'
    assert results['no_note_height']<=32
    assert results['inline']['noteLeft']>results['inline']['codeRight']
    assert results['side_display']=='grid' and not results['plain_note_visible']
    assert results['note_blurred'] and '换行验证' in results['note_newline']
    assert not errors
    browser.close()
