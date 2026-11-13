"""Real Google Chrome acceptance tests for the EditorFolding integration.

Run with a server already serving this directory on port 8720:
    python verify-vscode-folding.py
Requires playwright and installed Google Chrome (never substitutes bundled Chromium).
Each T01--T26 gets a fresh browser page, storage context and model. Assertions
express required behavior, not implementation-specific exceptions. Unsupported
word wrapping is a failure. Exit 1 means acceptance failures, exit 2 setup failure.
Only generated artifacts are the two explicitly requested docs screenshots.
"""
from pathlib import Path
import sys
import traceback
from playwright.sync_api import sync_playwright

URL = 'http://127.0.0.1:8720/index.html'
ROOT = Path(__file__).resolve().parent
NESTED = [
    'function outer() {',
    '    let alpha = 1;',
    '    if (alpha) {',
    '        while (alpha) {',
    '            alpha--;',
    '        }',
    '    }',
    '}',
    'function sibling() {',
    '    return 2;',
    '}',
    'const tail = 3;',
]
DEFAULTS = {
    'folding': True, 'foldingStrategy': 'indentation',
    'showFoldingControls': 'always', 'foldingHighlight': True,
    'unfoldOnClickAfterEndOfLine': False, 'tabSize': 4, 'indentSize': 4,
    'wordWrap': 'off', 'foldingMaximumRegions': 5000,
    'guides': {'indentation': True, 'highlightActiveIndentation': True,
               'bracketPairs': False, 'bracketPairsHorizontal': 'active',
               'highlightActiveBracketPair': True},
}


def require(condition, description, actual=None):
    if not condition:
        raise AssertionError(description + (f'; actual={actual!r}' if actual is not None else ''))


class Fixture:
    def __init__(self, browser, name, lines=None, lang='javascript'):
        self.context = browser.new_context(viewport={'width': 1500, 'height': 950},
                                          permissions=['clipboard-read', 'clipboard-write'])
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda exc: self.errors.append(str(exc)))
        self.page.goto(URL, wait_until='load')
        self.page.wait_for_function('window.ED && window.EditorFolding && window.FoldingUI && window.EditorGuides')
        self.page.evaluate('''([lines,lang,name,options]) => {
            files()[name] = {path:'acceptance/'+name,lang,lines}; cur=name;
            EditorFolding.configure(options); ED.render();
            const ta=document.getElementById('edInput');
            ta.focus(); ta.scrollTop=0;ta.scrollLeft=0;ta.setSelectionRange(0,0);
            ta.dispatchEvent(new Event('keyup',{bubbles:true}));
        }''', [lines if lines is not None else NESTED, lang, name, DEFAULTS])
        self.settle()

    def settle(self):
        self.page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        self.page.wait_for_timeout(550)  # Wait for the documented .5s icon opacity transition.

    def configure(self, **options):
        self.page.evaluate('(options) => EditorFolding.configure(options)', options)
        self.settle()

    def state(self):
        return self.page.evaluate('''() => ({
            regions:EditorFolding.state().regions.map(r=>({start:r.startLine,end:r.endLine,collapsed:r.isCollapsed,depth:r.depth})),
            map:ED.getFoldView().map.map(e=>e.model),
            model:files()[cur].lines.slice(), text:document.getElementById('edInput').value,
            gutter:document.getElementById('edGutter').textContent.trim().split('\\n').map(Number),
            selection:ED.getModelSelection(),readonly:document.getElementById('edInput').readOnly
        })''')

    def collapsed(self):
        return [r['start'] for r in self.state()['regions'] if r['collapsed']]

    def control(self, line):
        return self.page.locator(f'.fold-control[data-line="{line + 1}"]')

    def click(self, line, modifiers=None):
        self.control(line).click(modifiers=modifiers or [])
        self.settle()

    def command(self, command):
        self.page.evaluate('(cmd) => EditorFolding.command(cmd)', command)
        self.settle()

    def caret(self, line, col=0):
        self.page.evaluate('''([line,col]) => {
            const lines=files()[cur].lines;
            const pos=lines.slice(0,line).reduce((n,s)=>n+s.length+1,0)+col;
            ED.setModelSelection(pos,pos);const ta=document.getElementById('edInput');
            ta.focus();ta.dispatchEvent(new Event('keyup',{bubbles:true}));
        }''', [line, col])
        self.settle()

    def select(self, start, end):
        self.page.evaluate('''([a,b]) => {
            ED.setModelSelection(a,b); document.getElementById('edInput').focus();
        }''', [start, end])
        self.settle()

    def guides(self):
        return self.page.evaluate('''() => [...document.querySelectorAll('.core-guide')].map(el=>{
            const b=el.getBoundingClientRect(); const cs=getComputedStyle(el);
            return {model:+el.dataset.model,row:+el.dataset.row,level:+el.dataset.level,
                indent:el.classList.contains('core-guide-indent'),active:el.classList.contains('indent-active'),
                vertical:el.classList.contains('vertical'),x:b.x,y:b.y,w:b.width,h:b.height,
                color:cs.boxShadow,pointer:cs.pointerEvents};
        })''')

    def metrics(self):
        return self.page.evaluate('''() => {
            const ta=document.getElementById('edInput'),pre=document.getElementById('edHl');
            const b=ta.getBoundingClientRect(),p=pre.getBoundingClientRect(),cs=getComputedStyle(pre);
            const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=cs.font;
            return {x:b.x,y:b.y,w:b.width,h:b.height,left:p.left+parseFloat(cs.paddingLeft),
                top:p.top+parseFloat(cs.paddingTop),lh:parseFloat(cs.lineHeight),cw:ctx.measureText(' ').width};
        }''')

    def check_errors(self):
        require(not self.errors, 'No uncaught browser JavaScript errors', self.errors)

    def close(self):
        self.context.close()


