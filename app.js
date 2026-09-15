const STORAGE_KEY = "listo:data";

/** @typedef {{ id: string, text: string, checked: boolean }} Item */
/** @typedef {{ id: string, name: string, items: Item[] }} Section */
/** @typedef {{ id: string, name: string, sections: Section[] }} ListoList */

let state = { lists: [], activeListId: null };

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.lists)) {
        state = parsed;
      }
    }
  } catch (e) {
    console.warn("Listo: failed to load saved data", e);
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("Listo: failed to save data", e);
  }
}

function getActiveList() {
  return state.lists.find((l) => l.id === state.activeListId) || null;
}

// ---- Mutations ----

function createList(name) {
  const list = { id: uid(), name: name || "New List", sections: [] };
  state.lists.push(list);
  state.activeListId = list.id;
  save();
  render();
}

function deleteList(listId) {
  const list = state.lists.find((l) => l.id === listId);
  if (!list) return;
  if (!confirm(`Delete "${list.name}"? This can't be undone.`)) return;
  state.lists = state.lists.filter((l) => l.id !== listId);
  if (state.activeListId === listId) {
    state.activeListId = state.lists[0]?.id ?? null;
  }
  save();
  render();
}

function renameList(listId, name) {
  const list = state.lists.find((l) => l.id === listId);
  if (!list) return;
  list.name = name.trim() || list.name;
  save();
}

function resetList(listId) {
  const list = state.lists.find((l) => l.id === listId);
  if (!list) return;
  list.sections.forEach((s) => s.items.forEach((i) => (i.checked = false)));
  save();
  render();
}

function addSection(listId, name) {
  const list = state.lists.find((l) => l.id === listId);
  if (!list || !name.trim()) return;
  list.sections.push({ id: uid(), name: name.trim(), items: [] });
  save();
  render();
}

function deleteSection(listId, sectionId) {
  const list = state.lists.find((l) => l.id === listId);
  if (!list) return;
  list.sections = list.sections.filter((s) => s.id !== sectionId);
  save();
  render();
}

function renameSection(listId, sectionId, name) {
  const list = state.lists.find((l) => l.id === listId);
  const section = list?.sections.find((s) => s.id === sectionId);
  if (!section) return;
  section.name = name.trim() || section.name;
  save();
}

function addItem(listId, sectionId, text) {
  const list = state.lists.find((l) => l.id === listId);
  const section = list?.sections.find((s) => s.id === sectionId);
  if (!section || !text.trim()) return;
  section.items.push({ id: uid(), text: text.trim(), checked: false });
  save();
  render();
}

function toggleItem(listId, sectionId, itemId) {
  const list = state.lists.find((l) => l.id === listId);
  const section = list?.sections.find((s) => s.id === sectionId);
  const item = section?.items.find((i) => i.id === itemId);
  if (!item) return;
  item.checked = !item.checked;
  save();
  render();
}

function deleteItem(listId, sectionId, itemId) {
  const list = state.lists.find((l) => l.id === listId);
  const section = list?.sections.find((s) => s.id === sectionId);
  if (!section) return;
  section.items = section.items.filter((i) => i.id !== itemId);
  save();
  render();
}

// ---- Import / Export ----

async function exportList(listId) {
  const list = state.lists.find((l) => l.id === listId);
  if (!list) return;
  const payload = {
    listo: true,
    version: 1,
    exportedAt: new Date().toISOString(),
    list,
  };
  const safeName = list.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "list";
  const filename = `${safeName}.listo.json`;
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });

  // iOS Safari's share sheet only accepts a whitelist of "safe" file types
  // (image/video/audio/pdf/text); application/json isn't on it, so the
  // shared file is typed text/plain here even though it's saved as .json.
  const shareFile = new File([json], filename, { type: "text/plain" });

  // On iOS/most mobile browsers this opens the native share sheet (AirDrop,
  // Messages, etc). Falls back to a direct download where file sharing
  // isn't supported (most desktop browsers).
  if (navigator.canShare && navigator.canShare({ files: [shareFile] })) {
    try {
      await navigator.share({ files: [shareFile], title: list.name });
      return;
    } catch (e) {
      if (e.name === "AbortError") return; // user dismissed the share sheet
      console.warn("Listo: share failed, falling back to download", e);
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const source = parsed && parsed.list ? parsed.list : parsed;
      if (!source || typeof source.name !== "string" || !Array.isArray(source.sections)) {
        throw new Error("Not a valid Listo file");
      }
      const newList = {
        id: uid(),
        name: source.name,
        sections: source.sections.map((s) => ({
          id: uid(),
          name: String(s.name ?? "Section"),
          items: Array.isArray(s.items)
            ? s.items.map((i) => ({
                id: uid(),
                text: String(i.text ?? ""),
                checked: false,
              }))
            : [],
        })),
      };
      state.lists.push(newList);
      state.activeListId = newList.id;
      save();
      render();
    } catch (e) {
      alert("Couldn't import that file — it doesn't look like a valid Listo list.");
      console.warn(e);
    }
  };
  reader.readAsText(file);
}

// ---- Rendering ----

const listNav = document.getElementById("listNav");
const listView = document.getElementById("listView");

// Every mutation does a full re-render, which replaces DOM nodes and would
// normally drop focus (and dismiss the on-screen keyboard). When set, the
// next render refocuses the "add item" input for this section so adding
// items in quick succession doesn't require tapping back in each time.
let refocusSectionId = null;

