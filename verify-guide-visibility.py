"""Raster regression: guide must actually paint over the opaque gutter."""
import io
from PIL import Image
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(channel='chrome',headless=True)
 page=b.new_page(viewport={'width':1500,'height':950},device_scale_factor=1)
 page.goto('http://127.0.0.1:8720/index.html');page.wait_for_function('window.EditorGuides')
 for preset,theme in [('paper','light'),('graphite','dark')]:
  page.evaluate('''([preset,theme])=>{document.documentElement.dataset.preset=preset;document.documentElement.dataset.theme=theme;EditorFolding.configure({showFoldingControls:'always'});ED.render();}''',[preset,theme])
  page.wait_for_timeout(600)
  pos=page.evaluate('''()=>{const e=document.querySelector('.core-guide-indent');const r=e.getBoundingClientRect();return {x:r.x,y:r.y+r.height/2};}''')
  normal=Image.open(io.BytesIO(page.screenshot())).convert('RGB')
  page.evaluate("document.querySelector('.ed-guide-layer').style.visibility='hidden'")
  hidden=Image.open(io.BytesIO(page.screenshot())).convert('RGB')
  x,y=round(pos['x']),round(pos['y'])
  changes=[(xx,normal.getpixel((xx,y)),hidden.getpixel((xx,y))) for xx in range(x-1,x+3) if normal.getpixel((xx,y))!=hidden.getpixel((xx,y))]
  assert changes,('Guide exists in DOM but is not painted',preset,pos)
  page.evaluate("document.querySelector('.ed-guide-layer').style.visibility='visible'")
  page.locator('#code .ed').screenshot(path='docs/guides-visible-'+theme+'.png')
  print('PASS actual raster guide visible',preset,changes)
 b.close()
