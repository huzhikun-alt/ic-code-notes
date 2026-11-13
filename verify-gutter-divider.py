import runpy
from pathlib import Path
from playwright.sync_api import sync_playwright
helpers=runpy.run_path(str(Path(__file__).with_name('verify-guide-placement.py')))

import io
from PIL import Image
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True)
    page=helpers['setup'](browser)
    box=page.locator('.monaco-editor .margin').bounding_box()
    assert box and box['height']>100, box
    image=Image.open(io.BytesIO(page.screenshot())).convert('RGB')
    # Scan the entire gutter and its boundary with code, away from top/bottom borders.
    # A full-height divider must differ from gutter background on every sampled row.
    y0,y1=int(box['y'])+10,int(box['y']+box['height'])-10
    x0,x1=int(box['x']),int(box['x']+box['width'])
    background=image.getpixel((x0+1,y1-1))
    columns={x:sum(image.getpixel((x,y))!=background for y in range(y0,y1)) for x in range(x0+2,x1+2)}
    full=[x for x,n in columns.items() if n==y1-y0]
    print('gutter bounds',box,'background',background,'rows',y1-y0,'max painted rows',max(columns.values()),'full-height columns',full)
    assert not full, full
    print('PASS no full-height gutter divider')
    browser.close()
