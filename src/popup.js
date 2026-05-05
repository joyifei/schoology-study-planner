const STORAGE_KEY = "schoologyStudyPlanner.tasks";
const DONE_KEY = "schoologyStudyPlanner.done";

const elements = {
  syncButton: document.querySelector("#syncButton"),
  clearButton: document.querySelector("#clearButton"),
  syncStatus: document.querySelector("#syncStatus"),
  lastUpdated: document.querySelector("#lastUpdated"),
  overdueCount: document.querySelector("#overdueCount"),
  todayCount: document.querySelector("#todayCount"),
  weekCount: document.querySelector("#weekCount"),
  filterSelect: document.querySelector("#filterSelect"),
  taskTable: document.querySelector("#taskTable"),
  emptyState: document.querySelector("#emptyState"),
  planList: document.querySelector("#planList")
};

let state = {
  tasks: [],
  done: {}
};

function stableUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().toLowerCase();
  } catch (_error) {
    return url.split("#")[0].split("?")[0].toLowerCase();
  }
}

function stableTaskId(task) {
  const urlKey = stableUrl(task.url);
  if (urlKey) return `url:${urlKey}`;
  return `text:${[task.title || "", task.course || ""].join("|").toLowerCase()}`;
}

function legacyTaskId(task) {
  return [task.title || "", task.course || "", task.dueText || ""].join("|").toLowerCase();
}

function legacyDonePrefix(task) {
  return `${[task.title || "", task.course || ""].join("|").toLowerCase()}|`;
}

function doneKeysFor(task) {
  return Array.from(new Set([task.id, stableTaskId(task), task.legacyId, legacyTaskId(task)].filter(Boolean)));
}

function getDoneEntry(task) {
  const exactMatch = doneKeysFor(task).map((key) => state.done[key]).find(Boolean);
  if (exactMatch) return exactMatch;

  const legacyPrefix = legacyDonePrefix(task);
  const legacyKey = Object.keys(state.done).find((key) => key.startsWith(legacyPrefix));
  return legacyKey ? state.done[legacyKey] : null;
}

function isDone(task) {
  return Boolean(getDoneEntry(task));
}

function formatDateTime(iso, fallback) {
  if (!iso) return fallback || "Unknown";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return fallback || "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function daysUntil(task) {
  if (/overdue/i.test(task.status) || /overdue/i.test(task.dueText)) return -1;
  if (!task.dueAt) return 999;
  const today = startOfDay(new Date());
  const due = startOfDay(new Date(task.dueAt));
  return Math.round((due - today) / 86400000);
}

function urgencyLabel(task) {
  const days = daysUntil(task);
  if (days < 0) return "Overdue";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days <= 7) return `${days} days`;
  return "Later";
}

function taskPriority(task) {
  const days = daysUntil(task);
  if (isDone(task)) return 1000;
  if (days < 0) return 0;
  if (days === 0) return 1;
  if (days === 1) return 2;
  if (days <= 7) return 3 + days;
  return 99;
}

function filteredTasks() {
  const filter = elements.filterSelect.value;
  return state.tasks
    .filter((task) => {
      const days = daysUntil(task);
      if (filter === "overdue") return days < 0;
      if (filter === "today") return days === 0;
      if (filter === "week") return days >= 0 && days <= 7;
      return true;
    })
    .sort((a, b) => taskPriority(a) - taskPriority(b) || (a.course || "").localeCompare(b.course || ""));
}

