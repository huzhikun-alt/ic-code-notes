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

  /* ---------------- 真实 API 调用 ---------------- */
  const endpoint = () => {
    const base = (cfg().base || '').replace(/\/+$/, '');
    if (!base) return '';
    return /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
  };

  async function apiChat(messages, opts = {}) {
    const c = cfg();
    const url = endpoint();
    if (!url) throw new Error('Base URL 未填写');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || 60000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(c.key ? { Authorization: 'Bearer ' + c.key } : {})
        },
        body: JSON.stringify({
          model: c.model,
          temperature: typeof opts.temp === 'number' ? opts.temp : (c.temp ?? 0.3),
          max_tokens: opts.maxTokens || 1600,
          stream: false,
          messages
        })
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error('HTTP ' + res.status + (body ? ' · ' + body.slice(0, 180) : ''));
      }
      const data = await res.json();
      return (data && data.choices && data.choices[0] && data.choices[0].message &&
              data.choices[0].message.content) || '';
    } finally {
      clearTimeout(timer);
    }
  }

  async function testConnection() {
    const c = cfg();
    if (!c.base) return { ok: false, msg: 'Base URL 未填写' };
    const base = c.base.replace(/\/+$/, '');
    const t0 = performance.now();
    const auth = c.key ? { Authorization: 'Bearer ' + c.key } : {};

    // 1) 先试 /models（最轻，多数兼容网关都实现）
    try {
      const r = await fetch(base + '/models', { headers: auth });
      if (r.ok) {
        const j = await r.json().catch(() => null);
        const n = j && Array.isArray(j.data) ? j.data.length : 0;
        return { ok: true, ms: Math.round(performance.now() - t0),
                 msg: '连接成功' + (n ? ' · 可用模型 ' + n + ' 个' : '') };
      }
      if (r.status !== 404 && r.status !== 405) {
        const t = await r.text().catch(() => '');
        return { ok: false, ms: Math.round(performance.now() - t0),
                 msg: 'HTTP ' + r.status + (t ? ' · ' + t.slice(0, 120) : '（若是 401/403，检查 Key）') };
      }
    } catch (e) {
      // 网络层错误：继续用补全接口再确认一次
    }

    // 2) 再用一次极小的补全请求确认
    try {
      const url = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({
          model: c.model, max_tokens: 1, temperature: 0,
          messages: [{ role: 'user', content: 'ping' }]
        })
      });
      const ms = Math.round(performance.now() - t0);
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        return { ok: false, ms, msg: 'HTTP ' + res.status + (t ? ' · ' + t.slice(0, 140) : '') };
      }
      return { ok: true, ms, msg: '连接成功 · 模型 ' + c.model + ' 可用' };
    } catch (e) {
      return { ok: false, ms: Math.round(performance.now() - t0),
               msg: '请求失败：' + (e.name === 'AbortError' ? '超时' : e.message) +
                    '（常见原因：CORS 未放行 http://127.0.0.1:8710，或地址不可达）' };
    }
  }

  /* ---------------- 提示词 ---------------- */
  function numberedSource(lines, from, to) {
    return lines.slice(from - 1, to)
      .map((l, i) => String(from + i).padStart(4, ' ') + ' | ' + l)
      .join('\n');
  }

  const SYS = '你是资深的 IC / EDA 代码阅读助手，精通 Verilog/SystemVerilog、Perl、Python。' +
    '你的任务是为给定的代码片段写出精确的逐段批注。要求：' +
    '1) 只输出 JSON 数组，不要任何解释文字、不要 Markdown 代码块；' +
    '2) 每项格式 {"from":整数,"to":整数,"text":"说明"}，from/to 使用我给的原始行号（含两端）；' +
    '3) text 必须具体：写清这段在做什么运算/判断、涉及哪些信号或变量、时序关系（是否寄存、复位行为）、以及设计意图；' +
    '4) 禁止写"这段代码实现了功能""这是一段逻辑"这类空话；' +
    '5) 段落粒度按语义划分：一个模块头、一个 always 块、一个 case 分支组、一个函数体各成一段；' +
    '6) 每段 1-3 句，中文。';

  function buildUserPrompt(lang, from, to, code, extra) {
    return '语言：' + lang + '\n代码（行号 | 内容）：\n' + code +
      (extra ? '\n\n额外要求：' + extra : '') +
      '\n\n请为 ' + from + '-' + to + ' 范围内的代码输出批注 JSON 数组。';
  }

  function parseJsonArray(text) {
    if (!text) return null;
    let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const s = t.indexOf('['), e = t.lastIndexOf(']');
    if (s >= 0 && e > s) t = t.slice(s, e + 1);
    try {
      const arr = JSON.parse(t);
      if (!Array.isArray(arr)) return null;
      return arr
        .map(x => ({ from: parseInt(x.from, 10), to: parseInt(x.to, 10), text: String(x.text || '').trim() }))
        .filter(x => x.from > 0 && x.to >= x.from && x.text);
    } catch (e) { return null; }
  }

  /* ---------------- 动作 ---------------- */
  function runAction(act) {
    if (busy) return;
    if (!hasFile()) { toast('先打开一个文件'); return; }
    if (act === 'cfg') { openSettings(); return; }
    if (act === 'test') { openSettings(); return; }

    const c = cfg();
    if (!c.key) {
      toast('还没有接入 API');
      chatSay('ai', '<div class="ai-result"><p class="dim">还没有接入 API。' +
        '点「接入设置」填写内网 Base URL 与 Key，填完可以先用「测试连接」验证是否通。</p></div>');
      return;
    }

    const f = files()[cur];
    const sel = act === 'sel' ? selRange() : null;
    if (act === 'sel' && !sel) { toast('先选中几行代码'); return; }
    const from = sel ? sel.from : 1;
    const to = sel ? sel.to : f.lines.length;

    busy = true;
    chatSay('user', (act === 'explain' ? '解释 ' : '注释 ') + from + '–' + to + ' 行');
    const out = chatSay('ai', '<span class="typing"><svg class="ic spin"><use href="#i-loader-circle"/></svg>请求中…</span>');

    const code = numberedSource(f.lines, from, to);
    const messages = act === 'explain'
      ? [{ role: 'system', content: '你是 IC 代码阅读助手，用中文简洁解释代码的作用、关键信号与时序，不要复述语法。' },
         { role: 'user', content: '语言：' + f.lang + '\n代码（行号 | 内容）：\n' + code + '\n\n请解释这段代码在做什么。' }]
      : [{ role: 'system', content: SYS },
         { role: 'user', content: buildUserPrompt(f.lang, from, to, code) }];

    apiChat(messages, { maxTokens: act === 'explain' ? 800 : 1800 })
      .then(text => {
        busy = false;
        if (act === 'explain') {
          out.innerHTML = '<div class="ai-result"><p></p></div>';
          out.querySelector('p').textContent = text.trim();
          return;
        }
        const items = parseJsonArray(text);
        if (!items || !items.length) {
          out.innerHTML = '<div class="ai-result"><div class="ai-sum">模型没有返回结构化结果，原文如下：</div>' +
            '<pre class="ai-raw"></pre></div>';
          out.querySelector('.ai-raw').textContent = text.slice(0, 1200);
          return;
        }
        out.innerHTML =
          '<div class="ai-result">' +
          '<div class="ai-sum">识别出 ' + items.length + ' 段：</div>' +
          items.map(x => '<div class="ai-item"><span class="rg-badge sm">' + x.from + '–' + x.to + '</span>' +
            '<span>' + esc(x.text) + '</span></div>').join('') +
          '<div class="ai-result-acts">' +
          '<button class="btn pri" id="aiAccept">全部写入</button>' +
          '<button class="btn" id="aiAgain">重试</button></div></div>';
        out.querySelector('#aiAccept').onclick = () => {
          let n = 0;
          items.forEach(x => { if (addRange(x.from, x.to, x.text, 'ai')) n++; });
          toast('已写入 ' + n + ' 条 AI 批注（待确认）');
          out.querySelector('.ai-result').innerHTML = '<p class="dim">已写入 ' + n + ' 条，可在代码区审阅。</p>';
        };
        out.querySelector('#aiAgain').onclick = () => { out.remove(); runAction(act); };
      })
      .catch(err => {
        busy = false;
        out.innerHTML = '<div class="ai-result"><div class="ai-err"></div></div>';
        out.querySelector('.ai-err').textContent = '请求失败：' + err.message;
      });
  }

  /* ---------------- 设置弹窗 ---------------- */
  function openSettings() {
    const c = cfg();
    openModal({
      title: 'AI 接入设置',
      sub: '配置只保存在本机浏览器。填好后先点「测试连接」确认能通，再保存。',
      body:
        '<div class="fld"><label>服务商</label><div class="choices" id="aiProv">' +
          [['deepseek', 'DeepSeek'], ['openai', 'OpenAI'], ['custom', '自定义 / 内网']].map(([k, n]) =>
            '<button data-p="' + k + '" class="' + (k === 'custom' ? 'on' : '') + '">' + n + '</button>').join('') +
        '</div></div>' +
        '<div class="fld"><label>Base URL（不要带结尾斜杠）</label>' +
          '<input id="aiBase" placeholder="http://10.0.0.8:8000/v1" value="' + esc(c.base || '') + '"></div>' +
        '<div class="fld"><label>API Key</label>' +
          '<input id="aiKey" type="password" placeholder="sk-... / 内网 token" value="' + esc(c.key || '') + '"></div>' +
        '<div class="fld"><label>模型名</label>' +
          '<input id="aiModel" placeholder="deepseek-chat" value="' + esc(c.model || '') + '"></div>' +
        '<div class="fld"><label>允许 AI 生成代码补丁</label><div class="choices" id="aiEdit">' +
          '<button data-v="0" class="' + (c.allowEdit ? '' : 'on') + '">只写批注</button>' +
          '<button data-v="1" class="' + (c.allowEdit ? 'on' : '') + '">可生成补丁（需确认）</button>' +
        '</div></div>' +
        '<div class="ai-test"><button class="btn" id="aiTest">测试连接</button>' +
        '<span id="aiTestMsg" class="ai-testmsg">尚未测试</span></div>',
      okText: '保存',
      onOk() {
        const next = readForm();
        store.set('icn-ai-cfg', next);
        paintCtx();
        toast(next.key ? '已保存配置' : '已保存，但缺少 Key，AI 功能不可用');
        return true;
      }
    });

    function readForm() {
      return {
        base: document.getElementById('aiBase').value.trim(),
        key: document.getElementById('aiKey').value.trim(),
        model: document.getElementById('aiModel').value.trim(),
        temp: c.temp ?? 0.3,
        allowEdit: document.querySelector('#aiEdit button.on').dataset.v === '1'
      };
    }

    setTimeout(() => {
      document.querySelectorAll('#aiProv button').forEach(b => b.onclick = () => {
        document.querySelectorAll('#aiProv button').forEach(x => x.classList.toggle('on', x === b));
        const map = { deepseek: 'https://api.deepseek.com/v1', openai: 'https://api.openai.com/v1' };
        if (map[b.dataset.p]) {
          document.getElementById('aiBase').value = map[b.dataset.p];
          if (!document.getElementById('aiModel').value)
            document.getElementById('aiModel').value = b.dataset.p === 'openai' ? 'gpt-4o-mini' : 'deepseek-chat';
        }
      });
      document.querySelectorAll('#aiEdit button').forEach(b => b.onclick = () =>
        document.querySelectorAll('#aiEdit button').forEach(x => x.classList.toggle('on', x === b)));

      document.getElementById('aiTest').onclick = async () => {
        const msg = document.getElementById('aiTestMsg');
        const btn = document.getElementById('aiTest');
        store.set('icn-ai-cfg', readForm());     // 测试用当前表单值
        msg.textContent = '测试中…'; msg.className = 'ai-testmsg';
        btn.disabled = true;
        const r = await testConnection();
        btn.disabled = false;
        msg.textContent = (r.ok ? '✓ ' : '✗ ') + r.msg + (r.ms ? ' （' + r.ms + 'ms）' : '');
        msg.className = 'ai-testmsg ' + (r.ok ? 'ok' : 'bad');
        if (r.ok) paintCtx();
      };
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
  /* ---------- 对话：带上下文走真实模型 ---------- */
  const SYS_CHAT = '你是嵌在「IC 代码笔记」里的代码阅读助手。用户正在读 IC / EDA 代码。'
    + '你会收到工程信息、文件清单、函数库摘要，以及当前文件（可能含选中范围）的源码。'
    + '回答要求：用中文；结论先行；提到代码时给出具体行号；'
    + '如果上下文不足以回答，直接说缺哪部分信息，不要编造 API 或信号名。';

  function assembleContext(question) {
    const f = hasFile() ? files()[cur] : null;
    const out = [];
    const proj = Object.keys(PROJECTS);
    out.push('# 工程');
    out.push('- 当前工程：' + curProj + (PROJECTS[curProj] && PROJECTS[curProj].desc ? '（' + PROJECTS[curProj].desc + '）' : ''));
    out.push('- 全部工程：' + proj.join('、'));

    if (PROJECTS[curProj]) {
      const files = PROJECTS[curProj].files;
      const keys = Object.keys(files);
      out.push('- 本工程文件清单（' + keys.length + ' 个）：');
      keys.forEach(k => {
        out.push('  - ' + files[k].path + '（' + files[k].lang + '，' + files[k].lines.length + ' 行）');
      });
    }

    // 函数库摘要（当前语言优先）
    const langs = f ? [f.lang] : Object.keys(LANGS);
    langs.forEach(lg => {
      const items = (LIB[lg] || []).slice(0, 20);
      if (!items.length) return;
      out.push('- 函数库 · ' + lg + '（' + (LIB[lg] || []).length + ' 条，列前 ' + items.length + '）：');
      items.forEach(en => out.push('  - ' + en.name + (en.sig ? '：' + en.sig : '') +
        (en.desc ? ' — ' + en.desc.replace(/\n/g, ' ') : '')));
    });

    if (f) {
      const sel = selRange();
      const from = sel ? sel.from : 1;
      const to = sel ? sel.to : Math.min(f.lines.length, 400);
      out.push('');
      out.push('# 当前文件 ' + f.path + '（' + f.lang + '，共 ' + f.lines.length + ' 行）'
        + (sel ? '· 用户选中 ' + sel.from + '–' + sel.to + ' 行' : ''));
      if (f.lines.length > 400 && !sel) {
        out.push('（文件较长，只给出前 400 行；如需其它位置请让用户选中后再问）');
      }
      const body = f.lines.slice(from - 1, to)
        .map((l, i) => String(from + i).padStart(4, ' ') + ' | ' + l).join('\n');
      out.push('```' + (f.lang === 'verilog' ? 'systemverilog' : f.lang));
      out.push(body);
      out.push('```');

      // 当前文件的批注
      const notes = NOTES[nkey()] || {};
      const keys = Object.keys(notes);
      if (keys.length) {
        out.push('');
        out.push('# 我在这个文件里已有的批注');
        keys.slice(0, 20).forEach(k => {
          const n = notes[k];
          out.push('  - 第 ' + k + ' 行：' + String(n.text || '').replace(/\n/g, ' '));
        });
      }
    }

    out.push('');
    out.push('# 用户的问题');
    out.push(question);
    return out.join('\n');
  }

  async function sendChat(text) {
    const c = cfg();
    chatSay('user', esc(text));
    if (!c.key) {
      chatSay('ai', '<div class="ai-result"><p class="dim">还没有接入 API。点「接入设置」填写地址与 Key，'
        + '可用「测试连接」验证。</p></div>');
      return;
    }
    const out = chatSay('ai',
      '<span class="typing"><svg class="ic spin"><use href="#i-loader-circle"/></svg>思考中…</span>');
    try {
      const answer = await apiChat([
        { role: 'system', content: SYS_CHAT },
        { role: 'user', content: assembleContext(text) }
      ], { maxTokens: 1600, temp: 0.3 });
      out.innerHTML = '<div class="ai-result"><div class="ai-answer"></div></div>';
      out.querySelector('.ai-answer').textContent = (answer || '').trim() || '（模型返回为空）';
    } catch (err) {
      out.innerHTML = '<div class="ai-result"><div class="ai-err"></div></div>';
      out.querySelector('.ai-err').textContent = '请求失败：' + err.message;
    }
  }

  document.getElementById('aiSend').onclick = () => {
    const box = document.getElementById('aiInput');
    const v = box.value.trim(); if(!v) return;
    box.value = '';
    sendChat(v);
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
