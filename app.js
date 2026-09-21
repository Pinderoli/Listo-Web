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

// Backfills sections saved before stack rotation became a stored
// per-section value, and re-rolls any rotation left over from before the
// max angle (or the adjacent-card step limit) was tightened — all via
// enforceRotationAdjacency, which is idempotent, so a section already
// satisfying both rules is never touched again on a later load.
function migrateMissingRotations() {
  let changed = false;
  state.lists.forEach((list) => {
    if (enforceRotationAdjacency(list)) changed = true;
  });
  if (changed) save();
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
  unstackedLists.delete(listId);
  delete expandedInStack[listId];
  expandedAddSection.delete(listId);
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
  const prevRotation = list.sections.length > 0 ? list.sections[list.sections.length - 1].rotation : null;
  const section = { id: uid(), name: name.trim(), items: [], rotation: randomStackRotation(prevRotation) };
  list.sections.push(section);
  animateNewCardId = section.id;
  save();
  render();
}

function deleteSection(listId, sectionId) {
  const list = state.lists.find((l) => l.id === listId);
  const section = list?.sections.find((s) => s.id === sectionId);
  if (!list || !section) return;
  if (!confirm(`Delete section "${section.name}"? This can't be undone.`)) return;
  list.sections = list.sections.filter((s) => s.id !== sectionId);
  // Removing a section can bring two previously non-adjacent sections
  // next to each other, which might not satisfy the 1deg step limit.
  enforceRotationAdjacency(list);
  save();
  render();
}

function renameSection(listId, sectionId, name) {
  const list = state.lists.find((l) => l.id === listId);
  const section = list?.sections.find((s) => s.id === sectionId);
  if (!section) return;
  section.name = name.trim() || section.name;
  save();
  render();
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
          rotation: typeof s.rotation === "number" ? s.rotation : undefined,
          items: Array.isArray(s.items)
            ? s.items.map((i) => ({
                id: uid(),
                text: String(i.text ?? ""),
                checked: false,
              }))
            : [],
        })),
      };
      // Validates each section's rotation against the overall range and
      // the 1deg-from-the-previous-section step limit, re-rolling any
      // that don't fit (including every one lacking a stored value, e.g.
      // files exported before rotation existed).
      enforceRotationAdjacency(newList);
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
let refocusAddSectionListId = null;

// Which lists currently have their "Add Section" control expanded. Its
// open/close animation is handled with plain CSS transitions on the
// persistent DOM node directly (not through render()) so it can animate
// smoothly in both directions; this set just keeps a from-scratch render
// (triggered by something unrelated) showing the right state.
const expandedAddSection = new Set();

// UI-only view state (not persisted). The condensed stack view is the
// default for any list with more than one section — this set tracks
// lists the user has explicitly switched to the flat "view all" list
// instead, opt-out rather than opt-in. expandedInStack tracks which
// section (if any) is currently pulled out of the stack for focused
// viewing.
const unstackedLists = new Set();
const expandedInStack = {};

// One-shot animation flags. Every mutation does a full re-render, so
// without these the "cards settle into a deck" / "card pops out of the
// deck" animations would replay on every unrelated re-render (e.g.
// checking an item) instead of just the transition that triggered them.
let animateDeckEntrance = false;
let animateSectionPopId = null;
let animateSectionCollapseId = null;
let animateNewCardId = null;

// Each section's stack tilt is a fixed random value in [-3, 3] degrees,
// rolled once (when the section is created) and stored on the section
// itself, rather than computed from its position in the deck. Random
// per-card tilt looks more like a real stack of loose cards than a
// deliberate fan, without guaranteeing any particular card lands at the
// extreme of the range the way a position-based spread would. It's also
// constrained to land within STACK_ROTATION_STEP_DEG of the section
// directly above it, so neighboring cards never swing from one extreme
// straight to the other (e.g. -3deg next to +3deg). The first section in
// a list is the one exception — always flat at 0deg, reading as a clean
// anchor for the stack rather than tilted at random like the rest.
const STACK_MAX_ROTATION_DEG = 3;
const STACK_ROTATION_STEP_DEG = 1;