function listProgress(list) {
  const items = list.sections.flatMap((s) => s.items);
  const done = items.filter((i) => i.checked).length;
  return { done, total: items.length };
}

function render() {
  renderNav();
  renderListView();
  if (refocusSectionId) {
    const input = listView.querySelector(
      `[data-section-id="${refocusSectionId}"] .inline-add input`
    );
    refocusSectionId = null;
    if (input) input.focus();
  }
}

function renderNav() {
  listNav.innerHTML = "";
  if (state.lists.length === 0) {
    const empty = document.createElement("div");
    empty.className = "nav-empty";
    empty.textContent = "No lists yet.";
    listNav.appendChild(empty);
    return;
  }

  state.lists.forEach((list) => {
    const { done, total } = listProgress(list);
    const item = document.createElement("div");
    item.className = "nav-item" + (list.id === state.activeListId ? " active" : "");
    item.innerHTML = `
      <span class="nav-item-name">${escapeHtml(list.name)}</span>
      <span class="nav-item-progress">${done}/${total}</span>
    `;
    item.addEventListener("click", () => {
      state.activeListId = list.id;
      save();
      render();
    });
    listNav.appendChild(item);
  });
}

function renderListView() {
  listView.innerHTML = "";
  const list = getActiveList();

  if (!list) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No lists yet — create one to get started.";
    listView.appendChild(empty);
    return;
  }

  const header = document.createElement("div");
  header.className = "list-header";

  const titleInput = document.createElement("input");
  titleInput.className = "list-title";
  titleInput.value = list.name;
  titleInput.addEventListener("change", () => renameList(list.id, titleInput.value));

  const actions = document.createElement("div");
  actions.className = "list-actions";

  const resetBtn = makeButton("↺ Reset", "btn btn-reset", () => resetList(list.id));
  const exportBtn = makeButton("Export", "btn btn-ghost btn-sm", () => exportList(list.id));
  const deleteBtn = makeButton("Delete", "btn btn-danger btn-sm", () => deleteList(list.id));

  actions.append(resetBtn, exportBtn, deleteBtn);
  header.append(titleInput, actions);
  listView.appendChild(header);

  list.sections.forEach((section) => {
    listView.appendChild(renderSection(list, section));
  });

  listView.appendChild(renderAddSectionRow(list));
}

function renderSection(list, section) {
  const card = document.createElement("div");
  card.className = "section-card";
  card.dataset.sectionId = section.id;

  const headerEl = document.createElement("div");
  headerEl.className = "section-header";

  const nameInput = document.createElement("input");
  nameInput.className = "section-title";
  nameInput.value = section.name;
  nameInput.addEventListener("change", () => renameSection(list.id, section.id, nameInput.value));

  const removeBtn = makeButton("Remove section", "btn btn-danger btn-sm", () =>
    deleteSection(list.id, section.id)
  );

  headerEl.append(nameInput, removeBtn);
  card.appendChild(headerEl);

  section.items.forEach((item) => {
    card.appendChild(renderItem(list, section, item));
  });

  const addItemRow = document.createElement("div");
  addItemRow.className = "inline-add";
  const input = document.createElement("input");
  input.placeholder = "Add item…";
  const submitItem = () => {
    if (!input.value.trim()) return;
    refocusSectionId = section.id;
    addItem(list.id, section.id, input.value);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitItem();
    }
  });
  const addBtn = makeButton("Add", "btn btn-primary btn-sm", submitItem);
  addItemRow.append(input, addBtn);
  card.appendChild(addItemRow);

  return card;
}

function renderItem(list, section, item) {
  const row = document.createElement("div");
  row.className = "item-row" + (item.checked ? " checked" : "");

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = item.checked;
  checkbox.addEventListener("change", () => toggleItem(list.id, section.id, item.id));

  const label = document.createElement("span");
  label.className = "item-label";
  label.textContent = item.text;
  label.addEventListener("click", () => toggleItem(list.id, section.id, item.id));

  const del = document.createElement("button");
  del.className = "item-delete";
  del.textContent = "×";
  del.setAttribute("aria-label", "Delete item");
  del.addEventListener("click", () => deleteItem(list.id, section.id, item.id));

  row.append(checkbox, label, del);
  return row;
}

function renderAddSectionRow(list) {
  const row = document.createElement("div");
  row.className = "inline-add add-section-row";
  const input = document.createElement("input");
  input.placeholder = "Add section (e.g. Clothes, Food, Documents)…";
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      addSection(list.id, input.value);
    }
  });
  const addBtn = makeButton("Add section", "btn btn-ghost btn-sm", () => addSection(list.id, input.value));
  row.append(input, addBtn);
  return row;
}

function makeButton(text, className, onClick) {
  const btn = document.createElement("button");
  btn.className = className;
  btn.textContent = text;
  btn.addEventListener("click", onClick);
  return btn;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---- Wiring ----

document.getElementById("newListBtn").addEventListener("click", () => {
  const name = prompt("List name:", "New List");
  if (name !== null) createList(name);
});

document.getElementById("importBtn").addEventListener("click", () => {
  document.getElementById("importInput").click();
});

document.getElementById("importInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) importFromFile(file);
  e.target.value = "";
});

load();
if (!state.activeListId && state.lists.length > 0) {
  state.activeListId = state.lists[0].id;
}
render();
