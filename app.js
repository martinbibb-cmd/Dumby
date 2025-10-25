/** Dumby App – Prompt Tree (local-first PWA) */
const LS_KEY = 'dumby.prompts.v1';
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const els = {
  tree: $('#tree'), cats: $('#category-list'), search: $('#search'),
  toast: $('#toast'), editDialog: $('#edit-dialog'), editForm: $('#edit-form'),
  stats: $('#stats'), catList: $('#category-datalist'),
  btnAdd: $('#btn-add'), btnExport: $('#btn-export'), btnExportMD: $('#btn-export-md'),
  btnExportOPML: $('#btn-export-opml'), btnReset: $('#btn-reset'), fileImport: $('#file-import'),
  toggleCompact: $('#toggle-compact'), toggleDark: $('#toggle-dark')
};
let prompts = [];
let filter = { q:'', cat:'All' };

init();

async function init(){
  attachUI();
  await loadData();
  renderAll();
  registerSW();
}

function attachUI(){
  $('#toggle-descriptions')?.addEventListener('change',()=>document.body.classList.toggle('nosummaries', !$('#toggle-descriptions').checked));
  els.toggleCompact?.addEventListener('change',()=>document.body.classList.toggle('compact', els.toggleCompact.checked));
  els.toggleDark?.addEventListener('change',()=>{
    document.documentElement.classList.toggle('light', !els.toggleDark.checked);
    localStorage.setItem('dumby.theme', els.toggleDark.checked ? 'dark' : 'light');
  });
  const t = localStorage.getItem('dumby.theme') || 'dark';
  els.toggleDark.checked = (t==='dark'); document.documentElement.classList.toggle('light', t!=='dark');

  els.search.addEventListener('input',()=>{ filter.q = els.search.value.toLowerCase().trim(); renderAll(); });
  els.btnAdd.addEventListener('click',()=>openEditor());
  els.btnExport.addEventListener('click',()=>downloadText(JSON.stringify(prompts,null,2),'dumby_prompts.json','application/json'));
  els.btnExportMD.addEventListener('click',()=>downloadText(toMarkdown(prompts),'dumby_prompts.md','text/markdown'));
  els.btnExportOPML.addEventListener('click',()=>downloadText(toOPML(prompts),'dumby_prompts.opml','text/xml'));
  els.btnReset.addEventListener('click', resetSeed);
  els.fileImport.addEventListener('change', importJSON);
  els.editForm.addEventListener('submit', onEditSubmit);
}

async function loadData(){
  const cached = localStorage.getItem(LS_KEY);
  if(cached){ try{ prompts = JSON.parse(cached); return; }catch{} }
  try{
    const r = await fetch('./data/prompts.json',{cache:'no-store'});
    prompts = await r.json();
    sync();
  }catch{ prompts = []; }
}

function sync(){ localStorage.setItem(LS_KEY, JSON.stringify(prompts)); renderAll(); }
function renderAll(){ renderCats(); renderTree(); updateStats(); }

function renderCats(){
  const cats = ['All', ...Array.from(new Set(prompts.map(p=>p.category))).sort()];
  els.cats.innerHTML = '';
  cats.forEach(cat=>{
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.textContent = cat; btn.className = (filter.cat===cat?'active':'');
    btn.addEventListener('click',()=>{ filter.cat=cat; renderAll(); });
    li.appendChild(btn); els.cats.appendChild(li);
  });
  $('#category-datalist').innerHTML = cats.filter(c=>c!=='All').map(c=>`<option value="${escapeHTML(c)}">`).join('');
}

function renderTree(){
  els.tree.innerHTML = '';
  const tpl = $('#prompt-item');
  const list = prompts.filter(p=>{
    const matchCat = (filter.cat==='All' || p.category===filter.cat);
    const hay = (p.title+' '+(p.summary||'')+' '+p.prompt+' '+p.category).toLowerCase();
    const matchQ = !filter.q || hay.includes(filter.q);
    return matchCat && matchQ;
  });
  const byCat = groupBy(list, x=>x.category);
  Object.entries(byCat).sort().forEach(([cat, arr])=>{
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.querySelector('.node-title').textContent = cat;
    node.querySelector('.node-summary').textContent = `${arr.length} prompt${arr.length!==1?'s':''}`;
    node.querySelector('.copy').remove(); node.querySelector('.edit').remove(); node.querySelector('.delete').remove();
    const ul = node.querySelector('.children');
    arr.sort((a,b)=>a.title.localeCompare(b.title)).forEach(p=>ul.appendChild(renderLeaf(p,tpl)));
    els.tree.appendChild(node);
  });
  $$('.collapse').forEach(btn=>btn.addEventListener('click',()=>{
    const li = btn.closest('.node'); const open = btn.textContent==='▾';
    btn.textContent = open?'▸':'▾'; li.querySelector('.children').style.display = open?'none':'';
  }));
}

