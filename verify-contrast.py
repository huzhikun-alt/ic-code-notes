import json
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = Path(__file__).with_name('index.html').resolve().as_uri()

READ = """
() => {
  const s = getComputedStyle(document.documentElement);
  const probe = document.createElement('span');
  document.body.appendChild(probe);
  const rgb = name => { probe.style.color=''; probe.style.color=s.getPropertyValue(name).trim();
    return getComputedStyle(probe).color; };
  const out = {
    paper: rgb('--paper'), soft: rgb('--surface-soft'), ink: rgb('--ink'),
    tx2: rgb('--tx2'), muted: rgb('--muted'), noteBg: rgb('--note-bg'),
    noteInk: rgb('--note-ink'), comBg: rgb('--com-bg'), comInk: rgb('--com-ink'),
    teal: rgb('--teal'), accent: rgb('--accent'), fx: rgb('--t-fx'),
    kw: rgb('--t-k'), str: rgb('--t-s')
  };
  probe.remove(); return out;
}
"""

CONTRAST = """
([fg,bg]) => {
  const parse = c => (c.match(/\\d+(\\.\\d+)?/g)||[]).slice(0,3).map(Number);
  const lum = rgb => rgb.map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);})
    .reduce((a,v,i)=>a+v*[0.2126,0.7152,0.0722][i],0);
  const a=parse(fg), b=parse(bg);
  if(a.length<3||b.length<3) return null;
  const la=lum(a), lb=lum(b);
  return Math.round(((Math.max(la,lb)+0.05)/(Math.min(la,lb)+0.05))*100)/100;
}
"""

PRESETS = ['paper','graphite','gruvbox-dark','gruvbox-light','nord',
           'solarized-dark','solarized-light','tokyonight','onedark']
PAIRS = [('ink_on_paper','ink','paper',7.0), ('ink_on_nav','ink','soft',7.0),
         ('tx2_on_paper','tx2','paper',4.5), ('muted_on_paper','muted','paper',4.0),
         ('note_on_card','noteInk','noteBg',4.5), ('comment_on_card','comInk','comBg',4.5),
         ('fx_on_paper','fx','paper',4.0), ('kw_on_paper','kw','paper',4.0),
         ('str_on_paper','str','paper',4.0)]

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--no-sandbox'])
    page = b.new_page(viewport={'width':1440,'height':900})
    page.goto(URL); page.evaluate('localStorage.clear()'); page.reload(); page.wait_for_timeout(250)

    report, failed = {}, []
    for preset in PRESETS:
        page.evaluate("(id)=>{document.documentElement.dataset.preset=id;}", preset)
        page.wait_for_timeout(90)
        tokens = page.evaluate(READ)
        res = {}
        for name, fg, bg, floor in PAIRS:
            ratio = page.evaluate(CONTRAST, [tokens[fg], tokens[bg]])
            res[name] = ratio
            if ratio is None or ratio < floor:
                failed.append(f'{preset}.{name}={ratio} (<{floor})')
        report[preset] = res

    for k, v in report.items():
        print(f"{k:17} " + "  ".join(f"{n.split('_')[0]}={x}" for n, x in v.items()))
    print('FAILED:', failed if failed else 'none')
    assert not failed, failed
    b.close()
