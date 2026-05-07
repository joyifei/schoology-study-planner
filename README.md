# Schoology Study Planner

A Chrome extension that turns Schoology's right-side **To Do / Upcoming** panel into a parent-friendly homework table and a short daily study plan.

## What It Does

- Reads visible homework items from the current Schoology page.
- Captures assignment title, course, due text, due date when it can be parsed, and overdue/upcoming status.
- Saves the latest captured homework locally in Chrome storage.
- Lets a parent mark assignments done inside the extension, and keeps that status across popup closes, browser restarts, and later syncs.
- Lets a parent edit the estimated minutes for each assignment.
- Lets a parent add or remove assignments from Today Plan.
- Builds a lightweight "Today Plan" ordered by overdue and soonest due items, using the saved duration estimates.
- Scans Schoology courses and saves current course grades for a weighted GPA estimate.
- Shows a GPA dashboard and can refresh all saved course grade pages in one pass.
- Saves one grade/GPA snapshot per day and charts course grade and GPA changes over time.

## Install Locally

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder.
5. Open Schoology, then click the extension and press **Sync**.

## Current Scope

This is a first working prototype. It reads the Schoology page after you are already logged in. It does not store your Schoology password, bypass login, or send student data to any server.

Because schools can customize Schoology and Schoology can change its markup, the extractor uses visible text and section labels instead of relying on one exact CSS selector. If your school's page structure differs, update `src/contentScript.js`.

Done status is matched to a stable Schoology assignment URL when one is available. If there is no URL, it falls back to the assignment title and course.

Duration estimates use the same stable matching. Edit the `Min` field in the homework table; the value is saved immediately and reflected in the Today Plan.

The Grades tab is intentionally semi-automatic. Add each course manually, paste the course Grades page link, and keep level/include settings editable. Use `Grab` to read top-level grading-period scores from that course page and calculate the display-only Grade and GPA columns. Use the GPA tab's `Update All Grades` button to run that same grab logic for every course with a saved grade page link.

GPA uses the Conestoga High School conversion chart for AP, Honors, Accelerated, and Academic levels.

Each successful grade grab saves today's course grades plus weighted and unweighted GPA. If grades are grabbed more than once on the same day, the latest snapshot replaces the earlier one.

## Privacy

All captured homework data is stored locally with `chrome.storage.local`. There is no backend and no analytics.

## Files

- `manifest.json` - Chrome extension configuration.
- `popup.html` - Extension popup layout.
- `src/contentScript.js` - Schoology page extraction logic.
- `src/popup.js` - Table, filters, local storage, and plan generation.
- `src/popup.css` - Popup styling.