def t01(f):
    initial = f.state()
    require([(r['start'],r['end']) for r in initial['regions']] == [(0,6),(2,5),(3,4),(8,9)],
            'Zero-based indentation ranges must match exact fixture bounds', initial['regions'])
    f.click(0)
    folded=f.state()
    require(folded['map']==[0,7,8,9,10,11], 'Fold hides body without inserting a fake model row', folded['map'])
    require(folded['model']==NESTED and not folded['readonly'], 'Fold preserves editable model')
    require(f.page.locator('.fold-placeholder[data-model="0"]').count()==1, 'Inline folded placeholder exists')
    require(f.control(0).get_attribute('aria-expanded')=='false', 'Collapsed control exposes ARIA state')
    icon=f.control(0).locator('.fold-codicon').inner_text()
    require(icon=='\ueab6', 'Collapsed codicon is chevron-right', icon)
    f.click(0)
    require(f.state()['map']==list(range(len(NESTED))), 'Unfold restores every original row')
    require(f.control(0).locator('.fold-codicon').inner_text()=='\ueab4', 'Expanded icon is chevron-down')


def t02(f):
    f.click(3);f.click(2);f.click(0)
    require(f.collapsed()==[0,2,3], 'All nested collapsed states retained',f.collapsed())
    f.click(0)
    require(f.collapsed()==[2,3] and f.state()['map']==[0,1,2,6,7,8,9,10,11],
            'Unfold outer preserves collapsed child projection',f.state())
    f.click(2)
    require(f.collapsed()==[3] and 4 not in f.state()['map'] and 5 in f.state()['map'],
            'Unfold child preserves collapsed grandchild',f.state())


def t03(f):
    f.click(2);f.click(8)
    require(f.collapsed()==[2,8], 'Independent siblings both collapse',f.collapsed())
    f.click(2)
    require(f.collapsed()==[8] and 9 not in f.state()['map'] and 4 in f.state()['map'],
            'Expanding one sibling does not expand other sibling',f.state())


