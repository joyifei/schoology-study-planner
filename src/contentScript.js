(function () {
  const STORAGE_KEY = "schoologyStudyPlanner.tasks";
  const SYNC_MESSAGE = "SCHOOLGY_STUDY_PLANNER_SYNC_V2";
  const SCAN_GRADE_MESSAGE = "SCHOOLGY_STUDY_PLANNER_SCAN_GRADE_V1";

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
      /\bDue\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}(?:\s+at(?:\s+\d{1,2}:\d{2}\s*(?:am|pm))?)?/i,
      /\bDue\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}(?:\s+at(?:\s+\d{1,2}:\d{2}\s*(?:am|pm))?)?/i,
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

  function urlForTitle(links, title) {
    const normalizedTitle = normalizeText(title).toLowerCase();
    const match = links.find((link) => {
      const linkText = normalizeText(link.innerText || link.textContent).toLowerCase();
      return linkText === normalizedTitle || linkText.includes(normalizedTitle) || normalizedTitle.includes(linkText);
    });
    return match?.href || "";
  }

  function isDueLine(line) {
    return /(\bDue\b|\boverdue\b)/i.test(line);
  }

  function tasksFromVisibleLines(lines, links) {
    const tasks = [];
    let section = "";

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^overdue$/i.test(line)) {
        section = "Overdue";
        continue;
      }
      if (/^upcoming$/i.test(line)) {
        section = "Upcoming";
        continue;
      }
      if (!section || isDueLine(line)) continue;

      const dueIndex = index + 1;
      if (!lines[dueIndex] || !isDueLine(lines[dueIndex])) continue;

      const title = line;
      const dueText = extractDueText(lines[dueIndex]);
      if (!dueText) continue;

      const course = lines[dueIndex + 1] && !/^(overdue|upcoming)$/i.test(lines[dueIndex + 1])
        ? lines[dueIndex + 1]
        : "Unknown course";

      tasks.push({
        id: "",
        legacyId: "",
        title,
        course,
        dueText,
        dueAt: parseDueDate(dueText),
        status: section,
        url: urlForTitle(links, title),
        source: "Schoology To Do",
        capturedAt: new Date().toISOString()
      });
    }

    return tasks;
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

  function courseIdFromUrl(url) {
    const stable = stableUrl(url);
    const match = stable.match(/\/course\/(\d+)/i);
    if (match) return `course:${match[1]}`;
    return stable ? `url:${stable}` : "";
  }

  function courseUrlFromLink(link) {
    if (!link?.href) return "";
    try {
      return new URL(link.href, window.location.href).toString();
    } catch (_error) {
      return link.href;
    }
  }

  function currentCourseFromPage() {
    const pageCourseId = courseIdFromUrl(window.location.href);
    const courseLink = Array.from(document.querySelectorAll("a[href*='/course/']")).find((link) => {
      const text = normalizeText(link.innerText || link.textContent);
      return text && !/^courses$/i.test(text);
    });
    const heading = Array.from(document.querySelectorAll("h1,h2,.page-title,.course-title"))
      .map((node) => normalizeText(node.innerText || node.textContent))
      .find(Boolean);
    const url = courseUrlFromLink(courseLink) || window.location.href;
    return {
      id: pageCourseId || courseIdFromUrl(url) || `url:${stableUrl(url)}`,
      name: normalizeText(courseLink?.innerText || courseLink?.textContent) || heading || document.title || "Current course",
      url
    };
  }

  function extractGradePercentFromText(text) {
    const patterns = [
      /(?:overall|current|final|course|period|total)[^%\n]{0,80}?(\d{1,3}(?:\.\d+)?)\s*%/i,
      /(\d{1,3}(?:\.\d+)?)\s*%/
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const value = Number.parseFloat(match[1]);
      if (Number.isFinite(value) && value >= 0 && value <= 110) return value;
    }
    return null;
  }

  function combinedGradeLines(lines) {
    const combined = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const nextLine = lines[index + 1] || "";
      if (
        /\b(20\d{2}|2\d)\s*(S\d|Q\d|T\d|MP\d)\b/i.test(line) &&
        /^\(\s*\d+(?:\.\d+)?\s*%\s*\)$/.test(nextLine)
      ) {
        combined.push(`${line} ${nextLine}`);
        index += 1;
      } else {
        combined.push(line);
      }
    }

    return combined;
  }

  function extractWeightedGradePeriods(rawLines) {
    const lines = combinedGradeLines(rawLines);
    const periods = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!/\(\s*\d+(?:\.\d+)?\s*%\s*\)/.test(line)) continue;
      if (/no grading period/i.test(line)) continue;
      if (!/\b(20\d{2}|2\d)\s*(S\d|Q\d|T\d|MP\d)\b/i.test(line)) continue;

      const weightMatch = line.match(/\(\s*(\d+(?:\.\d+)?)\s*%\s*\)/);
      if (!weightMatch) continue;
      const weight = Number.parseFloat(weightMatch[1]);
      if (!Number.isFinite(weight) || weight <= 0) continue;

      const afterWeight = line.slice(line.indexOf(weightMatch[0]) + weightMatch[0].length);
      let scoreMatch = afterWeight.match(/\b(\d{1,3}(?:\.\d+)?)\s*%/);
      if (!scoreMatch) {
        for (let lookahead = index + 1; lookahead <= Math.min(index + 3, lines.length - 1); lookahead += 1) {
          if (/\(\s*\d+(?:\.\d+)?\s*%\s*\)/.test(lines[lookahead])) break;
          scoreMatch = lines[lookahead].match(/\b(\d{1,3}(?:\.\d+)?)\s*%/);
          if (scoreMatch) break;
        }
      }

      if (!scoreMatch) continue;
      const score = Number.parseFloat(scoreMatch[1]);
      if (!Number.isFinite(score) || score < 0 || score > 110) continue;

      periods.push({
        label: line.replace(/\(\s*\d+(?:\.\d+)?\s*%\s*\).*/, "").trim(),
        weight,
        score
      });
    }

    return periods;
  }

  function weightedGradeFromPeriods(periods) {
    const totalWeight = periods.reduce((sum, period) => sum + period.weight, 0);
    if (totalWeight <= 0) return null;
    const weighted = periods.reduce((sum, period) => sum + period.score * period.weight, 0) / totalWeight;
    return Math.round(weighted * 100) / 100;
  }

  function extractLetterGrade(text) {
    const match = text.match(/\b(A\+|A-|A|B\+|B-|B|C\+|C-|C|D\+|D-|D|F)\b/);
    return match ? match[1] : "";
  }

  function extractCurrentGrade() {
    const course = currentCourseFromPage();
    const tables = Array.from(document.querySelectorAll("table"));
    const preferredText = tables
      .map((table) => getVisibleText(table))
      .find((text) => /overall|current|final|course|period|total|%/i.test(text));
    const text = preferredText || getVisibleText(document.body);
    const lines = visibleLines(document.body);
    const gradingPeriods = extractWeightedGradePeriods(lines);
    const weightedGradePercent = weightedGradeFromPeriods(gradingPeriods);
    const gradePercent = weightedGradePercent ?? extractGradePercentFromText(text);
    const letterGrade = extractLetterGrade(text);

    return {
      ...course,
      gradePercent,
      letterGrade,
      gradingPeriods,
      scannedAt: new Date().toISOString(),
      sourceUrl: window.location.href
    };
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

    const lineTasks = tasksFromVisibleLines(lines, links);
    const linkTasks = [];
    let searchStart = 0;
    for (const [index, link] of links.entries()) {
      const title = normalizeText(link.innerText || link.textContent);
      const titleIndex = findLineIndex(lines, title, searchStart);
      if (titleIndex < 0) continue;

      const nextTitle = links[index + 1] ? normalizeText(links[index + 1].innerText || links[index + 1].textContent) : "";
      const nextTitleIndex = nextTitle ? findLineIndex(lines, nextTitle, titleIndex + 1) : -1;
      const details = taskDetailsFromLines(lines, titleIndex, nextTitleIndex);
      const section = sectionForLine(lines, titleIndex);
      const status = section || (/overdue/i.test(details.dueText) ? "Overdue" : "Upcoming");
      searchStart = titleIndex + 1;

      linkTasks.push({
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
      });
    }

    const extractedTasks = lineTasks.length > 0 ? lineTasks : linkTasks;
    const unique = new Map();
    for (const task of extractedTasks.filter((task) => task && task.dueText)) {
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
    if (message?.type === SCAN_GRADE_MESSAGE) {
      sendResponse({ ok: true, grade: extractCurrentGrade() });
      return true;
    }

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
