/** Dumby App – Prompt Tree (local-first PWA) */
const LS_KEY = 'dumby.prompts.v1';
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const els = {
  tree: $('#tree'),
  cats: $('#category-list'),
  search: $('#search'),
  toast: $('#toast'),
  editDialog: $('#edit-dialog'),
  editForm: $('#edit-form'),
  stats: $('#stats'),
  catList: $('#category-datalist'),
  btnAdd: $('#btn-add'),
  btnExport: $('#btn-export'),
  btnExportMD: $('#btn-export-md'),
  btnExportOPML: $('#btn-export-opml'),
  btnReset: $('#btn-reset'),
  fileImport: $('#file-import'),
  toggleCompact: $('#toggle-compact'),
  toggleDark: $('#toggle-dark'),
  tagFilter: $('#tag-filter'),
  favoritesToggle: $('#toggle-favorites'),
  emptyState: $('#empty-state'),
  templateDialog: $('#template-dialog'),
  templateForm: $('#template-form'),
  templateBody: $('#template-body'),
  confirmDialog: $('#confirm-dialog'),
  confirmMessage: $('#confirm-message'),
  confirmOk: $('#confirm-ok'),
  confirmCancel: $('#confirm-cancel'),
  promptField: $('#f-prompt'),
  tagsField: $('#f-tags')
};

let prompts = [];
let filter = { q: '', cat: 'All', tags: new Set(), favoritesOnly: false };
let toastTimer = null;
let templateState = null;
let dragState = null;

init();

async function init() {
  attachUI();
  await loadData();
  renderAll();
  registerSW();
}

function attachUI() {
  const toggleDescriptions = $('#toggle-descriptions');
  if (toggleDescriptions) {
    const apply = () => document.body.classList.toggle('nosummaries', !toggleDescriptions.checked);
    toggleDescriptions.addEventListener('change', apply);
    apply();
  }

  if (els.toggleCompact) {
    els.toggleCompact.addEventListener('change', () => {
      document.body.classList.toggle('compact', els.toggleCompact.checked);
    });
  }

  if (els.toggleDark) {
    const storedTheme = localStorage.getItem('dumby.theme') || 'dark';
    els.toggleDark.checked = storedTheme === 'dark';
    document.documentElement.classList.toggle('light', storedTheme !== 'dark');
    els.toggleDark.addEventListener('change', () => {
      const dark = els.toggleDark.checked;
      document.documentElement.classList.toggle('light', !dark);
      localStorage.setItem('dumby.theme', dark ? 'dark' : 'light');
    });
  }

  els.search?.addEventListener('input', () => {
    filter.q = els.search.value.toLowerCase().trim();
    renderAll();
  });

  els.favoritesToggle?.addEventListener('change', () => {
    filter.favoritesOnly = !!els.favoritesToggle.checked;
    renderAll();
  });

  els.btnAdd?.addEventListener('click', () => openEditor());
  els.btnExport?.addEventListener('click', () => downloadText(JSON.stringify(prompts, null, 2), 'dumby_prompts.json', 'application/json'));
  els.btnExportMD?.addEventListener('click', () => downloadText(toMarkdown(prompts), 'dumby_prompts.md', 'text/markdown'));
  els.btnExportOPML?.addEventListener('click', () => downloadText(toOPML(prompts), 'dumby_prompts.opml', 'text/xml'));
  els.btnReset?.addEventListener('click', resetSeed);
  els.fileImport?.addEventListener('change', importJSON);
  els.editForm?.addEventListener('submit', onEditSubmit);

  if (els.promptField) {
    els.promptField.addEventListener('input', () => autoResize(els.promptField));
  }

  if (els.templateForm) {
    els.templateForm.addEventListener('submit', onTemplateSubmit);
  }

  if (els.templateDialog) {
    els.templateDialog.addEventListener('close', () => {
      templateState = null;
      if (els.templateBody) els.templateBody.innerHTML = '';
    });
  }
}

async function loadData() {
  const cached = localStorage.getItem(LS_KEY);
  if (cached) {
    try {
      prompts = JSON.parse(cached);
      normalizePrompts();
      return;
    } catch (err) {
      console.warn('Could not parse cached prompts', err);
    }
  }
  try {
    const response = await fetch('./data/prompts.json', { cache: 'no-store' });
    prompts = await response.json();
    normalizePrompts();
    sync();
  } catch {
    prompts = [];
  }
}

