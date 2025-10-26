/* Mind map renderer (SVG) – no external libs */
import { DumbyStore, onDataReady, copyToClipboard, toast } from './modules.js'; // (added inside app.js below)

const svg = document.getElementById('map-svg');
const tip = document.getElementById('map-tip');
const btnCenter = document.getElementById('map-center');
const btnZoomIn = document.getElementById('map-zoom-in');
const btnZoomOut = document.getElementById('map-zoom-out');
const btnExpand = document.getElementById('map-expand');
const btnCollapse = document.getElementById('map-collapse');
const tabList = document.getElementById('tab-list');
const tabMap = document.getElementById('tab-map');

let scale = 1, tx = 0, ty = 0;
let dragging = false, last = null;
let collapsed = new Set(); // nodeId -> collapsed state

// Simple layout constants
const NODE_W = 240, NODE_H = 56, X_GAP = 48, Y_GAP = 12, RADIUS = 10;

function setView(view){
  document.getElementById('view-list').setAttribute('aria-hidden', view!=='list');
  document.getElementById('view-map').setAttribute('aria-hidden', view!=='map');
  tabList.setAttribute('aria-selected', view==='list');
  tabMap.setAttribute('aria-selected', view==='map');
}
tabList.addEventListener('click',()=>setView('list'));
tabMap.addEventListener('click',()=>{ setView('map'); render(); });

btnCenter.addEventListener('click',()=>{ tx=0; ty=0; scale=1; applyTransform(); });
btnZoomIn.addEventListener('click',()=>{ scale*=1.15; applyTransform(); });
btnZoomOut.addEventListener('click',()=>{ scale/=1.15; applyTransform(); });

svg.addEventListener('mousedown',e=>{ dragging=true; last={x:e.clientX,y:e.clientY}; });
svg.addEventListener('mousemove',e=>{
  if(!dragging) return;
  tx += (e.clientX - last.x); ty += (e.clientY - last.y); last={x:e.clientX,y:e.clientY}; applyTransform();
});
window.addEventListener('mouseup',()=>dragging=false);
svg.addEventListener('wheel',e=>{ e.preventDefault(); const f=Math.pow(1.0015,-e.deltaY); scale*=f; applyTransform(); },{passive:false});

btnExpand.addEventListener('click',()=>{ collapsed.clear(); render(); });
btnCollapse.addEventListener('click',()=>{
  collapsed = new Set(DumbyStore.nodes.flatMap(n=>[n.id,...(n.children||[]).map(c=>c.id)]));
  render();
});

function applyTransform(){
  const g = svg.querySelector('g#world'); if(g) g.setAttribute('transform',`translate(${tx},${ty}) scale(${scale})`);
}

function clearSVG(){ while(svg.firstChild) svg.removeChild(svg.firstChild); }

function rect(x,y,w,h,r,cls){ const el = document.createElementNS('http://www.w3.org/2000/svg','rect');
  el.setAttribute('x',x); el.setAttribute('y',y); el.setAttribute('width',w); el.setAttribute('height',h);
  el.setAttribute('rx',r); el.setAttribute('class',cls); return el; }
function text(x,y,content,cls){ const t=document.createElementNS('http://www.w3.org/2000/svg','text');
  t.setAttribute('x',x); t.setAttribute('y',y); t.setAttribute('class',cls); t.textContent=content; return t; }
function path(d,cls){ const p=document.createElementNS('http://www.w3.org/2000/svg','path'); p.setAttribute('d',d); p.setAttribute('class',cls); return p; }

function nodeColor(n){
  const map={accent:'#66d9ef',good:'#9be39b',warn:'#f7c948',bad:'#ff6b6b'};
  return n.color && n.color.startsWith('#') ? n.color : (map[n.color]||'#66d9ef');
}

