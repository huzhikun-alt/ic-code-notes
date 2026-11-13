"""Real Chrome checks for outer gutter / inner opener-and-closer anchors."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True)
    page = browser.new_page(viewport={'width':1500,'height':950})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://127.0.0.1:8720/index.html')
    page.wait_for_function('window.__ED_GUIDES__ && window.ED')
    fixture = ['module demo;', '  function calculate;', '    if (ready) begin', '      result = value;', '    end', '  endfunction', 'endmodule']
    page.evaluate('''lines => {
      files()['anchors.sv'] = {path:'anchors.sv',lang:'verilog',lines};
      cur='anchors.sv'; ED.render();
      document.documentElement.dataset.preset='graphite';
      document.documentElement.dataset.theme='dark';
    }''', fixture)
    page.wait_for_timeout(200)
    data = page.evaluate('''() => {
      const main=document.querySelector('.ed-main').getBoundingClientRect();
      const nodes=[...document.querySelectorAll('#edHl span')];
      const charLeft=text => {const el=nodes.find(e=>e.textContent===text); const r=document.createRange();
        r.setStart(el.firstChild,0);r.setEnd(el.firstChild,1);return r.getBoundingClientRect().left;};
      return {origin:main.left+24, arrow:document.querySelector('.fold').getBoundingClientRect().right,
        fn:charLeft('function'), endfn:charLeft('endfunction'), iff:charLeft('if'), end:charLeft('end'),
        lines:[...document.querySelectorAll('.gline')].map(e=>({start:+e.dataset.start,end:+e.dataset.end,
          from:+e.dataset.from,to:+e.dataset.to,x:e.getBoundingClientRect().left}))};
    }''')
    outer, fn, inner = data['lines']
    assert data['arrow'] < outer['x'] < data['origin'], data
    assert abs(fn['x']-data['fn']) <= 1 and abs(fn['x']-data['endfn']) <= 1, data
    assert abs(inner['x']-data['iff']) <= 1 and abs(inner['x']-data['end']) <= 1, data
    assert (fn['from'],fn['to']) == (3,5), data
    assert (inner['from'],inner['to']) == (4,4), data
    assert (outer['from'],outer['to']) == (2,6), data
    page.locator('#code .ed').screenshot(path='docs/scope-anchors-expanded.png')
    page.evaluate('window.__ED_FOLDS__.toggleFold(1)')
    page.wait_for_timeout(200)
    assert page.evaluate('ED.isFolded() && files()[cur].lines.length===7')
    assert page.locator('.gline').count() == 2
    page.locator('#code .ed').screenshot(path='docs/scope-anchors-folded.png')
    page.evaluate('window.__ED_FOLDS__.expandAll()')
    page.wait_for_timeout(200)
    assert page.locator('.gline').count() == 3
    page.evaluate("ED.gotoLine(4)")
    page.keyboard.press('End')
    page.keyboard.type(' // edit')
    assert page.evaluate("files()[cur].lines[3].endsWith('// edit')")
    assert not errors, errors
    print('PASS: outer lane, inner opener/closer character alignment, endpoints, fold/expand, editing, no page errors')
    print(data)
    browser.close()