function renderSummary() {
  const active = state.tasks.filter((task) => !isDone(task));
  elements.overdueCount.textContent = String(active.filter((task) => daysUntil(task) < 0).length);
  elements.todayCount.textContent = String(active.filter((task) => daysUntil(task) === 0).length);
  elements.weekCount.textContent = String(active.filter((task) => daysUntil(task) >= 0 && daysUntil(task) <= 7).length);

  const latest = state.tasks
    .map((task) => task.capturedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  elements.lastUpdated.textContent = latest ? `Updated ${formatDateTime(latest, "")}` : "";
}

function renderTable() {
  const tasks = filteredTasks();
  elements.taskTable.replaceChildren();
  elements.emptyState.hidden = tasks.length > 0;

  for (const task of tasks) {
    const row = document.createElement("tr");
    if (isDone(task)) row.classList.add("done-row");

    const course = document.createElement("td");
    course.textContent = task.course || "Unknown course";

    const title = document.createElement("td");
    const link = document.createElement(task.url ? "a" : "span");
    link.textContent = task.title || "Untitled";
    if (task.url) {
      link.href = task.url;
      link.target = "_blank";
    }
    title.append(link);

    const due = document.createElement("td");
    due.textContent = formatDateTime(task.dueAt, task.dueText);

    const status = document.createElement("td");
    const badge = document.createElement("span");
    const label = isDone(task) ? "Done" : urgencyLabel(task);
    badge.className = `badge ${label.toLowerCase().replace(/\s+/g, "-")}`;
    badge.textContent = label;
    status.append(badge);

    const done = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = isDone(task);
    checkbox.ariaLabel = `Mark ${task.title} done`;
    checkbox.addEventListener("change", () => toggleDone(task, checkbox.checked));
    done.append(checkbox);

    row.append(course, title, due, status, done);
    elements.taskTable.append(row);
  }
}

function renderPlan() {
  elements.planList.replaceChildren();
  const active = state.tasks
    .filter((task) => !isDone(task))
    .sort((a, b) => taskPriority(a) - taskPriority(b))
    .slice(0, 5);

  if (active.length === 0) {
    const item = document.createElement("li");
    item.textContent = "Nothing urgent saved. Sync Schoology or enjoy the breathing room.";
    elements.planList.append(item);
    return;
  }

  active.forEach((task, index) => {
    const item = document.createElement("li");
    const minutes = daysUntil(task) <= 0 ? 35 : 25;
    item.innerHTML = `<strong>${index + 1}. ${task.course || "Course"}</strong><span>${minutes} min - ${task.title}</span>`;
    elements.planList.append(item);
  });
}

function render() {
  renderSummary();
  renderTable();
  renderPlan();
}

function load() {
  chrome.storage.local.get([STORAGE_KEY, DONE_KEY], (stored) => {
    state.tasks = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
    state.done = stored[DONE_KEY] || {};
    render();
  });
}

function toggleDone(task, checked) {
  const keys = doneKeysFor(task);
  const primaryKey = stableTaskId(task);
  const legacyPrefix = legacyDonePrefix(task);
  state.done = { ...state.done };

  for (const key of keys) delete state.done[key];
  for (const key of Object.keys(state.done)) {
    if (key.startsWith(legacyPrefix)) delete state.done[key];
  }
  if (checked) {
    state.done[primaryKey] = {
      doneAt: new Date().toISOString(),
      title: task.title || "",
      course: task.course || ""
    };
  }

  chrome.storage.local.set({ [DONE_KEY]: state.done }, render);
}

function syncCurrentTab() {
  elements.syncButton.disabled = true;
  elements.syncStatus.textContent = "Reading current Schoology page...";

  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab?.id) {
      elements.syncStatus.textContent = "No active tab found.";
      elements.syncButton.disabled = false;
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: "SCHOOLGY_STUDY_PLANNER_SYNC" }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        elements.syncStatus.textContent = "Open a Schoology page, then click Sync.";
        elements.syncButton.disabled = false;
        return;
      }

      state.tasks = mergeTasks(state.tasks, response.tasks || []);
      chrome.storage.local.set({ [STORAGE_KEY]: state.tasks }, () => {
        elements.syncStatus.textContent = `Captured ${response.tasks.length} item${response.tasks.length === 1 ? "" : "s"}.`;
        elements.syncButton.disabled = false;
        render();
      });
    });
  });
}

function mergeTasks(existing, incoming) {
  const normalize = (task) => ({
    ...task,
    id: stableTaskId(task),
    legacyId: task.legacyId || legacyTaskId(task)
  });
  const byId = new Map(existing.map((task) => {
    const normalized = normalize(task);
    return [normalized.id, normalized];
  }));
  for (const task of incoming) {
    const normalized = normalize(task);
    byId.set(normalized.id, { ...byId.get(normalized.id), ...normalized });
  }
  return Array.from(byId.values());
}

function clearSavedData() {
  chrome.storage.local.remove([STORAGE_KEY, DONE_KEY], () => {
    state = { tasks: [], done: {} };
    elements.syncStatus.textContent = "Saved homework cleared.";
    render();
  });
}

elements.syncButton.addEventListener("click", syncCurrentTab);
elements.clearButton.addEventListener("click", clearSavedData);
elements.filterSelect.addEventListener("change", renderTable);

load();
