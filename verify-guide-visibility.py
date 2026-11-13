import runpy
from pathlib import Path
from playwright.sync_api import sync_playwright
helpers=runpy.run_path(str(Path(__file__).with_name('verify-guide-placement.py')))

import io
from PIL import Image
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True)
    page=helpers['setup'](browser)
    for theme in ['light','dark']:
        page.evaluate('(t)=>document.documentElement.dataset.theme=t',theme)
        page.wait_for_timeout(500)
        result=helpers['guides'](page)
        assert len(result['guides'])==2, result
        normal=Image.open(io.BytesIO(page.screenshot())).convert('RGB')
        style=page.add_style_tag(content='.core-guide-indent.vertical{visibility:hidden!important}')
        hidden=Image.open(io.BytesIO(page.screenshot())).convert('RGB')
        for guide in result['guides']:
            x,y=round(guide['x']),round(guide['y'])
            changes=[(xx,normal.getpixel((xx,y)),hidden.getpixel((xx,y))) for xx in range(x-1,x+3) if normal.getpixel((xx,y))!=hidden.getpixel((xx,y))]
            assert changes, (theme,guide)
            print('PASS painted guide',theme,guide['left'],changes)
        style.evaluate('(e)=>e.remove()')
    browser.close()
