// ═══════════════════════════════════════════════
// Tindo calendar.js — 漸進放大網格月曆 v1.6
// ═══════════════════════════════════════════════

const PIXELS_PER_MINUTE_TIER_1 = 1.5;
const PIXELS_PER_MINUTE_TIER_2 = 1.0;
const PIXELS_PER_MINUTE_HOVER = 1.2;

let tasksByDate = {};
let initialRangeEnd = null;
let calendarInitialized = false;

// ── 主渲染入口 ────────────────────────────

async function ensureCalendarRendered() {
  if (calendarInitialized) return;
  await renderInitialCalendar();
}

async function renderInitialCalendar() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = fmtDate(today);

  // 載入所有任務並按日期分組
  await loadAllTasks();

  // 更新頂部標籤
  updateCalendarHeader(today);

  const grid = document.getElementById("calendar-grid");
  grid.innerHTML = "";

  // 排次 1: 1 格（今天）
  await renderTier(grid, 1, [todayStr], todayStr);

  // 排次 2: 3 格（明天起 3 天）
  const tier2 = [];
  for (let i = 1; i <= 3; i++) tier2.push(fmtDate(addDays(today, i)));
  await renderTier(grid, 2, tier2, todayStr);

  // 排次 3: 5 格（第 5 至 9 天）
  const tier3 = [];
  for (let i = 4; i <= 8; i++) tier3.push(fmtDate(addDays(today, i)));
  await renderTier(grid, 3, tier3, todayStr);

  // 排次 4 起：從第 10 天所在週的週一開始
  const day10 = addDays(today, 9);
  const weekStart = getWeekStartMonday(day10);

  // 插入星期標頭（只一次）
  grid.insertAdjacentHTML("beforeend", renderWeekdayHeader());

  const tier4 = [];
  for (let i = 0; i < 7; i++) tier4.push(fmtDate(addDays(weekStart, i)));
  await renderWeekTier(grid, tier4, fmtDate(day10));

  initialRangeEnd = tier4[tier4.length - 1];

  // 預載 2 排，完成後更新 initialRangeEnd 供無限滾動用
  let lastEnd = initialRangeEnd;
  for (let i = 0; i < 2; i++) {
    lastEnd = await appendWeekTier(grid, lastEnd);
  }
  initialRangeEnd = lastEnd;

  setupHoverExpand();
  setupInfiniteScroll();
  setupLocationEdit();
  calendarInitialized = true;
}

// ── 任務載入 ──────────────────────────────

async function loadAllTasks() {
  try {
    const tasks = await fetch("/api/tasks").then(r => r.json());
    tasksByDate = {};
    tasks.forEach(t => {
      if (t.scheduled_date) {
        if (!tasksByDate[t.scheduled_date]) tasksByDate[t.scheduled_date] = [];
        tasksByDate[t.scheduled_date].push(t);
      }
    });
  } catch (e) {
    tasksByDate = {};
  }
}

// ── 更新頂部標籤 ──────────────────────────

function updateCalendarHeader(today) {
  const m = today.getMonth() + 1;
  const y = today.getFullYear();
  document.getElementById("cal-month-label").textContent = `${y} 年 ${m} 月`;

  const weekdayMap = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
  const wd = weekdayMap[today.getDay()];
  document.getElementById("cal-today-relative").textContent = `今天 · ${m}/${today.getDate()} ${wd}`;
}

// ── 渲染排次 1-3 ──────────────────────────

function renderTier(grid, tier, dates, todayStr) {
  const tierClass = `cal-row-tier-${tier}`;
  let cellsHtml = dates.map(d => renderCell(d, tier, d === todayStr)).join("");
  grid.insertAdjacentHTML("beforeend",
    `<div class="cal-row ${tierClass}" data-tier="${tier}">${cellsHtml}</div>`
  );
  return Promise.resolve();
}