function layout(nodes, x0=0, y0=0, depth=0){
  // Simple top-down tree layout
  let y = y0;
  const boxes=[];
  for(const n of nodes){
    const myY = y;
    const childRes = (!collapsed.has(n.id) && n.children && n.children.length)
      ? layout(n.children, x0 + NODE_W + X_GAP, y, depth+1)
      : { height: NODE_H, boxes: [] };
    const h = Math.max(NODE_H, childRes.height);
    boxes.push({ node:n, x:x0, y:myY + h/2 - NODE_H/2, width:NODE_W, height:NODE_H, depth, children:childRes.boxes });
    y += h + Y_GAP;
  }
  const totalH = (y - y0) - Y_GAP;
  return { height: Math.max(totalH, NODE_H), boxes };
}

function render(){
  if(!DumbyStore.nodes.length) return;
  clearSVG();
  const g = document.createElementNS('http://www.w3.org/2000/svg','g'); g.id='world'; svg.appendChild(g);

  const rootLayout = layout(DumbyStore.nodes, 40, 60);
  // connectors
  function drawChildren(box){
    for(const child of box.children){
      const x1 = box.x + NODE_W, y1 = box.y + NODE_H/2;
      const x2 = child.x, y2 = child.y + NODE_H/2;
      const mx = (x1+x2)/2;
      const d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
      g.appendChild(path(d,'edge'));
      drawChildren(child);
    }
  }
  rootLayout.boxes.forEach(drawChildren);

  // boxes
  function drawBox(b){
    const color = nodeColor(b.node);
    const r = rect(b.x, b.y, NODE_W, NODE_H, RADIUS, 'node-rect'); r.setAttribute('stroke', color);
    g.appendChild(r);

    const title = text(b.x+12, b.y+22, b.node.title, 'node-title'); g.appendChild(title);

    // chips
    const chips = [];
    if(b.node.type) chips.push(b.node.type);
    if(b.node.tags?.length) chips.push(...b.node.tags.slice(0,3));
    const chipText = chips.join(' · ');
    if(chipText){ g.appendChild(text(b.x+12, b.y+40, chipText, 'node-chip')); }

    // expand/collapse toggle
    if(b.node.children?.length){
      const t = document.createElementNS('http://www.w3.org/2000/svg','text');
      t.setAttribute('x', b.x + NODE_W - 18);
      t.setAttribute('y', b.y + 22);
      t.setAttribute('class','node-toggle');
      t.textContent = collapsed.has(b.node.id) ? '▸' : '▾';
      t.dataset.id = b.node.id;
      t.style.cursor = 'pointer';
      t.addEventListener('click', (e)=>{ e.stopPropagation(); 
        if(collapsed.has(b.node.id)) collapsed.delete(b.node.id); else collapsed.add(b.node.id);
        render();
      });
      g.appendChild(t);
    }

    // interactions
    r.addEventListener('mouseenter', e => showTip(e, b.node));
    r.addEventListener('mouseleave', hideTip);
    r.addEventListener('click', () => handleNodeAction(b.node));
    title.addEventListener('mouseenter', e => showTip(e, b.node));
    title.addEventListener('mouseleave', hideTip);

    b.children.forEach(drawBox);
  }
  rootLayout.boxes.forEach(drawBox);

  applyTransform();
}
function showTip(e, n){
  tip.style.display='block';
  tip.style.left = (e.clientX + 12) + 'px';
  tip.style.top = (e.clientY + 12) + 'px';
  const lines = [];
  lines.push(`<strong>${escapeHTML(n.title)}</strong>`);
  if(n.summary) lines.push(escapeHTML(n.summary));
  if(n.type) lines.push(`<span class="node-badge">${escapeHTML(n.type)}</span>`);
  if(n.tags?.length) lines.push(`<span class="node-badge">#${n.tags.join(' #')}</span>`);
  tip.innerHTML = lines.join('<br>');
}
function hideTip(){ tip.style.display='none'; }

function handleNodeAction(n){
  if(n.type==='link' && n.href){ window.open(n.href,'_blank'); return; }
  if(n.prompt){ copyToClipboard(n.prompt).then(()=>toast('Copied')); }
  else { toast('Group node'); }
}
function escapeHTML(s){
  const map = {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"};
  return s.replace(/[&<>"']/g, c => map[c]);
}

// render when data is ready or changes
onDataReady(render);
