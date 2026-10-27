// Runs before the app renders so the page never flashes the wrong theme.
// Stored choice: 'light' | 'dark' | 'system' (default).
let choice = 'system';
try { choice = localStorage.getItem('cqa_theme') || 'system'; } catch (e) { /* storage blocked */ }
const dark = choice === 'dark' || (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
document.documentElement.classList.toggle('dark', dark);
