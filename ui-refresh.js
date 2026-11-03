/* Presentation preferences do not alter notes or source text. */
(() => {
  const root = document.documentElement;
  const read = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
  const store = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  const theme = document.getElementById('themeToggle');
  const mode = document.getElementById('noteMode');
  function applyTheme(value) {
    root.dataset.theme = value === 'dark' ? 'dark' : 'light';
    theme.textContent = value === 'dark' ? '☀ 浅色' : '☾ 深色';
    theme.setAttribute('aria-label', value === 'dark' ? '切换浅色主题' : '切换深色主题');
    store('icn-ui-theme', root.dataset.theme);
  }
  function applyMode(value) {
    root.dataset.noteMode = ['inline', 'side', 'plain'].includes(value) ? value : 'inline';
    mode.value = root.dataset.noteMode;
    store('icn-ui-mode', root.dataset.noteMode);
  }
  applyTheme(read('icn-ui-theme', 'light'));
  applyMode(read('icn-ui-mode', 'inline'));
  theme.addEventListener('click', () => applyTheme(root.dataset.theme === 'light' ? 'dark' : 'light'));
  mode.addEventListener('change', () => applyMode(mode.value));
  // Both source comments and personal notes use the same keyboard convention.
  document.getElementById('code').addEventListener('keydown', event => {
    const editor = event.target.closest('.nb [contenteditable="true"]');
    if (!editor || event.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault(); event.stopImmediatePropagation(); editor.blur();
    }
  }, true);
  // Keep width controls accessible without a pointer as well.
  const divider = document.getElementById('splitter');
  divider.tabIndex = 0;
  divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-orientation', 'vertical');
  divider.setAttribute('aria-label', '代码与右侧批注列宽');
  divider.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const current = parseInt(getComputedStyle(root).getPropertyValue('--notew'), 10) || 360;
    setNoteW(current + (event.key === 'ArrowLeft' ? 20 : -20), true);
  });
})();