function normalizePrompts() {
  prompts = prompts.map((p, idx) => {
    const tags = Array.isArray(p.tags)
      ? p.tags.map(cleanTag).filter(Boolean)
      : typeof p.tags === 'string'
        ? p.tags.split(',').map(cleanTag).filter(Boolean)
        : [];
    return {
      id: p.id || crypto.randomUUID(),
      category: (p.category || '').trim() || 'Unsorted',
      title: (p.title || '').trim() || 'Untitled',
      summary: (p.summary || '').trim(),
      prompt: (p.prompt || '').toString(),
      tags,
      favorite: !!p.favorite,
      order: typeof p.order === 'number' ? p.order : idx
    };
  });
  normalizeOrders();
}

function cleanTag(tag) {
  return tag?.toString().trim().replace(/\s+/g, ' ');
}

function normalizeOrders() {
  const byCat = groupBy(prompts, p => p.category);
  Object.values(byCat).forEach(arr => {
    arr.sort(byOrder);
    arr.forEach((p, idx) => {
      p.order = idx;
    });
  });
}

function byOrder(a, b) {
  const ao = typeof a.order === 'number' ? a.order : 0;
  const bo = typeof b.order === 'number' ? b.order : 0;
  return ao - bo || a.title.localeCompare(b.title);
}

function renderAll() {
  ensureActiveCategory();
  renderCats();
  renderTagFilter();
  renderTree();
  updateStats();
}

function ensureActiveCategory() {
  if (filter.cat === 'All') return;
  if (!prompts.some(p => p.category === filter.cat)) {
    filter.cat = 'All';
  }
}

function renderCats() {
  const counts = prompts.reduce((map, p) => {
    map[p.category] = (map[p.category] || 0) + 1;
    return map;
  }, {});
  const cats = ['All', ...Array.from(new Set(prompts.map(p => p.category))).sort((a, b) => a.localeCompare(b))];
  if (els.cats) {
    els.cats.innerHTML = '';
    cats.forEach(cat => {
      const li = document.createElement('li');
      li.className = 'cat-item';
      li.dataset.cat = cat;

      const row = document.createElement('div');
      row.className = 'cat-row';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cat-button' + (filter.cat === cat ? ' active' : '');
      btn.setAttribute('aria-pressed', filter.cat === cat ? 'true' : 'false');
      btn.textContent = cat;
      const count = document.createElement('span');
      count.className = 'cat-count';
      count.textContent = cat === 'All' ? prompts.length : (counts[cat] || 0);
      btn.appendChild(count);
      btn.addEventListener('click', () => {
        filter.cat = cat;
        renderAll();
      });

      row.appendChild(btn);

      if (cat !== 'All') {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'cat-delete';
        del.title = `Delete category "${cat}"`;
        del.setAttribute('aria-label', `Delete category ${cat}`);
        del.textContent = '🗑';
        del.addEventListener('click', async ev => {
          ev.stopPropagation();
          if (await confirmAction(`Delete category "${cat}" and all of its prompts?`)) {
            deleteCategory(cat);
          }
        });
        row.appendChild(del);

        row.addEventListener('dragover', e => {
          if (!dragState) return;
          e.preventDefault();
          row.classList.add('drag-over');
        });
        row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
        row.addEventListener('drop', e => {
          if (!dragState) return;
          e.preventDefault();
          row.classList.remove('drag-over');
          movePrompt(dragState.id, cat, null, 'after');
        });
      }

      li.appendChild(row);
      els.cats.appendChild(li);
    });
  }

  if (els.catList) {
    els.catList.innerHTML = cats
      .filter(c => c !== 'All')
      .map(c => `<option value="${escapeHTML(c)}">`)
      .join('');
  }
}

