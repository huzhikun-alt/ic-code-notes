/* DEPRECATED: 当前编辑器是 ed-monaco.js（Monaco 0.57），本文件不再加载 */
/* Folding controls/controller. Behavior port references: folding.ts:396-510, folding.css.
 * Canonical ranges live ONLY in EditorFolding; this layer contains no range detection. */
(() => {
  'use strict';
  let editor, main, gutter, controls, pending=null, frame=0, chord=false;
  const core=()=>window.EditorFolding;
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;draw();});};
  function geometry(){const ta=document.getElementById('edInput'),hl=document.getElementById('edHl');
    if(!ta||!hl)return null;const cs=getComputedStyle(hl);
    return {ta,hl,lineHeight:parseFloat(cs.lineHeight),padTop:parseFloat(cs.paddingTop),padLeft:parseFloat(cs.paddingLeft)};}
  function target(ev){
    const control=ev.target.closest&&ev.target.closest('.fold-control');
    if(control){const box=control.getBoundingClientRect();return {type:'gutter',line:+control.dataset.model,excluded:ev.clientX-box.left<4};}
    const g=geometry();if(!g||ev.target!==g.ta)return null;
    const v=ED.getFoldView(), box=main.getBoundingClientRect();
    const row=window.EditorViewLayout ? EditorViewLayout.rowAt(ev.clientY-box.top+g.ta.scrollTop)
      : Math.floor((ev.clientY-box.top+g.ta.scrollTop-g.padTop)/g.lineHeight);
    const entry=v&&v.map[row];if(!entry)return null;
    const marker=g.hl.querySelector('.fold-placeholder[data-model="'+entry.model+'"]');
    if(!marker)return null;
    const mr=marker.getBoundingClientRect();
    if(ev.clientX>=mr.left&&ev.clientX<=mr.right&&ev.clientY>=mr.top&&ev.clientY<=mr.bottom)return {type:'placeholder',line:entry.model};
    if(core().options.unfoldOnClickAfterEndOfLine&&ev.clientX>mr.right)return {type:'empty',line:entry.model};
    return null;
  }
  function down(ev){pending=null;if(ev.button!==0&&ev.button!==1)return;const hit=target(ev);
    if(!hit||hit.excluded)return;pending={...hit,x:ev.clientX,y:ev.clientY};
    // Project-specific suppression of textarea selection and browser middle-click autoscroll.
    if(hit.type==='gutter'||hit.type==='placeholder'){ev.preventDefault();}
  }
  function up(ev){const was=pending;pending=null;if(!was)return;const hit=target(ev);
    if(!hit||hit.line!==was.line||was.type==='gutter'&&hit.type!=='gutter')return;
    const r=core().state().regions.find(r=>r.startLine===hit.line);if(!r)return;
    if(was.type!=='gutter'&&!r.isCollapsed)return;
    core().toggle(r,ev.shiftKey||ev.button===1,ev.altKey);ev.preventDefault();schedule();
  }
  function keydown(ev){if(ev.target.id!=='edInput')return;
    const mod=ev.ctrlKey||ev.metaKey,k=ev.key.toLowerCase();let cmd;
    if(['control','meta','shift','alt'].includes(k))return;
    if(chord){chord=false;if(mod&&k==='0')cmd='foldAll';else if(mod&&k==='j')cmd='unfoldAll';else if(mod&&/^[1-9]$/.test(k))cmd='foldLevel'+k;}
    else if(mod&&k==='k'){chord=true;ev.preventDefault();ev.stopImmediatePropagation();return;}
    else if(mod&&ev.shiftKey&&ev.code==='BracketLeft')cmd='fold';
    else if(mod&&ev.shiftKey&&ev.code==='BracketRight')cmd='unfold';
    else if(mod&&!ev.altKey&&(k==='z'||k==='y')){ev.preventDefault();ev.stopImmediatePropagation();core().history(k==='y'||ev.shiftKey);return;}
    if(cmd){ev.preventDefault();ev.stopImmediatePropagation();core().command('editor.'+cmd);}
  }
  function bind(){const ta=document.getElementById('edInput');if(!ta)return false;
    const next=ta.closest('.ed');if(next===editor)return true;
    editor=next;main=ta.closest('.ed-main');gutter=editor.querySelector('.ed-gutter');
    gutter.style.position='relative';controls=document.createElement('div');controls.className='fold-controls';
    gutter.appendChild(controls);
    editor.addEventListener('mousedown',down,true);document.addEventListener('mouseup',up,true);
    document.addEventListener('mousemove',ev=>{if(pending&&Math.hypot(ev.clientX-pending.x,ev.clientY-pending.y)>5)pending=null;});
    let lineDrag = null;
    gutter.addEventListener('mousedown', ev => {
      if(ev.button!==0 || ev.target.closest('.fold-controls'))return;
      const g=geometry(), box=gutter.getBoundingClientRect();
      const row=window.EditorViewLayout ? EditorViewLayout.rowAt(ev.clientY-box.top+g.ta.scrollTop)
        : Math.floor((ev.clientY-box.top+g.ta.scrollTop-g.padTop)/g.lineHeight);
      lineDrag=Math.max(0,row);ev.preventDefault();g.ta.focus();selectRows(row,row);
    });
    function selectRows(a,b){const v=ED.getFoldView(),g=geometry();const ss=[];let pos=0;
      for(const text of v.lines){ss.push(pos);pos+=text.length+1;}
      const lo=Math.max(0,Math.min(a,b)),hi=Math.min(v.lines.length-1,Math.max(a,b));
      g.ta.setSelectionRange(ss[lo]||0,ss[hi+1]===undefined?g.ta.value.length:ss[hi+1],b<a?'backward':'forward');}
    document.addEventListener('mousemove',ev=>{if(lineDrag===null)return;const g=geometry(),box=gutter.getBoundingClientRect();
      const row=window.EditorViewLayout?EditorViewLayout.rowAt(ev.clientY-box.top+g.ta.scrollTop):Math.floor((ev.clientY-box.top+g.ta.scrollTop-g.padTop)/g.lineHeight);
      selectRows(lineDrag,row);});
    document.addEventListener('mouseup',()=>{lineDrag=null;});
    editor.addEventListener('keydown',keydown,true);
    gutter.addEventListener('mouseenter',()=>gutter.classList.add('fold-hover'));
    gutter.addEventListener('mouseleave',()=>gutter.classList.remove('fold-hover'));
    ta.addEventListener('scroll',schedule,{passive:true});ta.addEventListener('input',schedule);
    ta.addEventListener('click',schedule);ta.addEventListener('keyup',schedule);
    new ResizeObserver(schedule).observe(main);
    return true;
  }
  function draw(){if(!bind())return;const f=typeof hasFile==='function'&&hasFile()?files()[cur]:null;if(!f)return;
    core().beforeRender(f);const v=ED.getFoldView(),g=geometry();if(!v||!g)return;
    const cs=getComputedStyle(g.hl),count=String(f.lines.length).length;
    // Separate line-number and line-decoration lanes; widths respond to real font and digit count.
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=getComputedStyle(document.getElementById('edGutter')).font;
    const digits=Math.ceil(ctx.measureText('9'.repeat(Math.max(3,count))).width);
    // Monaco reserves a 16px folding lane in addition to lineDecorationsWidth.
    const lane=Math.ceil(g.lineHeight)+16;gutter.style.width=(digits+lane+2)+'px';
    main.style.setProperty('--ed-content-padding','0px');
    g.ta.style.paddingLeft='0px';g.hl.style.paddingLeft='0px';
    gutter.style.setProperty('--fold-lane-width',lane+'px');
    if(window.EditorViewLayout)EditorViewLayout.draw(v);
    editor.dataset.foldControls=core().options.showFoldingControls;
    controls.style.width=lane+'px';controls.style.fontSize=cs.fontSize;
    controls.replaceChildren();
    if(core().options.folding&&core().options.showFoldingControls!=='never'){
      const lookup=new Map(v.map.map((e,i)=>[e.model,i]));
      for(const r of core().state().regions){const row=lookup.get(r.startLine);if(row===undefined)continue;
        const top=(window.EditorViewLayout ? EditorViewLayout.lineTop(row) : g.padTop+row*g.lineHeight)-g.ta.scrollTop;
        if(top+g.lineHeight<0||top>main.clientHeight)continue;
        const el=document.createElement('span');el.className='fold-control'+(r.isCollapsed?' collapsed':'');
        el.dataset.model=r.startLine;el.dataset.line=r.startLine+1;el.setAttribute('role','button');
        el.setAttribute('aria-label',r.isCollapsed?'展开代码范围':'折叠代码范围');el.setAttribute('aria-expanded',String(!r.isCollapsed));
        el.style.top=top+'px';el.style.height=g.lineHeight+'px';
        const icon=document.createElement('i');icon.className='fold-codicon';icon.textContent=String.fromCharCode(r.isCollapsed?0xeab6:0xeab4);
        el.appendChild(icon);controls.appendChild(el);
      }
    }
    if(window.EditorGuides)EditorGuides.draw();
  }
  function start(){if(!window.ED||!core()){setTimeout(start,30);return;}ED.afterRender(schedule);draw();}
  window.FoldingUI={draw,schedule};
  window.__ED_FOLDS__={toggleFold(start){const r=core().state().regions.find(r=>r.startLine===start);if(r)core().toggle(r);},
    expandAll(){core().command('editor.unfoldAll');},ranges(){return core().state().regions.filter(r=>r.isCollapsed);}};
  // Toolbar model-text undo shares the keyboard transaction stack. Existing note/AI undo remains fallback.
  for(const [id,redo] of [['btnUndo',false],['btnRedo',true]]){
    const button=document.getElementById(id);if(button)button.addEventListener('click',ev=>{
      const s=core().state();if(s&&(redo?s.future:s.history).length){ev.preventDefault();ev.stopImmediatePropagation();core().history(redo);}
    },true);
  }
  window.addEventListener('resize',schedule);start();
})();