// prevRotation is the rotation of the section directly above this one in
// the deck (not a number if there isn't one, e.g. the first section in a
// list — which always comes back flat).
function randomStackRotation(prevRotation) {
  if (typeof prevRotation !== "number") return 0;
  const min = Math.max(-STACK_MAX_ROTATION_DEG, prevRotation - STACK_ROTATION_STEP_DEG);
  const max = Math.min(STACK_MAX_ROTATION_DEG, prevRotation + STACK_ROTATION_STEP_DEG);
  return +(min + Math.random() * (max - min)).toFixed(2);
}

// Walks a list's sections in order, re-rolling any rotation that's
// missing, outside the overall range, more than STACK_ROTATION_STEP_DEG
// away from the section above it, or (for the first section) not exactly
// 0. Returns whether anything changed.
function enforceRotationAdjacency(list) {
  let prev = null;
  let changed = false;
  list.sections.forEach((section) => {
    const valid =
      typeof section.rotation === "number" &&
      Math.abs(section.rotation) <= STACK_MAX_ROTATION_DEG &&
      (prev === null ? section.rotation === 0 : Math.abs(section.rotation - prev) <= STACK_ROTATION_STEP_DEG);
    if (!valid) {
      section.rotation = randomStackRotation(prev);
      changed = true;
    }
    prev = section.rotation;
  });
  return changed;
}

function listProgress(list) {
  const items = list.sections.flatMap((s) => s.items);
  const done = items.filter((i) => i.checked).length;
  return { done, total: items.length };
}