function renderTagFilter() {
  if (!els.tagFilter) return;
  const tags = Array.from(new Set(prompts.flatMap(p => p.tags || []))).sort((a, b) => a.localeCompare(b));
  const active = filter.tags;
  const available = new Set(tags);
  for (const tag of Array.from(active)) {
    if (!available.has(tag)) active.delete(tag);
  }

  els.tagFilter.innerHTML = '';
  if (!tags.length) {
    const span = document.createElement('span');
    span.className = 'tag-filter-empty';
    span.textContent = 'No tags yet';
    els.tagFilter.appendChild(span);
    return;
  }

  tags.forEach(tag => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tag-chip' + (active.has(tag) ? ' active' : '');
    btn.textContent = tag;
    btn.addEventListener('click', () => {
      if (active.has(tag)) {
        active.delete(tag);
      } else {
        active.add(tag);
      }
      renderAll();
    });
    els.tagFilter.appendChild(btn);
  });

  if (active.size) {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'tag-chip clear';
    clear.textContent = 'Clear';
    clear.addEventListener('click', () => {
      active.clear();
      renderAll();
    });
    els.tagFilter.appendChild(clear);
  }
}

function renderTree() {
  dragState = null;
  if (!els.tree) return;
  els.tree.innerHTML = '';
  const tpl = $('#prompt-item');
  if (!tpl) return;

  const selectedTags = Array.from(filter.tags);
  const list = prompts.filter(p => {
    if (filter.cat !== 'All' && p.category !== filter.cat) return false;
    if (filter.favoritesOnly && !p.favorite) return false;
    if (selectedTags.length && !selectedTags.every(tag => p.tags.includes(tag))) return false;
    const hay = `${p.title} ${p.summary || ''} ${p.prompt} ${p.category} ${(p.tags || []).join(' ')}`.toLowerCase();
    return !filter.q || hay.includes(filter.q);
  });

  if (els.emptyState) {
    els.emptyState.hidden = list.length > 0;
  }
  if (!list.length) return;

  const byCat = groupBy(list, p => p.category);
  Object.entries(byCat)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([cat, arr]) => {
      const node = tpl.content.firstElementChild.cloneNode(true);
      node.classList.add('category-node');
      node.dataset.category = cat;
      node.querySelector('.node-title').textContent = cat;
      node.querySelector('.node-summary').textContent = `${arr.length} prompt${arr.length !== 1 ? 's' : ''}`;
      node.querySelector('.favorite')?.remove();
      node.querySelector('.prompt-viewer')?.remove();
      node.querySelector('.node-tags')?.remove();
      const actions = node.querySelector('.node-actions');
      if (actions) actions.innerHTML = '';

      const collapse = node.querySelector('.collapse');
      collapse.addEventListener('click', () => {
        const open = collapse.textContent === '▾';
        collapse.textContent = open ? '▸' : '▾';
        node.querySelector('.children').style.display = open ? 'none' : '';
      });

      const ul = node.querySelector('.children');
      ul.innerHTML = '';
      arr.sort(byOrder).forEach(p => ul.appendChild(renderLeaf(p, tpl)));
      ul.addEventListener('dragover', e => {
        if (!dragState) return;
        e.preventDefault();
        ul.classList.add('drag-over');
      });
      ul.addEventListener('dragleave', () => ul.classList.remove('drag-over'));
      ul.addEventListener('drop', e => {
        if (!dragState) return;
        e.preventDefault();
        ul.classList.remove('drag-over');
        movePrompt(dragState.id, cat, null, 'after');
      });

      els.tree.appendChild(node);
    });
}

