(function () {
  const STORAGE_KEY = "schoologyStudyPlanner.tasks";
  const SYNC_MESSAGE = "SCHOOLGY_STUDY_PLANNER_SYNC_V2";

  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function getVisibleText(element) {
    if (!element) return "";
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return "";
    return normalizeText(element.innerText || element.textContent || "");
  }

  function findHeading(text) {
    const candidates = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,.title,.header,.section-title,div,span"));
    return candidates.find((node) => normalizeText(node.textContent).toLowerCase() === text.toLowerCase());
  }

  function scoreContainer(element) {
    const text = getVisibleText(element).toLowerCase();
    const links = element.querySelectorAll("a").length;
    let score = 0;
    if (text.includes("overdue")) score += 3;
    if (text.includes("upcoming")) score += 3;
    if (text.includes("due ")) score += 2;
    if (links > 0) score += Math.min(links, 8);
    return score;
  }

  function findToDoContainer() {
    const heading = findHeading("To Do");
    if (!heading) return null;

    const chain = [];
    let cursor = heading.parentElement;
    while (cursor && cursor !== document.body) {
      chain.push(cursor);
      cursor = cursor.parentElement;
    }

    return chain
      .map((element) => ({ element, score: scoreContainer(element) }))
      .filter((entry) => entry.score >= 5)
      .sort((a, b) => a.element.innerText.length - b.element.innerText.length || b.score - a.score)[0]?.element || null;
  }

  function visibleLines(container) {
    return (container.innerText || container.textContent || "")
      .split(/\r?\n/)
      .map(normalizeText)
      .filter(Boolean);
  }

  function sectionForLine(lines, lineIndex) {
    const previousLabels = lines.slice(0, lineIndex).map((line) => line.toLowerCase());
    const overdueIndex = previousLabels.lastIndexOf("overdue");
    const upcomingIndex = previousLabels.lastIndexOf("upcoming");
    if (overdueIndex > upcomingIndex) return "Overdue";
    if (upcomingIndex >= 0) return "Upcoming";
    return "";
  }

  function extractDueText(blockText) {
    const patterns = [
      /\bDue\s+(?:Today|Tomorrow)(?:,\s*)?(?:[^A-Z]*?\d{1,2}:\d{2}\s*(?:am|pm))?/i,
      /\bDue\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}(?:\s+at\s+\d{1,2}:\d{2}\s*(?:am|pm))?/i,
      /\bDue\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}(?:\s+at\s+\d{1,2}:\d{2}\s*(?:am|pm))?/i,
      /\b\d+\s+days?\s+overdue\b/i
    ];

    for (const pattern of patterns) {
      const match = blockText.match(pattern);
      if (match) return normalizeText(match[0]);
    }
    return "";
  }

  function parseDueDate(dueText) {
    if (!dueText || /overdue/i.test(dueText)) return null;

    const now = new Date();
    let cleaned = dueText.replace(/^Due\s+/i, "").replace(/\bat\b/i, "").replace(/\s+/g, " ").trim();

    if (/^Today/i.test(cleaned)) {
      cleaned = cleaned.replace(/^Today,?\s*/i, `${now.toDateString()} `);
    } else if (/^Tomorrow/i.test(cleaned)) {
      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);
      cleaned = cleaned.replace(/^Tomorrow,?\s*/i, `${tomorrow.toDateString()} `);
    } else {
      cleaned = cleaned.replace(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*/i, "");
    }

    const parsed = new Date(cleaned);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  function extractCourse(blockText, title, dueText) {
    const lines = blockText
      .split(/\n| {2,}/)
      .map(normalizeText)
      .filter(Boolean);
    const dueLineIndex = lines.findIndex((line) => dueText && line.includes(dueText));

    if (dueLineIndex >= 0 && lines[dueLineIndex + 1]) return lines[dueLineIndex + 1];

    const compact = normalizeText(blockText.replace(title, "").replace(dueText, ""));
    const pieces = compact.split(" ").filter(Boolean);
    if (pieces.length > 0) return pieces.slice(-5).join(" ");
    return "Unknown course";
  }

  function findLineIndex(lines, title, startIndex) {
    const normalizedTitle = normalizeText(title).toLowerCase();
    for (let index = startIndex; index < lines.length; index += 1) {
      if (lines[index].toLowerCase() === normalizedTitle) return index;
    }
    for (let index = startIndex; index < lines.length; index += 1) {
      if (lines[index].toLowerCase().includes(normalizedTitle)) return index;
    }
    return -1;
  }

  function taskDetailsFromLines(lines, titleIndex, nextTitleIndex) {
    const endIndex = nextTitleIndex >= 0 ? nextTitleIndex : lines.length;
    const detailLines = lines.slice(titleIndex + 1, endIndex).filter((line) => !/^(overdue|upcoming)$/i.test(line));
    const dueLineIndex = detailLines.findIndex((line) => /(\bDue\b|\boverdue\b)/i.test(line));
    const dueText = dueLineIndex >= 0 ? extractDueText(detailLines[dueLineIndex]) : "";
    const course = dueLineIndex >= 0 && detailLines[dueLineIndex + 1]
      ? detailLines[dueLineIndex + 1]
      : extractCourse(detailLines.join(" "), lines[titleIndex], dueText);

    return {
      blockText: normalizeText([lines[titleIndex], ...detailLines].join(" ")),
      dueText,
      course
    };
  }

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

  function taskId(task) {
    const urlKey = stableUrl(task.url);
    if (urlKey) return `url-text:${[urlKey, task.title, task.course].join("|").toLowerCase()}`;
    return `text:${[task.title, task.course].join("|").toLowerCase()}`;
  }

  function legacyTaskId(task) {
    return [task.title, task.course, task.dueText].join("|").toLowerCase();
  }

  function extractTasks() {
    const container = findToDoContainer();
    if (!container) return [];

    const lines = visibleLines(container);
    const links = Array.from(container.querySelectorAll("a")).filter((link) => {
      const title = normalizeText(link.innerText || link.textContent);
      if (!title || title.toLowerCase() === "to do") return false;
      return title.length > 2;
    });

    let searchStart = 0;
    const tasks = links.map((link, index) => {
      const title = normalizeText(link.innerText || link.textContent);
      const titleIndex = findLineIndex(lines, title, searchStart);
      if (titleIndex < 0) return null;

      const nextTitle = links[index + 1] ? normalizeText(links[index + 1].innerText || links[index + 1].textContent) : "";
      const nextTitleIndex = nextTitle ? findLineIndex(lines, nextTitle, titleIndex + 1) : -1;
      const details = taskDetailsFromLines(lines, titleIndex, nextTitleIndex);
      const section = sectionForLine(lines, titleIndex);
      const status = section || (/overdue/i.test(details.dueText) ? "Overdue" : "Upcoming");
      searchStart = titleIndex + 1;

      return {
        id: "",
        legacyId: "",
        title,
        course: details.course,
        dueText: details.dueText,
        dueAt: parseDueDate(details.dueText),
        status,
        url: link.href || "",
        source: "Schoology To Do",
        capturedAt: new Date().toISOString()
      };
    }).filter((task) => task && task.dueText);

    const unique = new Map();
    for (const task of tasks) {
      task.id = taskId(task);
      task.legacyId = legacyTaskId(task);
      unique.set(task.id, task);
    }
    return Array.from(unique.values());
  }

  function saveTasks(tasks) {
    chrome.storage.local.get([STORAGE_KEY], (stored) => {
      const existing = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
      const retained = existing.filter((task) => task.source !== "Schoology To Do");
      const byId = new Map(retained.map((task) => [task.id, task]));
      for (const task of tasks) {
        byId.set(task.id, { ...byId.get(task.id), ...task });
      }
      chrome.storage.local.set({ [STORAGE_KEY]: Array.from(byId.values()) });
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== SYNC_MESSAGE) return false;
    const tasks = extractTasks();
    saveTasks(tasks);
    sendResponse({ ok: true, tasks });
    return true;
  });

  setTimeout(() => {
    const tasks = extractTasks();
    if (tasks.length > 0) saveTasks(tasks);
  }, 1200);
})();
