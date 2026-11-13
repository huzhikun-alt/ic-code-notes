"""Additional command, marker, provider and file-state browser assertions."""
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(channel='chrome',headless=True)
 c=b.new_context(permissions=['clipboard-read','clipboard-write'])
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:8720/index.html');page.wait_for_function('window.FoldingUI')
 page.evaluate("""() => {files()['extra.py']={path:'extra.py',lang:'python',lines:['#region a','def first():','    if ready:','        run()','','def second():','    stop()','#endregion','tail()']};cur='extra.py';ED.render();}""")
 page.wait_for_timeout(150)
 assert page.evaluate("EditorFolding.state().regions.some(r=>r.kind==='region'&&r.startLine===0&&r.endLine===7)")
 page.evaluate("EditorFolding.command('editor.foldAll')")
 assert page.evaluate("EditorFolding.state().regions.every(r=>r.isCollapsed)")
 original=page.evaluate("files()[cur].lines.join(String.fromCharCode(10))")
 page.evaluate("document.getElementById('edInput').focus()")
 page.keyboard.press('Control+a');page.keyboard.press('Control+c')
 assert page.evaluate('navigator.clipboard.readText()').replace('\r\n','\n')==original
 page.keyboard.press('Control+k');page.keyboard.press('Control+j');page.wait_for_timeout(100)
 assert page.evaluate("EditorFolding.state().regions.every(r=>!r.isCollapsed)")
 page.evaluate("EditorFolding.command('editor.foldLevel2')")
 assert page.evaluate("EditorFolding.state().regions.filter(r=>r.isCollapsed).every(r=>r.depth===2)")
 page.evaluate("EditorFolding.configure({showFoldingControls:'never'})")
 page.wait_for_timeout(100)
 assert page.locator('.fold-control').count()==0
 assert page.evaluate("EditorFolding.state().regions.some(r=>r.isCollapsed)")
 page.evaluate("EditorFolding.configure({showFoldingControls:'always'});ED.gotoLine(2);EditorFolding.command('editor.foldRecursively')")
 assert page.evaluate("EditorFolding.state().regions.filter(r=>r.startLine>=1&&r.endLine<=3).every(r=>r.isCollapsed)")
 page.evaluate("files()['other.py']={path:'other.py',lang:'python',lines:['def x():','    ok()']};cur='other.py';ED.render();")
 page.evaluate("cur='extra.py';ED.render()")
 assert page.evaluate("EditorFolding.state().regions.some(r=>r.isCollapsed)")
 page.evaluate("EditorFolding.registerProvider('python',()=>[{startLine:1,endLine:3,kind:'function'}]);ED.render()")
 assert page.evaluate("EditorFolding.state().regions.length===1&&EditorFolding.state().regions[0].source==='provider'")
 assert not errors,errors
 print('PASS: markers, foldAll, full-source clipboard at hidden EOF, key chords, foldLevel2, never controls, recursive commands, file state, registered provider')
 b.close()