function renderLeaf(p, tpl) {
  const li = tpl.content.firstElementChild.cloneNode(true);
  li.classList.add('prompt-leaf');
  li.dataset.id = p.id;
  li.dataset.category = p.category;
  li.setAttribute('draggable', 'true');

  li.querySelector('.collapse')?.remove();
  li.querySelector('.children')?.remove();

  li.querySelector('.node-title').textContent = p.title;
  li.querySelector('.node-summary').textContent = p.summary || '';

  const tagsEl = li.querySelector('.node-tags');
  if (p.tags?.length) {
    tagsEl.innerHTML = '';
    p.tags.forEach(tag => {
      const span = document.createElement('span');
      span.className = 'tag-pill';
      span.textContent = tag;
      tagsEl.appendChild(span);
    });
  } else {
    tagsEl.remove();
  }
  const favBtn = li.querySelector('.favorite');
  favBtn.classList.toggle('active', !!p.favorite);
  favBtn.setAttribute('aria-pressed', p.favorite ? 'true' : 'false');
  favBtn.textContent = p.favorite ? '★' : '☆';
  favBtn.addEventListener('click', () => {
    p.favorite = !p.favorite;
    favBtn.classList.toggle('active', p.favorite);
    favBtn.setAttribute('aria-pressed', p.favorite ? 'true' : 'false');
    favBtn.textContent = p.favorite ? '★' : '☆';
    sync();
    toast(p.favorite ? 'Added to favorites' : 'Removed from favorites');
  });

  li.querySelector('.copy').addEventListener('click', () => handleCopy(p));
  li.querySelector('.edit').addEventListener('click', () => openEditor(p));
  li.querySelector('.delete').addEventListener('click', async () => {
    if (await confirmAction('Delete this prompt?')) {
      prompts = prompts.filter(x => x.id !== p.id);
      normalizeOrders();
      sync();
      toast('Prompt deleted');
    }
  });

  const details = li.querySelector('.prompt-viewer');
  if (details) {
    const body = details.querySelector('.prompt-markdown');
    body.innerHTML = renderMarkdown(p.prompt);
  }

  li.addEventListener('dragstart', e => {
    dragState = { id: p.id };
    li.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', p.id);
    }
  });
  li.addEventListener('dragend', () => {
    dragState = null;
    li.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
  });
  li.addEventListener('dragover', e => {
    if (!dragState || dragState.id === p.id) return;
    e.preventDefault();
    const rect = li.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    li.classList.toggle('drag-over-top', before);
    li.classList.toggle('drag-over-bottom', !before);
  });
  li.addEventListener('dragleave', () => {
    li.classList.remove('drag-over-top', 'drag-over-bottom');
  });
  li.addEventListener('drop', e => {
    if (!dragState || dragState.id === p.id) return;
    e.preventDefault();
    const rect = li.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    li.classList.remove('drag-over-top', 'drag-over-bottom');
    movePrompt(dragState.id, p.category, p.id, before ? 'before' : 'after');
  });

  return li;
}

function updateStats() {
  if (!els.stats) return;
  const total = prompts.length;
  const cats = new Set(prompts.map(p => p.category)).size;
  const favs = prompts.filter(p => p.favorite).length;
  els.stats.textContent = `${total} prompts • ${cats} categories • ${favs} favorites`;
}

function openEditor(p) {
  const isEdit = !!p;
  $('#edit-title').textContent = isEdit ? 'Edit Prompt' : 'Add Prompt';
  els.editForm.reset();
  els.editForm.dataset.id = isEdit ? p.id : '';
  $('#f-category').value = isEdit ? p.category : (filter.cat !== 'All' ? filter.cat : '');
  $('#f-title').value = isEdit ? p.title : '';
  $('#f-summary').value = isEdit ? (p.summary || '') : '';
  if (els.tagsField) {
    els.tagsField.value = isEdit ? (p.tags || []).join(', ') : '';
  }
  if (els.promptField) {
    els.promptField.value = isEdit ? p.prompt : '';
    autoResize(els.promptField);
  }
  els.editDialog.showModal();
}