def t04(f):
    actual=f.page.locator('.fold-control').evaluate_all('(els)=>els.map(e=>+e.dataset.line)')
    require(actual==[1,3,4,9], 'No arrows on leaves, blank lines, closers or EOF',actual)
    # A separate fresh model containing only invalid candidates.
    f.page.evaluate('''() => {
        files().invalid={path:'invalid.js',lang:'javascript',lines:['const x = "{";','// {','', '}', 'plain']};
        cur='invalid';ED.render();
    }''')
    f.settle()
    require(f.page.locator('.fold-control').count()==0, 'Strings/comments/unmatched braces do not create arrows')


def t05(f):
    f.configure(showFoldingControls='mouseover')
    f.page.mouse.move(1490,5);f.settle()
    hidden=f.control(0).locator('.fold-codicon').evaluate('(e)=>getComputedStyle(e).opacity')
    require(float(hidden)==0, 'Expanded arrows hidden away from gutter',hidden)
    f.page.locator('.ed-gutter').hover();f.settle()
    shown=f.control(0).locator('.fold-codicon').evaluate('(e)=>getComputedStyle(e).opacity')
    require(float(shown)==1, 'Gutter hover reveals expanded arrows',shown)


def t06(f):
    f.configure(showFoldingControls='mouseover');f.click(2)
    f.page.mouse.move(1490,5);f.settle()
    opacity=f.control(2).locator('.fold-codicon').evaluate('(e)=>getComputedStyle(e).opacity')
    require(float(opacity)==1, 'Collapsed arrows remain visible without gutter hover',opacity)
    marker=f.page.locator('.fold-placeholder[data-model="2"]')
    b=marker.bounding_box();f.page.mouse.click(b['x']+b['width']/2,b['y']+b['height']/2);f.settle()
    require(f.collapsed()==[], 'Clicking inline folded placeholder unfolds actual model region',f.collapsed())


def t07(f):
    f.click(0,['Shift'])
    require(f.collapsed()==[2,3], 'Shift-click first collapses descendants while retaining parent',f.collapsed())
    f.click(0,['Shift'])
    require(f.collapsed()==[0,2,3], 'Second Shift-click collapses parent after descendants',f.collapsed())
    f.click(0,['Shift'])
    require(f.collapsed()==[], 'Shift-click collapsed parent expands descendants recursively',f.collapsed())


def t08(f):
    f.click(2,['Alt'])
    require(f.collapsed()==[8], 'Alt-click folds unrelated sibling, excludes ancestors and descendants',f.collapsed())
    f.click(2,['Alt'])
    require(f.collapsed()==[], 'Alt-click again unfolds unrelated folded siblings',f.collapsed())


def t09(f):
    b=f.control(2).bounding_box();m=f.metrics()
    f.page.mouse.move(b['x']+b['width']/2,b['y']+b['height']/2);f.page.mouse.down()
    f.page.mouse.move(m['x']+180,m['y']+180,steps=12);f.page.mouse.up();f.settle()
    require(f.collapsed()==[], 'Arrow drag released in text must cancel folding',f.collapsed())


def t10(f):
    b=f.control(2).bounding_box();x=b['x']+b['width']/2;y=b['y']+b['height']/2
    f.page.mouse.move(x,y);f.page.mouse.down();f.page.mouse.move(x+200,y+100,steps=10)
    f.page.mouse.move(x,y,steps=10);f.page.mouse.up();f.settle()
    require(f.collapsed()==[], 'A drag that leaves and returns to arrow must remain cancelled',f.collapsed())


def t11(f):
    b=f.page.locator('#edGutter').bounding_box();m=f.metrics()
    x=b['x']+b['width']/2
    f.page.mouse.move(x,m['top']+m['lh']*1.5);f.page.mouse.down()
    f.page.mouse.move(x,m['top']+m['lh']*4.5,steps=12);f.page.mouse.up();f.settle()
    actual=f.state()['selection']
    expected_start=len(NESTED[0])+1
    expected_end=sum(len(s)+1 for s in NESTED[:5])
    require(actual['start']==expected_start and actual['end']==expected_end,
            'Line-number drag selects complete model lines 2 through 5 in textarea',actual)
    require(f.collapsed()==[], 'Line number dragging must not toggle folding')


