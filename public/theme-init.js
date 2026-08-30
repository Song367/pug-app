// Apply dark mode before first paint to prevent flash.
// Must match atomWithStorage key ("pug:theme") and JSON format.
try {
  const theme = JSON.parse(localStorage.getItem('pug:theme') || '"system"')
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)

  if (dark) document.documentElement.classList.add('dark')
} catch {}
