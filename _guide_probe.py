from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    g = b.new_page(viewport={'width': 1500, 'height': 950})
    g.goto('http://127.0.0.1:8720/index.html')
    g.wait_for_function('window.ED && ED.editor()')
    g.wait_for_timeout(1000)
    print(g.evaluate("""() => {
      const e = ED.editor(), info = e.getLayoutInfo();
      const fi = e.getOption(monaco.editor.EditorOption.fontInfo);
      const rows = {};
      document.querySelectorAll('.core-guide-indent.vertical').forEach(n => {
        const r = n.getBoundingClientRect();
        const line = Math.round((r.top - e.getTopForLineNumber(1) + e.getScrollTop()) / 22) + 1;
        (rows[line] = rows[line] || []).push({x: Math.round(r.left*10)/10, w: Math.round(r.width*10)/10, h: Math.round(r.height*10)/10, cls: n.className});
      });
      return {contentLeft: info.contentLeft, contentWidth: info.contentWidth, lineHeight: e.getOption(monaco.editor.EditorOption.lineHeight),
        spaceWidth: fi && fi.spaceWidth, rows: Object.entries(rows).slice(0,12)};
    }"""))
    b.close()
