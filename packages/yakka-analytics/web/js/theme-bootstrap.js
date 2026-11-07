(() => {
  let theme = 'system';
  try {
    const stored = localStorage.getItem('yakka-analytics-theme');
    if (stored === 'light' || stored === 'dark') theme = stored;
  } catch {}
  const resolved = theme === 'system'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = theme;
})();
