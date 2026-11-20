(() => {
  const storageKey='seemaths.teacher.v1', managedKey='seemaths.assignments.managed.v1';
  const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)) || fallback;}catch{return fallback;}};
  let identity=read(storageKey,{}), assignments=[];
  const requested=new URLSearchParams(location.search).get('teacher');
  const valid=n=>/^\d{8}$/.test(n || '');
  function persist(){localStorage.setItem(storageKey,JSON.stringify(identity));}
  function headers(){if(!identity.uuid){identity.uuid=crypto.randomUUID();persist();}return {'X-Teacher-Id':identity.uuid};}
  function number(){return valid(requested)?requested:(identity.number || identity.recoveredNumber);}
  function render(){
    const n=number();
    if(!valid(n) || !assignments.length) return;
    let badge=document.getElementById('teacher-id');
    if(!badge){badge=document.createElement('button');badge.id='teacher-id';badge.type='button';badge.className='teacher-id';document.body.append(badge);}
    badge.innerHTML=`<span>Teacher Id</span><strong>${n}</strong>`;
    badge.title='Copy Teacher Id';badge.onclick=async()=>{try{await navigator.clipboard.writeText(n);badge.title='Teacher Id copied';badge.setAttribute('aria-label',`Teacher Id ${n} copied`);}catch{window.prompt('Copy Teacher Id',n);}};
    const masthead=document.querySelector('.masthead');
    if(masthead){let link=document.getElementById('teacher-assignments');if(!link){link=document.createElement('a');link.id='teacher-assignments';link.className='teacher-assignments';masthead.insertBefore(link,masthead.querySelector('.player-links, nav'));}link.textContent=`${assignments.length} Assignments`;link.href=`/assignments?teacher=${n}`;}
  }
  async function registered(a){
    if(a.teacherNumber){identity.number=a.teacherNumber;persist();}
    assignments=[a,...assignments.filter(x=>x.id!==a.id)];render();
  }
  async function init(){
    if(valid(requested)){identity.recoveredNumber=requested;persist();}
    const saved=read(managedKey,[]).filter(a=>a.expiresAt>Date.now()/1000);
    // Upgrade earlier browser-saved assignments using their private management keys.
    for(const a of saved.filter(a=>!a.teacherNumber)){
      try{const response=await fetch(`/api/assignments/${a.id}/teacher`,{method:'POST',headers:{...headers(),Authorization:`Bearer ${a.key}`}});if(response.ok){const data=await response.json();Object.assign(a,data);identity.number=data.teacherNumber;persist();}}catch{}
    }
    if(saved.length)localStorage.setItem(managedKey,JSON.stringify(saved));
    if(valid(number())){const response=await fetch(`/api/teachers/${number()}`,{cache:'no-store'});if(!response.ok)throw new Error('Could not load teacher assignments.');assignments=(await response.json()).assignments;render();}
    return assignments;
  }
  window.seemathsTeacher={headers,registered,number,get assignments(){return assignments;}};
  window.seemathsTeacherReady=init().catch(()=>[]);
})();
