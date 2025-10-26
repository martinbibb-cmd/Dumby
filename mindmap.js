/* Grove Map: multiple roots, horizontal branching, grow/zoom animation, tap-to-expand */
(function(){
  const svg = document.getElementById('map-svg');
  const tip = document.getElementById('map-tip');
  const btnCenter = document.getElementById('map-center');
  const btnZoomIn = document.getElementById('map-zoom-in');
  const btnZoomOut = document.getElementById('map-zoom-out');
  const btnExpand = document.getElementById('map-expand');
  const btnCollapse = document.getElementById('map-collapse');
  const btnDone = document.getElementById('map-done');

  // view state
  let scale = 1, tx = 0, ty = 0;
  let dragging = false, last = null;
  let collapsed = new Set(JSON.parse(localStorage.getItem('dumby.collapsed')||'[]'));

  const NODE_W = 240, NODE_H = 56, X_GAP = 72, Y_GAP = 12, ROOT_GAP = 80, RADIUS = 10;

  const colorMap = {accent:'#66d9ef', good:'#9be39b', warn:'#f7c948', bad:'#ff6b6b'};
  const colorFor = n => n.color && n.color.startsWith('#') ? n.color : (colorMap[n.color] || '#66d9ef');

  // expose entry point
  window.renderGrove = (animate=false) => draw(animate);

  // pan/zoom
  svg.addEventListener('mousedown',e=>{ if(e.target.closest('.node-toggle')) return; dragging=true; last={x:e.clientX,y:e.clientY}; });
  svg.addEventListener('mousemove',e=>{ if(!dragging) return; tx += (e.clientX-last.x); ty += (e.clientY-last.y); last={x:e.clientX,y:e.clientY}; applyTransform(); });
  window.addEventListener('mouseup',()=>dragging=false);
  svg.addEventListener('wheel',e=>{ e.preventDefault(); const f=Math.pow(1.0015,-e.deltaY); scale*=f; applyTransform(); },{passive:false});

  btnCenter.onclick = ()=>{ tx=0; ty=0; scale=1; applyTransform(); };
  btnZoomIn.onclick = ()=>{ scale*=1.15; applyTransform(); };
  btnZoomOut.onclick = ()=>{ scale/=1.15; applyTransform(); };
  btnExpand.onclick = ()=>{ collapsed.clear(); persistCollapsed(); draw(false); };
  btnCollapse.onclick = ()=>{ collapsed = new Set(allNodeIds()); persistCollapsed(); draw(false); };
  btnDone.onclick = ()=>{ btnDone.style.display='none'; btnCollapse.click(); };

  // draw
  function draw(animate){
    if(!window.DumbyStore || !DumbyStore.nodes.length) return;
    clearSVG();
    const world = g('g'); world.id='world'; svg.appendChild(world);

    // Layout multiple roots horizontally spaced like a grove
    const roots = DumbyStore.nodes;
    let yCursor = 80;
    const rootBoxes = [];
    for(const root of roots){
      const layoutRes = layout([root], 40, yCursor);
      rootBoxes.push(...layoutRes.boxes);
      yCursor += layoutRes.height + ROOT_GAP;
    }

    // Edges (curved horizontal)
    rootBoxes.forEach(drawEdges);
    // Nodes
    rootBoxes.forEach(drawBox);

    // Initial cinematic: zoom-out & grow lines
    if(animate){
      scale = 1.18; tx = 20; ty = 0; applyTransform();
      btnDone.style.display='none';
      setTimeout(()=>{ // after edges popped in, reveal Done
        btnDone.style.display='block';
      }, 900);
      // smooth zoom to 1
      const start=performance.now(), dur=850, s0=scale;
      requestAnimationFrame(function step(t){
        const k=Math.min(1,(t-start)/dur);
        scale = s0 - (s0-1)*easeOutCubic(k);
        applyTransform();
        if(k<1) requestAnimationFrame(step);
      });
    }
  }

  function easeOutCubic(x){ return 1 - Math.pow(1 - x, 3); }

  function drawEdges(box){
    for(const c of box.children){
      const x1 = box.x + NODE_W, y1 = box.y + NODE_H/2;
      const x2 = c.x, y2 = c.y + NODE_H/2;
      const mx = (x1 + x2) / 2;
      const p = path(`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`, 'edge grow-edge');
      svg.querySelector('#world').appendChild(p);
      drawEdges(c);
    }
  }

  function drawBox(b){
    const col = colorFor(b.node);
    const world = svg.querySelector('#world');

    const r = rect(b.x, b.y, NODE_W, NODE_H, RADIUS, 'node-rect grow-node'); r.setAttribute('stroke', col);
    const t = text(b.x+12, b.y+22, b.node.title, 'node-title grow-node');
    world.appendChild(r); world.appendChild(t);

    // chips
    const chips=[];
    if(b.node.type) chips.push(b.node.type);
    if(b.node.tags?.length) chips.push(...b.node.tags.slice(0,3));
    if(chips.length) world.appendChild(text(b.x+12, b.y+40, chips.join(' · '), 'node-chip grow-node'));

    // toggle
    if(b.node.children?.length){
      const tog = text(b.x + NODE_W - 18, b.y + 22, collapsed.has(b.node.id)?'▸':'▾', 'node-toggle');
      tog.addEventListener('click', (e)=>{ e.stopPropagation(); toggleNode(b.node.id); });
      world.appendChild(tog);
    }

    // hover tip
    const show=(e)=>{ tip.style.display='block'; tip.style.left=(e.clientX+12)+'px'; tip.style.top=(e.clientY+12)+'px';
      tip.innerHTML = `<strong>${esc(b.node.title)}</strong>${b.node.summary?'<br>'+esc(b.node.summary):''}`; };
    const hide=()=> tip.style.display='none';
    r.addEventListener('mouseenter',show); r.addEventListener('mouseleave',hide); t.addEventListener('mouseenter',show); t.addEventListener('mouseleave',hide);

    // click node
    r.addEventListener('click',()=>handleNodeAction(b.node));
    t.addEventListener('click',()=>handleNodeAction(b.node));

    // children
    b.children.forEach(drawBox);
  }

  function handleNodeAction(node){
    // Grow/collapse on tap; copy/open when leaf
    if(node.children?.length){
      toggleNode(node.id);
      return;
    }
    if(node.type==='link' && node.href){ window.open(node.href,'_blank'); return; }
    if(node.prompt){ copyToClipboard(node.prompt).then(()=>toast('Copied')); }
    else { toast('Group node'); }
  }

  function toggleNode(id){
    if(collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
    persistCollapsed(); draw(false);
  }
  function persistCollapsed(){ localStorage.setItem('dumby.collapsed', JSON.stringify([...collapsed])); }

  // recursive horizontal layout
  function layout(nodes, x0, y0){
    let y = y0; const boxes=[];
    for(const n of nodes){
      const visibleChildren = (!collapsed.has(n.id) && n.children?.length) ? n.children : [];
      const childLayout = visibleChildren.length ? layout(visibleChildren, x0 + NODE_W + X_GAP, y) : {height: NODE_H, boxes: []};
      const h = Math.max(NODE_H, childLayout.height);
      boxes.push({node:n, x:x0, y:y + h/2 - NODE_H/2, width:NODE_W, height:NODE_H, children:childLayout.boxes});
      y += h + Y_GAP;
    }
    return { height: (y - y0) - Y_GAP, boxes };
  }

  // utils
  const g = name => document.createElementNS('http://www.w3.org/2000/svg', name);
  const rect = (x,y,w,h,r,cls)=>{ const el=g('rect'); el.setAttribute('x',x); el.setAttribute('y',y); el.setAttribute('width',w); el.setAttribute('height',h); el.setAttribute('rx',r); el.setAttribute('class',cls); return el; };
  const path = (d,cls)=>{ const p=g('path'); p.setAttribute('d',d); p.setAttribute('class',cls); return p; };
  const text = (x,y,c,cls)=>{ const t=g('text'); t.setAttribute('x',x); t.setAttribute('y',y); t.setAttribute('class',cls); t.textContent=c; return t; };
  const esc = s => (s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  function applyTransform(){
    const world = svg.querySelector('#world');
    if(world) world.setAttribute('transform', `translate(${tx},${ty}) scale(${scale})`);
  }

  function clearSVG(){ while(svg.firstChild) svg.removeChild(svg.firstChild); }

  function allNodeIds(){
    const ids=[];
    (function walk(arr){ for(const n of arr){ ids.push(n.id); if(n.children) walk(n.children); } })(DumbyStore.nodes);
    return ids;
  }

  // re-render on data changes
  window.onDumbyData?.(()=>draw(false));
})();
