const STORAGE_KEY = "schoologyStudyPlanner.tasks";
const DONE_KEY = "schoologyStudyPlanner.done";
const DURATION_KEY = "schoologyStudyPlanner.durations";
const PLAN_KEY = "schoologyStudyPlanner.plan";
const COURSES_KEY = "schoologyStudyPlanner.courses";
const GPA_SETTINGS_KEY = "schoologyStudyPlanner.gpaSettings";
const SYNC_MESSAGE = "SCHOOLGY_STUDY_PLANNER_SYNC_V2";
const SCAN_COURSES_MESSAGE = "SCHOOLGY_STUDY_PLANNER_SCAN_COURSES_V1";
const SCAN_GRADE_MESSAGE = "SCHOOLGY_STUDY_PLANNER_SCAN_GRADE_V1";

const elements = {
  syncButton: document.querySelector("#syncButton"),
  clearButton: document.querySelector("#clearButton"),
  syncStatus: document.querySelector("#syncStatus"),
  lastUpdated: document.querySelector("#lastUpdated"),
  overdueCount: document.querySelector("#overdueCount"),
  todayCount: document.querySelector("#todayCount"),
  weekCount: document.querySelector("#weekCount"),
  allCount: document.querySelector("#allCount"),
  filterSelect: document.querySelector("#filterSelect"),
  taskTable: document.querySelector("#taskTable"),
  emptyState: document.querySelector("#emptyState"),
  planTotal: document.querySelector("#planTotal"),
  planList: document.querySelector("#planList"),
  tabButtons: Array.from(document.querySelectorAll(".tab-button")),
  tabPanels: Array.from(document.querySelectorAll(".tab-panel")),
  scanCoursesButton: document.querySelector("#scanCoursesButton"),
  saveGradeButton: document.querySelector("#saveGradeButton"),
  gradesTable: document.querySelector("#gradesTable"),
  gradesEmptyState: document.querySelector("#gradesEmptyState"),
  weightedGpa: document.querySelector("#weightedGpa"),
  unweightedGpa: document.querySelector("#unweightedGpa"),
  gpaCourseCount: document.querySelector("#gpaCourseCount"),
  honorsBonusInput: document.querySelector("#honorsBonusInput"),
  apBonusInput: document.querySelector("#apBonusInput")
};

let state = {
  tasks: [],
  done: {},
  durations: {},
  plan: {},
  courses: [],
  gpaSettings: {
    honorsBonus: 0.5,
    apBonus: 1.0
  }
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
  if (urlKey) return `url-text:${[urlKey, task.title || "", task.course || ""].join("|").toLowerCase()}`;
  return `text:${[task.title || "", task.course || ""].join("|").toLowerCase()}`;
}

function urlOnlyTaskId(task) {
  const urlKey = stableUrl(task.url);
  return urlKey ? `url:${urlKey}` : "";
}

function legacyTaskId(task) {
  return [task.title || "", task.course || "", task.dueText || ""].join("|").toLowerCase();
}

function legacyDonePrefix(task) {
  return `${[task.title || "", task.course || ""].join("|").toLowerCase()}|`;
}