function renderLeaf(p, tpl){
  const li = tpl.content.firstElementChild.cloneNode(true);
  li.dataset.id = p.id; li.querySelector('.children').remove();
  li.querySelector('.node-title').textContent = p.title;
  li.querySelector('.node-summary').textContent = p.summary || '';
  li.querySelector('.copy').addEventListener('click',()=>copy(p.prompt));
  li.querySelector('.edit').addEventListener('click',()=>openEditor(p));
  li.querySelector('.delete').addEventListener('click',()=>{
    if(confirm('Delete this prompt?')){ prompts = prompts.filter(x=>x.id!==p.id); sync(); toast('Deleted'); }
  });
  return li;
}

function openEditor(p){
  $('#edit-title').textContent = p ? 'Edit Prompt' : 'Add Prompt';
  els.editForm.reset(); els.editForm.dataset.id = p ? p.id : '';
  $('#f-category').value = p ? p.category : (filter.cat!=='All'?filter.cat:'');
  $('#f-title').value = p ? p.title : '';
  $('#f-summary').value = p ? (p.summary||'') : '';
  $('#f-prompt').value = p ? p.prompt : '';
  $('#edit-dialog').showModal();
}
function onEditSubmit(e){
  e.preventDefault();
  const id = els.editForm.dataset.id || crypto.randomUUID();
  const category = $('#f-category').value.trim();
  const title = $('#f-title').value.trim();
  const summary = $('#f-summary').value.trim();
  const prompt = $('#f-prompt').value.trim();
  if(!category || !title || !prompt) return;
  const payload = { id, category, title, summary, prompt };
  const i = prompts.findIndex(x=>x.id===id);
  if(i>=0) prompts[i]=payload; else prompts.push(payload);
  $('#edit-dialog').close(); sync(); toast('Saved');
}

function importJSON(ev){
  const f = ev.target.files?.[0]; if(!f) return;
  const rd = new FileReader();
  rd.onload = ()=>{
    try{
      const data = JSON.parse(rd.result);
      if(!Array.isArray(data)) throw new Error('Invalid JSON');
      data.forEach(p=>{ if(!p.id) p.id = crypto.randomUUID(); if(!p.category||!p.title||!p.prompt) throw new Error('Missing fields'); });
      prompts = data; sync(); toast('Imported');
    }catch(err){ alert('Import failed: '+err.message); }
    finally{ ev.target.value=''; }
  };
  rd.readAsText(f);
}

function resetSeed(){
  if(!confirm('Reload seed data? This overwrites current prompts.')) return;
  fetch('./data/prompts.json',{cache:'no-store'})
    .then(r=>r.json()).then(json=>{ prompts=json; sync(); toast('Seed reloaded'); })
    .catch(()=>alert('Could not load seed file.'));
}

function updateStats(){
  const total = prompts.length; const cats = new Set(prompts.map(p=>p.category)).size;
  els.stats.textContent = `${total} prompts • ${cats} categories`;
}

async function copy(text){
  try{ await navigator.clipboard.writeText(text); toast('Copied'); }
  catch{
    const ta = document.createElement('textarea'); ta.value=text; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); ta.remove(); toast('Copied');
  }
}
function toast(msg){ els.toast.textContent=msg; els.toast.style.display='block'; setTimeout(()=>els.toast.style.display='none',1300); }
const groupBy=(arr,fn)=>arr.reduce((m,x)=>(m[fn(x)]=m[fn(x)]||[],m[fn(x)].push(x),m),{});
const escapeHTML=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function downloadText(text, name, type='text/plain'){
  const blob = new Blob([text],{type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a);
  a.click(); a.remove(); URL.revokeObjectURL(url);
}

// Exporters
function toMarkdown(list){
  const byCat = groupBy(list,p=>p.category);
  const out=['# Dumby Prompts',''];
  Object.entries(byCat).sort().forEach(([cat,arr])=>{
    out.push(`## ${cat}`,'');
    arr.sort((a,b)=>a.title.localeCompare(b.title)).forEach(p=>{
      out.push(`### ${p.title}`); if(p.summary) out.push(p.summary);
      out.push('','```',p.prompt,'```','');
    });
  });
  return out.join('\n');
}
function toOPML(list){
  const byCat = groupBy(list,p=>p.category);
  const esc=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const out=[`<?xml version="1.0" encoding="UTF-8"?>`,`<opml version="2.0"><head><title>Dumby Prompts</title></head><body>`,`<outline text="Dumby Prompts">`];
  Object.entries(byCat).sort().forEach(([cat,arr])=>{
    out.push(`  <outline text="${esc(cat)}">`);
    arr.sort((a,b)=>a.title.localeCompare(b.title)).forEach(p=>{
      const s = p.summary?` – ${esc(p.summary)}`:'';
      out.push(`    <outline text="${esc(p.title+s)}"><outline text="${esc(p.prompt)}"/></outline>`);
    });
    out.push(`  </outline>`);
  });
  out.push(`</outline></body></opml>`); return out.join('\n');
}

// SW
async function registerSW(){ if('serviceWorker' in navigator){ try{ await navigator.serviceWorker.register('./sw.js'); }catch{} } }