function renderCell(dateStr, tier, isToday) {
  const d = new Date(dateStr + "T12:00:00");
  const weekdayMap = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
  const wd = weekdayMap[d.getDay()];
  const dayNum = d.getDate();

  const todayClass = isToday ? " cal-cell-today" : "";
  const tagHtml = isToday ? `<span class="cal-cell-tag">今天</span>` : "";

  const tasks = tasksByDate[dateStr] || [];
  const timetableHtml = renderCellTimetable(dateStr, tasks, tier);

  // 從當天任務中提取地區
  var locations = new Set();
  tasks.forEach(function(t) {
    try { var rc = JSON.parse(t.raw_content || '{}'); if (rc.location) locations.add(rc.location); } catch(e) {}
    if (t.notes) { var m = (t.notes||'').match(/@(\S+)/); if (m) locations.add(m[1]); }
  });
  // 優先讀 localStorage 手動設定
  var savedLoc = localStorage.getItem('tindo_loc_' + dateStr);
  var locStr = savedLoc || (locations.size > 0 ? Array.from(locations).slice(0,2).join('/') : '香港');
  if (locStr.length > 8) locStr = locStr.slice(0,7) + '…';

  return `
    <div class="cal-cell${todayClass}" data-date="${dateStr}">
      <div class="cal-cell-header">
        <div>
          <span class="cal-cell-num">${dayNum}</span>
          <span class="cal-cell-weekday">${wd}</span>
          <span class="cal-cell-loc">${locStr}</span>
        </div>
        ${tagHtml}
      </div>
      ${timetableHtml}
    </div>
  `;
}

// ── 渲染週排次 ────────────────────────────

function renderWeekTier(grid, dates, firstRealDate) {
  let cellsHtml = dates.map(d => {
    if (d < firstRealDate) {
      return `<div class="cal-cell cal-cell-empty"></div>`;
    }
    return renderCell(d, "week", false);
  }).join("");

  grid.insertAdjacentHTML("beforeend",
    `<div class="cal-row cal-row-tier-week" data-tier="week">${cellsHtml}</div>`
  );
  return Promise.resolve();
}

async function appendWeekTier(grid, afterDate) {
  if (!afterDate) return null;
  const next = addDays(new Date(afterDate + "T12:00:00"), 1);
  const weekStart = getWeekStartMonday(next);

  const dates = [];
  for (let i = 0; i < 7; i++) dates.push(fmtDate(addDays(weekStart, i)));

  maybeInsertMonthDivider(grid, dates[0]);

  grid.insertAdjacentHTML("beforeend", renderWeekTierRow(dates));
  return dates[6];
}

function renderWeekTierRow(dates) {
  const cellsHtml = dates.map(d => renderCell(d, "week", false)).join("");
  return `<div class="cal-row cal-row-tier-week" data-tier="week">${cellsHtml}</div>`;
}

// ── 星期標頭 ──────────────────────────────

function renderWeekdayHeader() {
  const days = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"];
  return `
    <div class="cal-weekday-header">
      ${days.map(d => `<div>${d}</div>`).join("")}
    </div>
  `;
}

// ── 月份分隔線 ────────────────────────────

function maybeInsertMonthDivider(grid, firstDayOfNewRow) {
  const lastCells = grid.querySelectorAll(".cal-cell:not(.cal-cell-empty)");
  if (!lastCells.length) return;
  const lastDate = lastCells[lastCells.length - 1].dataset.date;
  if (!lastDate) return;
  const lastMonth = lastDate.slice(0, 7);

  // 掃描新排 7 天，找出跨月的那天
  for (let i = 0; i < 7; i++) {
    const d = fmtDate(addDays(new Date(firstDayOfNewRow + "T12:00:00"), i));
    const m = d.slice(0, 7);
    if (m !== lastMonth) {
      const monthNum = parseInt(m.slice(5));
      const year = m.slice(0, 4);
      grid.insertAdjacentHTML("beforeend", `
        <div class="cal-month-divider" data-month="${m}">
          <span class="cal-month-divider-line"></span>
          <span class="cal-month-divider-label">${monthNum} 月 · ${year}</span>
          <span class="cal-month-divider-line"></span>
        </div>
      `);
      grid.insertAdjacentHTML("beforeend", renderWeekdayHeader());
      return;
    }
  }
}

// ── Timetable 渲染 ────────────────────────

function renderCellTimetable(date, tasks, tier) {
  const timed = tasks
    .filter(t => t.scheduled_time)
    .sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));

  if (!timed.length) {
    return '<div class="cal-cell-timetable"><div class="cal-cell-empty-hint">無排程</div></div>';
  }

  if (tier === 'week') {
    return renderCellCollapsed(timed);
  }

  return renderCellRegions(timed);
}

