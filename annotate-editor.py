"""Capture current editor and label positioning landmarks without altering app UI."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parent
with sync_playwright() as p:
 b=p.chromium.launch(channel='chrome',headless=True)
 page=b.new_page(viewport={'width':1500,'height':950},device_scale_factor=1)
 page.goto('http://127.0.0.1:8720/index.html')
 page.wait_for_function('window.FoldingUI && window.EditorGuides')
 page.evaluate('''() => {
 files()['position-demo.sv']={path:'position-demo.sv',lang:'verilog',lines:[
 'module demo;', '  function automatic calculate;', '    if (ready) begin',
 '      result = value;', '    end', '  endfunction', 'endmodule']};
 cur='position-demo.sv';document.documentElement.dataset.preset='graphite';
 document.documentElement.dataset.theme='dark';
 EditorFolding.configure({showFoldingControls:'always',tabSize:4,indentSize:2,guides:{indentation:true,bracketPairs:false}});ED.render();
 }''')
 page.wait_for_timeout(700)
 root=page.locator('#code .ed')
 data=page.evaluate('''() => {
 const root=document.querySelector('#code .ed').getBoundingClientRect();
 const main=document.querySelector('.ed-main').getBoundingClientRect();
 const gutter=document.querySelector('.ed-gutter').getBoundingClientRect();
 const arrow=document.querySelector('.fold-control').getBoundingClientRect();
 const spans=[...document.querySelectorAll('#edHl span')];
 const word=(text)=>{const e=spans.find(e=>e.textContent===text);const r=e.getBoundingClientRect();return {x:r.left-root.left,y:r.top-root.top,h:r.height};};
 const guide=[...document.querySelectorAll('.core-guide-indent')].map(e=>{const r=e.getBoundingClientRect();return {x:r.left-root.left,y:r.top-root.top};});
 return {main:main.left-root.left,gutter:gutter.width,arrow:{x:arrow.left-root.left+arrow.width/2,y:arrow.top-root.top+arrow.height/2},
 words:{module:word('module'),fn:word('function'),iff:word('if'),body:word('result'),end:word('end'),endfn:word('endfunction')},guide};
 }''')
 root.screenshot(path=str(ROOT/'docs/position-landmarks-raw.png'))
 b.close()

im=Image.open(ROOT/'docs/position-landmarks-raw.png').convert('RGB').crop((0,0,650,210))
scale=2
im=im.resize((im.width*scale,im.height*scale))
canvas=Image.new('RGB',(1540,1000),'#101820');canvas.paste(im,(160,160))
d=ImageDraw.Draw(canvas)
fontpath='C:/Windows/Fonts/msyh.ttc'
font=ImageFont.truetype(fontpath,24); small=ImageFont.truetype(fontpath,20); title=ImageFont.truetype(fontpath,30)
d.text((28,18),'请用编号指出：范围竖线的 X 位置，以及上下端点',font=title,fill='white')
d.text((28,64),'这是当前编辑器的真实截图；彩色标记仅用于沟通，不改变页面实现。',font=small,fill='#b9c8d7')
def point(x,y):return (160+x*scale,160+y*scale)
colors=['#ffce54','#69d2ff','#ff8e83','#a6e580','#d4a5ff','#ffb46b','#79e0c2','#f59ed0']
def badge(num,label,target,bx,by):
 color=colors[(num-1)%len(colors)]
 tx,ty=target
 d.line([(bx+18,by+18),(tx,ty)],fill=color,width=3)
 d.ellipse((tx-5,ty-5,tx+5,ty+5),fill=color)
 d.ellipse((bx,by,bx+36,by+36),fill=color)
 d.text((bx+9,by+1),str(num),font=font,fill='#101820')
 d.text((bx+45,by+1),label,font=small,fill=color)
w=data['words']; origin=data['main']
# Dedicated region boundaries, dashed vertical references.
for x,col in [(origin,'#ff8e83'),(w['fn']['x'],'#a6e580'),(w['iff']['x'],'#d4a5ff'),(w['body']['x'],'#ffb46b')]:
 xx,_=point(x,0)
 for yy in range(160,560,12):d.line((xx,yy,xx,yy+6),fill=col,width=2)
badge(1,'行号区域',point(12,27),20,110)
badge(2,'折叠箭头中心',point(data['arrow']['x'],data['arrow']['y']),370,110)
badge(3,'代码区左边界 / module 首字母',point(origin,w['module']['y']+8),790,110)
badge(4,'function 首字母列',point(w['fn']['x'],w['fn']['y']+8),20,600)
badge(5,'if 首字母列',point(w['iff']['x'],w['iff']['y']+8),430,600)
badge(6,'result 正文首字母列',point(w['body']['x'],w['body']['y']+8),850,600)
badge(7,'end 首字母（内层结束）',point(w['end']['x'],w['end']['y']+8),20,690)
badge(8,'endfunction 首字母',point(w['endfn']['x'],w['endfn']['y']+8),600,690)
d.text((30,800),'反馈示例：',font=font,fill='white')
d.text((30,845),'“外层线放在 ② 与 ③ 之间；内层线对齐 ④；从某行下缘画到某行上缘。”',font=small,fill='#d9e4ee')
d.text((30,895),'也可以直接在图上画出你要的竖线，再发回来。虚线只是坐标参考，不是期望的引导线。',font=small,fill='#b9c8d7')
canvas.save(ROOT/'docs/position-landmarks-numbered.png')
print('Created docs/position-landmarks-numbered.png')
