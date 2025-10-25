const STORAGE_KEY = 'dumby.prompts';
const PREFS_KEY = 'dumby.prefs';

const elements = {
  tree: document.getElementById('tree'),
  categoryList: document.getElementById('category-list'),
  stats: document.getElementById('stats'),
  toast: document.getElementById('toast'),
  search: document.getElementById('search'),
  toggles: {
    descriptions: document.getElementById('toggle-descriptions'),
    compact: document.getElementById('toggle-compact'),
    dark: document.getElementById('toggle-dark')
  },
  buttons: {
    add: document.getElementById('btn-add'),
    exportJson: document.getElementById('btn-export'),
    exportMarkdown: document.getElementById('btn-export-md'),
    exportOpml: document.getElementById('btn-export-opml'),
    reset: document.getElementById('btn-reset')
  },
  fileInput: document.getElementById('file-import'),
  dialog: document.getElementById('edit-dialog'),
  form: document.getElementById('edit-form'),
  formTitle: document.getElementById('edit-title'),
  fields: {
    category: document.getElementById('f-category'),
    title: document.getElementById('f-title'),
    summary: document.getElementById('f-summary'),
    prompt: document.getElementById('f-prompt')
  },
  categoryDatalist: document.getElementById('category-datalist')
};

const state = {
  nodes: [],
  seed: [],
  selectedCategory: 'all',
  searchTerm: '',
  editingId: null,
  prefs: {
    showSummaries: true,
    compact: false,
    dark: true
  }
};

const clone = value => (typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)));

function showToast(message) {
  const el = elements.toast;
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

function loadPrefs() {
  const raw = localStorage.getItem(PREFS_KEY);
  if (raw) {
    try {
      const stored = JSON.parse(raw);
      if (stored && typeof stored === 'object') {
        state.prefs = { ...state.prefs, ...stored };
      }
    } catch (err) {
      console.warn('Failed to parse prefs', err);
    }
  } else if (window.matchMedia) {
    state.prefs.dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  applyPrefsToUI();
}

function savePrefs() {
  localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs));
}

function applyPrefsToUI() {
  const { descriptions, compact, dark } = elements.toggles;
  descriptions.checked = state.prefs.showSummaries;
  compact.checked = state.prefs.compact;
  dark.checked = state.prefs.dark;
  document.body.classList.toggle('no-summaries', !state.prefs.showSummaries);
  document.body.classList.toggle('compact', state.prefs.compact);
  document.body.classList.toggle('theme-light', !state.prefs.dark);
}

async function loadData() {
  const local = localStorage.getItem(STORAGE_KEY);
  if (local) {
    try {
      const parsed = JSON.parse(local);
      if (parsed && Array.isArray(parsed.nodes)) {
        state.nodes = parsed.nodes;
        state.seed = parsed.seed ? clone(parsed.seed) : clone(parsed.nodes);
        return;
      }
    } catch (error) {
      console.warn('Failed to parse stored prompts', error);
    }
  }

  const response = await fetch('./data/prompts.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Unable to load prompts.json');
  }
  const data = await response.json();
  if (!Array.isArray(data.nodes)) {
    throw new Error('Invalid prompts.json structure');
  }
  state.nodes = clone(data.nodes);
  state.seed = clone(data.nodes);
  persistNodes();
}