function sectionProgress(section) {
  const done = section.items.filter((i) => i.checked).length;
  return { done, total: section.items.length };
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
  if (refocusAddSectionListId) {
    const input = listView.querySelector(
      `.add-section[data-list-id="${refocusAddSectionListId}"] .add-section-input`
    );
    refocusAddSectionListId = null;
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
      closeNavDrawer();
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

  const listMenu = buildDropdownMenu(
    "List options",
    [
      { label: "Export", onClick: () => exportList(list.id) },
      { label: "Delete", danger: true, onClick: () => deleteList(list.id) },
    ],
    { openRight: true }
  );
  actions.append(listMenu);
  if (list.sections.length > 1) {
    const stacked = !unstackedLists.has(list.id);
    const stackBtn = makeButton(
      stacked ? "▦ View all" : "🗂 Stack",
      "btn btn-ghost btn-sm",
      () => toggleStackMode(list.id)
    );
    actions.append(stackBtn);
  }
  const { done: doneCount } = listProgress(list);
  const resetBtn = makeButton(
    "↺ Reset",
    "btn btn-reset" + (doneCount > 0 ? " has-checked" : ""),
    () => resetList(list.id)
  );
  actions.append(resetBtn);
  header.append(titleInput, actions);
  listView.appendChild(header);

  const stacked = list.sections.length > 1 && !unstackedLists.has(list.id);
  let expandedId = expandedInStack[list.id] || null;
  if (expandedId && !list.sections.some((s) => s.id === expandedId)) {
    expandedId = null;
    expandedInStack[list.id] = null;
  }

  if (stacked && expandedId) {
    listView.appendChild(renderSplitStack(list, expandedId));
  } else if (stacked) {
    listView.appendChild(renderStackedDeck(list));
    listView.appendChild(renderAddSectionRow(list));
  } else {
    list.sections.forEach((section) => {
      listView.appendChild(renderSection(list, section));
    });
    listView.appendChild(renderAddSectionRow(list));
  }
  animateSectionPopId = null;
  animateNewCardId = null;
}

function toggleStackMode(listId) {
  if (unstackedLists.has(listId)) {
    unstackedLists.delete(listId);
    animateDeckEntrance = true;
  } else {
    unstackedLists.add(listId);
    expandedInStack[listId] = null;
  }
  render();
}

function expandStackedSection(listId, sectionId) {
  expandedInStack[listId] = sectionId;
  animateSectionPopId = sectionId;
  render();
}

function collapseStack(listId) {
  animateSectionCollapseId = expandedInStack[listId];
  expandedInStack[listId] = null;
  render();
}

// Builds one condensed "stacked-card" pill. Shared by the full deck and
// the above/below mini-decks either side of an expanded section.
function makeStackedCard(list, section, { rotateDeg, zIndex, hasMarginTop, animate, delayIndex, slideIn, collapseFrom }) {
  const card = document.createElement("div");
  card.className =
    "stacked-card" + (animate ? " deck-in" : slideIn ? " slide-in" : collapseFrom ? " collapse-in" : "");
  if (hasMarginTop) card.style.marginTop = "-10px";
  card.style.setProperty("--rot", `${rotateDeg.toFixed(2)}deg`);
  card.style.setProperty("--i", String(delayIndex));
  card.style.zIndex = String(zIndex);

  const { done, total } = sectionProgress(section);
  const title = document.createElement("span");
  title.className = "stacked-card-title";
  title.textContent = section.name;
  const progress = document.createElement("span");
  progress.className = "stacked-card-progress";
  progress.textContent = `${done}/${total}`;

  card.append(title, progress);
  card.addEventListener("click", () => expandStackedSection(list.id, section.id));
  return card;
}

function renderStackedDeck(list) {
  const deck = document.createElement("div");
  deck.className = "section-deck";
  const count = list.sections.length;
  const shouldAnimate = animateDeckEntrance;
  animateDeckEntrance = false;
  const newCardId = animateNewCardId;
  animateNewCardId = null;
  const collapseId = animateSectionCollapseId;
  animateSectionCollapseId = null;

  list.sections.forEach((section, index) => {
    deck.appendChild(
      makeStackedCard(list, section, {
        rotateDeg: section.rotation,
        zIndex: count - index,
        hasMarginTop: index > 0,
        animate: shouldAnimate,
        delayIndex: index,
        slideIn: section.id === newCardId,
        collapseFrom: section.id === collapseId,
      })
    );
  });

  return deck;
}

// A short condensed deck holding just the sections above or below the
// currently expanded one — each section keeps its own stored tilt
// regardless of which group it's currently rendered in.
function renderMiniDeck(list, sections, animate) {
  const deck = document.createElement("div");
  deck.className = "section-deck mini";

  sections.forEach((section, i) => {
    deck.appendChild(
      makeStackedCard(list, section, {
        rotateDeg: section.rotation,
        zIndex: sections.length - i,
        hasMarginTop: i > 0,
        animate,
        delayIndex: i,
      })
    );
  });

  return deck;
}

// Tapping a stacked card no longer opens an isolated full-screen section
// with a "back" button — instead the tapped section expands in place,
// with any sections before it condensed into a mini-deck above and any
// after it condensed into a mini-deck below, so switching between
// sections is just tapping another condensed card, no back-and-forth.
function renderSplitStack(list, expandedId) {
  const wrap = document.createElement("div");
  wrap.className = "split-stack";

  const expandedIndex = list.sections.findIndex((s) => s.id === expandedId);
  const expandedSection = list.sections[expandedIndex];
  const above = list.sections.slice(0, expandedIndex);
  const below = list.sections.slice(expandedIndex + 1);

  const shouldAnimateDeck = animateDeckEntrance;
  animateDeckEntrance = false;

  if (above.length > 0) wrap.appendChild(renderMiniDeck(list, above, shouldAnimateDeck));

  const sectionEl = renderSection(list, expandedSection, {
    onCollapse: () => collapseStack(list.id),
  });
  if (animateSectionPopId === expandedSection.id) {
    sectionEl.style.setProperty("--from-rot", `${expandedSection.rotation}deg`);
    sectionEl.classList.add("pop-in");
  }
  wrap.appendChild(sectionEl);

  if (below.length > 0) wrap.appendChild(renderMiniDeck(list, below, shouldAnimateDeck));

  return wrap;
}

function renderSection(list, section, opts = {}) {
  const card = document.createElement("div");
  card.className = "section-card";
  card.dataset.sectionId = section.id;

  const headerEl = document.createElement("div");
  headerEl.className = "section-header";
  // In the split-stack view (opts.onCollapse set), the whole header bar
  // doubles as the collapse control — tapping it mirrors how tapping a
  // condensed card opens it. The menu's own clicks stop propagation so
  // opening/using it doesn't also collapse the section.
  if (opts.onCollapse) {
    headerEl.classList.add("collapsible");
    headerEl.addEventListener("click", () => opts.onCollapse());
  }

  const title = document.createElement("span");
  title.className = "section-title";
  title.textContent = section.name;

  const menu = buildDropdownMenu("Section options", [
    {
      label: "Rename",
      onClick: () => {
        const name = prompt("Section name:", section.name);
        if (name !== null) renameSection(list.id, section.id, name);
      },
    },
    { label: "Delete", danger: true, onClick: () => deleteSection(list.id, section.id) },
  ]);
  headerEl.append(title, menu);
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
  const wrap = document.createElement("div");
  wrap.className = "add-section" + (expandedAddSection.has(list.id) ? " expanded" : "");
  wrap.dataset.listId = list.id;

  const input = document.createElement("input");
  input.className = "add-section-input";
  input.placeholder = "Add section…";

  // addSection() re-renders synchronously, which tears down this very
  // input element while it's focused — removing a focused element from
  // the DOM fires a real "blur" event. Without this guard the blur
  // handler below would misread that as the user clicking away and
  // collapse the (freshly rebuilt) control right after each add.
  let suppressBlurCollapse = false;
  const submitSection = () => {
    if (!input.value.trim()) return;
    refocusAddSectionListId = list.id;
    suppressBlurCollapse = true;
    addSection(list.id, input.value);
    suppressBlurCollapse = false;
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitSection();
    }
  });
  // Folds back in on blur, with plain CSS transitions on this persistent
  // node (not a re-render) so it can animate smoothly either direction.
  input.addEventListener("blur", () => {
    if (suppressBlurCollapse) return;
    if (!expandedAddSection.has(list.id)) return;
    expandedAddSection.delete(list.id);
    wrap.classList.remove("expanded");
    input.value = "";
  });

  const trigger = makeButton("Add Section", "add-section-trigger", () => {
    if (expandedAddSection.has(list.id)) return;
    expandedAddSection.add(list.id);
    wrap.classList.add("expanded");
    input.focus();
  });

  wrap.append(trigger, input);
  return wrap;
}

