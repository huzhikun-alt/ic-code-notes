/* ============================================================
   AI 侧边栏 + 范围批注
   依赖 index.html 暴露的全局：files()/cur/curProj/NOTES/saveAll/
   renderCode/renderNav/snapshot/toast/openModal/esc/hashLine/nkey
   ============================================================ */
(() => {
  const $  = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const store = {
    get(k, f){ try{ const v=localStorage.getItem(k); return v===null?f:JSON.parse(v); }catch(e){ return f; } },
    set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
  };

  /* ---------------- 范围批注存储 ---------------- */
  let RANGES = store.get('icn-ranges', {});
  const rkey = () => curProj + '::' + cur;
  const rangesOf = () => (RANGES[rkey()] || []);
  function saveRanges(){ store.set('icn-ranges', RANGES); }

  function addRange(from, to, text, author){
    if(from > to){ const t=from; from=to; to=t; }
    const list = RANGES[rkey()] || (RANGES[rkey()] = []);
    // 交叉检测
    const cross = list.find(r => (from>r.from && from<r.to) !== (to>r.from && to<r.to));
    if(cross){ toast('与已有批注 ' + cross.from + '–' + cross.to + ' 交叉，请调整范围'); return null; }
    const item = {
      id: 'r' + Date.now().toString(36),
      from, to, text,
      author: author || 'me',
      status: author === 'ai' ? 'draft' : 'ok',
      at: Date.now()
    };
    list.push(item); saveRanges();
    renderCode();
    return item;
  }
  window.icAddRange = addRange;

  /* ---------------- 范围批注渲染 ---------------- */
  function paintRanges(){
    const codeEl = document.getElementById('code');
    if(!codeEl) return;
    const rows = [...codeEl.querySelectorAll('.line')];
    const list = rangesOf();

    list.forEach(r => {
      for(let ln=r.from; ln<=r.to; ln++){
        const row = rows[ln-1];
        if(!row) continue;
        row.classList.add('rng');
        if(ln===r.from) row.classList.add('rng-start');
        if(ln===r.to)   row.classList.add('rng-end');
      }
      const endRow = rows[r.to-1];
      if(!endRow) return;
      const slot = endRow.querySelector('.slot');
      if(!slot) return;
      slot.appendChild(buildRangeCard(r));
    });
  }

  function buildRangeCard(r){
    const el = document.createElement('div');
    el.className = 'nb nb-range' + (r.author==='ai' ? ' ai' : '');
    el.dataset.range = r.id;
    el.tabIndex = 0;
    el.innerHTML =
      '<div class="rg-badge">' + r.from + '–' + r.to + '</div>' +
      '<div class="rg-body" contenteditable="true"></div>' +
      (r.author==='ai' && r.status==='draft'
        ? '<div class="rg-tools"><button data-act="accept" title="采纳"><svg class="ic"><use href="#i-check"/></svg></button></div>'
        : '');
    const body = el.querySelector('.rg-body');
    body.textContent = r.text || '';

    // 删空文字 = 删除这条批注
    body.addEventListener('input', ()=>{ r.text = body.innerText; saveRanges(); });
    body.addEventListener('blur', ()=>{
      if(!body.innerText.trim()){
        RANGES[rkey()] = rangesOf().filter(x => x.id !== r.id);
        saveRanges(); renderCode();
      }
    });
    body.addEventListener('dblclick', ()=>{
      const range = document.createRange(); range.selectNodeContents(body);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    });
    // 卡片本身聚焦时按 Delete / Backspace 删除整条
    el.addEventListener('keydown', ev => {
      if(document.activeElement === el && (ev.key==='Delete'||ev.key==='Backspace')){
        ev.preventDefault();
        RANGES[rkey()] = rangesOf().filter(x => x.id !== r.id);
        saveRanges(); renderCode(); toast('已删除范围批注');
      }
    });

    const acc = el.querySelector('[data-act="accept"]');
    if(acc) acc.onclick = ev => {
      ev.stopPropagation();
      r.status = 'ok'; saveRanges(); renderCode(); toast('已采纳');
    };
    return el;
  }

  /* ---------------- AI 侧边栏 ---------------- */
  let aiOpen = store.get('icn-ai-open', false);
  let busy = false;
  const cfg = () => store.get('icn-ai-cfg', { base:'', key:'', model:'deepseek-chat', temp:0.3, allowEdit:false });

  function buildPanel(){
    const p = document.createElement('aside');
    p.id = 'aiPanel';
    p.innerHTML = `
      <div class="ai-head">
        <svg class="ic"><use href="#i-sparkles"/></svg>
        <span class="ai-title">AI 助手</span>
        <span class="ai-mode" id="aiMode">演示模式</span>
        <button class="ai-x" id="aiClose" title="收起侧栏 (Ctrl+J)"><svg class="ic"><use href="#i-panel-right-close"/></svg></button>
      </div>
      <div class="ai-ctx" id="aiCtx"></div>
      <div class="ai-acts">
        <button class="ai-act" data-act="file"><svg class="ic"><use href="#i-scan-text"/></svg><span>整文件注释</span></button>
        <button class="ai-act" data-act="sel"><svg class="ic"><use href="#i-brackets"/></svg><span>注释选中</span></button>
        <button class="ai-act" data-act="explain"><svg class="ic"><use href="#i-circle-question-mark"/></svg><span>解释这段</span></button>
        <button class="ai-act" data-act="cfg"><svg class="ic"><use href="#i-settings-2"/></svg><span>接入设置</span></button>
      </div>
      <div class="ai-chat" id="aiChat">
        <div class="ai-empty">
          <svg class="ic big"><use href="#i-bot"/></svg>
          <p>选中几行代码，或直接点上面的按钮。</p>
          <p class="dim">未接入 API 时使用演示结果，不会发送任何代码。</p>
        </div>
      </div>
      <div class="ai-input">
        <textarea id="aiInput" rows="1" placeholder="问点什么…（Enter 发送，Shift+Enter 换行）"></textarea>
        <button class="ai-send" id="aiSend" title="发送"><svg class="ic"><use href="#i-send"/></svg></button>
      </div>`;
    document.querySelector('.main').appendChild(p);
    return p;
  }

  function panelEl(){ return document.getElementById('aiPanel'); }
  function setOpen(v){
    aiOpen = v; store.set('icn-ai-open', v);
    const p = panelEl(); if(!p) return;
    p.classList.toggle('on', v);
    document.body.classList.toggle('ai-open', v);
  }

  /* 上下文摘要 */
  function selRange(){
    const s = window.getSelection();
    if(!s || !s.rangeCount || !s.toString().trim()) return null;
    const r = s.getRangeAt(0);
    const rows = [...document.querySelectorAll('#code .line')];
    const idxOf = node => {
      const el = node.nodeType === 1 ? node : node.parentElement;
      const row = el && el.closest('.line');
      return row ? rows.indexOf(row) : -1;
    };
    let a = idxOf(r.startContainer), b = idxOf(r.endContainer);
    if(a < 0 && b < 0) return null;
    if(a < 0) a = b; if(b < 0) b = a;
    return { from: Math.min(a,b)+1, to: Math.max(a,b)+1 };
  }

  function paintCtx(){
    const box = document.getElementById('aiCtx'); if(!box) return;
    const sel = selRange();
    const f = hasFile() ? files()[cur] : null;
    box.innerHTML = sel
      ? `<span class="ctx-chip"><svg class="ic"><use href="#i-brackets"/></svg>已选 ${sel.from}–${sel.to} 行（${sel.to-sel.from+1} 行）</span>`
      : `<span class="ctx-chip dim"><svg class="ic"><use href="#i-file-code"/></svg>${f ? esc(f.path)+' · '+f.lines.length+' 行' : '未打开文件'}</span>`;
    const m = document.getElementById('aiMode');
    if(m){ const c = cfg(); m.textContent = c.key ? '已接入' : '演示模式'; m.classList.toggle('live', !!c.key); }
  }

  /* 演示用的“AI”：按结构切分，产出范围批注 */
  function mockAnnotate(lines, lang){
    const out = [];
    const push = (a,b,t) => out.push({from:a+1, to:b+1, text:t});
    let start = -1, kind = '';
    lines.forEach((line, i) => {
      const t = line.trim();
      if(/^(module|function|task|sub|def|class)\b/.test(t) && start < 0){ start = i; kind = 'block'; }
      if(/always_comb|always_ff|always @|always_/.test(t)){ start = i; kind = 'always'; }
      if(/end(function|module|task)?$|^\}/.test(t) && start >= 0){
        const label = kind === 'always'
          ? (i - start < 3 ? '一小段时序/组合逻辑，注意敏感表和复位。' : '这段逻辑块：读的时候先看敏感表和分支覆盖。')
          : '这个模块/子程序：先看端口与参数，再看内部状态。';
        push(start, i, label);
        start = -1;
      }
    });
    if(start >= 0) push(start, lines.length-1, '文件尾部的一段逻辑。');
    if(!out.length) push(0, Math.min(lines.length-1, 5), '这是文件开头的一段，没有识别到明显结构。');
    return out;
  }

  function chatSay(role, html){
    const chat = document.getElementById('aiChat'); if(!chat) return;
    const empty = chat.querySelector('.ai-empty'); if(empty) empty.remove();
    const el = document.createElement('div');
    el.className = 'ai-msg ' + role;
    el.innerHTML = html;
    chat.appendChild(el);
    chat.scrollTop = chat.scrollHeight;
    return el;
  }

  function runAction(act){
    if(busy) return;
    if(!hasFile()){ toast('先打开一个文件'); return; }
    if(act === 'cfg'){ openSettings(); return; }
    const f = files()[cur];
    const sel = act === 'sel' ? selRange() : null;
    if(act === 'sel' && !sel){ toast('先选中几行代码'); return; }

    busy = true;
    const c = cfg();
    const scope = act === 'file' ? `${f.lines.length} 行` : `${sel.to-sel.from+1} 行`;
    const msg = chatSay('user', act === 'explain'
      ? `解释 ${sel ? sel.from+'–'+sel.to+' 行' : '当前文件'}`
      : `为 ${scope} 生成批注`);
    const out = chatSay('ai', '<span class="typing"><svg class="ic spin"><use href="#i-loader-circle"/></svg>生成中…</span>');

    setTimeout(() => {
      busy = false;
      const lines = f.lines;
      if(act === 'explain'){
        out.innerHTML = '<div class="ai-result"><p>这段代码做的是：把输入按 opcode 分流计算，再打一拍输出。</p><p class="dim">（演示模式：未接入 API，内容为固定示例）</p></div>';
        return;
      }
      const items = mockAnnotate(lines, f.lang);
      const filtered = sel ? items.filter(x => x.to >= sel.from && x.from <= sel.to) : items;
      const list = (filtered.length ? filtered : [{from:sel?sel.from:1, to:sel?sel.to:lines.length, text:'这是一段值得记录的代码。'}]);
      out.innerHTML =
        '<div class="ai-result">' +
        '<div class="ai-sum">识别出 ' + list.length + ' 段，可整批写入批注：</div>' +
        list.map(x => '<div class="ai-item"><span class="rg-badge sm">'+x.from+'–'+x.to+'</span><span>'+esc(x.text)+'</span></div>').join('') +
        '<div class="ai-result-acts">' +
        '<button class="btn pri" id="aiAccept">全部写入</button>' +
        '<button class="btn" id="aiAgain">重试</button>' +
        (act==='file' ? '' : '<span class="dim tiny">仅写入选中范围内的段落</span>') +
        '</div></div>';
      const accept = out.querySelector('#aiAccept');
      if(accept) accept.onclick = () => {
        let n = 0;
        list.forEach(x => { if(addRange(x.from, x.to, x.text, 'ai')) n++; });
        toast('已写入 ' + n + ' 条 AI 批注（待确认）');
        out.querySelector('.ai-result').innerHTML = '<p class="dim">已写入 ' + n + ' 条，可在代码区审阅。</p>';
      };
      const again = out.querySelector('#aiAgain');
      if(again) again.onclick = () => { out.remove(); runAction(act); };
    }, 650);
  }

  /* ---------------- 设置弹窗 ---------------- */
  function openSettings(){
    const c = cfg();
    openModal({
      title: 'AI 接入设置',
      sub: 'Key 只保存在本机浏览器里，不会上传。留空则使用演示模式。',
      body:
        '<div class="fld"><label>服务商</label><div class="choices" id="aiProv">' +
          [['deepseek','DeepSeek'],['openai','OpenAI'],['custom','自定义']].map(([k,n]) =>
            '<button data-p="'+k+'" class="'+(k==='deepseek'?'on':'')+'">'+n+'</button>').join('') +
        '</div></div>' +
        '<div class="fld"><label>Base URL</label><input id="aiBase" value="'+esc(c.base||'https://api.deepseek.com/v1')+'"></div>' +
        '<div class="fld"><label>API Key</label><input id="aiKey" type="password" value="'+esc(c.key||'')+'" placeholder="sk-..."></div>' +
        '<div class="fld"><label>模型</label><input id="aiModel" value="'+esc(c.model||'deepseek-chat')+'"></div>' +
        '<div class="fld"><label>允许 AI 生成代码补丁</label><div class="choices" id="aiEdit">' +
          '<button data-v="0" class="'+(c.allowEdit?'':'on')+'">只写批注</button>' +
          '<button data-v="1" class="'+(c.allowEdit?'on':'')+'">可生成补丁（需确认）</button>' +
        '</div></div>',
      okText: '保存',
      onOk(){
        const next = {
          base: document.getElementById('aiBase').value.trim(),
          key: document.getElementById('aiKey').value.trim(),
          model: document.getElementById('aiModel').value.trim(),
          temp: c.temp,
          allowEdit: document.querySelector('#aiEdit button.on').dataset.v === '1'
        };
        store.set('icn-ai-cfg', next);
        paintCtx(); toast(next.key ? '已接入，可用真实模型' : '已保存（未填 Key，仍为演示模式）');
        return true;
      }
    });
    setTimeout(() => {
      document.querySelectorAll('#aiProv button').forEach(b => b.onclick = () => {
        $$('#aiProv button').forEach(x => x.classList.toggle('on', x === b));
        const map = { deepseek:'https://api.deepseek.com/v1', openai:'https://api.openai.com/v1' };
        if(map[b.dataset.p]) document.getElementById('aiBase').value = map[b.dataset.p];
      });
      document.querySelectorAll('#aiEdit button').forEach(b => b.onclick = () =>
        $$('#aiEdit button').forEach(x => x.classList.toggle('on', x === b)));
    }, 30);
  }

  /* ---------------- 选中 → 右键加范围批注 ---------------- */
  const codeEl = document.getElementById('code');
  codeEl.addEventListener('contextmenu', e => {
    const sel = selRange();
    if(!sel || sel.to === sel.from) return;      // 单行走原有菜单
    e.preventDefault(); e.stopPropagation();
    const x = e.clientX, y = e.clientY;
    showMenu(x, y, [
      { text: '选中 ' + sel.from + '–' + sel.to + ' 行' },
      { label: '为这 ' + (sel.to-sel.from+1) + ' 行添加批注', onClick: () => {
          const t = window.prompt('这段代码在做什么？', '');
          if(t) addRange(sel.from, sel.to, t, 'me');
        } },
      { label: '让 AI 注释这几行', onClick: () => { setOpen(true); panelEl().dataset.forceSel='1'; runAction('sel'); } }
    ]);
  }, true);

  /* ---------------- 启动 ---------------- */
  buildPanel();
  setOpen(aiOpen);
  paintCtx();

  document.getElementById('aiClose').onclick = () => setOpen(false);
  const tog=document.getElementById('aiToggle');
  if(tog){ tog.onclick=()=>setOpen(!aiOpen); tog.classList.toggle('on', aiOpen); }
  const _setOpen=setOpen; setOpen=function(v){ _setOpen(v); const t=document.getElementById('aiToggle'); if(t) t.classList.toggle('on', v); };
  $$('.ai-act').forEach(b => b.onclick = () => runAction(b.dataset.act));
  document.getElementById('aiSend').onclick = () => {
    const box = document.getElementById('aiInput');
    const v = box.value.trim(); if(!v) return;
    box.value = '';
    chatSay('user', esc(v));
    setTimeout(() => chatSay('ai',
      '<div class="ai-result"><p>（演示模式）这个问题需要接入模型才能回答。</p>' +
      '<p class="dim">在「接入设置」里填入 API Key 即可。</p></div>'), 500);
  };
  document.getElementById('aiInput').addEventListener('keydown', e => {
    if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); document.getElementById('aiSend').click(); }
  });
  document.addEventListener('selectionchange', () => { if(aiOpen) paintCtx(); });
  document.addEventListener('keydown', e => {
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='j'){ e.preventDefault(); setOpen(!aiOpen); }
  });

  /* 每次重绘代码后补画范围批注 */
  const origRender = window.renderCode;
  if(typeof origRender === 'function'){
    window.renderCode = function(){ origRender.apply(this, arguments); paintRanges(); paintCtx(); };
  }
  setTimeout(paintRanges, 0);
})();
