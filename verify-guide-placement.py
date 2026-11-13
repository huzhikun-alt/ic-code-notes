from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(channel='chrome',headless=True)
 page=b.new_page(viewport={'width':1500,'height':950})
 page.goto('http://127.0.0.1:8720/index.html');page.wait_for_function('window.FoldingUI&&window.EditorGuides')
 page.evaluate("""()=>{files()['placement.sv']={path:'placement.sv',lang:'verilog',lines:['module demo;','  function calculate;','    if (ready) begin','      result = value;','    end','  endfunction','endmodule']};cur='placement.sv';EditorFolding.configure({showFoldingControls:'always',indentSize:2,guides:{bracketPairs:false}});ED.render();}""")
 page.wait_for_timeout(600)
 result=page.evaluate("""()=>{const main=document.querySelector('.ed-main').getBoundingClientRect();const cw=EditorViewLayout.positionAt(0,1).left-EditorViewLayout.positionAt(0,0).left;return {main:main.left,outerExpected:main.left+cw/2,innerExpected:main.left+2*cw+cw/2,actual:[...document.querySelectorAll('.core-guide-indent')].map(e=>({level:+e.dataset.level,x:e.getBoundingClientRect().left}))};}""")
 assert all(abs(g['x']-result['outerExpected'])<1 for g in result['actual'] if g['level']==1),result
 assert all(abs(g['x']-result['innerExpected'])<1 for g in result['actual'] if g['level']==2),result
 page.evaluate("""()=>{files()['placement.yaml']={path:'placement.yaml',lang:'yaml',lines:['- id: a','  config:','    nested:','      deep: 1','- id: b']};cur='placement.yaml';EditorFolding.configure({showFoldingControls:'always',indentSize:2,guides:{bracketPairs:false}});ED.render();}""")
 page.wait_for_timeout(600)
 yaml=page.evaluate("""()=>{const rows={};document.querySelectorAll('.core-guide-indent').forEach(e=>{const k=e.dataset.model;(rows[k]=rows[k]||[]).push(Math.round(e.getBoundingClientRect().left));});return rows;}""")
 assert len(set(yaml['3']))==4,('Nested line must show ancestors plus its own indent column',yaml)
 page.locator('#code .ed').screenshot(path='docs/guide-placement-updated.png')
 print('PASS first-image cell-origin guides with own-level column',result,yaml)
 b.close()