function makeButton(text, className, onClick) {
  const btn = document.createElement("button");
  btn.className = className;
  btn.textContent = text;
  btn.addEventListener("click", onClick);
  return btn;
}

// Builds a "⋮" trigger that reveals a small dropdown of actions — shared
// by the per-section options menu and the per-list options menu. The
// section menu sits at the right edge of its card, so its dropdown opens
// leftward (the default); the list menu now sits at the left edge of the
// header, so openRight flips it to open rightward instead — otherwise it
// renders off the left edge of the viewport and becomes unreachable.
function buildDropdownMenu(ariaLabel, items, { openRight = false } = {}) {
  const menu = document.createElement("details");
  menu.className = "dropdown-menu" + (openRight ? " open-right" : "");
  menu.addEventListener("click", (e) => e.stopPropagation());

  const trigger = document.createElement("summary");
  trigger.className = "dropdown-menu-trigger";
  trigger.textContent = "⋮";
  trigger.setAttribute("aria-label", ariaLabel);

  const menuList = document.createElement("div");
  menuList.className = "dropdown-menu-list";
  items.forEach(({ label, danger, onClick }) => {
    menuList.appendChild(
      makeButton(label, "dropdown-menu-item" + (danger ? " danger" : ""), () => {
        menu.removeAttribute("open");
        onClick();
      })
    );
  });

  menu.append(trigger, menuList);
  return menu;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---- Wiring ----

// Custom "New List" naming dialog, replacing the native prompt() popup.
const newListModalBackdrop = document.getElementById("newListModalBackdrop");
const newListModal = document.getElementById("newListModal");
const newListModalInput = document.getElementById("newListModalInput");

function openNewListModal() {
  newListModalInput.value = "";
  newListModalBackdrop.classList.add("visible");
  newListModal.classList.add("visible");
  // rAF so the input is focused after the opening transition has started
  // rather than racing it on some browsers.
  requestAnimationFrame(() => newListModalInput.focus());
}

function closeNewListModal() {
  newListModalBackdrop.classList.remove("visible");
  newListModal.classList.remove("visible");
}

function confirmNewListModal() {
  const name = newListModalInput.value.trim();
  if (!name) return;
  createList(name);
  closeNewListModal();
}

document.getElementById("newListBtn").addEventListener("click", openNewListModal);
document.getElementById("newListDrawerBtn").addEventListener("click", () => {
  closeNavDrawer();
  openNewListModal();
});
document.getElementById("newListModalCreate").addEventListener("click", confirmNewListModal);
document.getElementById("newListModalCancel").addEventListener("click", closeNewListModal);
newListModalBackdrop.addEventListener("click", closeNewListModal);
newListModalInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    confirmNewListModal();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && newListModal.classList.contains("visible")) {
    closeNewListModal();
  }
});

