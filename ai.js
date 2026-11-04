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

  /* 供撤销系统读写范围批注 */
  window.icRangesGet = () => JSON.parse(JSON.stringify(RANGES[rkey()] || []));
  window.icRangesSet = arr => { RANGES[rkey()] = JSON.parse(JSON.stringify(arr || [])); saveRanges(); };

  function addRange(from, to, text, author){
    if(from > to){ const t=from; from=to; to=t; }
    if(typeof snapshot === 'function') snapshot(author === 'ai' ? '写入 AI 批注' : '新增范围批注');
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
        if(typeof snapshot === 'function') snapshot('删除范围批注');
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
        if(typeof snapshot === 'function') snapshot('删除范围批注');
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
    if(!s || !s.rangeCount || !s.toString().trim()){
      // 没有文字选择时，回退到「按行选择」
      const r = window.__rowSelection ? window.__rowSelection() : null;
      return r || null;
    }
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
    const c = cfg();
    if (c.full && c.full.trim()) return c.full.trim();   // 用户直接给了完整地址
    const base = (c.base || '').replace(/\/+$/, '');
    if (!base) return '';
    if (/\/completions$/.test(base)) return base;
    return base + '/chat/completions';
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
      const raw = await res.text().catch(() => '');
      if (!res.ok) {
        throw new Error('HTTP ' + res.status + (raw ? ' · ' + raw.slice(0, 200).replace(/\s+/g, ' ') : ''));
      }
      let data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        const isHtml = /html/.test(ct) || /^\s*</.test(raw);
        throw new Error(
          (isHtml
            ? '这个地址返回的是网页而不是接口。请检查 Base URL 是否少了路径段（常见是 /v1），当前请求的是 ' + url
            : '返回内容不是合法 JSON') +
          '；前 120 字：' + raw.slice(0, 120).replace(/\s+/g, ' ')
        );
      }
      return (data && data.choices && data.choices[0] && data.choices[0].message &&
              data.choices[0].message.content) || '';
    } finally {
      clearTimeout(timer);
    }
  }


  /* ---------------- 连接诊断：逐步定位到底是哪一步返回了网页 ---------------- */
  async function diagnose() {
    const c = cfg();
    const base = (c.base || '').replace(/\/+$/, '');
    if (!base) return [{ step: 'Base URL', status: '-', ct: '-', ms: 0, head: '未填写' }];
    const url = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
    const auth = c.key ? { Authorization: 'Bearer ' + c.key } : {};
    const rows = [];

    const probe = async (step, run) => {
      const t0 = performance.now();
      try {
        const r = await run();
        const txt = await r.text().catch(() => '');
        const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
        const html = /html/.test(ct.toLowerCase()) || /^\s*</.test(txt);
        rows.push({
          step, status: r.status, ct: ct || '-', ms: Math.round(performance.now() - t0),
          head: (html ? '[网页] ' : '') + txt.slice(0, 90).replace(/\s+/g, ' '),
          html
        });
      } catch (e) {
        rows.push({ step, status: '失败', ct: '-', ms: Math.round(performance.now() - t0),
                    head: e.name === 'AbortError' ? '超时' : e.message, html: false });
      }
    };

    await probe('GET ' + base + '/models', () =>
      fetch(base + '/models', { headers: auth }));

    await probe('POST 最小补全（1 token）', () =>
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ model: c.model, max_tokens: 1, temperature: 0,
          messages: [{ role: 'user', content: 'ping' }] }) }));

    await probe('POST 短问答（200 tokens）', () =>
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ model: c.model, max_tokens: 200, temperature: 0.3,
          messages: [{ role: 'user', content: '用一句话说明寄存器的作用' }] }) }));

    return rows;
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
      const bodyText = await r.text().catch(() => '');
      const isHtml = /^\s*</.test(bodyText);
      if (r.ok && !isHtml) {
        let j = null; try { j = JSON.parse(bodyText); } catch (e) {}
        const n = j && Array.isArray(j.data) ? j.data.length : 0;
        return { ok: true, ms: Math.round(performance.now() - t0),
                 msg: '连接成功' + (n ? ' · 可用模型 ' + n + ' 个' : '') };
      }
      if (r.ok && isHtml) {
        return { ok: false, ms: Math.round(performance.now() - t0),
                 msg: '这个地址返回的是网页，不是接口。Base URL 可能少了 /v1 这类路径段（当前：' + base + '）' };
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


  function conclude(rows) {
    const models = rows[0], tiny = rows[1], shortq = rows[2];
    if (models && models.html && tiny && tiny.html) {
      return '两个接口都返回网页，Base URL 基本可以确定不对（缺 /v1 或前缀）。';
    }
    if (models && String(models.status) === '200' && tiny && tiny.html) {
      return 'GET /models 正常，但 POST /chat/completions 返回网页 —— 网关的补全路径与模型列表路径不一致，' +
             '请确认补全接口的真实路径（可能是 /v1/chat/completions 或其它自定义路径）。';
    }
    if (tiny && String(tiny.status) === '200' && shortq && shortq.html) {
      return '短请求可以、稍长请求返回网页，可能是网关/WAF 对请求体积有限制。';
    }
    if (tiny && /401|403/.test(String(tiny.status))) {
      return '鉴权失败，检查 API Key 与请求头。';
    }
    if (shortq && String(shortq.status) === '200' && !shortq.html) {
      return '三步都通，应该可以直接使用。若对话框仍报错，把这次报错内容发我。';
    }
    return '按上面三步的结果调整 Base URL / Key / 模型名。';
  }


  /* ---------------- 与已有批注的重叠判定 ---------------- */
  function existingIn(from, to) {
    const notes = NOTES[nkey()] || {};
    const lines = [];
    Object.keys(notes).forEach(k => {
      const ln = +k;
      if (ln >= from && ln <= to) lines.push({ line: ln, text: String(notes[k].text || '') });
    });
    const rs = rangesOf().filter(r => !(r.to < from || r.from > to));
    return {
      lines, ranges: rs,
      total: lines.length + rs.length,
      same: rs.filter(r => r.from === from && r.to === to).length > 0
    };
  }

  function renderConflict(i, x, c) {
    const bits = [];
    if (c.lines.length) {
      bits.push('已有 ' + c.lines.length + ' 条行批注（第 ' +
        c.lines.slice(0, 3).map(l => l.line).join('、') + (c.lines.length > 3 ? '…' : '') + ' 行）');
    }
    if (c.ranges.length) {
      bits.push('已有 ' + c.ranges.length + ' 条范围批注（' +
        c.ranges.map(r => r.from + '–' + r.to).slice(0, 3).join('、') + '）');
    }
    const def = 'keep';
    return '<div class="ai-conflict">' +
      '<div class="ai-conflict-head">⚠ 与已有批注重叠：' + bits.join('，') + '</div>' +
      '<label><input type="radio" name="ch' + i + '" value="keep" checked> 并存（保留原批注，另加这条）</label>' +
      '<label><input type="radio" name="ch' + i + '" value="replace"> 用 AI 替换（删除该范围内的行批注' +
        (c.same ? '，并更新同范围批注' : '') + '）</label>' +
      '<label><input type="radio" name="ch' + i + '" value="skip"> 跳过这条</label>' +
      '</div>';
  }

  function readChoice(i, c) {
    if (!c.total) return 'keep';
    const el = document.querySelector('input[name="ch' + i + '"]:checked');
    return el ? el.value : 'keep';
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
        // 找出与现有批注重叠的部分，让用户逐条决定
        const conflicts = items.map(x => existingIn(x.from, x.to));

        out.innerHTML =
          '<div class="ai-result">' +
          '<div class="ai-sum">识别出 ' + items.length + ' 段' +
            (conflicts.some(c => c.total) ? '，其中 ' + conflicts.filter(c => c.total).length + ' 段与已有批注重叠' : '') +
          '：</div>' +
          items.map((x, i) => {
            const c = conflicts[i];
            return '<div class="ai-item"' + (c.total ? ' class="overlap"' : '') + '>' +
              '<span class="rg-badge sm">' + x.from + '–' + x.to + '</span>' +
              '<div class="ai-item-body">' +
                '<div class="ai-item-text">' + esc(x.text) + '</div>' +
                (c.total ? renderConflict(i, x, c) : '') +
              '</div></div>';
          }).join('') +
          '<div class="ai-result-acts">' +
          '<button class="btn pri" id="aiAccept">按选择写入</button>' +
          '<button class="btn" id="aiAgain">重试</button></div></div>';

        out.querySelector('#aiAccept').onclick = () => {
          snapshot('写入 AI 批注');
          let added = 0, replaced = 0, skipped = 0;
          items.forEach((x, i) => {
            const mode = readChoice(i, conflicts[i]);
            if (mode === 'skip') { skipped++; return; }
            if (mode === 'replace') {
              const nm = NOTES[nkey()] || {};
              Object.keys(nm).forEach(k => {
                const ln = +k;
                if (ln >= x.from && ln <= x.to) delete nm[k];
              });
              const same = rangesOf().filter(r => r.from === x.from && r.to === x.to);
              same.forEach(r => { r.text = x.text; r.author = 'ai'; r.status = 'draft'; });
              if (same.length) { replaced++; }
              else if (addRange(x.from, x.to, x.text, 'ai')) added++;
              saveAll(); saveRanges();
              renderCode();
              return;
            }
            if (addRange(x.from, x.to, x.text, 'ai')) added++;
          });
          toast('写入 ' + added + ' 条' + (replaced ? '，更新 ' + replaced + ' 条' : '') +
                (skipped ? '，跳过 ' + skipped + ' 条' : ''));
          out.querySelector('.ai-result').innerHTML =
            '<p class="dim">已写入 ' + (added + replaced) + ' 条，跳过 ' + skipped +
            ' 条，可在代码区审阅。</p>';
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
          '<input id="aiBase" placeholder="http://10.0.0.8:8000/v1" value="' + esc(c.base || '') + '">' +
          '<div class="ai-endpoint" id="aiEndpoint"></div></div>' +
        '<div class="fld"><label>API Key</label>' +
          '<input id="aiKey" type="password" placeholder="sk-... / 内网 token" value="' + esc(c.key || '') + '"></div>' +
        '<div class="fld"><label>完整请求地址（可选，填了就直接用它）</label>' +
          '<input id="aiFull" placeholder="http://10.0.0.8:8000/v1/chat/completions" value="' + esc(c.full || '') + '"></div>' +
        '<div class="fld"><label>模型名</label>' +
          '<input id="aiModel" placeholder="deepseek-chat" value="' + esc(c.model || '') + '"></div>' +
        '<div class="fld"><label>允许 AI 生成代码补丁</label><div class="choices" id="aiEdit">' +
          '<button data-v="0" class="' + (c.allowEdit ? '' : 'on') + '">只写批注</button>' +
          '<button data-v="1" class="' + (c.allowEdit ? 'on' : '') + '">可生成补丁（需确认）</button>' +
        '</div></div>' +
        '<div class="ai-test"><button class="btn" id="aiTest">测试连接</button>' +
        '<button class="btn" id="aiDiag">诊断</button>' +
        '<span id="aiTestMsg" class="ai-testmsg">尚未测试</span></div>' +
        '<pre class="ai-diag" id="aiDiagOut" hidden></pre>',
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
        full: document.getElementById('aiFull').value.trim(),
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

      const baseInput = document.getElementById('aiBase');
      const epBox = document.getElementById('aiEndpoint');
      const paintEndpoint = () => {
        const full = (document.getElementById('aiFull').value || '').trim();
        const b = baseInput.value.trim().replace(/\/+$/, '');
        if (full) { epBox.textContent = '实际请求：POST ' + full; return; }
        epBox.textContent = b
          ? '实际请求：POST ' + (/\/completions$/.test(b) ? b : b + '/chat/completions')
          : '实际请求：（先填写 Base URL）';
      };
      baseInput.addEventListener('input', paintEndpoint);
      document.getElementById('aiFull').addEventListener('input', paintEndpoint);
      paintEndpoint();

      document.getElementById('aiDiag').onclick = async () => {
        const out = document.getElementById('aiDiagOut');
        out.hidden = false;
        out.textContent = '诊断中…';
        store.set('icn-ai-cfg', readForm());
        const rows = await diagnose();
        const NL = String.fromCharCode(10);
        out.textContent = rows.map(r =>
          r.step + NL + '  状态 ' + r.status + ' · 类型 ' + r.ct + ' · ' + r.ms + 'ms' + NL + '  返回 ' + r.head
        ).join(NL + NL) + NL + NL + '结论：' + conclude(rows);
      };

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