function renderCellRegions(timed) {
  const GAP_THRESHOLD = 90;
  const regions = [];
  // 找最長任務作為基準
  let maxDuration = 60;
  timed.forEach(t => { maxDuration = Math.max(maxDuration, t.estimated_minutes || 60); });

  for (const t of timed) {
    const [h, m] = t.scheduled_time.split(':').map(Number);
    const start = h * 60 + m;
    const end = start + (t.estimated_minutes || 60);

    const last = regions[regions.length - 1];
    if (last && (start - last.lastEnd) <= GAP_THRESHOLD) {
      last.lastEnd = Math.max(last.lastEnd, end);
      last.tasks.push(t);
    } else {
      regions.push({ firstStart: start, lastEnd: end, tasks: [t] });
    }
  }

  let html = '<div class="cal-cell-timetable regions">';

  regions.forEach((region, i) => {
    if (i > 0) {
      const prev = regions[i - 1];
      const gapMin = region.firstStart - prev.lastEnd;
      const gapLabel = gapMin >= 60
        ? `⋯ 略過 ${Math.round(gapMin / 60)}h`
        : `⋯ 略過 ${gapMin}m`;
      html += `<div class="region-gap"><span class="gap-label">${gapLabel}</span></div>`;
    }

    const startLabel = formatHHMM(region.firstStart);
    const endLabel = formatHHMM(region.lastEnd);
    const showEnd = (region.lastEnd - region.firstStart) >= 60;

    const tasksHtml = region.tasks.map((t, ti) => {
      const dur = t.estimated_minutes || 60;
      const minH = 34;
      const maxH = 80;
      const h = Math.round(minH + ((dur - 15) / Math.max(maxDuration - 15, 1)) * (maxH - minH));
      const heightPx = Math.max(minH, Math.min(maxH, h));
      // 和前一個任務的間隔
      let gapHtml = '';
      if (ti > 0) {
        const prev = region.tasks[ti - 1];
        const [ph, pm] = prev.scheduled_time.split(':').map(Number);
        const prevEnd = ph * 60 + pm + (prev.estimated_minutes || 60);
        const [th, tm] = t.scheduled_time.split(':').map(Number);
        const thisStart = th * 60 + tm;
        const gapMin = thisStart - prevEnd;
        if (gapMin >= 15) {
          const gapLabel = gapMin >= 60 ? `${Math.floor(gapMin/60)}h${gapMin%60 > 0 ? gapMin%60+'m' : ''}` : `${gapMin}m`;
          gapHtml = `<div class="task-gap">${gapLabel}</div>`;
        }
      }
      return `
      ${gapHtml}
      <div class="cal-cell-task event-${t.event_type} urgency-${t.urgency || 3}${t.status === 'done' ? ' done' : ''}"
           data-task-id="${t.id}"
           style="min-height:${heightPx}px"
           onclick="event.stopPropagation(); showTaskDetail(${t.id})">
        <span class="task-title">${escapeHtml(t.title)}</span>
        <span class="task-time">${t.scheduled_time.slice(0,5)}</span>
        <span class="task-check" data-id="${t.id}" onclick="event.stopPropagation(); toggleTaskDone(${t.id})"></span>
      </div>
    `;
    }).join('');

    html += `
      <div class="region">
        <div class="region-time-axis">
          <span class="region-time-start">${startLabel}</span>
          ${showEnd ? `<span class="region-time-end">${endLabel}</span>` : ''}
        </div>
        <div class="region-content">${tasksHtml}</div>
      </div>
    `;
  });

  html += '</div>';
  return html;
}

function renderCellCollapsed(timed) {
  const first = timed[0];
  const rest = timed.length - 1;
  // 智慧截短標題：去前綴數字、只留關鍵詞
  let shortTitle = first.title || '';
  shortTitle = shortTitle.replace(/^[\d]{4}[-/]\d{2}\s*/, ''); // 去掉 "2025-26 "
  shortTitle = shortTitle.replace(/^(Required and Elective|提醒\d*[：:]|CUHK|WYS[/]\s*\w+\s*)/, ''); // 去掉常見前綴
  if (shortTitle.length < 3) shortTitle = first.title;
  if (shortTitle.length > 14) shortTitle = shortTitle.slice(0, 12) + '…';

  const taskHtml = `
    <div class="cal-cell-task event-${first.event_type} urgency-${first.urgency || 3}"
         data-task-id="${first.id}"
         onclick="event.stopPropagation(); showTaskDetail(${first.id})">
      <span class="task-title">${escapeHtml(shortTitle)}</span>
      <span class="task-time">${first.scheduled_time ? first.scheduled_time.slice(0,5) : ''}</span>
    </div>
  `;
  const moreHtml = rest > 0 ? `<div class="task-collapsed-more">+ ${rest} 件</div>` : '';
  return `
    <div class="cal-cell-timetable collapsed">
      <div class="time-dot"></div>
      <div class="task-row">${taskHtml}</div>
      ${moreHtml}
    </div>
  `;
}

