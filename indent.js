/* ============ 缩进 ============ */
const INDENT_CACHE = {};

function detectIndentUnit(lines, lang){
  const key = lang + '#' + lines.length + '#' + (lines[0] || '').length;
  if (INDENT_CACHE[key]) return INDENT_CACHE[key];
  const freq = {};
  for (let i = 1; i < Math.min(lines.length, 160); i++) {
    const a = (lines[i-1].match(/^[ \t]*/) || [''])[0].length;
    const b = (lines[i].match(/^[ \t]*/) || [''])[0].length;
    if (b > a) { const d = b - a; freq[d] = (freq[d] || 0) + 1; }
  }
  let best = 0, max = 0;
  Object.keys(freq).forEach(d => { if (freq[d] > max) { max = freq[d]; best = +d; } });
  const unit = best || (lang === 'verilog' ? 2 : 4);
  INDENT_CACHE[key] = unit;
  return unit;
}

const V_OPEN = /(\bbegin\b|\bcase[xz]?\b|\bfork\b|\bgenerate\b|\bmodule\b|\bfunction\b|\btask\b|\bclass\b|\balways(_comb|_ff|_latch)?\b|\binitial\b)\s*(\/\/.*)?$/;
const V_CLOSE = /^(end|endcase|endmodule|endfunction|endtask|endgenerate|endclass|join|join_any|join_none)\b/;
const PY_OPEN = /:\s*(#.*)?$/;
const PY_CLOSE = /^(else|elif|except|finally)\b/;

/* 回车后新行的缩进 */
function nextIndent(lineText, lineIdx){
  const f = files()[cur];
  const unit = detectIndentUnit(f.lines, f.lang);
  const t = String(lineText || '').replace(/\s+$/, '');
  const indent = (t.match(/^[ \t]*/) || [''])[0];
  const body = t.trim();
  const pad = n => ' '.repeat(Math.max(0, n));

  let opens = false, closes = false;
  if (f.lang === 'verilog') {
    closes = V_CLOSE.test(body);
    opens  = V_OPEN.test(body) || /[{([]\s*$/.test(body) ||
             /^(module|function|task|class|interface|package)[^;]*;\s*(\/\/.*)?$/.test(body);
  } else if (f.lang === 'python') {
    closes = PY_CLOSE.test(body);
    opens  = PY_OPEN.test(body);
  } else {
    closes = /^[}\])]/.test(body);
    opens  = /[{([]\s*$/.test(body);
  }

  if (closes) return pad(indent.length - unit);
  if (opens)  return indent + pad(unit);
  return indent;
}
