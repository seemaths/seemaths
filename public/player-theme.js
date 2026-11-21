const themes = [
  {name:'midnight',strip:'#1c2942',button:'#2b3b56',border:'#56647c',current:'#f2c879',hover:'#3a4e6b'},
  {name:'forest',strip:'#173d38',button:'#28524b',border:'#5d8175',current:'#b5dfae',hover:'#38665c'},
  {name:'plum',strip:'#362740',button:'#4b3858',border:'#826b8b',current:'#efb8d0',hover:'#62486e'},
  {name:'ocean',strip:'#19384d',button:'#294d63',border:'#65889e',current:'#9dd9eb',hover:'#3a627a'},
];

// Stable across devices and sessions; no student identity or database state.
export function themeForExercise(id) {
  let hash = 2166136261;
  for (const character of String(id)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return themes[hash % themes.length];
}
export function applyPlayerTheme(root, id) {
  const theme = themeForExercise(id);
  root.dataset.playerTheme = theme.name;
  for (const [key,value] of Object.entries(theme)) if (key !== 'name') root.style.setProperty(`--player-${key}`,value);
}
