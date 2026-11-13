from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(channel='chrome',headless=True)
 page=b.new_page(viewport={'width':1500,'height':950})
 page.goto('http://127.0.0.1:8720/index.html');page.wait_for_function('window.FoldingUI&&window.EditorGuides')
 page.evaluate("EditorFolding.configure({showFoldingControls:'always'})")
 page.wait_for_timeout(500)
 r=page.evaluate('''()=>{const g=document.querySelector('.ed-gutter');const box=g.getBoundingClientRect(),css=getComputedStyle(g,'::after');const icon=document.querySelector('.fold-codicon').getBoundingClientRect();const n=document.getElementById('edGutter');const range=document.createRange();range.setStart(n.firstChild,0);range.setEnd(n.firstChild,1);const nr=range.getBoundingClientRect();return {numberRight:nr.right,dividerLeft:box.right-parseFloat(css.right)-parseFloat(css.width),dividerRight:box.right-parseFloat(css.right),iconLeft:icon.left,iconRight:icon.right,codeLeft:document.querySelector('.ed-main').getBoundingClientRect().left,border:getComputedStyle(g).borderRightWidth};}''')
 assert r['numberRight']<=r['dividerLeft']<r['dividerRight']<=r['iconLeft']<r['iconRight']<r['codeLeft'],r
 assert r['border']=='0px',r
 page.locator('#code .ed').screenshot(path='docs/gutter-divider-updated.png')
 print('PASS number < divider < folding arrow < code',r)
 b.close()
