/* App chrome: overflow menu, palettes, annotation mode. Never touches note or source data. */
(() => {
  const root = document.documentElement;
  const read = (k, f) => { try { return localStorage.getItem(k) || f; } catch { return f; } };
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  /* ---------- overflow menu ---------- */
  const menuBtn = document.getElementById('btnMenu');
  const appMenu = document.getElementById('appMenu');
  const setMenu = open => {
    appMenu.classList.toggle('on', open);
    menuBtn.setAttribute('aria-expanded', String(open));
  };
  menuBtn.addEventListener('click', e => { e.stopPropagation(); setMenu(!appMenu.classList.contains('on')); });
  document.addEventListener('click', e => {
    if (!appMenu.contains(e.target) && e.target !== menuBtn) setMenu(false);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });
  appMenu.addEventListener('click', e => { if (e.target.closest('button')) setMenu(false); });

  /* ---------- palettes (classic editor colourschemes) ---------- */
  const PRESETS = [
    { id:'paper',           name:'纸感浅色',    theme:'light', sw:['#ffffff','#a8681f','#2f6f3f'] },
    { id:'graphite',        name:'石墨深色',    theme:'dark',  sw:['#0d1218','#e0b063','#7dcfff'] },
    { id:'gruvbox-dark',    name:'Gruvbox 深',  theme:'dark',  sw:['#282828','#fabd2f','#b8bb26'] },
    { id:'gruvbox-light',   name:'Gruvbox 浅',  theme:'light', sw:['#fbf1c7','#b57614','#79740e'] },
    { id:'nord',            name:'Nord',        theme:'dark',  sw:['#2e3440','#88c0d0','#a3be8c'] },
    { id:'solarized-dark',  name:'Solarized 深',theme:'dark',  sw:['#002b36','#b58900','#2aa198'] },
    { id:'solarized-light', name:'Solarized 浅',theme:'light', sw:['#fdf6e3','#b58900','#859900'] },
    { id:'tokyonight',      name:'Tokyo Night', theme:'dark',  sw:['#1a1b26','#7dcfff','#bb9af7'] },
    { id:'onedark',         name:'One Dark',    theme:'dark',  sw:['#282c34','#e5c07b','#61afef'] },
  ];
  const byId = id => PRESETS.find(x => x.id === id) || PRESETS[0];

  function applyPreset(id) {
    const preset = byId(id);
    root.dataset.preset = preset.id;
    root.dataset.theme = preset.theme;      // drives shadows / scrollbars
    store('icn-preset', preset.id);
  }
  applyPreset(read('icn-preset', 'paper'));

  const themeItem = document.getElementById('themeToggle');
  themeItem.addEventListener('click', () => {
    const current = root.dataset.preset;
    openModal({
      title: '配色方案',
      sub: 'Gruvbox、Nord 取自各自的 colorscheme 源文件；Solarized、Tokyo Night、One Dark 为公开配色。',
      body: '<div class="presetlist">' + PRESETS.map(p =>
        '<button class="preset' + (p.id === current ? ' on' : '') + '" data-preset-id="' + p.id + '">' +
          '<span class="dots">' + p.sw.map(c => '<i style="background:' + c + '"></i>').join('') + '</span>' +
          '<span class="nm">' + p.name + '</span>' +
        '</button>').join('') + '</div>',
      okText: '完成', cancelText: '关闭'
    });
    document.querySelectorAll('.preset').forEach(btn => {
      btn.onclick = () => {
        applyPreset(btn.dataset.presetId);
        document.querySelectorAll('.preset').forEach(b => b.classList.toggle('on', b === btn));
      };
    });
  });

  /* ---------- annotation mode ---------- */
  const mode = document.getElementById('noteMode');
  function applyMode(value) {
    root.dataset.noteMode = ['inline','side','plain'].includes(value) ? value : 'inline';
    mode.value = root.dataset.noteMode;
    store('icn-ui-mode', root.dataset.noteMode);
  }
  applyMode(read('icn-ui-mode', 'inline'));
  mode.addEventListener('change', () => applyMode(mode.value));

  /* ---------- lost anchors ---------- */
  document.getElementById('btnLost').addEventListener('click', () => {
    if (typeof openLostDialog === 'function') openLostDialog();
  });

  /* ---------- auto-convert trailing comments ---------- */
  const autoItem = document.getElementById('btnAutoComment');
  const syncAuto = () => {
    const on = typeof autoCommentOn === 'function' ? autoCommentOn() : true;
    const al=document.getElementById('autoLabel'); if(al) al.textContent='行末注释自动转卡片'+(on?' ✓':'');
    autoItem.setAttribute('aria-checked', String(on));
  };
  syncAuto();
  autoItem.addEventListener('click', () => {
    const on = typeof autoCommentOn === 'function' ? autoCommentOn() : true;
    try { localStorage.setItem('icn-auto-comment', on ? 'off' : 'on'); } catch {}
    syncAuto();
  });

  /* ---------- dismiss the hover card by clicking anywhere else ---------- */
  document.addEventListener('click', e => {
    const tip = document.getElementById('tip');
    if (!tip || tip.style.display !== 'block') return;
    if (tip.contains(e.target)) return;          // keep open while editing it
    if (e.target.closest('.fx')) return;         // another function: retarget
    if (typeof hideTip === 'function') hideTip();
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const tip = document.getElementById('tip');
    if (tip && tip.style.display === 'block' && typeof hideTip === 'function') hideTip();
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
      if (!['ArrowLeft','ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const current = parseInt(getComputedStyle(root).getPropertyValue('--notew'), 10) || 360;
      setNoteW(current + (event.key === 'ArrowLeft' ? 20 : -20), true);
    });
  }
})();
