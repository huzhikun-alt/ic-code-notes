"""Monaco DOM acceptance; run with this directory served on port 8720."""
import json
from playwright.sync_api import sync_playwright


def setup(browser):
    page = browser.new_page(viewport={"width":1500,"height":950}, device_scale_factor=1)
    page.goto('http://127.0.0.1:8720/index.html')
    page.wait_for_function('window.ED && ED.editor && ED.editor()')
    page.evaluate("""() => {
        files()['acceptance.yaml']={path:'acceptance.yaml',lang:'yaml',lines:[
            'root:', '    child:', '        value: 1', '    sibling: 2', 'tail: 3']};
        cur='acceptance.yaml'; ED.render();
        ED.editor().setPosition({lineNumber:1,column:1});
    }""")
    page.wait_for_function("document.querySelectorAll('.core-guide-indent.vertical').length > 0")
    page.wait_for_timeout(700)
    return page


def guides(page):
    return page.evaluate("""() => {
        const ed=ED.editor(), pos=ed.getScrolledVisiblePosition({lineNumber:3,column:1});
        const root=ed.getDomNode().getBoundingClientRect();
        const y=root.top+pos.top+pos.height/2;
        return {charWidth:ed.getOption(monaco.editor.EditorOption.fontInfo).spaceWidth,
            guides:[...document.querySelectorAll('.core-guide-indent.vertical')]
            .filter(e=>{const r=e.getBoundingClientRect();return r.top<=y && r.bottom>y})
            .map(e=>({left:parseFloat(e.style.left),transform:getComputedStyle(e).transform,
                x:e.getBoundingClientRect().x,y}))};
    }""")


def main():
    with sync_playwright() as p:
        browser=p.chromium.launch(channel='chrome',headless=True)
        page=setup(browser)
        result=guides(page)
        print(json.dumps(result),flush=True)
        lefts=sorted(set(g['left'] for g in result['guides']))
        assert len(lefts)==2, result
        assert all(abs(a-b*result['charWidth'])<=1 for a,b in zip(lefts,[0,4])), result
        assert all(g['transform']=='none' for g in result['guides']), result
        print('PASS two guides at character left edges, no transform')
        browser.close()

if __name__=='__main__':
    main()