document.getElementById("importBtn").addEventListener("click", () => {
  document.getElementById("importInput").click();
  closeNavDrawer();
});

// The "☰" button toggles an off-canvas drawer (holding the list nav and
// the Import action) on narrow/mobile widths, where there's no room for
// a permanent sidebar. On wider layouts the drawer sits inline as a
// regular sidebar and the button is hidden, so open/close never applies.
const navDrawer = document.getElementById("navDrawer");
const navBackdrop = document.getElementById("navBackdrop");
const menuBtn = document.getElementById("menuBtn");

function openNavDrawer() {
  navDrawer.classList.add("open");
  navBackdrop.classList.add("visible");
  menuBtn.setAttribute("aria-expanded", "true");
}

function closeNavDrawer() {
  navDrawer.classList.remove("open");
  navBackdrop.classList.remove("visible");
  menuBtn.setAttribute("aria-expanded", "false");
}

menuBtn.addEventListener("click", () => {
  if (navDrawer.classList.contains("open")) closeNavDrawer();
  else openNavDrawer();
});

navBackdrop.addEventListener("click", closeNavDrawer);

document.getElementById("importInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) importFromFile(file);
  e.target.value = "";
});

// Close any open dropdown menu (section or list options) when tapping
// outside it — <details> has no native "click outside to close" behavior.
document.addEventListener("click", (e) => {
  document.querySelectorAll("details.dropdown-menu[open]").forEach((d) => {
    if (!d.contains(e.target)) d.removeAttribute("open");
  });
});

// Tapping outside the expanded card in split-stack view condenses it
// back into the deck — mirrors tapping the header, just from anywhere
// else on the page. Clicks on a mini-deck card are excluded since those
// already have their own handler (switch which section is expanded);
// clicks in the list header (rename/reset/export/etc.) are excluded so
// list-level actions don't also collapse the view.
document.addEventListener("click", (e) => {
  if (e.target.closest(".stacked-card")) return;
  if (e.target.closest(".list-header")) return;
  const list = getActiveList();
  if (!list) return;
  const expandedId = expandedInStack[list.id];
  if (!expandedId) return;
  const sectionCard = listView.querySelector(".split-stack > .section-card");
  if (sectionCard && !sectionCard.contains(e.target)) {
    collapseStack(list.id);
  }
});

load();
migrateMissingRotations();
if (!state.activeListId && state.lists.length > 0) {
  state.activeListId = state.lists[0].id;
}
render();
