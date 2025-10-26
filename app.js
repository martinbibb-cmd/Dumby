/* Dumby core (global store) – unchanged List view + tree support + forest loader */
(function(){
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  window.DumbyStore = {
    nodes: [],
    flat: [],
    listeners: [],
    setNodes(nodes){ this.nodes = nodes; this.flat = flatten(nodes); ls('dumby.nodes.v1', nodes); notify(); },
    setFlat(flat){ this.flat = flat; ls('dumby.prompts.v1', flat); notify(); }
  };
  window.onDumbyData = fn => DumbyStore.listeners.push(fn);
  function notify(){ DumbyStore.listeners.forEach(fn=>fn()); }

  const ls = (k,v)=>localStorage.setItem(k, JSON.stringify(v));
  const ld = k => { try{ return JSON.parse(localStorage.getItem(k)||''); }catch{ return null; } };
  window.copyToClipboard = async function(text){
    try{ await navigator.clipboard.writeText(text); }catch{
      const ta=document.createElement('textarea'); ta.value=text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
  };
  window.toast = msg => { const el=$('#toast'); el.textContent=msg; el.style.display='block'; setTimeout(()=>el.style.display='none',1200); };

  // boot
  init();

  async function init(){
    attachUI();
    await loadData();
    renderList();
  }

  function attachUI(){
    $('#toggle-compact').addEventListener('change',()=>document.body.classList.toggle('compact',$('#toggle-compact').checked));
    $('#toggle-dark').addEventListener('change',()=>{
      document.documentElement.classList.toggle('light', !$('#toggle-dark').checked);
      localStorage.setItem('dumby.theme', $('#toggle-dark').checked ? 'dark':'light');
    });
    const theme = localStorage.getItem('dumby.theme') || 'dark';
    $('#toggle-dark').checked = (theme==='dark'); document.documentElement.classList.toggle('light', theme!=='dark');

    $('#search').addEventListener('input', renderList);
    $('#btn-add').addEventListener('click', ()=>openEditor());
    $('#btn-export').addEventListener('click', ()=>download('dumby_forest.json', DumbyStore.nodes));
    $('#btn-export-md').addEventListener('click', ()=>downloadText(toMarkdown(DumbyStore.nodes),'dumby_prompts.md','text/markdown'));
    $('#btn-export-opml').addEventListener('click', ()=>downloadText(toOPML(DumbyStore.nodes),'dumby_prompts.opml','text/xml'));
    $('#btn-reset').addEventListener('click', resetSeed);
    $('#file-import').addEventListener('change', importJSON);
    $('#edit-form').addEventListener('submit', onEditSubmit);
  }

  async function loadData(){
    // Load multiple roots if present, else fallback
    const lsTree = ld('dumby.nodes.v1'); if(lsTree?.length){ DumbyStore.setNodes(lsTree); return; }
    try{
      const r = await fetch('./data/forest.json',{cache:'no-store'});
      if(r.ok){ DumbyStore.setNodes(await r.json()); return; }
    }catch{}
    try{
      const r = await fetch('./data/prompts.json',{cache:'no-store'});
      const flat = await r.json();
      DumbyStore.setNodes(convertPromptsToForest(flat));
    }catch{ DumbyStore.setNodes([]); }
  }

  function convertPromptsToForest(flat){
    // One root "System Dev" with categories → prompts
    const by = flat.reduce((m,p)=>{ (m[p.category] ||= []).push(p); return m; },{});
    return [{
      id: crypto.randomUUID(), title:'System Dev', type:'group', color:'accent', tags:['System'],
      children: Object.entries(by).map(([cat, arr])=>({
        id: crypto.randomUUID(), title: cat, type:'group', tags:[cat],
        children: arr.map(p=>(
          {
            id: p.id || crypto.randomUUID(), title: p.title, type: p.type || 'prompt',
            summary: p.summary, prompt: p.prompt, tags:[cat]
          }
        ))
      }))
    }];
  }

  // ---------- LIST VIEW (as before) ----------
  let filter = { q:'', cat:'All' };
  function renderList(){
    const q = $('#search').value.trim().toLowerCase();
    filter.q = q;
    const flat = DumbyStore.flat.filter(n=>{
      const hay = [n.title, n.summary||'', n.prompt||'', (n.tags||[]).join(' ')].join(' ').toLowerCase();
      return !q || hay.includes(q);
    });
    const cats = ['All', ...Array.from(new Set(flat.map(n=>n.tags?.[0]).filter(Boolean))).sort()];
    const $cats = $('#category-list'); $cats.innerHTML='';
    cats.forEach(c=>{
      const li=document.createElement('li'); const b=document.createElement('button');
      b.textContent=c; if(filter.cat===c) b.className='active';
      b.onclick=()=>{ filter.cat=c; renderList(); };
      li.appendChild(b); $cats.appendChild(li);
    });

    const items = flat.filter(n=> filter.cat==='All' || n.tags?.includes(filter.cat));
    const $tree = $('#tree'); $tree.innerHTML='';
    const tpl = $('#prompt-item');

    const byCat = items.reduce((m,n)=>{ const k = n.tags?.[0] || 'Misc'; (m[k] ||= []).push(n); return m; },{});
    Object.entries(byCat).sort().forEach(([cat, arr])=>{
      const group = tpl.content.firstElementChild.cloneNode(true);
      group.querySelector('.node-title').textContent = cat;
      group.querySelector('.node-summary').textContent = `${arr.length} item(s)`;
      group.querySelector('.copy').remove(); group.querySelector('.edit').remove(); group.querySelector('.delete').remove();
      const ul = group.querySelector('.children');

      arr.sort((a,b)=>a.title.localeCompare(b.title)).forEach(n=>{
        const li = tpl.content.firstElementChild.cloneNode(true);
        li.querySelector('.children').remove();
        li.querySelector('.node-title').textContent = n.title;
        li.querySelector('.node-summary').textContent = n.summary || n.type || '';
        li.querySelector('.copy').onclick = ()=> n.prompt ? copyToClipboard(n.prompt).then(()=>toast('Copied')) : toast('No prompt');
        li.querySelector('.edit').onclick = ()=> openEditor(n);
        li.querySelector('.delete').onclick = ()=> deleteNode(n.id);
        ul.appendChild(li);
      });

      $tree.appendChild(group);
    });

    const total = DumbyStore.flat.length;
    const catsCount = new Set(DumbyStore.flat.map(n=>n.tags?.[0]).filter(Boolean)).size;
    $('#stats').textContent = `${total} nodes • ${catsCount} categories`;
  }

  function deleteNode(id){
    const rec = (arr)=>arr.filter(n=>{
      if(n.id===id) return false;
      if(n.children) n.children = rec(n.children);
      return true;
    });
    const nodes = rec(structuredClone(DumbyStore.nodes));
    DumbyStore.setNodes(nodes);
    renderList();
  }

  function openEditor(n, parentId='root'){
    $('#edit-title').textContent = n ? 'Edit Node' : 'Add Node';
    $('#edit-form').reset();
    $('#edit-form').dataset.id = n?.id || '';
    $('#f-parent').value = findParentId(n?.id) || parentId;
    $('#f-type').value = n?.type || 'prompt';
    $('#f-title').value = n?.title || '';
    $('#f-summary').value = n?.summary || '';
    $('#f-prompt').value = n?.prompt || '';
    $('#f-tags').value = (n?.tags||[]).join(', ');
    $('#f-color').value = n?.color || '';
    $('#edit-dialog').showModal();
  }

  function onEditSubmit(e){
    e.preventDefault();
    const id = e.target.dataset.id || crypto.randomUUID();
    const parentId = $('#f-parent').value.trim();
    const node = {
      id,
      type: $('#f-type').value,
      title: $('#f-title').value.trim(),
      summary: $('#f-summary').value.trim(),
      prompt: $('#f-prompt').value,
      tags: $('#f-tags').value.split(',').map(s=>s.trim()).filter(Boolean),
      color: $('#f-color').value.trim(),
      children: []
    };
    let nodes = structuredClone(DumbyStore.nodes);
    if(e.target.dataset.id){ // update
      const {parent, idx} = findNode(nodes, id);
      if(parent){ parent.children[idx] = {...parent.children[idx], ...node}; }
      else { const i = nodes.findIndex(n=>n.id===id); if(i>=0) nodes[i] = {...nodes[i], ...node}; }
    }else{
      if(parentId && parentId!=='root'){
        const {node:p} = findNode(nodes, parentId);
        if(p){ (p.children ||= []).push(node); } else { nodes.push(node); }
      }else{ nodes.push(node); }
    }
    DumbyStore.setNodes(nodes);
    $('#edit-dialog').close();
    renderList();
  }

  function findParentId(id){
    if(!id) return 'root';
    let pid='root';
    (function walk(arr, parent){
      for(const n of arr){
        if(n.id===id){ pid = parent; return; }
        if(n.children) walk(n.children, n.id);
      }
    })(DumbyStore.nodes, 'root');
    return pid;
  }

  function findNode(arr, id){
    for(let i=0;i<arr.length;i++){
      const n = arr[i];
      if(n.id===id) return {node:n, parent:null, idx:i};
      if(n.children){
        const r = findNode(arr[i].children, id);
        if(r.node) return {node:r.node, parent:arr[i], idx:r.idx};
      }
    }
    return {node:null, parent:null, idx:-1};
  }

  function flatten(nodes, parentTags=[]){
    const out=[];
    for(const n of nodes){
      out.push({ id:n.id, title:n.title, summary:n.summary, prompt:n.prompt, type:n.type, tags:n.tags?.length ? n.tags : parentTags, color:n.color });
      if(n.children) out.push(...flatten(n.children, n.tags?.length?n.tags:parentTags));
    }
    return out;
  }

  function resetSeed(){
    if(!confirm('Reload grove seed? This overwrites current data.')) return;
    fetch('./data/forest.json',{cache:'no-store'})
      .then(r=>r.json())
      .then(nodes=>{ DumbyStore.setNodes(nodes); renderList(); toast('Seed loaded'); })
      .catch(()=>alert('Could not load data/forest.json'));
  }

  function importJSON(ev){
    const f = ev.target.files?.[0]; if(!f) return;
    const rd = new FileReader();
    rd.onload = ()=>{
      try{
        const data = JSON.parse(rd.result);
        if(Array.isArray(data) && data[0]?.children){ DumbyStore.setNodes(data); }
        else if(Array.isArray(data)){ DumbyStore.setNodes(convertPromptsToForest(data)); }
        else { throw new Error('Unexpected JSON format'); }
        toast('Imported'); renderList();
      }catch(err){ alert('Import failed: '+err.message); }
      finally{ ev.target.value=''; }
    };
    rd.readAsText(f);
  }

  function toMarkdown(tree){
    const lines=['# Dumby Grove',''];
    (function walk(nodes, depth=0){
      for(const n of nodes){
        const pfx = '  '.repeat(depth);
        lines.push(`${pfx}- **${n.title}** ${n.type?`(_${n.type}_)`:''} ${n.tags?.length?`[#${n.tags.join(' #')}]`:''}`);
        if(n.summary) lines.push(`${pfx}  - ${n.summary}`);
        if(n.prompt){ lines.push('', pfx+'  ```', n.prompt, pfx+'  ```', ''); }
        if(n.children?.length) walk(n.children, depth+1);
      }
    })(tree);
    return lines.join('\n');
  }
  function toOPML(tree){
    const esc = s=> (s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    const lines=[`<?xml version="1.0" encoding="UTF-8"?>`,`<opml version="2.0"><head><title>Dumby Grove</title></head><body>`,`<outline text="Dumby">`];
    (function walk(nodes, indent='  '){
      for(const n of nodes){
        lines.push(`${indent}<outline text="${esc(n.title)}">`);
        if(n.prompt) lines.push(`${indent}  <outline text="${esc(n.prompt)}"/>`);
        if(n.children?.length) walk(n.children, indent+'  ');
        lines.push(`${indent}</outline>`);
      }
    })(tree);
    lines.push(`</outline></body></opml>`); return lines.join('\n');
  }
  function download(name, obj){ downloadText(JSON.stringify(obj,null,2), name, 'application/json'); }
  function downloadText(text, name, type='text/plain'){
    const blob=new Blob([text],{type}); const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),500);
  }
})();
