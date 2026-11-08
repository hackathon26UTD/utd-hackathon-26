try { document.documentElement.dataset.hbkitTheme = localStorage.getItem('hbkit-theme') === 'dark' ? 'dark' : 'light'; } catch { document.documentElement.dataset.hbkitTheme = 'light'; }