def t12(f):
    m=f.metrics();f.page.mouse.move(m['left']+1,m['top']+m['lh']/2);f.page.mouse.down()
    f.page.mouse.move(m['left']+180,m['top']+m['lh']*4.5,steps=20);f.page.mouse.up();f.settle()
    s=f.state()['selection']
    require(s['end']>s['start'] and '\n' in '\n'.join(NESTED)[s['start']:s['end']],
            'Text drag makes a genuine multiline textarea selection',s)
    require(f.collapsed()==[], 'Text drag does not fold')
    require(all(g['pointer']=='none' for g in f.guides()), 'Guide overlay never intercepts text pointer events')


def t13(f):
    m=f.metrics();f.page.mouse.dblclick(m['left']+m['cw']*11,m['top']+m['lh']/2);f.settle()
    s=f.state()['selection'];selected='\n'.join(NESTED)[s['start']:s['end']]
    require(selected=='outer', 'Double-click selects identifier, not fold region',selected)
    require(f.collapsed()==[], 'Double-click text never folds')


def t14(f):
    gs=[g for g in f.guides() if g['indent'] and g['model']==4]
    m=f.metrics()
    require([g['level'] for g in gs]==[1,2,3,4], 'Leaf gets ancestor plus own-level indentation guide columns',gs)
    icon=f.control(0).locator('.fold-codicon').bounding_box()
    for g in gs:
        expected=m['left']+(g['level']-1)*4*m['cw']+m['cw']/2
        require(abs(g['x']-expected)<1, f'Level {g["level"]} sits at its indent cell origin',(g['x'],expected))
    require(icon['x']+icon['width']<min(g['x'] for g in gs), 'Outer guide is right of visible arrow, not its hit target')
    require(not any(g['model']==7 and g['indent'] for g in f.guides()), 'Indent guides stop before outer closing brace')


def t15(f):
    f.caret(4,12)
    active=[g for g in f.guides() if g['indent'] and g['active']]
    require([(g['model'],g['level']) for g in active]==[(4,3)], 'Innermost active indentation only',active)
    f.caret(2)
    active=[g for g in f.guides() if g['indent'] and g['active']]
    require([(g['model'],g['level']) for g in active]==[(3,2),(4,2),(5,2)], 'Header activates entire child indentation scope',active)
    f.configure(guides={'highlightActiveIndentation':False})
    require(not any(g['active'] for g in f.guides()), 'Disabling active indent removes all active guide marks')


def t16(f):
    f.configure(guides={'bracketPairs':True,'bracketPairsHorizontal':False})
    gs=[g for g in f.guides() if g['vertical']]
    require(any(not g['indent'] for g in gs), 'Bracket guides actually rendered')
    duplicates=[]
    for i,a in enumerate(gs):
        for b in gs[i+1:]:
            if a['model']==b['model'] and abs(a['x']-b['x'])<0.75:
                duplicates.append((a,b))
    require(not duplicates, 'Bracket/indent vertical segments never duplicate same source column',duplicates)


def t17(f):
    baseline=[(g['model'],g['level'],round(g['x'],2)) for g in f.guides()]
    f.configure(guides={'bracketPairs':True})
    require(any(not g['indent'] for g in f.guides()), 'Bracket toggle on creates guides')
    f.configure(guides={'bracketPairs':False})
    actual=[(g['model'],g['level'],round(g['x'],2)) for g in f.guides()]
    require(actual==baseline, 'Bracket toggle off restores original independent indentation guides',(baseline,actual))
    f.configure(guides={'indentation':False,'bracketPairs':False})
    require(f.guides()==[], 'Both guide systems disabled removes all segments')
    require(f.page.locator('.fold-control').count()==4, 'Guide toggles do not disable fold controls')