function setupLocationEdit() {
  document.getElementById("calendar-grid").addEventListener("click", function(e) {
    var locEl = e.target.closest(".cal-cell-loc");
    if (!locEl) return;
    e.stopPropagation();
    var cell = locEl.closest(".cal-cell");
    var date = cell.dataset.date;
    var current = locEl.textContent;
    var input = prompt("設定 " + date + " 的地區：", current === "香港" ? "" : current);
    if (input !== null) {
      var val = input.trim() || "香港";
      localStorage.setItem("tindo_loc_" + date, val);
      locEl.textContent = val.length > 8 ? val.slice(0,7) + "…" : val;
    }
  });
}

async function toggleTaskDone(taskId) {
  try {
    const resp = await fetch(`/api/tasks/${taskId}`);
    const task = await resp.json();
    const newStatus = task.status === 'done' ? 'scheduled' : 'done';
    await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({status: newStatus}),
    });
    // 動畫效果
    const el = document.querySelector(`.cal-cell-task[data-task-id=\"${taskId}\"]`);
    if (el) {
      if (newStatus === 'done') {
        el.classList.add('done-sweep');
        setTimeout(() => { el.classList.remove('done-sweep'); el.classList.add('done'); }, 500);
      } else {
        el.classList.remove('done', 'done-sweep');
      }
    }
    if (typeof loadTodoList === 'function') loadTodoList();
    if (typeof renderInitialCalendar === 'function') renderInitialCalendar();
  } catch(e) {}
}

