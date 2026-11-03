/* App chrome: overflow menu, theme, annotation mode. Never touches note or source data. */
(() => {
  const root = document.documentElement;
  const read = (k, f) => { try { return localStorage.getItem(k) || f; } catch { return f; } };
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  /* ---------- overflow menu ---------- */
  const menuBtn = document.getElementById('btnMenu');
  const appMenu = document.getElementById('appMenu');

  function setMenu(open) {
    appMenu.classList.toggle('on', open);
    menuBtn.setAttribute('aria-expanded', String(open));
  }
  menuBtn.addEventListener('click', e => {
    e.stopPropagation();
    setMenu(!appMenu.classList.contains('on'));
  });
  document.addEventListener('click', e => {
    if (!appMenu.contains(e.target) && e.target !== menuBtn) setMenu(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') setMenu(false);
  });
  appMenu.addEventListener('click', e => {
    if (e.target.closest('button')) setMenu(false);
  });

  /* ---------- theme ---------- */
  const themeItem = document.getElementById('themeToggle');
  function applyTheme(value) {
    const dark = value === 'dark';
    root.dataset.theme = dark ? 'dark' : 'light';
    themeItem.textContent = dark ? '切换到浅色' : '切换到深色';
    store('icn-ui-theme', root.dataset.theme);
  }
  applyTheme(read('icn-ui-theme', 'light'));
  themeItem.addEventListener('click', () => {
    applyTheme(root.dataset.theme === 'light' ? 'dark' : 'light');
  });

  /* ---------- annotation mode ---------- */
  const mode = document.getElementById('noteMode');
  function applyMode(value) {
    root.dataset.noteMode = ['inline', 'side', 'plain'].includes(value) ? value : 'inline';
    mode.value = root.dataset.noteMode;
    store('icn-ui-mode', root.dataset.noteMode);
  }
  applyMode(read('icn-ui-mode', 'inline'));
  mode.addEventListener('change', () => applyMode(mode.value));

  /* ---------- lost anchors ---------- */
  const lostItem = document.getElementById('btnLost');
  lostItem.addEventListener('click', () => {
    if (typeof openLostDialog === 'function') openLostDialog();
  });

  /* ---------- notes: Enter commits, Shift+Enter breaks ---------- */
  document.getElementById('code').addEventListener('keydown', event => {
    const editor = event.target.closest('.nb [contenteditable="true"]');
    if (!editor || event.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      editor.blur();
    }
  }, true);

  /* ---------- resizable side column ---------- */
  const divider = document.getElementById('splitter');
  if (divider) {
    divider.tabIndex = 0;
    divider.setAttribute('role', 'separator');
    divider.setAttribute('aria-orientation', 'vertical');
    divider.setAttribute('aria-label', '代码与右侧批注列宽');
    divider.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const current = parseInt(getComputedStyle(root).getPropertyValue('--notew'), 10) || 360;
      setNoteW(current + (event.key === 'ArrowLeft' ? 20 : -20), true);
    });
  }
})();