def t18(f):
    gs=f.guides()
    models=sorted(set(g['model'] for g in gs if g['indent']))
    require(models==[2,3,4,5], 'Internal JavaScript blank continues scope; leading/trailing blanks remain clear',models)
    f.click(1)
    require(f.state()['map']==[0,1,6,7], 'Blank lines inside folded block disappear without fake rows',f.state()['map'])


def t19(f):
    f.click(2);f.caret(9,4)
    f.page.keyboard.type('X');f.settle()
    expected=NESTED.copy();expected[9]='    Xreturn 2;'
    require(f.state()['model']==expected, 'Typing after folded block edits correct model line, hidden text unchanged',f.state()['model'])
    require(f.collapsed()==[2], 'Unrelated fold remains collapsed through edit',f.collapsed())
    f.caret(2,len(NESTED[2]));f.page.keyboard.type(' // header');f.settle()
    require(f.state()['model'][2]==NESTED[2]+' // header' and f.state()['model'][4]==NESTED[4],
            'Editing folded header preserves hidden child text',f.state()['model'])


def t20(f):
    f.click(2)
    start=sum(len(s)+1 for s in NESTED[:2]);end=sum(len(s)+1 for s in NESTED[:7])
    f.select(start,end);f.page.keyboard.press('Backspace');f.settle()
    expected=NESTED[:2]+NESTED[7:]
    require(f.state()['model']==expected, 'Deleting selection across fold deletes hidden lines exactly once',f.state()['model'])
    require(all(r['end']<len(expected) for r in f.state()['regions']), 'No stale out-of-bounds regions after deletion')


def t21(f):
    f.click(2)
    start=sum(len(s)+1 for s in NESTED[:2]);end=sum(len(s)+1 for s in NESTED[:7])
    f.select(start,end);f.page.keyboard.press('Tab');f.settle()
    expected=NESTED.copy()
    for i in range(2,7):expected[i]='    '+expected[i]
    require(f.state()['model']==expected, 'Tab over folded selection indents every selected model line, including hidden lines',f.state()['model'])
    f.page.keyboard.press('Control+z');f.settle()
    require(f.state()['model']==NESTED and f.collapsed()==[2], 'Undo folded indent restores model and fold state')


def t22(f):
    f.click(3);f.click(2)
    start=sum(len(s)+1 for s in NESTED[:2]);end=sum(len(s)+1 for s in NESTED[:7])
    f.select(start,end);f.page.keyboard.press('Backspace');f.settle()
    deleted=f.state()['model']
    f.page.keyboard.press('Control+z');f.settle()
    require(f.state()['model']==NESTED and f.collapsed()==[2,3], 'Undo deletion restores text and nested collapsed states',f.state())
    f.click(2)
    require(f.collapsed()==[3] and 4 not in f.state()['map'], 'Restored child fold remains functional after undo')
    f.page.keyboard.press('Control+y');f.settle()
    require(f.state()['model']==deleted, 'Redo removes restored nested text again',f.state()['model'])


def t23(f):
    f.click(2);f.click(8)
    s=f.state()
    require(s['gutter']==[1,2,3,7,8,9,11,12], 'Gutter displays original model numbers after sibling folding',s['gutter'])
    f.caret(11,6)
    require(f.page.evaluate('() => ED.caretLine()')==12, 'Caret reports model line, not projected row')
    require(s['gutter']==[i+1 for i in s['map']], 'Gutter and projection have one-to-one model row mapping')