function doneKeysFor(task) {
  return Array.from(new Set([task.id, stableTaskId(task), urlOnlyTaskId(task), task.legacyId, legacyTaskId(task)].filter(Boolean)));
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

function defaultDuration(task) {
  const days = daysUntil(task);
  if (days < 0) return 40;
  if (days === 0) return 35;
  if (days === 1) return 30;
  return 25;
}

function durationKeysFor(task) {
  return Array.from(new Set([task.id, stableTaskId(task), urlOnlyTaskId(task), task.legacyId, legacyTaskId(task)].filter(Boolean)));
}

function getDurationEntry(task) {
  return durationKeysFor(task).map((key) => state.durations[key]).find(Boolean) || null;
}

function estimatedMinutes(task) {
  const entry = getDurationEntry(task);
  const rawMinutes = typeof entry === "number" ? entry : entry?.minutes;
  const minutes = Number.parseInt(rawMinutes, 10);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : defaultDuration(task);
}

function planKeysFor(task) {
  return durationKeysFor(task);
}

function getPlanEntry(task) {
  return planKeysFor(task).map((key) => state.plan[key]).find((entry) => entry !== undefined) ?? null;
}

function defaultPlanIds() {
  return new Set(
    state.tasks
      .filter((task) => !isDone(task))
      .sort((a, b) => taskPriority(a) - taskPriority(b))
      .slice(0, 5)
      .map((task) => stableTaskId(task))
  );
}

function hasCustomPlan() {
  return Object.keys(state.plan).length > 0;
}

function isPlanned(task, defaultIds = defaultPlanIds()) {
  const entry = getPlanEntry(task);
  if (entry) return Boolean(entry.included);
  return defaultIds.has(stableTaskId(task));
}

function courseKey(course) {
  return course.id || `name:${[course.name || "", course.section || ""].join("|").toLowerCase()}`;
}

function mergeCourses(existing, incoming) {
  const byId = new Map(existing.map((course) => [courseKey(course), course]));
  for (const course of incoming) {
    const key = courseKey(course);
    const previous = byId.get(key) || {};
    const merged = { ...previous, ...course, id: key };
    if (previous.includeInGpa !== undefined) merged.includeInGpa = previous.includeInGpa;
    if (previous.level) merged.level = previous.level;
    if (previous.gradePercent !== undefined && course.gradePercent == null) merged.gradePercent = previous.gradePercent;
    byId.set(key, merged);
  }
  return Array.from(byId.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

function gradePoints(percent) {
  const value = Number.parseFloat(percent);
  if (!Number.isFinite(value)) return null;
  if (value >= 93) return 4.0;
  if (value >= 90) return 3.7;
  if (value >= 87) return 3.3;
  if (value >= 83) return 3.0;
  if (value >= 80) return 2.7;
  if (value >= 77) return 2.3;
  if (value >= 73) return 2.0;
  if (value >= 70) return 1.7;
  if (value >= 67) return 1.3;
  if (value >= 65) return 1.0;
  return 0;
}

function weightBonus(course) {
  if (course.level === "ap") return Number.parseFloat(state.gpaSettings.apBonus) || 0;
  if (course.level === "honors") return Number.parseFloat(state.gpaSettings.honorsBonus) || 0;
  return 0;
}

function courseGpa(course, weighted = true) {
  const base = gradePoints(course.gradePercent);
  if (base === null) return null;
  return Math.min(5, base + (weighted ? weightBonus(course) : 0));
}

function formatGpa(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "--";
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

function formatPlanDue(task) {
  const due = formatDateTime(task.dueAt, task.dueText);
  return due && due !== "Unknown" ? due.replace(/^Due\s+/i, "") : "No due date";
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
  elements.allCount.textContent = String(active.length);

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

    const duration = document.createElement("td");
    const durationInput = document.createElement("input");
    durationInput.className = "duration-input";
    durationInput.type = "number";
    durationInput.min = "5";
    durationInput.max = "240";
    durationInput.step = "5";
    durationInput.value = String(estimatedMinutes(task));
    durationInput.ariaLabel = `Estimated minutes for ${task.title}`;
    durationInput.addEventListener("change", () => updateDuration(task, durationInput.value));
    durationInput.addEventListener("blur", () => updateDuration(task, durationInput.value));
    duration.append(durationInput);

    const plan = document.createElement("td");
    const planCheckbox = document.createElement("input");
    planCheckbox.type = "checkbox";
    planCheckbox.checked = isPlanned(task);
    planCheckbox.disabled = isDone(task);
    planCheckbox.ariaLabel = `Include ${task.title} in today's plan`;
    planCheckbox.addEventListener("change", () => togglePlan(task, planCheckbox.checked));
    plan.append(planCheckbox);

    const done = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = isDone(task);
    checkbox.ariaLabel = `Mark ${task.title} done`;
    checkbox.addEventListener("change", () => toggleDone(task, checkbox.checked));
    done.append(checkbox);

    row.append(course, title, due, status, duration, plan, done);
    elements.taskTable.append(row);
  }
}

function renderPlan() {
  elements.planList.replaceChildren();
  const defaultIds = defaultPlanIds();
  const active = state.tasks
    .filter((task) => !isDone(task))
    .filter((task) => isPlanned(task, defaultIds))
    .sort((a, b) => taskPriority(a) - taskPriority(b))
    .slice(0, 12);

  if (active.length === 0) {
    elements.planTotal.textContent = "";
    const item = document.createElement("li");
    item.textContent = hasCustomPlan() ? "No assignments selected for today's plan." : "Nothing urgent saved. Sync Schoology or enjoy the breathing room.";
    elements.planList.append(item);
    return;
  }

  const totalMinutes = active.reduce((sum, task) => sum + estimatedMinutes(task), 0);
  elements.planTotal.textContent = `${totalMinutes} min total`;

  active.forEach((task, index) => {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = `${index + 1}. ${task.course || "Course"}`;
    const detail = document.createElement("span");
    detail.textContent = `${estimatedMinutes(task)} min - ${task.title} - due ${formatPlanDue(task)}`;
    item.append(title, detail);
    elements.planList.append(item);
  });
}

function renderGrades() {
  elements.gradesTable.replaceChildren();
  elements.gradesEmptyState.hidden = state.courses.length > 0;

  for (const course of state.courses) {
    const row = document.createElement("tr");

    const name = document.createElement("td");
    const link = document.createElement(course.url ? "a" : "span");
    link.textContent = course.name || "Untitled course";
    if (course.url) {
      link.href = course.url;
      link.target = "_blank";
    }
    name.append(link);

    const section = document.createElement("td");
    section.textContent = course.section || "";

    const grade = document.createElement("td");
    const gradeInput = document.createElement("input");
    gradeInput.className = "grade-input";
    gradeInput.type = "number";
    gradeInput.min = "0";
    gradeInput.max = "110";
    gradeInput.step = "0.1";
    gradeInput.value = course.gradePercent ?? "";
    gradeInput.placeholder = "%";
    gradeInput.ariaLabel = `Grade percent for ${course.name}`;
    gradeInput.addEventListener("change", () => updateCourse(course.id, { gradePercent: gradeInput.value ? Number.parseFloat(gradeInput.value) : null }));
    grade.append(gradeInput);

    const level = document.createElement("td");
    const levelSelect = document.createElement("select");
    levelSelect.className = "level-select";
    for (const [value, label] of [["regular", "Regular"], ["honors", "Honors"], ["ap", "AP"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      levelSelect.append(option);
    }
    levelSelect.value = course.level || "regular";
    levelSelect.addEventListener("change", () => updateCourse(course.id, { level: levelSelect.value }));
    level.append(levelSelect);

    const gpa = document.createElement("td");
    gpa.textContent = formatGpa(courseGpa(course));

    const include = document.createElement("td");
    const includeCheckbox = document.createElement("input");
    includeCheckbox.type = "checkbox";
    includeCheckbox.checked = course.includeInGpa !== false;
    includeCheckbox.ariaLabel = `Include ${course.name} in GPA`;
    includeCheckbox.addEventListener("change", () => updateCourse(course.id, { includeInGpa: includeCheckbox.checked }));
    include.append(includeCheckbox);

    row.append(name, section, grade, level, gpa, include);
    elements.gradesTable.append(row);
  }
}

function renderGpa() {
  const included = state.courses.filter((course) => course.includeInGpa !== false && courseGpa(course, false) !== null);
  const unweighted = included.length
    ? included.reduce((sum, course) => sum + courseGpa(course, false), 0) / included.length
    : NaN;
  const weighted = included.length
    ? included.reduce((sum, course) => sum + courseGpa(course, true), 0) / included.length
    : NaN;

  elements.unweightedGpa.textContent = formatGpa(unweighted);
  elements.weightedGpa.textContent = formatGpa(weighted);
  elements.gpaCourseCount.textContent = String(included.length);
  elements.honorsBonusInput.value = String(state.gpaSettings.honorsBonus);
  elements.apBonusInput.value = String(state.gpaSettings.apBonus);
}

function render() {
  renderSummary();
  renderTable();
  renderPlan();
  renderGrades();
  renderGpa();
}

function load() {
  chrome.storage.local.get([STORAGE_KEY, DONE_KEY, DURATION_KEY, PLAN_KEY, COURSES_KEY, GPA_SETTINGS_KEY], (stored) => {
    state.tasks = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
    state.done = stored[DONE_KEY] || {};
    state.durations = stored[DURATION_KEY] || {};
    state.plan = stored[PLAN_KEY] || {};
    state.courses = Array.isArray(stored[COURSES_KEY]) ? stored[COURSES_KEY] : [];
    state.gpaSettings = { ...state.gpaSettings, ...(stored[GPA_SETTINGS_KEY] || {}) };
    render();
  });
}

function saveCourses(nextCourses = state.courses) {
  state.courses = nextCourses;
  chrome.storage.local.set({ [COURSES_KEY]: state.courses }, render);
}

function saveGpaSettings() {
  chrome.storage.local.set({ [GPA_SETTINGS_KEY]: state.gpaSettings }, render);
}

function updateCourse(id, patch) {
  saveCourses(state.courses.map((course) => course.id === id ? { ...course, ...patch } : course));
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

function updateDuration(task, value) {
  const minutes = Math.min(240, Math.max(5, Math.round(Number.parseInt(value, 10) / 5) * 5));
  const safeMinutes = Number.isFinite(minutes) ? minutes : defaultDuration(task);
  const keys = durationKeysFor(task);
  const primaryKey = stableTaskId(task);
  state.durations = { ...state.durations };

  for (const key of keys) delete state.durations[key];

  state.durations[primaryKey] = {
    minutes: safeMinutes,
    updatedAt: new Date().toISOString(),
    title: task.title || "",
    course: task.course || ""
  };

  chrome.storage.local.set({ [DURATION_KEY]: state.durations }, render);
}

function togglePlan(task, included) {
  const keys = planKeysFor(task);
  const primaryKey = stableTaskId(task);
  state.plan = { ...state.plan };

  for (const key of keys) delete state.plan[key];
  state.plan[primaryKey] = {
    included,
    updatedAt: new Date().toISOString(),
    title: task.title || "",
    course: task.course || ""
  };

  chrome.storage.local.set({ [PLAN_KEY]: state.plan }, render);
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

    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/contentScript.js"] }, () => {
      if (chrome.runtime.lastError) {
        elements.syncStatus.textContent = "Open a Schoology page, then click Sync.";
        elements.syncButton.disabled = false;
        return;
      }

      chrome.tabs.sendMessage(tab.id, { type: SYNC_MESSAGE }, (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
          elements.syncStatus.textContent = "Open a Schoology page, then click Sync.";
          elements.syncButton.disabled = false;
          return;
        }

        state.tasks = replaceSyncedTasks(state.tasks, response.tasks || []);
        chrome.storage.local.set({ [STORAGE_KEY]: state.tasks }, () => {
          elements.syncStatus.textContent = `Captured ${response.tasks.length} item${response.tasks.length === 1 ? "" : "s"}.`;
          elements.syncButton.disabled = false;
          render();
        });
      });
    });
  });
}

function sendSchoologyMessage(type, onResponse) {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab?.id) {
      elements.syncStatus.textContent = "No active tab found.";
      return;
    }

    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/contentScript.js"] }, () => {
      if (chrome.runtime.lastError) {
        elements.syncStatus.textContent = "Open a Schoology page first.";
        return;
      }

      chrome.tabs.sendMessage(tab.id, { type }, (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
          elements.syncStatus.textContent = "Could not read this Schoology page.";
          return;
        }
        onResponse(response);
      });
    });
  });
}

