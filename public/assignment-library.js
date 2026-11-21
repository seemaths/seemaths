(() => {
  const key='seemaths.assignments.managed.v1';
  const url=new URL(location.href);
  if(url.searchParams.has('teacher')) {url.searchParams.delete('teacher');history.replaceState(null,'',url);}
  try {
    localStorage.removeItem('seemaths.teacher.v1');
    const saved=JSON.parse(localStorage.getItem(key) || '[]');
    if(Array.isArray(saved)) localStorage.setItem(key,JSON.stringify(saved.filter(a=>a.expiresAt>Date.now()/1000).map(({teacherNumber,...a})=>a)));
  } catch {}
  const header=document.querySelector('.masthead');
  if(header && document.querySelector('.player-links')) {
    const link=document.createElement('a');link.className='assignments-link';link.href='/assignments';link.textContent='Assignments';
    header.insertBefore(link,header.querySelector('.player-links'));
  }
})();