def t24(f):
    f.page.evaluate('''() => {
        const t=document.getElementById('edInput');t.scrollTop=440;t.scrollLeft=0;
        t.dispatchEvent(new Event('scroll'));
    }''');f.settle()
    m=f.metrics();gs=f.guides();visible=[g for g in gs if g['model']==21 and g['level']==1]
    require(bool(visible), 'Scrolled model guide exists in viewport',gs[:3])
    require(abs(visible[0]['x']-(m['left']+m['cw']/2))<1 and abs(visible[0]['y']-(m['top']+21*m['lh']))<1,
            'Scrolled level-1 guide retains its indent cell origin and source-row height',visible)
    b=f.control(20).bounding_box()
    require(abs(b['y']-(m['top']+20*m['lh']))<1, 'Fold control stays vertically aligned under scroll',(b,m))
    before_left=m['left'];before_arrow_x=b['x']
    f.page.evaluate('''() => {const t=document.getElementById('edInput');t.scrollLeft=120;
        t.dispatchEvent(new Event('scroll'));}''');f.settle()
    require(abs(f.metrics()['left']-(before_left-120))<1,
            'Horizontal scrolling moves highlighted text by exact scroll offset',f.metrics())
    require(abs(f.control(20).bounding_box()['x']-before_arrow_x)<1,
            'Horizontal scrolling leaves folding controls fixed in gutter')
    f.page.evaluate('''() => {document.body.style.zoom='1.25';document.getElementById('edInput').scrollLeft=0;
        document.getElementById('edInput').dispatchEvent(new Event('scroll'));}''');f.settle()
    # CSS zoom exercises browser layout scaling; not a synthetic mutation of guide geometry.
    b=f.control(20).bounding_box();f.page.mouse.click(b['x']+b['width']/2,b['y']+b['height']/2);f.settle()
    require(20 in f.collapsed(), 'Zoomed and scrolled fold control still hits correct region',f.collapsed())
    g=f.guides()
    require(all(abs(a['y']-b['y'])>0.5 or abs(a['x']-b['x'])>0.5 for i,a in enumerate(g) for b in g[i+1:]),
            'Zoom creates no duplicated guide geometry')


def t25(f):
    require(len(f.state()['model'])==1000, 'Stress fixture has exactly 1000 model lines')
    f.command('editor.foldAll')
    require(len(f.collapsed())==100 and f.state()['map']==sum(([i*10,i*10+9] for i in range(100)),[]),
            'All 100 indentation regions fold; their dedented closing braces remain visible',f.state()['map'][:20])
    f.command('editor.unfoldAll')
    require(len(f.state()['map'])==1000, 'Unfold restores 1000 rows')
    f.configure(wordWrap='on')
    result=f.page.evaluate('''() => {
        const ta=document.getElementById('edInput'),pre=document.getElementById('edHl');
        return {wrap:ta.wrap,whiteSpace:getComputedStyle(ta).whiteSpace,
            overflow:ta.scrollWidth-ta.clientWidth,preWhiteSpace:getComputedStyle(pre).whiteSpace,
            scrollHeight:ta.scrollHeight,lineHeight:parseFloat(getComputedStyle(ta).lineHeight)};
    }''')
    require(result['wrap']!='off' and result['overflow']<=2 and result['whiteSpace']!='pre'
            and result['preWhiteSpace'] in ('pre-wrap','break-spaces')
            and result['scrollHeight']>1000*result['lineHeight'], 
            'wordWrap=on must really wrap long lines in textarea and highlight, not merely store option (unsupported is FAIL)',result)
    f.click(0)
    require(f.state()['map']==[0]+list(range(9,1000)),
            'Wrapped projection preserves all source model indices while folding exactly eight body lines',f.state()['map'][:15])


