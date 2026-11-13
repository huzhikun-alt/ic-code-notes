"""Real-Chrome checks for the Monaco-backed main editor."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    page = b.new_page(viewport={'width': 1500, 'height': 950})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://127.0.0.1:8720/index.html')
    page.wait_for_function('window.ED && ED.editor() && document.querySelector("#code .monaco-editor")', timeout=25000)
    page.wait_for_timeout(900)

    def state():
        return page.evaluate("""() => ({
          file: cur, lines: files()[cur].lines.length,
          model: ED.editor().getModel().getValue().split('\\n').length,
          lang: ED.editor().getModel().getLanguageId(),
          folds: document.querySelectorAll('.codicon-folding-expanded,.codicon-folding-collapsed').length,
          collapsed: document.querySelectorAll('.codicon-folding-collapsed').length,
          guides: document.querySelectorAll('.core-guide-indent').length,
          visible: document.querySelectorAll('.view-line').length
        })""")

    s0 = state()
    assert s0['model'] == s0['lines'] and s0['folds'] >= 1 and s0['guides'] >= 1, s0
    gp = page.evaluate("""() => {
      const e = ED.editor(), info = e.getLayoutInfo();
      const fi = e.getOption(monaco.editor.EditorOption.fontInfo);
      const g = document.querySelector('.core-guide-indent.vertical');
      const er = e.getDomNode().getBoundingClientRect();
      return {x:g.getBoundingClientRect().left, want:er.left + info.contentLeft + fi.spaceWidth / 2,
        space:fi.spaceWidth, contentLeft:info.contentLeft};
    }""")
    assert abs(gp['x'] - gp['want']) < 1, gp

    # Native folding: click the first expanded chevron.
    page.locator('.codicon-folding-expanded').first.click()
    page.wait_for_timeout(300)
    folded = state()
    assert folded['collapsed'] == 1 and folded['visible'] < s0['visible'], (folded, s0)
    page.locator('.codicon-folding-collapsed').first.click()
    page.wait_for_timeout(300)
    assert state()['collapsed'] == 0

    # Inline note + note editor.
    page.evaluate("() => ED.addNote(2, 'monaco-inline-note', {quiet:true})")
    page.wait_for_timeout(300)
    assert page.evaluate("() => [...document.querySelectorAll('.nl-inline')].some(e => e.textContent.includes('monaco-inline-note'))")
    page.evaluate("() => ED.openNoteEditor(2)")
    page.wait_for_timeout(200)
    assert page.locator('.nl-editor textarea').count() == 1
    page.locator('.nl-editor textarea').fill('monaco-note-edited')
    page.locator('.nl-editor textarea').blur()
    page.wait_for_timeout(400)
    assert page.evaluate("() => NOTES[nkey()][2].text") == 'monaco-note-edited'

    # AI note styling.
    page.evaluate("() => ED.putNote(3, 'ai-note', {author:'ai'})")
    page.wait_for_timeout(300)
    assert page.locator('.nl-inline.ai').count() >= 1

    # Selection API.
    sel = page.evaluate("""() => {
      const e = ED.editor();
      e.setSelection(new monaco.Selection(2, 1, 3, 1));
      return ED.selectedLines();
    }""")
    assert sel['from'] == 2 and sel['to'] == 3 and sel['text'], sel

    # Edit -> model sync -> native undo.
    page.evaluate("() => { const e = ED.editor(); e.setPosition({lineNumber:2,column:1}); e.focus(); }")
    page.keyboard.type('X')
    page.wait_for_timeout(300)
    assert page.evaluate("() => files()[cur].lines[1].startsWith('X')")
    page.keyboard.press('Control+z')
    page.wait_for_timeout(300)
    assert not page.evaluate("() => files()[cur].lines[1].startsWith('X')")

    # File switch.
    page.evaluate("() => { cur='sat_alu.sv'; ED.render(); }")
    page.wait_for_timeout(500)
    sat = state()
    assert sat['lang'] == 'verilog' and sat['model'] == sat['lines'] and sat['guides'] >= 1, sat

    # Theme and full-height line-number divider.
    page.evaluate("() => { document.documentElement.dataset.theme='light'; }")
    page.wait_for_timeout(400)
    bg = page.evaluate("() => getComputedStyle(document.querySelector('.monaco-editor')).backgroundColor")
    assert bg == 'rgb(251, 250, 247)', bg
    gutter = page.evaluate("""() => ({
      customDivider: document.querySelectorAll('.monaco-l0-divider').length,
      numsRight: document.querySelector('.line-numbers').getBoundingClientRect().right,
      foldLeft: document.querySelector('.codicon-folding-expanded,.codicon-folding-collapsed')?.getBoundingClientRect().left
    })""")
    assert gutter['customDivider'] == 0, gutter
    assert gutter['foldLeft'] is None or gutter['foldLeft'] >= gutter['numsRight'] + 2, gutter

    assert not errors, errors
    page.screenshot(path='docs/monaco-app-final.png')
    print('PASS Monaco main editor: native folding/guides, notes, AI, selection, edit/undo, file switch, theme, divider')
    print(s0, folded, sel, sat, gutter, gp)
    b.close()