function formatHHMM(totalMin) {
  const h = Math.floor(totalMin / 60) % 24;
  const m = totalMin % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

// ── Hover 浮層擴展 ────────────────────────

function setupHoverExpand() {
  const grid = document.getElementById("calendar-grid");
  let currentDate = null;
  let cellRect = null;

  function close() {
    const ov = document.getElementById("cal-expanded-overlay");
    if (ov) ov.remove();
    currentDate = null;
    cellRect = null;
  }

  // 滑鼠是否在「當前格子的擴展區域」內（含浮層向下延伸的部分）
  function inExpandedZone(cx, cy) {
    if (!cellRect) return false;
    const padTop = 4;
    const padBot = 160;
    const padX = 40;
    return cx >= cellRect.left - padX && cx <= cellRect.right + padX
        && cy >= cellRect.top - padTop && cy <= cellRect.bottom + padBot;
  }

  grid.addEventListener("mousemove", (e) => {
    // 如果在當前浮層的擴展區域內，不切換
    if (currentDate && inExpandedZone(e.clientX, e.clientY)) return;

    const cell = e.target.closest(".cal-cell");
    if (!cell || cell.classList.contains("cal-cell-empty")) { close(); return; }
    const row = cell.closest(".cal-row");
    const tier = row?.dataset.tier;
    if (tier !== "3" && tier !== "week") { close(); return; }

    const date = cell.dataset.date;
    if (currentDate === date) return;

    close();
    currentDate = date;
    cellRect = cell.getBoundingClientRect();
    showExpandedOverlay(cell);
  });

  grid.addEventListener("mouseleave", () => { close(); });
}

function showExpandedOverlay(cell) {
  const date = cell.dataset.date;
  const rect = cell.getBoundingClientRect();
  const containerEl = document.getElementById("calendar-scroll-container");
  const containerRect = containerEl.getBoundingClientRect();

  const cellWidth = rect.width;
  const expandedWidth = cellWidth * 1.3;
  const extraWidth = expandedWidth - cellWidth;

  // 方向感知
  const cells = Array.from(cell.closest(".cal-row").querySelectorAll(".cal-cell"));
  const idx = cells.indexOf(cell);
  const total = cells.length;
  let leftOffset, originX;
  if (total <= 1) { leftOffset = -extraWidth / 2; originX = "center"; }
  else if (idx === 0) { leftOffset = 0; originX = "left"; }
  else if (idx === total - 1) { leftOffset = -extraWidth; originX = "right"; }
  else { leftOffset = -extraWidth / 2; originX = "center"; }

  const numEl = cell.querySelector(".cal-cell-num");
  const weekdayEl = cell.querySelector(".cal-cell-weekday");
  const dayNum = numEl ? numEl.textContent : "";
  const weekday = weekdayEl ? weekdayEl.textContent : "";

  const tasks = tasksByDate[date] || [];
  const timetableHtml = renderCellTimetableForExpand(date, tasks);

  const overlay = document.createElement("div");
  overlay.id = "cal-expanded-overlay";

  overlay.innerHTML = `
    <div class="expanded-header">
      <span class="cal-cell-num">${dayNum}</span>
      <span class="cal-cell-weekday">${weekday}</span>
    </div>
    ${timetableHtml}
  `;

  Object.assign(overlay.style, {
    left: `${rect.left - containerRect.left + containerEl.scrollLeft + leftOffset}px`,
    top: `${rect.top - containerRect.top + containerEl.scrollTop}px`,
    width: `${expandedWidth}px`,
    transformOrigin: `top ${originX}`,
  });

  containerEl.appendChild(overlay);

  // 即刻觸發動畫
  void overlay.offsetWidth;
  overlay.classList.add("shown");
}

function renderCellTimetableForExpand(date, tasks) {
  const timed = tasks.filter(t => t.scheduled_time);
  if (!timed.length) {
    return `<div class="cal-cell-timetable"><div class="cal-cell-empty-hint">無排程</div></div>`;
  }

  let earliest = 24 * 60, latest = 0;
  timed.forEach(t => {
    const [h, m] = (t.scheduled_time || "12:00").split(":").map(Number);
    const start = h * 60 + m;
    const end = start + (t.estimated_minutes || 60);
    if (start < earliest) earliest = start;
    if (end > latest) latest = end;
  });

  earliest = Math.max(0, earliest - 60);
  latest = Math.min(24 * 60, latest + 60);
  const totalMinutes = latest - earliest;
  const containerHeight = Math.max(totalMinutes * PIXELS_PER_MINUTE_HOVER, 100);

  const blocks = timed.map(t => {
    const [h, m] = (t.scheduled_time || "12:00").split(":").map(Number);
    const startMin = h * 60 + m;
    const topPx = (startMin - earliest) * PIXELS_PER_MINUTE_HOVER;
    const blockHeight = Math.max(24, (t.estimated_minutes || 60) * PIXELS_PER_MINUTE_HOVER);
    return `
      <div class="cal-cell-task event-${t.event_type} urgency-${t.urgency || 3}"
           style="top: ${topPx.toFixed(1)}px; height: ${blockHeight.toFixed(1)}px"
           data-task-id="${t.id}"
           onclick="event.stopPropagation(); showTaskDetail(${t.id})">
        <span class="task-time">${(t.scheduled_time || "").slice(0, 5)}</span>
        <span class="task-title">${escapeHtml(t.title)}</span>
      </div>
    `;
  }).join("");

  return `<div class="cal-cell-timetable" style="position:relative; height: ${containerHeight.toFixed(0)}px">${blocks}</div>`;
}

// ── 無限滾動 ──────────────────────────────

function setupInfiniteScroll() {
  const container = document.getElementById("calendar-scroll-container");
  let loading = false;

  container.addEventListener("scroll", async () => {
    if (loading) return;
    const remain = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (remain < 600) {
      loading = true;
      const grid = document.getElementById("calendar-grid");
      initialRangeEnd = await appendWeekTier(grid, initialRangeEnd);
      loading = false;
    }
    updateStickyMonth();
  });
}

function updateStickyMonth() {
  const container = document.getElementById("calendar-scroll-container");
  const rect = container.getBoundingClientRect();
  const centerY = rect.top + rect.height / 2;
  const cells = container.querySelectorAll(".cal-cell:not(.cal-cell-empty)");

  let closest = null, closestDist = Infinity;
  cells.forEach(c => {
    const r = c.getBoundingClientRect();
    const dist = Math.abs((r.top + r.bottom) / 2 - centerY);
    if (dist < closestDist) { closestDist = dist; closest = c; }
  });

  if (closest) {
    const date = closest.dataset.date;
    if (date) {
      const parts = date.split("-");
      document.getElementById("cal-month-label").textContent = `${parts[0]} 年 ${parseInt(parts[1])} 月`;
    }
  }
}

// ── 點擊 → 全螢幕日詳情 modal ─────────────

document.addEventListener("DOMContentLoaded", () => {
  const grid = document.getElementById("calendar-grid");
  grid.addEventListener("click", (e) => {
    const cell = e.target.closest(".cal-cell");
    if (!cell || cell.classList.contains("cal-cell-empty")) return;
    if (e.target.closest(".cal-cell-task") || e.target.closest(".cal-list-item")) return;
    openDayDetailModal(cell.dataset.date);
  });
});

function openDayDetailModal(dateStr) {
  window._currentDetailDate = dateStr;
  const d = new Date(dateStr + "T12:00:00");
  const weekdayMap = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
  const wd = weekdayMap[d.getDay()];
  const month = d.getMonth() + 1;
  const day = d.getDate();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000);
  let relative = "";
  if (diffDays === 0) relative = "今天";
  else if (diffDays === 1) relative = "明天";
  else if (diffDays === 2) relative = "後天";
  else if (diffDays > 2 && diffDays <= 30) relative = `${diffDays} 天後`;
  else if (diffDays > 30) relative = `${Math.round(diffDays / 30)} 個月後`;

  document.getElementById("day-detail-title").textContent = `${month}/${day} ${wd}`;
  document.getElementById("day-detail-weekday").textContent = "";
  document.getElementById("day-detail-relative").textContent = relative;
  document.getElementById("day-detail-overlay").classList.remove("hidden");

  // 渲染時間軸
  const tasks = tasksByDate[dateStr] || [];
  const timed = tasks.filter(t => t.scheduled_time).sort((a, b) => (a.scheduled_time || "").localeCompare(b.scheduled_time || ""));
  const untimed = tasks.filter(t => !t.scheduled_time);

  // 計算時間範圍
  let earliest = 6, latest = 22;
  if (timed.length) {
    timed.forEach(t => {
      const h = parseInt((t.scheduled_time || "12:00").split(":")[0]);
      if (h - 1 < earliest) earliest = Math.max(0, h - 1);
      if (h + 2 > latest) latest = Math.min(24, h + 2);
    });
  }

  // 渲染小時線
  let timelineHtml = "";
  for (let h = earliest; h <= latest; h++) {
    timelineHtml += `<div class="hour-line" data-hour="${h}"><span class="hour-label">${String(h).padStart(2, "0")}:00</span></div>`;
  }

  // 渲染任務 block（浮在時間軸上）
  var blocksHtml = "";
  timed.forEach(function(t) {
    var timeParts = (t.scheduled_time || "12:00").split(":").map(Number);
    var startMin = timeParts[0] * 60 + (timeParts[1] || 0);
    var durMin = t.estimated_minutes || 60;
    var topPx = (startMin - earliest * 60) / 60 * 48;
    var heightPx = Math.max(24, durMin / 60 * 48);
    blocksHtml += '<div class="timeline-existing-task event-' + (t.event_type || 'ddl') + '" style="top:' + topPx.toFixed(0) + 'px;height:' + heightPx.toFixed(0) + 'px" onclick="showTaskDetail(' + t.id + ')"><span>' + (t.scheduled_time || "").slice(0,5) + '</span> <span>' + escapeHtml(t.title) + '</span></div>';
  });
  document.getElementById("day-detail-timeline").innerHTML = timelineHtml + blocksHtml;
  document.getElementById("day-detail-timeline").style.position = "relative";

  // 未指定時間
  const unscheduledDiv = document.getElementById("day-detail-unscheduled");
  if (untimed.length) {
    unscheduledDiv.innerHTML = untimed.map(t =>
      `<div class="cal-list-item event-${t.event_type} urgency-${t.urgency || 3}" style="cursor:pointer;margin-bottom:4px;" onclick="showTaskDetail(${t.id})">
        <span class="cal-list-time">—</span>
        <span class="cal-list-title">${escapeHtml(t.title)}</span>
      </div>`
    ).join("");
  } else {
    unscheduledDiv.textContent = "無";
  }

  // 統計
  const totalMin = tasks.reduce((s, t) => s + (t.estimated_minutes || 0), 0);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  const highUrgency = tasks.filter(t => (t.urgency || 0) >= 4).length;
  document.getElementById("day-detail-stats").innerHTML = `
    <div>任務數: ${tasks.length} 個 (${timed.length} 已定時 / ${untimed.length} 未定時)</div>
    <div>預估總時長: ${hours}h ${mins}m</div>
    <div>高急迫度: ${highUrgency} 個</div>
  `;
}

// ── helpers ────────────────────────────────

function getWeekStartMonday(d) {
  const dayOfWeek = (d.getDay() + 6) % 7;
  return addDays(d, -dayOfWeek);
}