function autoResize(el) {
  if (!el) return;
  requestAnimationFrame(() => {
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 160)}px`;
  });
}

function onEditSubmit(e) {
  e.preventDefault();
  const id = els.editForm.dataset.id || crypto.randomUUID();
  const category = $('#f-category').value.trim();
  const title = $('#f-title').value.trim();
  const summary = $('#f-summary').value.trim();
  const promptText = els.promptField.value.trim();
  const tags = parseTags(els.tagsField?.value || '');
  if (!category || !title || !promptText) return;

  const existingIndex = prompts.findIndex(x => x.id === id);
  if (existingIndex >= 0) {
    const existing = prompts[existingIndex];
    const movedCategory = existing.category !== category;
    prompts[existingIndex] = {
      ...existing,
      category,
      title,
      summary,
      prompt: promptText,
      tags
    };
    if (movedCategory) {
      prompts[existingIndex].order = getNextOrder(category);
    }
  } else {
    prompts.push({
      id,
      category,
      title,
      summary,
      prompt: promptText,
      tags,
      favorite: false,
      order: getNextOrder(category)
    });
  }

  normalizeOrders();
  els.editDialog.close();
  sync();
  toast('Saved');
}

function parseTags(raw) {
  if (!raw) return [];
  return raw.split(',').map(cleanTag).filter(Boolean);
}

function getNextOrder(category) {
  const arr = prompts.filter(p => p.category === category);
  return arr.length;
}

async function resetSeed() {
  if (!(await confirmAction('Reload seed data? This will overwrite your current prompts.'))) return;
  try {
    const response = await fetch('./data/prompts.json', { cache: 'no-store' });
    prompts = await response.json();
    normalizePrompts();
    sync();
    toast('Seed reloaded');
  } catch {
    alert('Could not load seed file.');
  }
}

function importJSON(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data)) throw new Error('Invalid JSON');
      data.forEach(item => {
        if (!item.id) item.id = crypto.randomUUID();
        if (!item.category || !item.title || !item.prompt) {
          throw new Error('Missing required fields');
        }
      });
      prompts = data;
      normalizePrompts();
      sync();
      toast('Imported');
    } catch (err) {
      alert('Import failed: ' + err.message);
    } finally {
      ev.target.value = '';
    }
  };
  reader.readAsText(file);
}

function handleCopy(p) {
  const variables = extractTemplateVariables(p.prompt);
  if (variables.length) {
    openTemplateDialog(p, variables);
  } else {
    copyToClipboard(p.prompt);
  }
}

function extractTemplateVariables(text) {
  const found = new Set();
  const regex = /\[([A-Za-z0-9_-]+)\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    found.add(match[1]);
  }
  return Array.from(found);
}

function openTemplateDialog(p, variables) {
  if (!els.templateDialog || !els.templateBody) {
    copyToClipboard(p.prompt);
    return;
  }
  templateState = { prompt: p.prompt, variables };
  els.templateBody.innerHTML = '';
  variables.forEach(name => {
    const wrapper = document.createElement('label');
    const span = document.createElement('span');
    span.textContent = name;
    const input = document.createElement('input');
    input.type = 'text';
    input.dataset.name = name;
    input.placeholder = name;
    wrapper.appendChild(span);
    wrapper.appendChild(input);
    els.templateBody.appendChild(wrapper);
  });
  els.templateDialog.showModal();
  const firstInput = els.templateBody.querySelector('input');
  if (firstInput) firstInput.focus();
}

function onTemplateSubmit(ev) {
  ev.preventDefault();
  if (!templateState) {
    els.templateDialog.close();
    return;
  }
  const values = {};
  els.templateBody.querySelectorAll('input').forEach(input => {
    values[input.dataset.name] = input.value;
  });
  const finalText = templateState.prompt.replace(/\[([A-Za-z0-9_-]+)\]/g, (full, name) => {
    return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : full;
  });
  els.templateDialog.close();
  templateState = null;
  copyToClipboard(finalText);
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied!');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('Copied!');
  }
}

function toast(msg) {
  if (!els.toast) return;
  clearTimeout(toastTimer);
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  toastTimer = setTimeout(() => {
    els.toast.classList.remove('show');
  }, 1800);
}

function confirmAction(message) {
  if (!els.confirmDialog || typeof els.confirmDialog.showModal !== 'function') {
    return Promise.resolve(window.confirm(message));
  }
  return new Promise(resolve => {
    const handler = () => {
      resolve(els.confirmDialog.returnValue === 'confirm');
    };
    els.confirmDialog.addEventListener('close', handler, { once: true });
    els.confirmMessage.textContent = message;
    els.confirmDialog.showModal();
  });
}

function movePrompt(id, targetCategory, referenceId, position) {
  const prompt = prompts.find(p => p.id === id);
  if (!prompt) return;
  const fromCategory = prompt.category;
  const toCategory = targetCategory || prompt.category;
  prompt.category = toCategory;

  const toList = prompts.filter(p => p.category === toCategory && p.id !== id).sort(byOrder);
  let insertIndex = toList.length;
  if (referenceId) {
    const idx = toList.findIndex(p => p.id === referenceId);
    if (idx >= 0) {
      insertIndex = idx + (position === 'after' ? 1 : 0);
    }
  }
  toList.splice(insertIndex, 0, prompt);
  toList.forEach((item, idx) => {
    item.order = idx;
  });

  if (fromCategory !== toCategory) {
    const fromList = prompts.filter(p => p.category === fromCategory).sort(byOrder);
    fromList.forEach((item, idx) => {
      item.order = idx;
    });
  }

  dragState = null;
  sync();
  toast('Prompt reordered');
}

function deleteCategory(cat) {
  prompts = prompts.filter(p => p.category !== cat);
  if (filter.cat === cat) filter.cat = 'All';
  normalizeOrders();
  sync();
  toast('Category deleted');
}

function sync() {
  localStorage.setItem(LS_KEY, JSON.stringify(prompts));
  renderAll();
}

const groupBy = (arr, fn) => arr.reduce((map, item) => {
  const key = fn(item);
  if (!map[key]) map[key] = [];
  map[key].push(item);
  return map;
}, {});

const escapeHTML = s => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

function renderMarkdown(md) {
  if (!md) return '';
  const codeBlocks = [];
  let text = md.replace(/```([\s\S]*?)```/g, (_match, code) => {
    const token = `__CODEBLOCK_${codeBlocks.length}__`;
    codeBlocks.push(`<pre><code>${escapeHTML(code.trim())}</code></pre>`);
    return token;
  });

  const lines = text.split(/\r?\n/);
  const html = [];
  let inList = false;
  lines.forEach(line => {
    const tokenMatch = line.match(/^__CODEBLOCK_(\d+)__$/);
    if (tokenMatch) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      html.push(codeBlocks[Number(tokenMatch[1])]);
      return;
    }

    if (!line.trim()) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      html.push('');
      return;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      const level = heading[1].length;
      html.push(`<h${level}>${formatInline(heading[2])}</h${level}>`);
      return;
    }

    const listMatch = line.trim().match(/^[-*]\s+(.*)$/);
    if (listMatch) {
      if (!inList) {
        html.push('<ul>');
        inList = true;
      }
      html.push(`<li>${formatInline(listMatch[1])}</li>`);
      return;
    }

    if (inList) {
      html.push('</ul>');
      inList = false;
    }

    html.push(`<p>${formatInline(line)}</p>`);
  });

  if (inList) html.push('</ul>');

  return html.filter(Boolean).join('\n');
}

function formatInline(text) {
  let t = escapeHTML(text);
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\*(.+?)\*/g, '<em>$1</em>');
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  t = t.replace(/\[([A-Za-z0-9_-]+)\]/g, '<span class="placeholder">[$1]</span>');
  return t.replace(/\n/g, '<br>');
}

function downloadText(text, name, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toMarkdown(list) {
  const byCat = groupBy(list, p => p.category);
  const out = ['# Dumby Prompts', ''];
  Object.entries(byCat).sort((a, b) => a[0].localeCompare(b[0])).forEach(([cat, arr]) => {
    out.push(`## ${cat}`, '');
    arr.sort(byOrder).forEach(p => {
      out.push(`### ${p.title}`);
      if (p.summary) out.push(p.summary);
      if (p.tags?.length) out.push(`Tags: ${p.tags.join(', ')}`);
      out.push('', '```', p.prompt, '```', '');
    });
  });
  return out.join('\n');
}

function toOPML(list) {
  const byCat = groupBy(list, p => p.category);
  const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const out = [`<?xml version="1.0" encoding="UTF-8"?>`, `<opml version="2.0"><head><title>Dumby Prompts</title></head><body>`, `<outline text="Dumby Prompts">`];
  Object.entries(byCat).sort((a, b) => a[0].localeCompare(b[0])).forEach(([cat, arr]) => {
    out.push(`  <outline text="${esc(cat)}">`);
    arr.sort(byOrder).forEach(p => {
      const extras = [];
      if (p.summary) extras.push(p.summary);
      if (p.tags?.length) extras.push(`Tags: ${p.tags.join(', ')}`);
      const subtitle = extras.length ? ` – ${esc(extras.join(' • '))}` : '';
      out.push(`    <outline text="${esc(p.title + subtitle)}"><outline text="${esc(p.prompt)}"/></outline>`);
    });
    out.push('  </outline>');
  });
  out.push('</outline></body></opml>');
  return out.join('\n');
}

async function registerSW() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch {
      /* noop */
    }
  }
}