def t26(f):
    colors=[]
    f.click(3);f.caret(2)
    for theme in ('dark','light'):
        f.page.evaluate('''theme=>{document.documentElement.dataset.theme=theme;
            document.documentElement.dataset.preset=theme==='dark'?'graphite':'paper';EditorGuides.reset();}''',theme)
        f.page.mouse.move(1490,5);f.settle()
        colors.append(f.page.evaluate('''() => {
            const g=document.querySelector('.core-guide'),a=document.querySelector('.fold-codicon');
            return {guide:getComputedStyle(g).boxShadow,arrow:getComputedStyle(a).color,
                paper:getComputedStyle(document.documentElement).getPropertyValue('--paper'),
                font:getComputedStyle(a).fontFamily,opacity:getComputedStyle(a).opacity};
        }'''))
        path=ROOT/'docs'/f'vscode-current-{theme}.png'
        path.parent.mkdir(exist_ok=True)
        f.page.screenshot(path=str(path),full_page=True)
        print(f'  SCREENSHOT {path.relative_to(ROOT)}')
        require('codicon' in colors[-1]['font'].lower(), 'Controls use loaded codicon typeface',colors[-1])
        require(f.page.evaluate('() => document.fonts.check("16px codicon")'), 'Codicon font actually loaded')
        require(colors[-1]['guide']!='none' and colors[-1]['opacity']=='1', 'Guides and controls visible in both themes',colors[-1])
    require(colors[0]['paper']!=colors[1]['paper'] and colors[0]['guide']!=colors[1]['guide'],
            'Dark/light guide color responds to actual theme change',colors)


CASES = [
    ('T01','fold/unfold, bounds, placeholder and icons',t01,None),
    ('T02','nested collapse state restoration',t02,None),
    ('T03','independent siblings',t03,None),
    ('T04','invalid arrow suppression',t04,None),
    ('T05','gutter hover controls',t05,None),
    ('T06','persistent collapsed controls and placeholder click',t06,None),
    ('T07','Shift-click descendants recursively',t07,None),
    ('T08','Alt-click other regions',t08,None),
    ('T09','drag cancellation outside arrow',t09,None),
    ('T10','drag cancellation after leaving and returning',t10,None),
    ('T11','line-number whole-line drag selection',t11,None),
    ('T12','multiline text drag and overlay hit testing',t12,None),
    ('T13','text double-click identifier selection',t13,None),
    ('T14','indent guide exact column positions',t14,None),
    ('T15','active indentation scope',t15,None),
    ('T16','bracket/indent guide deduplication',t16,None),
    ('T17','independent bracket/indent toggles',t17,None),
    ('T18','leading, interior and trailing blanks',t18,['','function blank() {','    alpha();','','    beta();','    gamma();','}','']),
    ('T19','editable projection and header edits',t19,None),
    ('T20','deletion across hidden model text',t20,None),
    ('T21','folded multiline indentation and undo',t21,None),
    ('T22','undo/redo nested deletion restoration',t22,None),
    ('T23','model gutter numbers and caret line',t23,None),
    ('T24','vertical/horizontal scroll and 125% layout zoom',t24,
     sum(([f'function block{i}() {{']+['    '+('x'*240)+';' for _ in range(8)]+['}'] for i in range(20)),[])),
    ('T25','1000-line stress and actual word wrap',t25,
     sum(([f'function block{i}() {{']+['    '+('x'*240)+';' for _ in range(8)]+['}'] for i in range(100)),[])),
    ('T26','dark/light themes, loaded icons and screenshots',t26,None),
]


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        pass
    failures=[]
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch(channel='chrome',headless=True,args=['--no-sandbox'])
        print(f'Google Chrome {browser.version}; target={URL}; cases={len(CASES)}')
        for ident,title,test,lines in CASES:
            fixture=None
            try:
                fixture=Fixture(browser,ident+'.js',lines)
                test(fixture)
                fixture.check_errors()
                print(f'PASS {ident} {title}')
            except Exception as exc:
                message=f'{ident} {title}: {type(exc).__name__}: {exc}'
                failures.append(message)
                print('FAIL '+message)
                if not isinstance(exc,AssertionError):
                    traceback.print_exc()
            finally:
                if fixture:
                    fixture.close()
        browser.close()
    print(f'\nRESULT: {len(CASES)-len(failures)}/{len(CASES)} PASS; {len(failures)} FAIL; 0 SKIP')
    for failure in failures:
        print('  - '+failure)
    return 1 if failures else 0


if __name__=='__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        print(f'SETUP FAIL: {type(exc).__name__}: {exc}',file=sys.stderr)
        sys.exit(2)
