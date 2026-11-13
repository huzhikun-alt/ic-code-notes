/* VS Code compatible folding core. Reference: 1745a4a6102e93173430b4b2debc1247a91cd036.
 * Indentation provider ported from Microsoft's MIT licensed indentRangeProvider.ts.
 * See docs/vscode-reference/LICENSE.txt. Projection/edit adapter is project-specific. */
(() => {
  'use strict';
  const options = {
    folding: true, foldingStrategy: 'auto', foldingHighlight: true,
    showFoldingControls: 'mouseover', unfoldOnClickAfterEndOfLine: false,
    tabSize: 4, indentSize: 4, wordWrap: 'off', foldingMaximumRegions: 5000,
    guides: {indentation:true, highlightActiveIndentation:true, bracketPairs:false,
      bracketPairsHorizontal:'active', highlightActiveBracketPair:true}
  };
  const banks = new Map(), providers = new Map();
  let serial = 0;
  const key = () => typeof nkey === 'function' ? nkey() : '';
  const current = () => typeof hasFile === 'function' && hasFile() ? files()[cur] : null;
  const indent = text => {
    let n=0; for (const c of text) {if(c===' ')n++; else if(c==='\t')n+=options.tabSize-n%options.tabSize; else return n;}
    return -1;
  };
  // Stateful scanner, not a brace regexp: strings, triple strings, multiline comments and templates are masked.
  function lex(lines, lang) {
    const clean=[], pairs=[], stack=[]; let mode='', quote='', triple=false, escaped=false;
    for(let line=0;line<lines.length;line++) {
      const src=lines[line]; let out='';
      for(let col=0;col<src.length;col++) {
        const c=src[col], n=src[col+1];
        if(mode==='comment') {out+=' '; if(c==='*'&&n==='/'){out+=' ';col++;mode='';} continue;}
        if(mode==='string') {
          out+=' ';
          if(escaped){escaped=false;continue;} if(c==='\\'){escaped=true;continue;}
          if(triple && src.slice(col,col+3)===quote.repeat(3)){out+='  ';col+=2;mode='';triple=false;}
          else if(!triple&&c===quote)mode='';
          continue;
        }
        if(c==='/'&&n==='*'&&lang!=='python'&&lang!=='perl'){mode='comment';out+='  ';col++;continue;}
        if((c==='/'&&n==='/'&&lang!=='python'&&lang!=='perl') || (c==='#'&&(lang==='python'||lang==='perl'))){out+=' '.repeat(src.length-col);break;}
        const numericTick=lang==='verilog'&&c==="'"&&/[bBoOdDhHsS01xXzZ{]/.test(n||'');
        if(!numericTick&&(c==='"'||c==="'"||c==='`'&&lang!=='verilog')) {
          quote=c; mode='string';triple=lang==='python'&&src.slice(col,col+3)===c.repeat(3);
          out+=' ';if(triple){out+='  ';col+=2;}continue;
        }
        out+=c;
        if('({['.includes(c)) stack.push({char:c,line,col,depth:stack.length});
        else if(')}]'.includes(c)) {
          const want={')':'(',']':'[','}':'{'}[c], top=stack[stack.length-1];
          if(top&&top.char===want){stack.pop();pairs.push({open:top,close:{line,col},depth:top.depth});}
        }
      }
      clean.push(out.padEnd(src.length,' ')); escaped=false;
      if(mode==='string'&&!triple&&quote!=='`')mode='';
    }
    return {clean,pairs};
  }
  // Official bottom-up indentation fallback, with language off-side and region markers.
  function indentationRanges(lines, lang) {
    const result=[], previous=[{indent:-1,endAbove:lines.length+1,line:lines.length+1}];
    for(let line=lines.length;line>0;line--) {
      const content=lines[line-1], amount=indent(content);let p=previous[previous.length-1];
      if(amount===-1){if(lang==='python')p.endAbove=line;continue;}
      const start=/^\s*(?:#|\/\/)\s*#?region\b/.test(content);
      const end=/^\s*(?:#|\/\/)\s*#?endregion\b/.test(content);
      if(start){let i=previous.length-1;while(i>0&&previous[i].indent!==-2)i--;
        if(i>0){previous.length=i+1;p=previous[i];result.push({startLine:line-1,endLine:p.line-1,kind:'region',source:'indent'});
          p.line=line;p.indent=amount;p.endAbove=line;continue;}}
      else if(end){previous.push({indent:-2,endAbove:line,line});continue;}
      if(p.indent>amount){do{previous.pop();p=previous[previous.length-1];}while(p.indent>amount);
        const last=p.endAbove-1;if(last-line>=1)result.push({startLine:line-1,endLine:last-1,kind:'region',source:'indent'});}
      if(p.indent===amount)p.endAbove=line;else previous.push({indent:amount,endAbove:line,line});
    }
    return result.reverse();
  }
  function normalize(ranges, count) {
    const sorted=ranges.filter(r=>Number.isInteger(r.startLine)&&Number.isInteger(r.endLine)&&r.startLine>=0&&r.endLine<count&&r.endLine>r.startLine)
      .sort((a,b)=>a.startLine-b.startLine||b.endLine-a.endLine);
    const out=[], stack=[];
    for(const r of sorted){while(stack.length&&stack[stack.length-1].endLine<r.startLine)stack.pop();
      if(out.length&&out[out.length-1].startLine===r.startLine)continue;
      if(stack.length&&r.endLine>stack[stack.length-1].endLine)continue;
      const item={...r,id:r.id||'fold-'+(++serial),kind:r.kind||'region',source:r.source||'provider',
        parentId:stack.length?stack[stack.length-1].id:null,children:[],depth:stack.length+1,isCollapsed:!!r.isCollapsed};
      if(stack.length)stack[stack.length-1].children.push(item.id);out.push(item);stack.push(item);
      if(out.length>=options.foldingMaximumRegions)break;
    }return out;
  }
  function state(f=current()) {
    if(!f)return null;let s=banks.get(key());
    if(!s){s={file:f,text:null,regions:[],history:[],future:[],projection:null};banks.set(key(),s);}return s;
  }
  function beforeRender(f) {
    const s=state(f);if(!s)return;const text=f.lines.join('\n');if(s.text===text)return;
    const provider=options.foldingStrategy!=='indentation'&&providers.get(f.lang);
    let ranges=null;
    if(provider){try{ranges=provider(f.lines,lex(f.lines,f.lang));}catch(error){console.warn('Folding provider failed; using indentation fallback',error);}}
    if(!Array.isArray(ranges))ranges=indentationRanges(f.lines,f.lang);
    const previous=s.regions;
    s.regions=normalize(ranges,f.lines.length);
    for(const r of s.regions){const old=previous.find(p=>p.startLine===r.startLine&&p.endLine===r.endLine);
      if(old){r.id=old.id;r.isCollapsed=old.isCollapsed;}}
    // Rebuild parent ids after restoring stable ids.
    const stack=[];for(const r of s.regions){r.children=[];while(stack.length&&stack[stack.length-1].endLine<r.startLine)stack.pop();
      r.parentId=stack.length?stack[stack.length-1].id:null;if(stack.length)stack[stack.length-1].children.push(r.id);stack.push(r);}
    s.text=text;
  }
  function project(f) {
    beforeRender(f);const s=state(f), hidden=[], collapsedByStart=new Map();
    if(options.folding)for(const r of s.regions)if(r.isCollapsed){collapsedByStart.set(r.startLine,r);
      if(!hidden.length||r.startLine+1>hidden[hidden.length-1].endLine)hidden.push({startLine:r.startLine+1,endLine:r.endLine});}
    const lines=[],map=[];let j=0;
    for(let i=0;i<f.lines.length;i++){while(j<hidden.length&&i>hidden[j].endLine)j++;if(j<hidden.length&&i>=hidden[j].startLine)continue;
      lines.push(f.lines[i]);map.push({model:i});}
    s.projection={lines,map,hidden,collapsedByStart,fileKey:key()};return s.projection;
  }
  const starts = lines => {let n=0;return lines.map(l=>{const s=n;n+=l.length+1;return s;});};
  function viewOffset(pos,view,f) {
    const ss=starts(view.lines);let i=ss.length-1;while(i>0&&ss[i]>pos)i--;
    const model=view.map[i]?view.map[i].model:0;
    return starts(f.lines)[model]+Math.min(pos-ss[i],f.lines[model].length);
  }
  function applyViewEdit(oldText,newText,view,f) {
    const s=state(f);let a=0,b=0;
    while(a<oldText.length&&a<newText.length&&oldText[a]===newText[a])a++;
    while(b<oldText.length-a&&b<newText.length-a&&oldText[oldText.length-1-b]===newText[newText.length-1-b])b++;
    const from=viewOffset(a,view,f),to=viewOffset(oldText.length-b,view,f),insert=newText.slice(a,newText.length-b);
    const source=f.lines.join('\n');if(source.slice(from,to)===insert)return;
    s.history.push({text:source,regions:s.regions.map(r=>({...r})),selection:window.ED&&ED.getModelSelection?ED.getModelSelection():null});
    if(s.history.length>300)s.history.shift();s.future=[];
    const undoButton=document.getElementById('btnUndo');if(undoButton)undoButton.disabled=false;
    const fromLine=source.slice(0,from).split('\n').length-1, toLine=source.slice(0,to).split('\n').length-1;
    const delta=insert.split('\n').length-1-(toLine-fromLine);
    s.regions=s.regions.filter(r=>!(r.startLine>=fromLine&&r.startLine<=toLine&&toLine>fromLine)).map(r=>{
      if(r.startLine>toLine){r.startLine+=delta;r.endLine+=delta;}else if(r.endLine>=fromLine)r.endLine+=delta;return r;});
    f.lines=(source.slice(0,from)+insert+source.slice(to)).split('\n');s.text=null;
    beforeRender(f);
  }
  function refresh(){if(window.ED)ED.refreshView?ED.refreshView():ED.render();}
  function regionAt(line){const s=state();return s&&s.regions.filter(r=>r.startLine<=line&&r.endLine>=line).pop();}
  function toggle(r,recursive=false,alt=false) {
    const rs=state().regions;let batch=[];
    if(alt){batch=rs.filter(p=>!(p.startLine<=r.startLine&&p.endLine>=r.endLine)&&!(p.startLine>=r.startLine&&p.endLine<=r.endLine));
      if(batch.some(p=>p.isCollapsed))batch=batch.filter(p=>p.isCollapsed);
    }else{if(recursive)batch=rs.filter(p=>p.startLine>r.startLine&&p.endLine<=r.endLine&&p.isCollapsed===r.isCollapsed);
      if(r.isCollapsed||!recursive||!batch.length)batch.push(r);}
    for(const item of new Set(batch))item.isCollapsed=!item.isCollapsed;refresh();
  }
  function reveal(line){const s=state();if(s)for(const r of s.regions)if(r.startLine<line&&r.endLine>=line)r.isCollapsed=false;}
  function command(name,arg) {
    const f=current();if(!f)return;beforeRender(f);const s=state(f),line=window.ED?ED.caretLine()-1:0,r=regionAt(line);
    const action=name.replace(/^editor\./,'');let batch=[];let collapsed;
    if(action==='foldAll'||action==='unfoldAll'){batch=s.regions;collapsed=action==='foldAll';}
    else if(/^foldLevel\d+$/.test(action)){batch=s.regions.filter(p=>p.depth===+action.slice(9));collapsed=true;}
    else if(r){if(action==='toggleFold'){toggle(r);return;}
      batch=/Recursively$/.test(action)?s.regions.filter(p=>p.startLine>=r.startLine&&p.endLine<=r.endLine):[r];
      collapsed=action==='fold'||action==='foldRecursively';}
    for(const item of batch)item.isCollapsed=collapsed;refresh();
  }
  function history(redo=false){const f=current(),s=state(f);if(!s)return;const src=redo?s.future:s.history,dst=redo?s.history:s.future;
    const item=src.pop();if(!item)return;dst.push({text:f.lines.join('\n'),regions:s.regions.map(r=>({...r}))});
    f.lines=item.text.split('\n');s.regions=item.regions;s.text=null;
    // Refresh once without mapping the previous projection against a now shorter document.
    s.projection=null;refresh();if(typeof saveAll==='function')saveAll();
    if(item.selection&&ED.setModelSelection)ED.setModelSelection(item.selection.start,item.selection.end,item.selection.direction);}
  window.EditorFolding={options,lex,indent,indentationRanges,normalize,beforeRender,project,applyViewEdit,viewOffset,
    state,regionAt,toggle,reveal,command,history,refresh,
    configure(next){const {guides,...rest}=next;Object.assign(options,rest);if(guides)Object.assign(options.guides,guides);for(const s of banks.values())s.text=null;refresh();},
    registerProvider(lang,provider){providers.set(lang,provider);for(const s of banks.values())s.text=null;refresh();}};
})();