function scanCourses() {
  elements.syncStatus.textContent = "Scanning visible Schoology courses...";
  sendSchoologyMessage(SCAN_COURSES_MESSAGE, (response) => {
    const courses = response.courses || [];
    saveCourses(mergeCourses(state.courses, courses));
    elements.syncStatus.textContent = `Saved ${courses.length} course${courses.length === 1 ? "" : "s"}.`;
  });
}

function saveCurrentGrade() {
  elements.syncStatus.textContent = "Reading current Grades page...";
  sendSchoologyMessage(SCAN_GRADE_MESSAGE, (response) => {
    const grade = response.grade;
    if (!grade) {
      elements.syncStatus.textContent = "No grade found on this page.";
      return;
    }
    saveCourses(mergeCourses(state.courses, [grade]));
    elements.syncStatus.textContent = grade.gradePercent === null
      ? `Saved ${grade.name}; enter grade manually.`
      : `Saved ${grade.name}: ${grade.gradePercent}%.`;
  });
}

function switchTab(tabId) {
  for (const button of elements.tabButtons) button.classList.toggle("active", button.dataset.tab === tabId);
  for (const panel of elements.tabPanels) panel.classList.toggle("active", panel.id === tabId);
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

function replaceSyncedTasks(existing, incoming) {
  return mergeTasks(existing.filter((task) => task.source !== "Schoology To Do"), incoming);
}

function clearSavedData() {
  chrome.storage.local.remove([STORAGE_KEY, DONE_KEY, DURATION_KEY, PLAN_KEY], () => {
    state = { ...state, tasks: [], done: {}, durations: {}, plan: {} };
    elements.syncStatus.textContent = "Saved homework cleared.";
    render();
  });
}

elements.syncButton.addEventListener("click", syncCurrentTab);
elements.clearButton.addEventListener("click", clearSavedData);
elements.filterSelect.addEventListener("change", renderTable);
elements.scanCoursesButton.addEventListener("click", scanCourses);
elements.saveGradeButton.addEventListener("click", saveCurrentGrade);
elements.honorsBonusInput.addEventListener("change", () => {
  state.gpaSettings = { ...state.gpaSettings, honorsBonus: Number.parseFloat(elements.honorsBonusInput.value) || 0 };
  saveGpaSettings();
});
elements.apBonusInput.addEventListener("change", () => {
  state.gpaSettings = { ...state.gpaSettings, apBonus: Number.parseFloat(elements.apBonusInput.value) || 0 };
  saveGpaSettings();
});
for (const button of elements.tabButtons) {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
}

load();