function persistNodes() {
  const payload = {
    nodes: state.nodes,
    seed: state.seed
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function buildNodeMap(nodes) {
  const map = new Map();
  nodes.forEach(node => {
    map.set(node.id, { ...node, children: [] });
  });
  const roots = [];
  map.forEach(node => {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

function filterNodes(tree) {
  const search = state.searchTerm.trim().toLowerCase();
  const selectedCategory = state.selectedCategory;

  function matches(node) {
    const categoryOk = selectedCategory === 'all' || node.category === selectedCategory;
    if (!categoryOk) return false;
    if (!search) return true;
    const haystack = `${node.title} ${node.summary ?? ''} ${node.prompt}`.toLowerCase();
    return haystack.includes(search);
  }

  function filterNode(node) {
    const filteredChildren = node.children.map(filterNode).filter(Boolean);
    const nodeMatches = matches(node);
    if (nodeMatches || filteredChildren.length) {
      return { ...node, children: filteredChildren };
    }
    return null;
  }

  return tree.map(filterNode).filter(Boolean);
}

function renderTree() {
  const tree = buildNodeMap(state.nodes);
  const filtered = filterNodes(tree);
  elements.tree.innerHTML = '';
  const template = document.getElementById('prompt-item');

  function renderNode(node) {
    const fragment = template.content.cloneNode(true);
    const li = fragment.querySelector('.node');
    const collapseBtn = fragment.querySelector('.collapse');
    const titleEl = fragment.querySelector('.node-title');
    const summaryEl = fragment.querySelector('.node-summary');
    const copyBtn = fragment.querySelector('.copy');
    const editBtn = fragment.querySelector('.edit');
    const deleteBtn = fragment.querySelector('.delete');
    const childrenEl = fragment.querySelector('.children');

    titleEl.textContent = node.title;
    summaryEl.textContent = node.summary || '—';
    collapseBtn.addEventListener('click', () => {
      li.classList.toggle('collapsed');
    });

    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(node.prompt);
        showToast('Prompt copied to clipboard');
      } catch (error) {
        console.error(error);
        showToast('Copy failed');
      }
    });

    editBtn.addEventListener('click', () => openEditor(node.id));
    deleteBtn.addEventListener('click', () => deleteNode(node.id));

    if (node.children.length) {
      node.children.map(renderNode).forEach(child => childrenEl.appendChild(child));
    }
    return li;
  }

  filtered.map(renderNode).forEach(nodeEl => elements.tree.appendChild(nodeEl));
  renderStats();
}

function renderStats() {
  const total = state.nodes.length;
  const categories = new Set(state.nodes.map(n => n.category));
  const orphanCount = state.nodes.filter(n => n.parentId && !state.nodes.some(other => other.id === n.parentId)).length;
  elements.stats.innerHTML = `
    <div><strong>${total}</strong> prompts</div>
    <div><strong>${categories.size}</strong> categories</div>
    ${orphanCount ? `<div>${orphanCount} orphaned</div>` : ''}
  `;
}

function renderCategories() {
  const categories = Array.from(new Set(state.nodes.map(n => n.category))).filter(Boolean).sort((a, b) => a.localeCompare(b));
  elements.categoryList.innerHTML = '';

  function addCategoryButton(value, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.classList.toggle('active', state.selectedCategory === value);
    button.addEventListener('click', () => {
      state.selectedCategory = value;
      renderCategories();
      renderTree();
    });
    const li = document.createElement('li');
    li.appendChild(button);
    elements.categoryList.appendChild(li);
  }

  addCategoryButton('all', 'All prompts');
  categories.forEach(cat => addCategoryButton(cat, cat));

  elements.categoryDatalist.innerHTML = categories.map(cat => `<option value="${cat}"></option>`).join('');
}

function openEditor(id = null) {
  state.editingId = id;
  const parentLabelId = 'f-parent';
  let parentField = elements.form.querySelector(`#${parentLabelId}`);
  if (!parentField) {
    const label = document.createElement('label');
    label.textContent = 'Parent prompt';
    const select = document.createElement('select');
    select.id = parentLabelId;
    select.name = 'parentId';
    label.appendChild(select);
    elements.form.insertBefore(label, elements.form.querySelector('.dialog-actions'));
    parentField = select;
  } else {
    parentField = elements.form.querySelector(`#${parentLabelId}`);
  }

  populateParentOptions(parentField, id);

  if (id) {
    const node = state.nodes.find(n => n.id === id);
    if (!node) return;
    elements.formTitle.textContent = 'Edit Prompt';
    elements.fields.category.value = node.category;
    elements.fields.title.value = node.title;
    elements.fields.summary.value = node.summary || '';
    elements.fields.prompt.value = node.prompt;
    parentField.value = node.parentId || '';
  } else {
    elements.formTitle.textContent = 'Add Prompt';
    elements.form.reset();
    elements.fields.category.value = '';
    elements.fields.title.value = '';
    elements.fields.summary.value = '';
    elements.fields.prompt.value = '';
    parentField.value = '';
  }
  elements.dialog.showModal();
}

function populateParentOptions(select, excludeId) {
  select.innerHTML = '<option value="">— Top level —</option>';
  state.nodes.forEach(node => {
    if (node.id === excludeId) return;
    const option = document.createElement('option');
    option.value = node.id;
    option.textContent = node.title;
    select.appendChild(option);
  });
}

elements.form.addEventListener('submit', event => {
  event.preventDefault();
  const formData = new FormData(elements.form);
  const data = Object.fromEntries(formData.entries());
  const parentId = data.parentId || null;
  const payload = {
    category: data.category.trim(),
    title: data.title.trim(),
    summary: data.summary.trim(),
    prompt: data.prompt.trim(),
    parentId
  };

  if (!payload.category || !payload.title || !payload.prompt) {
    showToast('Please fill the required fields');
    return;
  }

  if (state.editingId) {
    const index = state.nodes.findIndex(n => n.id === state.editingId);
    if (index === -1) return;
    state.nodes[index] = { ...state.nodes[index], ...payload };
    showToast('Prompt updated');
  } else {
    const id = createId(payload.title);
    state.nodes.push({ id, ...payload });
    showToast('Prompt added');
  }

  elements.dialog.close();
  persistNodes();
  renderCategories();
  renderTree();
});

elements.dialog.addEventListener('close', () => {
  state.editingId = null;
});

function deleteNode(id) {
  const node = state.nodes.find(n => n.id === id);
  if (!node) return;
  if (!confirm(`Delete "${node.title}" and its children?`)) return;

  const descendants = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    state.nodes.forEach(n => {
      if (n.parentId && descendants.has(n.parentId) && !descendants.has(n.id)) {
        descendants.add(n.id);
        changed = true;
      }
    });
  }
  state.nodes = state.nodes.filter(n => !descendants.has(n.id));
  persistNodes();
  renderCategories();
  renderTree();
  showToast('Prompt deleted');
}

function createId(title) {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'prompt';
  let candidate = base;
  let i = 2;
  while (state.nodes.some(n => n.id === candidate)) {
    candidate = `${base}-${i++}`;
  }
  return candidate;
}

function exportFile(filename, content, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

elements.buttons.exportJson.addEventListener('click', () => {
  exportFile('dumby-prompts.json', JSON.stringify({ version: 1, nodes: state.nodes }, null, 2));
  showToast('Exported JSON');
});

elements.buttons.exportMarkdown.addEventListener('click', () => {
  const lines = [];
  const tree = buildNodeMap(state.nodes);
  function walk(node, depth = 0) {
    const indent = '  '.repeat(depth);
    lines.push(`${indent}- **${node.title}**${node.summary ? ` — ${node.summary}` : ''}`);
    lines.push(`${indent}  - Prompt: ${node.prompt}`);
    node.children.forEach(child => walk(child, depth + 1));
  }
  tree.forEach(node => walk(node));
  exportFile('dumby-prompts.md', lines.join('\n'), 'text/markdown');
  showToast('Exported Markdown');
});

elements.buttons.exportOpml.addEventListener('click', () => {
  const tree = buildNodeMap(state.nodes);
  function buildOutline(node) {
    const outline = document.createElement('outline');
    outline.setAttribute('text', node.title);
    if (node.summary) outline.setAttribute('summary', node.summary);
    outline.setAttribute('prompt', node.prompt);
    node.children.forEach(child => outline.appendChild(buildOutline(child)));
    return outline;
  }
  const xmlDoc = document.implementation.createDocument('', '', null);
  const opml = xmlDoc.createElement('opml');
  opml.setAttribute('version', '2.0');
  const head = xmlDoc.createElement('head');
  const title = xmlDoc.createElement('title');
  title.textContent = 'Dumby Prompt Tree';
  head.appendChild(title);
  opml.appendChild(head);
  const body = xmlDoc.createElement('body');
  tree.forEach(node => body.appendChild(buildOutline(node)));
  opml.appendChild(body);
  const serializer = new XMLSerializer();
  exportFile('dumby-prompts.opml', serializer.serializeToString(opml), 'text/xml');
  showToast('Exported OPML');
});

elements.buttons.add.addEventListener('click', () => openEditor());

elements.buttons.reset.addEventListener('click', () => {
  if (!confirm('Reset to the default prompt set? Your local changes will be lost.')) return;
  state.nodes = clone(state.seed);
  persistNodes();
  renderCategories();
  renderTree();
  showToast('Seed prompts restored');
});

elements.fileInput.addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!Array.isArray(parsed.nodes)) {
        throw new Error('Invalid JSON: missing "nodes" array');
      }
      state.nodes = parsed.nodes;
      persistNodes();
      renderCategories();
      renderTree();
      showToast('Imported prompts');
    } catch (error) {
      console.error(error);
      showToast('Import failed');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
});

elements.search.addEventListener('input', event => {
  state.searchTerm = event.target.value;
  renderTree();
});

elements.toggles.descriptions.addEventListener('change', event => {
  state.prefs.showSummaries = event.target.checked;
  applyPrefsToUI();
  savePrefs();
});

elements.toggles.compact.addEventListener('change', event => {
  state.prefs.compact = event.target.checked;
  applyPrefsToUI();
  savePrefs();
});

elements.toggles.dark.addEventListener('change', event => {
  state.prefs.dark = event.target.checked;
  applyPrefsToUI();
  savePrefs();
});

async function init() {
  loadPrefs();
  try {
    await loadData();
  } catch (error) {
    console.error(error);
    showToast('Could not load prompts.json');
    state.nodes = [];
    state.seed = [];
  }
  renderCategories();
  renderTree();
}

init();
