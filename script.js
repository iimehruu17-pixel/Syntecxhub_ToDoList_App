/* =========================================================
   TASKORA — script.js
   Sections:
   1. Constants & state
   2. Storage (load / save, safe parsing)
   3. Date helpers
   4. Task operations (create, update, delete, toggle)
   5. Filtering & sorting
   6. Rendering (stats, nav, chips, tasks)
   7. Modal & confirm dialog
   8. Toasts, theme, mobile nav
   9. Event listeners & init
   ========================================================= */

(function () {
  "use strict";

  /* ---------- 1. Constants & state ---------- */
  const STORAGE_KEY = "taskora-tasks";
  const THEME_KEY = "taskora-theme";

  const CATEGORIES = {
    personal: { label: "Personal", color: "#8b7cf6", icon: "user" },
    work: { label: "Work", color: "#3d8bd9", icon: "briefcase" },
    study: { label: "Study", color: "#d98a1f", icon: "graduation-cap" },
    health: { label: "Health", color: "#299764", icon: "heart-pulse" },
    other: { label: "Other", color: "#8a8b85", icon: "tag" },
  };
  const PRIORITIES = { high: { label: "High", rank: 3 }, medium: { label: "Medium", rank: 2 }, low: { label: "Low", rank: 1 } };

  const VIEWS = {
    overview: { heading: "Focus tasks", title: "Let's make today productive.", subtitle: "Small steps, done consistently, add up to big results." },
    all: { heading: "All tasks", title: "My Tasks", subtitle: "Everything on your plate, in one place." },
    today: { heading: "Due today", title: "Today", subtitle: "" },
    upcoming: { heading: "Coming up", title: "Upcoming", subtitle: "Plan ahead — tasks due after today." },
    completed: { heading: "Completed tasks", title: "Completed", subtitle: "Nice work. Reopen anything you need to revisit." },
  };
  const OVERVIEW_LIMIT = 6;

  // All mutable UI state lives in this single object.
  const state = {
    tasks: [],
    view: "overview",
    category: "all",
    filter: "all",
    sort: "newest",
    search: "",
    layout: "list",
    editingId: null,
    deletingId: null,
    lastAddedId: null,
    isSaving: false,
    lastFocused: null,
  };

  // Cached DOM references
  const $ = (id) => document.getElementById(id);
  const el = {
    sidebar: $("sidebar"), overlay: $("overlay"), openSidebar: $("openSidebar"), closeSidebar: $("closeSidebar"),
    categoryNav: $("categoryNav"), chips: $("categoryChips"), container: $("taskContainer"),
    dashboard: $("dashboard"), viewTitle: $("viewTitle"), viewSubtitle: $("viewSubtitle"), currentDate: $("currentDate"),
    tasksHeading: $("tasksHeading"), taskCount: $("taskCount"),
    search: $("searchInput"), filter: $("filterSelect"), sort: $("sortSelect"),
    statTotal: $("statTotal"), statCompleted: $("statCompleted"), statActive: $("statActive"), statOverdue: $("statOverdue"),
    progressPercent: $("progressPercent"), progressFill: $("progressFill"), progressBar: $("progressBar"), progressNote: $("progressNote"),
    categorySummary: $("categorySummary"),
    modal: $("taskModal"), form: $("taskForm"), modalTitle: $("modalTitle"), submitBtn: $("submitBtn"),
    fTitle: $("taskTitle"), fDesc: $("taskDescription"), fCategory: $("taskCategory"), fPriority: $("taskPriority"),
    fDate: $("taskDate"), fTime: $("taskTime"), titleError: $("titleError"), timeError: $("timeError"),
    confirm: $("confirmModal"), confirmText: $("confirmText"), confirmBtn: $("confirmDeleteBtn"),
    toasts: $("toasts"),
  };

  /* ---------- 2. Storage ---------- */
  function generateId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "t-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
  }

  // Make sure a stored object is a valid task; returns null if unusable.
  function sanitizeTask(raw) {
    if (!raw || typeof raw !== "object") return null;
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    if (!title) return null;
    const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const isTime = (v) => typeof v === "string" && /^\d{2}:\d{2}$/.test(v);
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : generateId(),
      title: title.slice(0, 120),
      description: typeof raw.description === "string" ? raw.description.slice(0, 500) : "",
      category: CATEGORIES[raw.category] ? raw.category : "other",
      priority: PRIORITIES[raw.priority] ? raw.priority : "medium",
      dueDate: isDate(raw.dueDate) ? raw.dueDate : "",
      dueTime: isDate(raw.dueDate) && isTime(raw.dueTime) ? raw.dueTime : "",
      completed: raw.completed === true,
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
      completedAt: Number.isFinite(raw.completedAt) ? raw.completedAt : null,
    };
  }

  function loadTasks() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(parsed)) return [];
      const seen = new Set();
      return parsed.map(sanitizeTask).filter((t) => {
        if (!t || seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });
    } catch (err) {
      console.warn("TASKORA: stored tasks were invalid and have been reset.");
      return [];
    }
  }

  function saveTasks() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
    } catch (err) {
      showToast("Couldn't save — storage may be full or blocked.", "danger");
    }
  }

  /* ---------- 3. Date helpers (all use the browser's local time) ---------- */
  function toDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const todayKey = () => toDateKey(new Date());
  function tomorrowKey() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return toDateKey(d);
  }
  // "YYYY-MM-DD" -> local Date (avoids the UTC shift of new Date("YYYY-MM-DD"))
  function parseDateKey(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function isOverdue(task) {
    if (task.completed || !task.dueDate) return false;
    const today = todayKey();
    if (task.dueDate < today) return true;
    if (task.dueDate === today && task.dueTime) {
      const now = new Date();
      const nowTime = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
      return task.dueTime < nowTime;
    }
    return false;
  }

  function formatTime(time) {
    const [h, m] = time.split(":").map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function formatDue(task) {
    if (!task.dueDate) return "";
    let label;
    if (task.dueDate === todayKey()) label = "Today";
    else if (task.dueDate === tomorrowKey()) label = "Tomorrow";
    else {
      const date = parseDateKey(task.dueDate);
      const opts = { month: "short", day: "numeric" };
      if (date.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
      label = date.toLocaleDateString(undefined, opts);
    }
    return task.dueTime ? `${label}, ${formatTime(task.dueTime)}` : label;
  }

  function formatGroupDate(key) {
    if (key === tomorrowKey()) return "Tomorrow";
    return parseDateKey(key).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  }

  /* ---------- 4. Task operations ---------- */
  function createTask(data) {
    const task = sanitizeTask({ ...data, id: generateId(), createdAt: Date.now(), completed: false });
    state.tasks.push(task);
    state.lastAddedId = task.id;
    saveTasks();
    return task;
  }

  function updateTask(id, data) {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return null;
    Object.assign(task, sanitizeTask({ ...task, ...data }));
    saveTasks();
    return task;
  }

  function deleteTask(id) {
    state.tasks = state.tasks.filter((t) => t.id !== id);
    saveTasks();
  }

  function toggleTask(id) {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return null;
    task.completed = !task.completed;
    task.completedAt = task.completed ? Date.now() : null;
    saveTasks();
    return task;
  }

  /* ---------- 5. Filtering & sorting (never mutates state.tasks) ---------- */
  function tasksForView(view, tasks) {
    const today = todayKey();
    switch (view) {
      case "today": return tasks.filter((t) => !t.completed && t.dueDate && t.dueDate <= today);
      case "upcoming": return tasks.filter((t) => !t.completed && t.dueDate && t.dueDate > today);
      case "completed": return tasks.filter((t) => t.completed);
      case "overview": return tasks.filter((t) => !t.completed);
      default: return tasks.slice();
    }
  }

  function matchesFilter(task) {
    switch (state.filter) {
      case "active": return !task.completed;
      case "completed": return task.completed;
      case "high": case "medium": case "low": return task.priority === state.filter;
      case "overdue": return isOverdue(task);
      default: return true;
    }
  }

  function matchesSearch(task) {
    const q = state.search.trim().toLowerCase();
    if (!q) return true;
    const haystack = [task.title, task.description, CATEGORIES[task.category].label].join(" ").toLowerCase();
    return haystack.includes(q);
  }

  // Compare due dates: tasks without dates go last.
  function dueValue(t) {
    return t.dueDate ? t.dueDate + " " + (t.dueTime || "99:99") : "9999-99-99";
  }

  function sortTasks(list) {
    const sorted = list.slice();
    const sorters = {
      newest: (a, b) => b.createdAt - a.createdAt,
      oldest: (a, b) => a.createdAt - b.createdAt,
      due: (a, b) => dueValue(a).localeCompare(dueValue(b)) || b.createdAt - a.createdAt,
      priority: (a, b) => PRIORITIES[b.priority].rank - PRIORITIES[a.priority].rank || dueValue(a).localeCompare(dueValue(b)),
    };
    // Upcoming always reads chronologically
    const key = state.view === "upcoming" ? "due" : state.sort;
    sorted.sort(sorters[key]);
    if (state.view !== "completed" && state.view !== "upcoming") {
      // keep completed items below active ones
      sorted.sort((a, b) => Number(a.completed) - Number(b.completed));
    }
    return sorted;
  }

  function getVisibleTasks() {
    let list = tasksForView(state.view, state.tasks);
    if (state.category !== "all") list = list.filter((t) => t.category === state.category);
    list = list.filter(matchesFilter).filter(matchesSearch);
    return sortTasks(list);
  }

  /* ---------- 6. Rendering ---------- */
  function icon(name) {
    const i = document.createElement("i");
    i.setAttribute("data-lucide", name);
    i.setAttribute("aria-hidden", "true");
    return i;
  }
  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
  }
  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function setStat(node, value) {
    const next = String(value);
    if (node.textContent !== next) {
      node.textContent = next;
      node.classList.remove("bump");
      void node.offsetWidth; // restart animation
      node.classList.add("bump");
    }
  }

  function renderStats() {
    const total = state.tasks.length;
    const completed = state.tasks.filter((t) => t.completed).length;
    const overdue = state.tasks.filter(isOverdue).length;
    const active = total - completed;
    const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

    setStat(el.statTotal, total);
    setStat(el.statCompleted, completed);
    setStat(el.statActive, active);
    setStat(el.statOverdue, overdue);

    el.progressPercent.textContent = percent + "%";
    el.progressFill.style.width = percent + "%";
    el.progressBar.setAttribute("aria-valuenow", String(percent));
    el.progressNote.textContent = total === 0
      ? "No tasks yet — add one to get started."
      : `${completed} of ${total} tasks completed${overdue ? ` · ${overdue} overdue` : ""}.`;

    // Category summary
    el.categorySummary.replaceChildren();
    Object.entries(CATEGORIES).forEach(([key, cat]) => {
      const count = state.tasks.filter((t) => t.category === key).length;
      const li = make("li");
      const name = make("span", "cat-summary__name");
      const dot = make("span", "cat-dot");
      dot.style.background = cat.color;
      name.append(dot, document.createTextNode(cat.label));
      const bar = make("div", "cat-summary__bar");
      const fill = make("span");
      fill.style.background = cat.color;
      fill.style.width = total ? (count / total) * 100 + "%" : "0%";
      bar.append(fill);
      li.append(name, bar, make("span", "cat-summary__num", String(count)));
      el.categorySummary.append(li);
    });
  }

  function renderNav() {
    document.querySelectorAll(".nav__item[data-view]").forEach((btn) => {
      const active = btn.dataset.view === state.view && state.category === "all";
      btn.classList.toggle("is-active", active);
      if (active) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });
    document.querySelectorAll("[data-count]").forEach((node) => {
      node.textContent = String(tasksForView(node.dataset.count, state.tasks).length);
    });

    el.categoryNav.replaceChildren();
    Object.entries(CATEGORIES).forEach(([key, cat]) => {
      const li = make("li");
      const btn = make("button", "nav__item");
      btn.type = "button";
      btn.dataset.navCategory = key;
      const isActive = state.view === "all" && state.category === key;
      btn.classList.toggle("is-active", isActive);
      if (isActive) btn.setAttribute("aria-current", "page");
      const dot = make("span", "cat-dot");
      dot.style.background = cat.color;
      dot.setAttribute("aria-hidden", "true");
      btn.append(dot, make("span", "", cat.label),
        make("span", "nav__count", String(state.tasks.filter((t) => t.category === key).length)));
      li.append(btn);
      el.categoryNav.append(li);
    });
  }

  function renderChips() {
    const base = tasksForView(state.view, state.tasks);
    el.chips.replaceChildren();
    const entries = [["all", { label: "All" }], ...Object.entries(CATEGORIES)];
    entries.forEach(([key, cat]) => {
      const chip = make("button", "chip" + (state.category === key ? " is-active" : ""));
      chip.type = "button";
      chip.dataset.category = key;
      chip.setAttribute("aria-pressed", String(state.category === key));
      if (cat.color) {
        const dot = make("span", "cat-dot");
        dot.style.background = cat.color;
        dot.style.margin = "0";
        chip.append(dot);
      }
      const count = key === "all" ? base.length : base.filter((t) => t.category === key).length;
      chip.append(document.createTextNode(cat.label), make("span", "chip__count", String(count)));
      el.chips.append(chip);
    });
  }

  function renderHeader() {
    const view = VIEWS[state.view];
    const now = new Date();
    el.currentDate.textContent = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    let title = view.title;
    let heading = view.heading;
    if (state.category !== "all") {
      title = CATEGORIES[state.category].label;
      heading = state.view === "all" ? `${title} tasks` : `${heading} · ${title}`;
    }
    el.viewTitle.textContent = title;
    el.viewSubtitle.textContent = state.view === "today"
      ? "Due today, plus anything overdue so nothing slips."
      : (state.category !== "all" && state.view === "all" ? `All tasks in ${title}.` : view.subtitle);
    el.tasksHeading.textContent = heading;
    el.dashboard.hidden = state.view !== "overview";
    document.title = (state.view === "overview" ? "" : title + " · ") + "TASKORA — Smart Task Manager";
  }

  function buildTaskCard(task) {
    const overdue = isOverdue(task);
    const li = make("li", `task task--${task.priority}` + (task.completed ? " is-done" : ""));
    li.dataset.id = task.id;
    if (task.id === state.lastAddedId) li.classList.add("is-new");

    const top = make("div", "task__top");
    const check = make("input", "check");
    check.type = "checkbox";
    check.checked = task.completed;
    check.dataset.action = "toggle";
    check.setAttribute("aria-label", (task.completed ? "Mark as not done: " : "Mark as done: ") + task.title);

    const body = make("div", "task__body");
    body.append(make("p", "task__title", task.title)); // textContent => safe from HTML injection
    if (task.description) body.append(make("p", "task__desc", task.description));

    const meta = make("div", "task__meta");
    const cat = CATEGORIES[task.category];
    const catBadge = make("span", "badge");
    const dot = make("span", "cat-dot");
    dot.style.background = cat.color;
    dot.style.margin = "0 2px 0 0";
    catBadge.append(dot, document.createTextNode(cat.label));
    meta.append(catBadge);

    const prio = make("span", `badge badge--${task.priority}`);
    prio.append(icon("flag"), document.createTextNode(PRIORITIES[task.priority].label));
    meta.append(prio);

    if (task.dueDate) {
      const isToday = task.dueDate === todayKey();
      const due = make("span", "badge" + (isToday && !task.completed && !overdue ? " badge--today" : ""));
      due.append(icon("calendar"), document.createTextNode(formatDue(task)));
      meta.append(due);
    }
    if (overdue) {
      const ob = make("span", "badge badge--overdue");
      ob.append(icon("alert-triangle"), document.createTextNode("Overdue"));
      meta.append(ob);
    }
    if (task.completed) {
      const done = make("span", "badge badge--done");
      done.append(icon("check"), document.createTextNode("Completed"));
      meta.append(done);
    }

    const actions = make("div", "task__actions");
    const editBtn = make("button", "icon-btn icon-btn--sm");
    editBtn.type = "button";
    editBtn.dataset.action = "edit";
    editBtn.setAttribute("aria-label", "Edit task: " + task.title);
    editBtn.append(icon("pencil"));
    const delBtn = make("button", "icon-btn icon-btn--sm icon-btn--danger");
    delBtn.type = "button";
    delBtn.dataset.action = "delete";
    delBtn.setAttribute("aria-label", "Delete task: " + task.title);
    delBtn.append(icon("trash-2"));
    actions.append(editBtn, delBtn);

    if (state.layout === "grid") {
      top.append(check, body);
      li.append(top, meta, actions);
    } else {
      body.append(meta);
      li.append(check, body, actions);
    }
    return li;
  }

  function buildList(tasks) {
    const ul = make("ul", "task-list" + (state.layout === "grid" ? " is-grid" : ""));
    tasks.forEach((t) => ul.append(buildTaskCard(t)));
    return ul;
  }

  function buildGroupTitle(text, count, danger) {
    const h = make("h3", "group-title" + (danger ? " group-title--danger" : ""));
    if (danger) h.append(icon("alert-triangle"));
    h.append(document.createTextNode(text), make("span", "group-title__count", String(count)));
    return h;
  }

  function buildEmptyState() {
    const hasQuery = state.search.trim() || state.filter !== "all" || state.category !== "all";
    const presets = {
      none: ["inbox", "No tasks yet", "Add your first task and make room for what matters.", true],
      search: ["search-x", "No matching tasks", "Try a different search, filter, or category.", false],
      today: ["sun", "Nothing due today", "Enjoy the breathing room — or plan something new.", true],
      upcoming: ["calendar-days", "No upcoming tasks", "Give a task a future due date and it will show up here.", true],
      completed: ["circle-check", "No completed tasks yet", "Finish a task and it will be celebrated here.", false],
      overview: ["sparkles", "You're all caught up", "Every task is done. Add something new when you're ready.", true],
    };
    let key = state.view;
    if (state.tasks.length === 0) key = "none";
    else if (hasQuery) key = "search";
    else if (!presets[key]) key = "none";
    const [ic, title, text, showAdd] = presets[key];

    const box = make("div", "empty");
    const iconWrap = make("div", "empty__icon");
    iconWrap.append(icon(ic));
    box.append(iconWrap, make("h3", "", title), make("p", "", text));
    if (key === "search") {
      const clear = make("button", "btn btn--ghost", "Clear filters");
      clear.type = "button";
      clear.dataset.action = "clear-filters";
      box.append(clear);
    } else if (showAdd) {
      const add = make("button", "btn btn--primary");
      add.type = "button";
      add.dataset.action = "add-task";
      add.append(icon("plus"), document.createTextNode("Add Task"));
      box.append(add);
    }
    return box;
  }

  function renderTasks() {
    const visible = getVisibleTasks();
    el.container.replaceChildren();
    const n = visible.length;
    el.taskCount.textContent = `${n} ${n === 1 ? "task" : "tasks"}`;

    if (n === 0) {
      el.container.append(buildEmptyState());
      return;
    }

    if (state.view === "today") {
      const overdue = visible.filter(isOverdue);
      const dueToday = visible.filter((t) => !isOverdue(t));
      if (overdue.length) el.container.append(buildGroupTitle("Overdue", overdue.length, true), buildList(overdue));
      if (dueToday.length) el.container.append(buildGroupTitle("Due today", dueToday.length), buildList(dueToday));
    } else if (state.view === "upcoming") {
      const groups = new Map();
      visible.forEach((t) => {
        if (!groups.has(t.dueDate)) groups.set(t.dueDate, []);
        groups.get(t.dueDate).push(t);
      });
      groups.forEach((list, date) => el.container.append(buildGroupTitle(formatGroupDate(date), list.length), buildList(list)));
    } else if (state.view === "overview") {
      el.container.append(buildList(visible.slice(0, OVERVIEW_LIMIT)));
      if (n > OVERVIEW_LIMIT) {
        const wrap = make("div", "view-all");
        const btn = make("button", "btn btn--ghost", `View all ${n} active tasks`);
        btn.type = "button";
        btn.dataset.gotoView = "all";
        wrap.append(btn);
        el.container.append(wrap);
      }
    } else {
      el.container.append(buildList(visible));
    }
  }

  // One function that re-renders everything from state
  function render() {
    renderHeader();
    renderStats();
    renderNav();
    renderChips();
    renderTasks();
    refreshIcons();
    state.lastAddedId = null;
  }

  /* ---------- 7. Modal & confirm dialog ---------- */
  function fillCategoryOptions() {
    Object.entries(CATEGORIES).forEach(([key, cat]) => {
      const opt = make("option", "", cat.label);
      opt.value = key;
      el.fCategory.append(opt);
    });
  }

  function clearErrors() {
    el.titleError.textContent = "";
    el.timeError.textContent = "";
    el.fTitle.removeAttribute("aria-invalid");
    el.fTime.removeAttribute("aria-invalid");
  }

  function openTaskModal(taskId) {
    state.lastFocused = document.activeElement;
    state.editingId = taskId || null;
    el.form.reset();
    clearErrors();
    const task = taskId ? state.tasks.find((t) => t.id === taskId) : null;

    if (task) {
      el.modalTitle.textContent = "Edit task";
      el.submitBtn.textContent = "Save Changes";
      el.fTitle.value = task.title;
      el.fDesc.value = task.description;
      el.fCategory.value = task.category;
      el.fPriority.value = task.priority;
      el.fDate.value = task.dueDate;
      el.fTime.value = task.dueTime;
    } else {
      el.modalTitle.textContent = "New task";
      el.submitBtn.textContent = "Create Task";
      el.fPriority.value = "medium";
      // sensible defaults based on the current context
      el.fCategory.value = state.category !== "all" ? state.category : "personal";
      el.fDate.value = state.view === "today" ? todayKey() : state.view === "upcoming" ? tomorrowKey() : "";
    }
    el.modal.hidden = false;
    document.body.style.overflow = "hidden";
    closeSidebar();
    setTimeout(() => el.fTitle.focus(), 30);
  }

  function closeTaskModal() {
    el.modal.hidden = true;
    document.body.style.overflow = "";
    state.editingId = null;
    state.isSaving = false;
    el.submitBtn.disabled = false;
    if (state.lastFocused && document.contains(state.lastFocused)) state.lastFocused.focus();
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (state.isSaving) return; // guard against double submits
    clearErrors();

    const title = el.fTitle.value.trim();
    const dueDate = el.fDate.value;
    const dueTime = el.fTime.value;
    let valid = true;
    if (!title) {
      el.titleError.textContent = "Please give your task a title.";
      el.fTitle.setAttribute("aria-invalid", "true");
      valid = false;
    }
    if (dueTime && !dueDate) {
      el.timeError.textContent = "Pick a due date to use a time.";
      el.fTime.setAttribute("aria-invalid", "true");
      valid = false;
    }
    if (!valid) {
      (title ? el.fTime : el.fTitle).focus();
      return;
    }

    state.isSaving = true;
    el.submitBtn.disabled = true;
    const data = {
      title,
      description: el.fDesc.value.trim(),
      category: el.fCategory.value,
      priority: el.fPriority.value,
      dueDate,
      dueTime,
    };

    if (state.editingId) {
      updateTask(state.editingId, data);
      showToast("Task updated");
    } else {
      createTask(data);
      showToast("Task created successfully");
    }
    closeTaskModal();
    render();
  }

  function openConfirm(taskId) {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;
    state.lastFocused = document.activeElement;
    state.deletingId = taskId;
    el.confirmText.textContent = `"${task.title}" will be permanently removed.`;
    el.confirm.hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(() => el.confirmBtn.focus(), 30);
  }

  function closeConfirm() {
    el.confirm.hidden = true;
    document.body.style.overflow = "";
    state.deletingId = null;
    if (state.lastFocused && document.contains(state.lastFocused)) state.lastFocused.focus();
  }

  // Keep Tab focus inside an open dialog
  function trapFocus(event, container) {
    const focusable = container.querySelectorAll('button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  /* ---------- 8. Toasts, theme, mobile nav ---------- */
  function showToast(message, type) {
    const kind = type || "success";
    const toast = make("div", `toast toast--${kind}`);
    toast.setAttribute("role", "status");
    toast.append(icon(kind === "danger" ? "trash-2" : "circle-check"), make("span", "", message));
    el.toasts.append(toast);
    refreshIcons();
    setTimeout(() => {
      toast.classList.add("is-leaving");
      setTimeout(() => toast.remove(), 220);
    }, 2600);
  }

  function getTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    document.querySelectorAll('[data-action="toggle-theme"]').forEach((b) =>
      b.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode"));
    const text = document.querySelector(".theme-switch__text");
    if (text) text.textContent = theme === "dark" ? "Light mode" : "Dark mode";
  }
  function toggleTheme() {
    const next = getTheme() === "dark" ? "light" : "dark";
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
  }
  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
    if (saved !== "dark" && saved !== "light") {
      saved = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    applyTheme(saved);
  }

  function openSidebar() {
    el.sidebar.classList.add("is-open");
    el.overlay.hidden = false;
    el.openSidebar.setAttribute("aria-expanded", "true");
    el.closeSidebar.focus();
  }
  function closeSidebar() {
    if (!el.sidebar.classList.contains("is-open")) return;
    el.sidebar.classList.remove("is-open");
    el.overlay.hidden = true;
    el.openSidebar.setAttribute("aria-expanded", "false");
  }

  function setView(view, category) {
    state.view = view;
    state.category = category || "all";
    closeSidebar();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------- 9. Event listeners & init ---------- */
  function bindEvents() {
    // Global click delegation for buttons that appear in several places
    document.addEventListener("click", (e) => {
      const target = e.target.closest("button, [data-close-modal], [data-close-confirm]");
      if (!target) return;
      if (target.dataset.action === "add-task") return openTaskModal();
      if (target.dataset.action === "toggle-theme") return toggleTheme();
      if (target.dataset.action === "clear-filters") {
        state.search = ""; state.filter = "all"; state.category = "all";
        el.search.value = ""; el.filter.value = "all";
        return render();
      }
      if (target.dataset.view) return setView(target.dataset.view);
      if (target.dataset.navCategory) return setView("all", target.dataset.navCategory);
      if (target.dataset.gotoView) return setView(target.dataset.gotoView);
      if (target.hasAttribute("data-close-modal")) return closeTaskModal();
      if (target.hasAttribute("data-close-confirm")) return closeConfirm();
    });

    // Task actions: only fire when the specific control is used
    el.container.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const card = btn.closest(".task");
      if (!card) return;
      if (btn.dataset.action === "edit") openTaskModal(card.dataset.id);
      if (btn.dataset.action === "delete") openConfirm(card.dataset.id);
    });
    el.container.addEventListener("change", (e) => {
      if (e.target.dataset.action !== "toggle") return;
      const card = e.target.closest(".task");
      const task = toggleTask(card.dataset.id);
      if (!task) return;
      showToast(task.completed ? "Task completed" : "Task reopened");
      // short delay lets the checkmark animation play before re-rendering
      setTimeout(render, 220);
    });

    el.chips.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      state.category = chip.dataset.category;
      render();
    });

    el.search.addEventListener("input", () => { state.search = el.search.value; renderTasks(); refreshIcons(); });
    el.filter.addEventListener("change", () => { state.filter = el.filter.value; renderTasks(); refreshIcons(); });
    el.sort.addEventListener("change", () => { state.sort = el.sort.value; renderTasks(); refreshIcons(); });

    document.querySelectorAll("[data-layout]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.layout = btn.dataset.layout;
        document.querySelectorAll("[data-layout]").forEach((b) => {
          const on = b === btn;
          b.classList.toggle("is-active", on);
          b.setAttribute("aria-pressed", String(on));
        });
        renderTasks();
        refreshIcons();
      });
    });

    el.form.addEventListener("submit", handleSubmit);
    el.fTitle.addEventListener("input", () => {
      if (el.fTitle.value.trim()) { el.titleError.textContent = ""; el.fTitle.removeAttribute("aria-invalid"); }
    });

    el.confirmBtn.addEventListener("click", () => {
      if (!state.deletingId) return;
      deleteTask(state.deletingId);
      closeConfirm();
      showToast("Task deleted", "danger");
      render();
    });

    el.openSidebar.addEventListener("click", openSidebar);
    el.closeSidebar.addEventListener("click", closeSidebar);
    el.overlay.addEventListener("click", closeSidebar);

    // Keyboard: Escape closes things, Tab is trapped in dialogs, "/" focuses search
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (!el.confirm.hidden) return closeConfirm();
        if (!el.modal.hidden) return closeTaskModal();
        return closeSidebar();
      }
      if (e.key === "Tab") {
        if (!el.confirm.hidden) trapFocus(e, el.confirm);
        else if (!el.modal.hidden) trapFocus(e, el.modal);
      }
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if (e.key === "/" && !typing && el.modal.hidden && el.confirm.hidden) {
        e.preventDefault();
        el.search.focus();
      }
    });

    // Re-check overdue status every minute so indicators stay current
    setInterval(() => { if (el.modal.hidden && el.confirm.hidden) render(); }, 60000);
  }

  function init() {
    initTheme();
    fillCategoryOptions();
    state.tasks = loadTasks();
    saveTasks(); // write back cleaned data
    bindEvents();
    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
