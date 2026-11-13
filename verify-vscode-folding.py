import runpy
from pathlib import Path
from playwright.sync_api import sync_playwright
helpers=runpy.run_path(str(Path(__file__).with_name('verify-guide-placement.py')))

with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True)
    page=helpers['setup'](browser)
    arrow=page.locator('.monaco-editor .codicon-folding-expanded').first
    arrow.wait_for(state='attached')
    def opacity():
        page.wait_for_timeout(650)
        return float(arrow.evaluate('(e)=>getComputedStyle(e).opacity'))
    page.mouse.move(0,0)
    before=opacity()
    assert before==0, before
    gutter=page.locator('.monaco-editor .margin-view-overlays')
    gutter.hover(position={'x':5,'y':10})
    hovered=opacity()
    assert hovered==1, hovered
    arrow.click()
    page.mouse.move(0,0)
    page.wait_for_timeout(650)
    collapsed=page.locator('.monaco-editor .codicon-folding-collapsed').first
    collapsed.wait_for(state='attached')
    after=float(collapsed.evaluate('(e)=>getComputedStyle(e).opacity'))
    assert after==1, after
    placeholder=page.locator('.monaco-editor .inline-folded').first
    content=placeholder.evaluate("e=>getComputedStyle(e,'::after').content")
    assert '⋯' in content, content
    print('PASS folding opacity:',before,hovered,after,'native ellipsis:',content)
    browser.close()
