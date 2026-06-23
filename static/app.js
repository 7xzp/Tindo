// ═══════════════════════════════════════════════
// Tindo app.js — 主邏輯、視區切換、鍵盤、modals
// ═══════════════════════════════════════════════

let currentView = "calendar";
let pendingScheduleTaskId = null;

// ── 視區切換 ──────────────────────────────

function switchView(view) {
  currentView = view;
  document.getElementById("view-calendar").classList.toggle("hidden", view !== "calendar");
  document.getElementById("view-todolist").classList.toggle("hidden", view !== "todolist");
  document.getElementById("view-tinder").classList.toggle("hidden", view !== "tinder");

  document.querySelectorAll(".view-tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.view === view);
  });

  if (view === "todolist") loadTodoList();
  if (view === "tinder" && typeof loadTinderTasks === "function") loadTinderTasks();
  if (view === "calendar") {
    if (typeof ensureCalendarRendered === "function") ensureCalendarRendered();
  }
}

document.querySelectorAll(".view-tab").forEach(tab => {
  tab.addEventListener("click", () => switchView(tab.dataset.view));
});

// ── 鍵盤監聽 ─────────────────────────────

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea, select")) return;
  if (e.key === "1") switchView("calendar");
  if (e.key === "2") switchView("todolist");
  if (e.key === "3") switchView("tinder");
  if (e.key === "Escape") closeAllModals();
});

// ── 新增任務 modal ────────────────────────

const addModal = document.getElementById("add-task-modal");
let parseResultData = null;

document.getElementById("btn-open-add-modal").addEventListener("click", () => {
  openAddModal();
});

function openAddModal(datePreset) {
  addModal.classList.remove("hidden");
  showAddStep("input");
  document.getElementById("input-raw-text").value = "";
  document.getElementById("input-raw-text").focus();
  parseResultData = null;
  window._presetEventType = "ddl";
  if (datePreset) window._presetDate = datePreset;
}

function closeAddTaskModal() {
  addModal.classList.add("hidden");
  window._presetDate = null;
  window._editingTaskId = null;
  document.getElementById("btn-add-submit").textContent = "加入";
  // 重置標題
  var t = document.querySelector("#modal-step-confirm .modal-title");
  if (t) t.textContent = "確認任務";
  // 清理編輯模式的按鈕
  var oldBtns = document.querySelectorAll("#btn-edit-schedule, #btn-edit-delete");
  oldBtns.forEach(function(b) { b.remove(); });
}

function showAddStep(step) {
  document.getElementById("modal-step-input").classList.toggle("hidden", step !== "input");
  document.getElementById("modal-step-loading").classList.toggle("hidden", step !== "loading");
  document.getElementById("modal-step-confirm").classList.toggle("hidden", step !== "confirm");
}

// Close buttons
document.getElementById("btn-close-add").addEventListener("click", closeAddTaskModal);
document.getElementById("btn-cancel-input").addEventListener("click", closeAddTaskModal);
document.getElementById("btn-close-add-2").addEventListener("click", closeAddTaskModal);
document.getElementById("btn-add-back").addEventListener("click", () => { showAddStep("input"); });

// Enter to parse
document.getElementById("input-raw-text").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doParse(); }
});

// 輸入階段選類型
document.querySelectorAll("#input-event-type-segment .segmented-item").forEach(function(item) {
  item.addEventListener("click", function() {
    document.querySelectorAll("#input-event-type-segment .segmented-item").forEach(function(i) { i.classList.remove("active"); });
    item.classList.add("active");
    window._presetEventType = item.dataset.type;
  });
});

document.getElementById("btn-manual-input").addEventListener("click", function() {
  var now = new Date();
  var pad = function(n) { return String(n).padStart(2,'0'); };
  var todayStr = now.getFullYear() + '-' + pad(now.getMonth()+1) + '-' + pad(now.getDate());
  var fakeData = {
    title: document.getElementById("input-raw-text").value.trim() || "",
    event_type: window._presetEventType || "ddl",
    estimated_minutes: 60,
    urgency: 3,
    workload: 2,
    ai_summary: "",
    deadline: todayStr + "T23:59:00",
  };
  fillConfirmCard(fakeData);
  showAddStep("confirm");
});

document.getElementById("btn-parse").addEventListener("click", doParse);

async function doParse() {
  const text = document.getElementById("input-raw-text").value.trim();
  if (!text) return;
  showAddStep("loading");
  try {
    const resp = await fetch("/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text, event_type: window._presetEventType || "ddl" }),
    });
    const data = await resp.json();
    if (data.error && !data.title) {
      alert("AI 解析失敗：" + data.error + "\n請手動填寫欄位");
      showAddStep("input");
      return;
    }
    parseResultData = data;
    // 強制使用使用者選擇的類型，不被 AI 覆蓋
    if (window._presetEventType) {
      data.event_type = window._presetEventType;
    }
    fillConfirmCard(data);
    showAddStep("confirm");
  } catch (e) {
    alert("AI 服務暫時不可用：" + e.message);
  }
}

// ── Segmented control ──────────────────────

document.querySelectorAll("#event-type-segment .segmented-item").forEach(item => {
  item.addEventListener("click", () => {
    document.querySelectorAll("#event-type-segment .segmented-item").forEach(i => {
      i.classList.remove("active");
      i.setAttribute("aria-selected", "false");
    });
    item.classList.add("active");
    item.setAttribute("aria-selected", "true");
    const type = item.dataset.type;
    document.getElementById("confirm-event-type").value = type;

    // 切換類型時，把舊時間帶到新欄位
    var dlInput = document.getElementById("confirm-deadline");
    var evtInput = document.getElementById("confirm-event-time");
    if (type === "event" && dlInput.value) {
      evtInput.value = dlInput.value;
    } else if (type === "ddl" && evtInput.value) {
      dlInput.value = evtInput.value;
    }

    document.querySelectorAll("#modal-step-confirm [data-show-for]").forEach(el => {
      el.style.display = (el.dataset.showFor === type) ? "" : "none";
    });
  });
});

// ── Rating dots ────────────────────────────

function setupRatingDots(groupId, valueElId) {
  const group = document.getElementById(groupId);
  const valueEl = document.getElementById(valueElId);
  const dots = group.querySelectorAll(".rating-dot");
  function render(val) {
    group.dataset.value = val;
    dots.forEach((d, i) => d.classList.toggle("filled", i < val));
    valueEl.textContent = val + " / 5";
  }
  dots.forEach((dot, idx) => {
    dot.addEventListener("click", () => render(idx + 1));
  });
  render(parseInt(group.dataset.value || "3"));
}

setupRatingDots("confirm-urgency", "confirm-urgency-value");
setupRatingDots("confirm-workload", "confirm-workload-value");

// ── 從 AI 解析結果填入 modal ───────────────

function fillConfirmCard(data) {
  document.getElementById("confirm-title").value = data.title || "";

  var ftype = data.event_type || "ddl";

  // 同步確認頁的 segmented control + hidden input
  document.getElementById("confirm-event-type").value = ftype;
  var segs = document.querySelectorAll("#event-type-segment .segmented-item");
  segs.forEach(function(s) { s.classList.remove("active"); });
  var match = document.querySelector('#event-type-segment .segmented-item[data-type="' + ftype + '"]');
  if (match) { match.classList.add("active"); match.setAttribute("aria-selected", "true"); }
  // 顯示/隱藏對應時間欄位
  document.querySelectorAll("#modal-step-confirm [data-show-for]").forEach(function(el) {
    el.style.display = (el.dataset.showFor === ftype) ? "" : "none";
  });

  if (ftype === "ddl" && data.deadline) {
    document.getElementById("confirm-deadline").value = toLocalDatetimeInput(data.deadline);
  } else if (ftype === "event" && data.deadline) {
    document.getElementById("confirm-event-time").value = toLocalDatetimeInput(data.deadline);
  }

  document.getElementById("confirm-estimated").value = data.estimated_minutes || 60;

  // Rating dots — re-init
  document.getElementById("confirm-urgency").dataset.value = data.urgency || 3;
  document.getElementById("confirm-workload").dataset.value = data.workload || 2;
  setupRatingDots("confirm-urgency", "confirm-urgency-value");
  setupRatingDots("confirm-workload", "confirm-workload-value");

  document.getElementById("confirm-summary").value = data.ai_summary || "";
}

function toLocalDatetimeInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 16);
  const pad = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

// ── 送出新增任務 ───────────────────────────

document.getElementById("btn-add-submit").addEventListener("click", submitNewTask);

async function submitNewTask() {
  const eventType = document.getElementById("confirm-event-type").value;
  const title = document.getElementById("confirm-title").value.trim();
  if (!title) { alert("請輸入標題"); return; }

  const base = {
    title: title,
    event_type: eventType,
    estimated_minutes: parseInt(document.getElementById("confirm-estimated").value) || 60,
    urgency: parseInt(document.getElementById("confirm-urgency").dataset.value) || 3,
    workload: parseInt(document.getElementById("confirm-workload").dataset.value) || 2,
    ai_summary: document.getElementById("confirm-summary").value.trim(),
    source: "manual",
    raw_content: document.getElementById("input-raw-text").value.trim(),
  };

  // 編輯模式：PATCH
  if (window._editingTaskId) {
    if (eventType === "event") {
      const at = document.getElementById("confirm-event-time").value;
      if (at) {
        const [d, t] = at.split("T");
        base.scheduled_date = d;
        base.scheduled_time = t;
        base.deadline = null;
        base.status = "scheduled";
        base.decision = "do";
      }
    } else if (eventType === "ddl") {
      const dl = document.getElementById("confirm-deadline").value;
      base.deadline = dl ? new Date(dl).toISOString() : null;
    }
    try {
      const resp = await fetch("/api/tasks/" + window._editingTaskId, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(base),
      });
      if (!resp.ok) throw new Error("儲存失敗");
      window._editingTaskId = null;
      document.getElementById("btn-add-submit").textContent = "加入";
      closeAddTaskModal();
      if (typeof loadTodoList === "function") loadTodoList();
      if (typeof renderInitialCalendar === "function") renderInitialCalendar();
    } catch (e) { alert("儲存失敗：" + e.message); }
    return;
  }

  // 新增模式
  if (eventType === "event") {
    const at = document.getElementById("confirm-event-time").value;
    if (!at) { alert("請填入活動時間"); return; }
    const [d, t] = at.split("T");
    base.scheduled_date = d;
    base.scheduled_time = t;
    base.deadline = null;
    base.status = "scheduled";
    base.decision = "do";

    try {
      const resp = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(base),
      });
      if (!resp.ok) throw new Error("建立失敗");
      closeAddTaskModal();
      if (typeof loadTodoList === "function") loadTodoList();
      if (typeof renderInitialCalendar === "function") renderInitialCalendar();
    } catch (e) { alert("建立任務失敗：" + e.message); }

  } else if (eventType === "ddl") {
    const dl = document.getElementById("confirm-deadline").value;
    base.deadline = dl ? new Date(dl).toISOString() : null;
    closeAddTaskModal();
    openScheduleModal({
      context: "create",
      pendingTaskData: base,
      taskTitle: base.title,
      deadline: base.deadline,
      estimatedMinutes: base.estimated_minutes,
    });
  }
}

// ═══════════════════════════════════════════════
// AI 對話修正
// ═══════════════════════════════════════════════

const refineInput = document.getElementById('ai-refine-input');
const refineBtn = document.getElementById('btn-ai-refine');

refineBtn.addEventListener('click', refineWithAI);
refineInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); refineWithAI(); }
});

async function refineWithAI() {
  const correction = refineInput.value.trim();
  if (!correction) return;

  const current = collectCurrentFormData();
  const rawInput = document.getElementById('input-raw-text')?.value?.trim() || '';

  refineBtn.disabled = true;
  refineBtn.classList.add('loading');

  try {
    const resp = await fetch('/api/refine-parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current, raw_input: rawInput, correction }),
    });
    const data = await resp.json();

    if (data.error) { alert(data.error); return; }

    const changedFields = applyRefinedDataToForm(current, data);
    flashChangedFields(changedFields);

    refineInput.value = '';
    refineInput.focus();
  } catch (e) {
    alert('AI 修改失敗：' + e.message);
  } finally {
    refineBtn.disabled = false;
    refineBtn.classList.remove('loading');
  }
}

function collectCurrentFormData() {
  return {
    title: document.getElementById('confirm-title').value,
    event_type: document.getElementById('confirm-event-type').value,
    deadline: getCurrentDeadlineISO(),
    estimated_minutes: parseInt(document.getElementById('confirm-estimated').value) || 60,
    urgency: parseInt(document.getElementById('confirm-urgency').dataset.value) || 3,
    workload: parseInt(document.getElementById('confirm-workload').dataset.value) || 2,
    ai_summary: document.getElementById('confirm-summary').value,
  };
}

function getCurrentDeadlineISO() {
  const type = document.getElementById('confirm-event-type').value;
  let val = '';
  if (type === 'ddl') val = document.getElementById('confirm-deadline')?.value || '';
  else if (type === 'event') val = document.getElementById('confirm-event-time')?.value || '';
  return val ? new Date(val).toISOString() : null;
}

function applyRefinedDataToForm(before, after) {
  const changed = [];
  if (after.title !== undefined && after.title !== before.title) {
    document.getElementById('confirm-title').value = after.title;
    changed.push('title');
  }
  if (after.event_type && after.event_type !== before.event_type) {
    const seg = document.querySelector('#event-type-segment .segmented-item[data-type="' + after.event_type + '"]');
    if (seg) seg.click();
    changed.push('event_type');
  }
  const newType = after.event_type || before.event_type;
  if (after.deadline !== undefined) {
    const targetId = newType === 'ddl' ? 'confirm-deadline' : 'confirm-event-time';
    const target = document.getElementById(targetId);
    if (target) { target.value = toLocalDatetimeInput(after.deadline) || ''; changed.push('time'); }
  }
  if (after.estimated_minutes !== undefined && after.estimated_minutes !== before.estimated_minutes) {
    document.getElementById('confirm-estimated').value = after.estimated_minutes;
    changed.push('estimated');
  }
  if (after.urgency !== undefined && after.urgency !== before.urgency) {
    document.getElementById('confirm-urgency').dataset.value = after.urgency;
    setupRatingDots('confirm-urgency', 'confirm-urgency-value');
    changed.push('urgency');
  }
  if (after.workload !== undefined && after.workload !== before.workload) {
    document.getElementById('confirm-workload').dataset.value = after.workload;
    setupRatingDots('confirm-workload', 'confirm-workload-value');
    changed.push('workload');
  }
  if (after.ai_summary !== undefined && after.ai_summary !== before.ai_summary) {
    document.getElementById('confirm-summary').value = after.ai_summary;
    changed.push('summary');
  }
  return changed;
}

function flashChangedFields(fields) {
  const map = {
    title: '#confirm-title',
    event_type: '.segmented',
    time: '.datetime-wrap',
    estimated: '.input-with-suffix',
    urgency: '#confirm-urgency',
    workload: '#confirm-workload',
    summary: '#confirm-summary',
  };
  fields.forEach(f => {
    const sel = map[f];
    if (!sel) return;
    var els = document.querySelectorAll(sel);
    els.forEach(function(el) {
      el.classList.remove('highlight');
      void el.offsetWidth;
      el.classList.add('highlight');
    });
  });
}

// ── 按鈕文字依類型切換 ─────────────────────

function updateSubmitButtonLabel() {
  const type = document.getElementById("confirm-event-type").value;
  const btn = document.getElementById("btn-add-submit");
  btn.textContent = (type === "ddl") ? "下一步:選哪天做" : "加入";
}

// 在 segmented control 切換時呼叫
document.querySelectorAll("#event-type-segment .segmented-item").forEach(function(item) {
  var origClick = item.onclick;
  item.addEventListener("click", function() {
    setTimeout(updateSubmitButtonLabel, 0);
  });
});
updateSubmitButtonLabel();

// ═══════════════════════════════════════════════
// 排程 modal — 6 天並排卡片 + 時段選擇
// ═══════════════════════════════════════════════

let scheduleState = {
  context: null,
  pendingTaskData: null,
  taskId: null,
  taskTitle: '',
  deadline: null,
  estimatedMinutes: 60,
  rangeStart: null,
  daysToShow: 6,
  selectedDate: null,
  daysData: {},
};

const scheduleModal = document.getElementById('schedule-modal');

function openScheduleModal(opts) {
  scheduleState = {
    context: opts.context || 'edit',
    pendingTaskData: opts.pendingTaskData || null,
    taskId: opts.taskId || null,
    taskTitle: opts.taskTitle || '',
    deadline: opts.deadline || null,
    estimatedMinutes: opts.estimatedMinutes || 60,
    rangeStart: null,
    daysToShow: 6,
    selectedDate: null,
    daysData: {},
  };

  document.getElementById('schedule-title').textContent = `排程任務「${scheduleState.taskTitle || '新任務'}」`;
  var subParts = [];
  if (scheduleState.deadline) subParts.push('截止:' + formatDeadlineShort(scheduleState.deadline));
  if (scheduleState.estimatedMinutes) subParts.push('預估 ' + scheduleState.estimatedMinutes + ' 分鐘');
  document.getElementById('schedule-subtitle').textContent = subParts.join(' · ');

  var today = new Date(); today.setHours(0,0,0,0);
  var todayStr = toDateStr(today);

  if (opts.deadline) {
    var dl = new Date(opts.deadline);
    dl.setHours(0,0,0,0);
    var dlStr = toDateStr(dl);

    if (dlStr < todayStr) {
      scheduleState.rangeStart = todayStr;
      scheduleState.daysToShow = 6;
    } else {
      var candidateStart = addDaysStr(dlStr, -5);
      scheduleState.rangeStart = candidateStart < todayStr ? todayStr : candidateStart;
      var diffDays = Math.floor((new Date(dlStr) - new Date(scheduleState.rangeStart)) / 86400000);
      scheduleState.daysToShow = Math.min(7, diffDays + 1);
    }
  } else {
    scheduleState.rangeStart = todayStr;
    scheduleState.daysToShow = 7;
  }

  document.getElementById('time-section').classList.add('hidden');
  document.getElementById('btn-schedule-confirm').disabled = true;

  scheduleModal.classList.remove('hidden');
  loadAndRenderDays();
}

function closeScheduleModal() {
  scheduleModal.classList.add('hidden');
}

async function loadAndRenderDays() {
  var start = scheduleState.rangeStart;
  var end = addDaysStr(start, scheduleState.daysToShow - 1);
  try {
    var resp = await fetch('/api/tasks/by-date-range?start=' + start + '&end=' + end);
    var data = await resp.json();
    scheduleState.daysData = {};
    (data.days || []).forEach(function(d) { scheduleState.daysData[d.date] = d; });
  } catch(e) { scheduleState.daysData = {}; }
  renderDayCards();
  renderPagerState();
}

function renderDayCards() {
  var container = document.getElementById('day-cards-container');
  container.style.gridTemplateColumns = 'repeat(' + scheduleState.daysToShow + ', minmax(0, 1fr))';
  var today = toDateStr(new Date());
  var ddlDate = scheduleState.deadline ? scheduleState.deadline.slice(0, 10) : null;

  var html = '';
  for (var i = 0; i < scheduleState.daysToShow; i++) {
    var date = addDaysStr(scheduleState.rangeStart, i);
    var data = scheduleState.daysData[date] || { tasks: [], total_minutes: 0 };
    var isToday = date === today;
    var isDdl = ddlDate === date;
    var isPast = date < today;
    if (isPast) continue;

    var rel = relativeLabel(date, today, ddlDate);
    var dateDisplay = parseInt(date.slice(5,7)) + '/' + parseInt(date.slice(8,10));
    var tasks = (data.tasks || []).slice(0, 3);
    var tasksHtml = '';
    if (tasks.length === 0) {
      tasksHtml = '<div class="day-card-empty">無排程</div>';
    } else {
      tasksHtml = tasks.map(function(t) {
        var icon = t.event_type === 'ddl' ? '⏰' : '📍';
        var title = t.title.length > 8 ? t.title.slice(0, 7) + '…' : t.title;
        var mins = t.estimated_minutes ? t.estimated_minutes + 'm' : '';
        return '<div class="day-card-task"><span class="day-card-task-icon">' + icon + '</span><span class="day-card-task-title">' + escapeHtml(title) + '</span><span class="day-card-task-mins">' + mins + '</span></div>';
      }).join('');
      if ((data.tasks || []).length > 3) tasksHtml += '<div class="day-card-more">+' + ((data.tasks || []).length - 3) + ' 個</div>';
    }

    var total = data.total_minutes || 0;
    var level = 0, label = '空';
    if (total > 300) { level = 3; label = '滿'; }
    else if (total > 120) { level = 2; label = '忙'; }
    else if (total > 0) { level = 1; label = '輕鬆'; }

    var warningHtml = '';
    if (i === 0 && ddlDate && ddlDate < today) {
      var overdueDays = Math.floor((new Date(today) - new Date(ddlDate)) / 86400000);
      warningHtml = '<div class="day-card-warning">⚠ DDL 已過 ' + overdueDays + ' 天</div>';
    }

    var classes = ['day-card', isToday ? 'is-today' : '', isDdl ? 'is-ddl' : ''].filter(Boolean).join(' ');
    html += '<div class="' + classes + '" data-date="' + date + '"><div class="day-card-head"><span class="day-card-rel">' + rel + '</span><span class="day-card-date">' + dateDisplay + '</span></div>' + warningHtml + '<div class="day-card-tasks">' + tasksHtml + '</div><div class="day-card-busy"><div class="day-card-busy-bar level-' + level + '"></div><span class="day-card-busy-label">' + label + '</span></div></div>';
  }
  container.innerHTML = html;

  container.querySelectorAll('.day-card').forEach(function(card) {
    card.addEventListener('click', function() {
      container.querySelectorAll('.day-card').forEach(function(c) { c.classList.remove('selected'); });
      card.classList.add('selected');
      scheduleState.selectedDate = card.dataset.date;
      renderTimeSection();
    });
  });
}

function renderPagerState() {
  var prevBtn = document.getElementById('day-pager-prev');
  var nextBtn = document.getElementById('day-pager-next');
  var today = toDateStr(new Date());
  var ddlDate = scheduleState.deadline ? scheduleState.deadline.slice(0, 10) : null;

  prevBtn.disabled = scheduleState.rangeStart <= today;

  var lastShown = addDaysStr(scheduleState.rangeStart, scheduleState.daysToShow - 1);
  nextBtn.disabled = ddlDate ? lastShown >= ddlDate : false;
}

document.getElementById('day-pager-prev').addEventListener('click', function() {
  var today = toDateStr(new Date());
  var newStart = addDaysStr(scheduleState.rangeStart, -7);
  if (newStart < today) newStart = today;
  scheduleState.rangeStart = newStart;
  loadAndRenderDays();
});

document.getElementById('day-pager-next').addEventListener('click', function() {
  var ddlDate = scheduleState.deadline ? scheduleState.deadline.slice(0, 10) : null;
  var newStart = addDaysStr(scheduleState.rangeStart, 7);
  if (ddlDate && newStart > ddlDate) newStart = ddlDate;
  scheduleState.rangeStart = newStart;
  loadAndRenderDays();
});

// ── 時段選擇器 ──────────────────────────

async function renderTimeSection() {
  document.getElementById('time-section').classList.remove('hidden');
  var date = scheduleState.selectedDate;
  var wd = dayOfWeekZh(date);
  document.getElementById('time-question').textContent = parseInt(date.slice(5,7)) + '/' + parseInt(date.slice(8,10)) + ' (' + wd + ') 你要幾點開始做?';

  var startSel = document.getElementById('schedule-start-time');
  startSel.innerHTML = '';
  for (var h = 6; h < 24; h++) {
    for (var m = 0; m < 60; m += 15) {
      var t = String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
      var opt = document.createElement('option');
      opt.value = t; opt.textContent = t;
      startSel.appendChild(opt);
    }
  }

  var durSel = document.getElementById('schedule-duration');
  var presetDur = scheduleState.estimatedMinutes || 60;
  var presetVals = ['15','30','45','60','90','120','180'];
  if (presetVals.indexOf(String(presetDur)) >= 0) {
    durSel.value = String(presetDur);
    document.getElementById('schedule-duration-custom').style.display = 'none';
  } else {
    durSel.value = 'custom';
    document.getElementById('schedule-duration-custom').style.display = '';
    document.getElementById('schedule-duration-custom').value = presetDur;
  }

  // AI 回來前不設預設值，顯示載入中
  startSel.value = '';
  document.getElementById('time-question').textContent =
    parseInt(date.slice(5,7)) + '/' + parseInt(date.slice(8,10)) + ' (' + wd + ') · AI 分析最佳時段中...';
  renderDayTimeline();

  // 異步請求 AI 推薦
  var data = scheduleState.daysData[date] || { tasks: [] };
  var aiTime = null;
  try {
    var aiResp = await fetch('/api/recommend-slot', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        date: date,
        task: {
          title: scheduleState.taskTitle || '',
          estimated_minutes: presetDur,
          urgency: scheduleState.pendingTaskData ? scheduleState.pendingTaskData.urgency : 3,
          workload: scheduleState.pendingTaskData ? scheduleState.pendingTaskData.workload : 2,
          event_type: 'ddl',
        },
        existing_tasks: (data.tasks || []).map(function(t) { return { title: t.title, scheduled_time: t.scheduled_time, estimated_minutes: t.estimated_minutes, event_type: t.event_type }; }),
      }),
    });
    var aiResult = await aiResp.json();
    if (aiResult.recommended_time) {
      aiTime = aiResult.recommended_time;
      document.getElementById('time-question').textContent =
        parseInt(date.slice(5,7)) + '/' + parseInt(date.slice(8,10)) + ' (' + wd + ') · AI 建議 ' + aiResult.recommended_time + ' — ' + aiResult.reason;
    }
  } catch(e) { /* 無視 */ }

  // AI 失敗才用 fallback
  if (!aiTime) {
    aiTime = findFirstEmptySlot(date, presetDur) || '09:00';
    document.getElementById('time-question').textContent =
      parseInt(date.slice(5,7)) + '/' + parseInt(date.slice(8,10)) + ' (' + wd + ') 你要幾點開始做?';
  }
  startSel.value = aiTime;
  renderDayTimeline();

  startSel.onchange = renderDayTimeline;
  durSel.onchange = onDurationChange;
  document.getElementById('schedule-duration-custom').oninput = renderDayTimeline;

  document.getElementById('btn-schedule-confirm').disabled = false;
}

function onDurationChange() {
  var durSel = document.getElementById('schedule-duration');
  var customInput = document.getElementById('schedule-duration-custom');
  if (durSel.value === 'custom') { customInput.style.display = ''; customInput.focus(); }
  else { customInput.style.display = 'none'; }
  renderDayTimeline();
}

function getSelectedDuration() {
  var durSel = document.getElementById('schedule-duration');
  if (durSel.value === 'custom') return parseInt(document.getElementById('schedule-duration-custom').value) || 60;
  return parseInt(durSel.value) || 60;
}

function renderDayTimeline() {
  var date = scheduleState.selectedDate;
  if (!date) return;
  var data = scheduleState.daysData[date] || { tasks: [] };
  var container = document.getElementById('day-timeline');
  var HOUR_HEIGHT = 30;
  var PPM = HOUR_HEIGHT / 60;
  var START_HOUR = 6;
  var html = '';
  for (var h = START_HOUR; h < 24; h++) {
    html += '<div class="timeline-hour"><span class="timeline-hour-label">' + String(h).padStart(2,'0') + ':00</span></div>';
  }
  (data.tasks || []).forEach(function(t) {
    if (!t.scheduled_time) return;
    var parts = t.scheduled_time.split(':');
    var hh = parseInt(parts[0]), mm = parseInt(parts[1]);
    var startMin = hh * 60 + mm;
    var durMin = t.estimated_minutes || 60;
    var topPx = (startMin - START_HOUR * 60) * PPM;
    var heightPx = Math.max(18, durMin * PPM);
    var cls = 'timeline-existing-task event-' + (t.event_type || 'ddl');
    html += '<div class="' + cls + '" style="top:' + topPx.toFixed(1) + 'px;height:' + heightPx.toFixed(1) + 'px"><span>' + t.scheduled_time + '</span> <span>' + escapeHtml(t.title || '') + '</span></div>';
  });
  var startTime = document.getElementById('schedule-start-time').value;
  if (startTime) {
    var parts = startTime.split(':');
    var hh = parseInt(parts[0]), mm = parseInt(parts[1]);
    var startMin = hh * 60 + mm;
    var durMin = getSelectedDuration();
    var topPx = (startMin - START_HOUR * 60) * PPM;
    var heightPx = Math.max(18, durMin * PPM);
    html += '<div class="timeline-new-task" style="top:' + topPx.toFixed(1) + 'px;height:' + heightPx.toFixed(1) + 'px">新任務 · ' + startTime + ' (' + durMin + 'm)</div>';
  }
  container.innerHTML = html;
}

function findFirstEmptySlot(date, neededMin) {
  var data = scheduleState.daysData[date] || { tasks: [] };
  var occupied = (data.tasks || [])
    .filter(function(t) { return t.scheduled_time; })
    .map(function(t) {
      var parts = t.scheduled_time.split(':');
      var start = parseInt(parts[0]) * 60 + parseInt(parts[1]);
      return { start: start, end: start + (t.estimated_minutes || 60) };
    })
    .sort(function(a, b) { return a.start - b.start; });
  // 今天：從現在時間+30min 開始找；未來：從 9:00 開始
  var today = toDateStr(new Date());
  var now = new Date();
  var nowMin = now.getHours() * 60 + now.getMinutes();
  var cursor;
  if (date === today) {
    cursor = Math.max(nowMin + 30, 9 * 60);
  } else {
    cursor = 9 * 60;
  }
  for (var i = 0; i < occupied.length; i++) {
    if (occupied[i].start - cursor >= neededMin) {
      var h = Math.floor(cursor / 60), m = cursor % 60;
      return String(h).padStart(2,'0') + ':' + String(Math.ceil(m/15)*15).padStart(2,'0');
    }
    cursor = Math.max(cursor, occupied[i].end);
  }
  if (cursor + neededMin <= 24 * 60) {
    var h = Math.floor(cursor / 60), m = Math.ceil((cursor % 60) / 15) * 15;
    return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
  }
  // fallback: 今天用現在時間，未來用 9:00
  if (date === today) {
    var fh = Math.max(now.getHours() + 1, 9);
    return String(fh).padStart(2,'0') + ':00';
  }
  return '09:00';
}

// ── 確認排程 ─────────────────────────────

document.getElementById('btn-schedule-confirm').addEventListener('click', async function() {
  var date = scheduleState.selectedDate;
  var time = document.getElementById('schedule-start-time').value;
  var mins = getSelectedDuration();
  if (!date || !time) { alert('請選日期 + 時段'); return; }

  if (scheduleState.context === 'create') {
    var payload = Object.assign({}, scheduleState.pendingTaskData, {
      scheduled_date: date,
      scheduled_time: time,
      estimated_minutes: mins,
      status: 'scheduled',
      decision: 'do',
    });
    var resp = await fetch('/api/tasks', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    var result = await resp.json();
    if (result.error) { alert(result.error); return; }
  } else {
    var resp = await fetch('/api/tasks/' + scheduleState.taskId + '/schedule', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ scheduled_date: date, scheduled_time: time, estimated_minutes: mins }),
    });
    var result = await resp.json();
    if (result.error) { alert(result.error); return; }
  }

  closeScheduleModal();
  if (typeof loadTodoList === 'function') loadTodoList();
  if (typeof renderInitialCalendar === 'function') renderInitialCalendar();
});

document.getElementById('btn-schedule-later').addEventListener('click', async function() {
  if (scheduleState.context === 'create' && scheduleState.pendingTaskData) {
    var payload = Object.assign({}, scheduleState.pendingTaskData);
    payload.status = 'decided';
    payload.scheduled_date = null;
    payload.scheduled_time = null;
    try {
      await fetch('/api/tasks', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
      });
    } catch(e) {}
  }
  closeScheduleModal();
  if (typeof loadTodoList === 'function') loadTodoList();
  setTimeout(function() {
    if (typeof loadTinderTasks === 'function') loadTinderTasks();
    if (typeof updateTinderBadge === 'function') updateTinderBadge();
  }, 400);
});

document.getElementById('btn-schedule-cancel').addEventListener('click', closeScheduleModal);
document.getElementById('btn-close-schedule').addEventListener('click', closeScheduleModal);

// ── 小工具 ───────────────────────────────

function toDateStr(d) {
  var pad = function(n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function addDaysStr(dateStr, days) {
  var d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

function dayOfWeekZh(dateStr) {
  return ['週日','週一','週二','週三','週四','週五','週六'][new Date(dateStr + 'T12:00:00').getDay()];
}

function relativeLabel(date, today, ddlDate) {
  if (date === today) return '今天';
  if (date === addDaysStr(today, 1)) return '明天';
  if (date === addDaysStr(today, 2)) return '後天';
  if (date === ddlDate) return 'DDL';
  return dayOfWeekZh(date);
}

function formatDeadlineShort(iso) {
  var d = new Date(iso);
  var pad = function(n) { return String(n).padStart(2,'0'); };
  return (d.getMonth()+1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// ── 舊版兼容: openScheduleModalForTask ─────

function openScheduleForExistingTask(task) {
  openScheduleModal({
    context: 'edit',
    taskId: task.id,
    taskTitle: task.title,
    deadline: task.deadline,
    estimatedMinutes: task.estimated_minutes || 60,
  });
}

// ── 任務詳情 panel ────────────────────────

document.getElementById("btn-close-task-detail").addEventListener("click", () => {
  document.getElementById("task-detail-panel").classList.add("hidden");
});

document.getElementById("btn-schedule-from-detail").addEventListener("click", () => {
  if (pendingScheduleTaskId && window._lastTaskDetail) {
    document.getElementById("task-detail-panel").classList.add("hidden");
    openScheduleForExistingTask(window._lastTaskDetail);
  }
});

document.getElementById("btn-delete-task").addEventListener("click", async () => {
  if (!pendingScheduleTaskId) return;
  if (!confirm("確定要刪除這個任務嗎？")) return;
  try {
    await fetch(`/api/tasks/${pendingScheduleTaskId}`, { method: "DELETE" });
    document.getElementById("task-detail-panel").classList.add("hidden");
    loadTodoList();
    if (typeof renderInitialCalendar === "function") renderInitialCalendar();
  } catch (e) {
    alert("刪除失敗：" + e.message);
  }
});

// ⭐ 全域函數：顯示任務詳情
function showTaskDetail(taskId) {
  fetch(`/api/tasks/${taskId}`)
    .then(r => r.json())
    .then(task => { openEditTaskModal(task); });
}

function openEditTaskModal(task) {
  closeAllModals();
  window._lastTaskDetail = task;
  pendingScheduleTaskId = task.id;
  document.getElementById("add-task-modal").classList.remove("hidden");
  showAddStep("confirm");
  document.getElementById("modal-step-confirm").querySelector(".modal-title").textContent = "編輯任務";
  var d = {
    title: task.title || "",
    event_type: task.event_type || "ddl",
    estimated_minutes: task.estimated_minutes || 60,
    urgency: task.urgency || 3,
    workload: task.workload || 2,
    ai_summary: task.ai_summary || "",
    deadline: task.deadline || "",
  };
  fillConfirmCard(d);
  if (task.deadline) {
    document.getElementById("confirm-deadline").value = toLocalDatetimeInput(task.deadline);
  }
  if (task.event_type === "event" && task.scheduled_date) {
    var t = task.scheduled_date;
    if (task.scheduled_time) t += "T" + (task.scheduled_time.length === 5 ? task.scheduled_time : task.scheduled_time.slice(0, 5));
    document.getElementById("confirm-event-time").value = t;
  }
  window._editingTaskId = task.id;
  document.getElementById("btn-add-submit").textContent = "儲存修改";

  // 排程 + 刪除快捷鍵
  var actions = document.querySelector("#modal-step-confirm .modal-actions");
  if (actions) {
    var oldBtns = document.querySelectorAll("#btn-edit-schedule, #btn-edit-delete");
    oldBtns.forEach(function(b) { b.remove(); });
    var schedHtml = "";
    if (task.event_type === "ddl" && task.status !== "scheduled") {
      schedHtml = '<button class="btn btn-secondary" id="btn-edit-schedule">排程</button>';
    }
    actions.insertAdjacentHTML("afterbegin",
      schedHtml + '<button class="btn btn-danger" id="btn-edit-delete">刪除</button>'
    );
    var schedBtn = document.getElementById("btn-edit-schedule");
    if (schedBtn) {
      schedBtn.addEventListener("click", function() {
        closeAddTaskModal();
        openScheduleForExistingTask(task);
      });
    }
    document.getElementById("btn-edit-delete").addEventListener("click", function() {
      if (!confirm("確定要刪除這個任務嗎？")) return;
      fetch("/api/tasks/" + task.id, { method: "DELETE" }).then(function() {
        closeAddTaskModal();
        if (typeof loadTodoList === "function") loadTodoList();
        if (typeof renderInitialCalendar === "function") renderInitialCalendar();
      });
    });
  }
}

function closeAllModals() {
  document.getElementById("add-task-modal").classList.add("hidden");
  document.getElementById("schedule-modal").classList.add("hidden");
  document.getElementById("task-detail-panel").classList.add("hidden");
  document.getElementById("day-detail-overlay").classList.add("hidden");
}

// ── 初始載入 ──────────────────────────────

async function init() {
  switchView("calendar");
  setupNotionStatusPolling();
  setupGmailStatusLight();
  pollGmailAdded();

  // 點 Notion 狀態燈 → 跳設定頁
  var icon = document.getElementById("notion-status-icon");
  if (icon) {
    icon.style.cursor = "pointer";
    icon.addEventListener("click", function() { window.location.href = "/settings"; });
  }
}

function setupGmailStatusLight() {
  async function update() {
    try {
      var resp = await fetch('/api/gmail/status');
      var data = await resp.json();
      var icon = document.getElementById('gmail-status-icon');
      if (!icon) return;
      if (!data.is_authenticated) {
        icon.textContent = '⚪'; icon.title = 'Gmail 未授權';
      } else if (!data.sync_enabled) {
        icon.textContent = '🔵'; icon.title = 'Gmail 已授權，背景同步未啟用';
      } else {
        try {
          var lr = await fetch('/api/gmail/last-sync').then(function(r) { return r.json(); }).catch(function() { return null; });
          if (lr && lr.result && lr.result.startsWith('error')) {
            icon.textContent = '🔴'; icon.title = 'Gmail 同步錯誤：' + lr.result;
          } else {
            icon.textContent = '🟢'; icon.title = 'Gmail 同步正常，最後：' + (lr ? lr.at || '-' : '-');
          }
        } catch(e2) { icon.textContent = '🟡'; }
      }
    } catch(e) {}
  }
  update();
  setInterval(update, 30000);
}

function setupNotionStatusPolling() {
  async function update() {
    try {
      const resp = await fetch("/api/notion/status");
      const data = await resp.json();
      const icon = document.getElementById("notion-status-icon");
      if (!icon) return;
      if (!data.sync_enabled) {
        icon.textContent = "⚪";
        icon.title = "同步未啟用";
      } else if (data.last_sync_result === "ok") {
        icon.textContent = "🟢";
        icon.title = `最近同步: ${data.last_sync_result}`;
      } else if (data.last_sync_result && data.last_sync_result.startsWith("error")) {
        icon.textContent = "🔴";
        icon.title = data.last_sync_result;
      } else {
        icon.textContent = "🟡";
        icon.title = "同步中或未知狀態";
      }
    } catch (e) {
      const icon = document.getElementById("notion-status-icon");
      if (icon) { icon.textContent = "🔴"; icon.title = "後端無回應"; }
    }
  }
  update();
  setInterval(update, 30000);
}

// ── 日詳情 modal ──────────────────────────

document.getElementById("btn-day-detail-close").addEventListener("click", () => {
  document.getElementById("day-detail-overlay").classList.add("hidden");
});

document.getElementById("day-detail-overlay").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) {
    e.currentTarget.classList.add("hidden");
  }
});

document.getElementById("btn-add-on-this-day").addEventListener("click", () => {
  const detailDate = window._currentDetailDate;
  document.getElementById("day-detail-overlay").classList.add("hidden");
  openAddModal(detailDate);
});

// ── escapeHtml ────────────────────────────

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function getSourceBadge(source) {
  switch (source) {
    case "manual": return "🖐";
    case "notion": return "📓";
    case "gmail": return "📧";
    default: return "";
  }
}

// ── Gmail 新增任務通知 ─────────────────────

var _gmailLastSeenTaskId = 0;

async function pollGmailAdded() {
  try {
    var resp = await fetch('/api/tasks?source=gmail&status=decided&limit=50');
    var tasks = await resp.json();
    // 找 AI 自動加入的新任務
    var aiAdded = [];
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].id <= _gmailLastSeenTaskId) continue;
      aiAdded.push(tasks[i]);
    }
    if (aiAdded.length > 0) {
      _gmailLastSeenTaskId = Math.max.apply(null, aiAdded.map(function(t) { return t.id; }));
      showGmailAddedToast(aiAdded);
      var badge = document.getElementById('gmail-added-badge');
      if (badge) {
        var current = parseInt(badge.textContent) || 0;
        badge.textContent = current + aiAdded.length;
        badge.classList.remove('hidden');
        badge.title = '點擊查看 AI 自動加入的任務';
      }
    }
  } catch(e) {}

  // 初始: 記住最新 task id
  try {
    var resp2 = await fetch('/api/tasks?source=gmail&limit=5');
    var tasks2 = await resp2.json();
    if (tasks2.length > 0) _gmailLastSeenTaskId = Math.max(_gmailLastSeenTaskId, tasks2[0].id);
  } catch(e) {}

  // 點 badge 看詳情
  var addedBadge = document.getElementById('gmail-added-badge');
  if (addedBadge) {
    addedBadge.addEventListener('click', function() { showGmailAddedDetail(); });
  }
  document.getElementById('btn-close-gmail-panel').addEventListener('click', function() {
    document.getElementById('gmail-added-panel').classList.add('hidden');
  });

  setTimeout(pollGmailAdded, 60000);
}

async function showGmailAddedDetail() {
  var panel = document.getElementById('gmail-added-panel');
  var list = document.getElementById('gmail-added-list');
  panel.classList.remove('hidden');
  list.innerHTML = '<p style="color:var(--text-dim);text-align:center;padding:20px;">載入中...</p>';

  try {
    var resp = await fetch('/api/tasks?source=gmail&status=decided&limit=20');
    var tasks = await resp.json();
    if (tasks.length === 0) {
      list.innerHTML = '<p style="color:var(--text-dim);text-align:center;padding:20px;">尚無 AI 自動加入的任務</p>';
      return;
    }
    var html = '';
    tasks.forEach(function(t) {
      var dl = t.deadline ? t.deadline.slice(0, 16) : '未指定';
      var src = '';
      try { var rc = JSON.parse(t.raw_content || '{}'); src = (rc.from || '') + ' | ' + (rc.subject || ''); } catch(e) {}
      html += '<div style="padding:12px;margin-bottom:8px;background:rgba(255,255,255,0.03);border-radius:8px;border-left:3px solid #4ade80;">'
        + '<div style="font-weight:600;margin-bottom:4px;">' + escapeHtml(t.title) + '</div>'
        + '<div style="font-size:0.75rem;color:var(--text-2);margin-bottom:4px;">' + escapeHtml(t.ai_summary || '') + '</div>'
        + '<div style="font-size:0.72rem;color:var(--text-3);display:flex;gap:16px;flex-wrap:wrap;">'
        + '<span>時間: ' + dl + '</span>'
        + '<span>時長: ' + (t.estimated_minutes||'?') + 'm</span>'
        + '<span>急迫: ' + (t.urgency||'?') + '/5</span>'
        + '<span>類型: ' + (t.event_type==='event'?'事件':'DDL') + '</span>'
        + '</div>'
        + (src ? '<div style="font-size:0.68rem;color:var(--text-4);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(src) + '</div>' : '')
        + '</div>';
    });
    list.innerHTML = html;
  } catch(e) {
    list.innerHTML = '<p style="color:var(--text-dim);text-align:center;padding:20px;">載入失敗</p>';
  }
}

function showGmailAddedToast(tasks) {
  var old = document.querySelector('.gmail-added-toast');
  if (old) old.remove();
  var toast = document.createElement('div');
  toast.className = 'gmail-added-toast';
  toast.innerHTML = '<div class="toast-title">AI 從 Gmail 自動加入 ' + tasks.length + ' 個任務</div>'
    + tasks.slice(0, 5).map(function(t) { return '<div class="toast-item">' + escapeHtml(t.title) + '</div>'; }).join('')
    + (tasks.length > 5 ? '<div class="toast-item">還有 ' + (tasks.length - 5) + ' 個...</div>' : '');
  document.body.appendChild(toast);
  setTimeout(function() {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.5s';
    setTimeout(function() { if (toast.parentNode) toast.remove(); }, 500);
  }, 5000);
}

// 手動刷新
document.addEventListener("DOMContentLoaded", function() {
  var refreshBtn = document.getElementById("btn-refresh");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async function() {
      this.textContent = "⏳";
      try { await fetch("/api/gmail/pull", {method:"POST"}); } catch(e) {}
      if (typeof loadTodoList === "function") loadTodoList();
      if (typeof loadTinderTasks === "function") loadTinderTasks();
      if (typeof renderInitialCalendar === "function") renderInitialCalendar();
      this.textContent = "🔄";
    });
  }
});

// ── 導入行程 ────────────────────────────

let importExtractedEvents = [];
let importSelectedFile = null;

document.getElementById("btn-open-import-modal").addEventListener("click", function() {
  document.getElementById("import-modal").classList.remove("hidden");
  document.getElementById("import-step-upload").classList.remove("hidden");
  document.getElementById("import-step-loading").classList.add("hidden");
  document.getElementById("import-step-result").classList.add("hidden");
  importSelectedFile = null;
  document.getElementById("import-file-name").textContent = "";
  document.getElementById("btn-import-start").disabled = true;
});

document.getElementById("btn-close-import").addEventListener("click", function() {
  document.getElementById("import-modal").classList.add("hidden");
});
document.getElementById("btn-import-cancel").addEventListener("click", function() {
  document.getElementById("import-modal").classList.add("hidden");
});
document.getElementById("btn-import-back").addEventListener("click", function() {
  document.getElementById("import-step-result").classList.add("hidden");
  document.getElementById("import-step-upload").classList.remove("hidden");
});

// Dropzone
var dz = document.getElementById("import-dropzone");
var fi = document.getElementById("import-file-input");
dz.addEventListener("click", function() { fi.click(); });
dz.addEventListener("dragover", function(e) { e.preventDefault(); dz.style.borderColor = "#4c9aff"; });
dz.addEventListener("dragleave", function() { dz.style.borderColor = ""; });
dz.addEventListener("drop", function(e) {
  e.preventDefault();
  dz.style.borderColor = "";
  var f = e.dataTransfer.files[0];
  if (f) { importSelectedFile = f; document.getElementById("import-file-name").textContent = f.name; document.getElementById("btn-import-start").disabled = false; }
});
fi.addEventListener("change", function() {
  var f = fi.files[0];
  if (f) { importSelectedFile = f; document.getElementById("import-file-name").textContent = f.name; document.getElementById("btn-import-start").disabled = false; }
});

document.getElementById("btn-import-start").addEventListener("click", async function() {
  var text = document.getElementById("import-text-input").value.trim();
  if (!text && !importSelectedFile) return;
  document.getElementById("import-step-upload").classList.add("hidden");
  document.getElementById("import-step-loading").classList.remove("hidden");

  try {
    var resp;
    if (text) {
      // 文字輸入
      resp = await fetch("/api/import-itinerary-text", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({text: text}),
      });
    } else {
      // 檔案上傳
      var formData = new FormData();
      formData.append("file", importSelectedFile);
      resp = await fetch("/api/import-itinerary", { method: "POST", body: formData });
    }
    var data = await resp.json();
    if (data.error) { alert(data.error); document.getElementById("btn-import-back").click(); return; }

    importExtractedEvents = data.events || [];
    document.getElementById("import-result-label").textContent = "找到 " + importExtractedEvents.length + " 個事件";
    var listHtml = "";
    importExtractedEvents.forEach(function(ev, i) {
      listHtml += '<div class="import-event-card">'
        + '<span class="ie-date">' + (ev.date || "?") + '</span>'
        + '<span class="ie-time">' + (ev.time || "") + (ev.end_time ? "-" + ev.end_time : "") + '</span>'
        + '<span class="ie-title">' + escapeHtml(ev.title) + '</span>'
        + '</div>';
    });
    document.getElementById("import-event-list").innerHTML = listHtml;
    document.getElementById("import-step-loading").classList.add("hidden");
    document.getElementById("import-step-result").classList.remove("hidden");
  } catch(e) { alert("上傳失敗：" + e.message); }
});

// 文字輸入時啟用按鈕
document.getElementById("import-text-input").addEventListener("input", function() {
  document.getElementById("btn-import-start").disabled = !this.value.trim() && !importSelectedFile;
});

document.getElementById("btn-import-add-all").addEventListener("click", async function() {
  var added = 0;
  for (var i = 0; i < importExtractedEvents.length; i++) {
    var ev = importExtractedEvents[i];
    try {
      await fetch("/api/tasks", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          title: ev.title,
          event_type: "event",
          scheduled_date: ev.date,
          scheduled_time: ev.time || null,
          estimated_minutes: ev.estimated_minutes || 60,
          ai_summary: (ev.notes || "") + (ev.location ? " @" + ev.location : ""),
          status: "scheduled",
          decision: "do",
          source: "manual",
          raw_content: JSON.stringify(ev),
        }),
      });
      added++;
    } catch(e) {}
  }
  document.getElementById("import-modal").classList.add("hidden");
  if (typeof loadTodoList === "function") loadTodoList();
  if (typeof renderInitialCalendar === "function") renderInitialCalendar();
  alert("已加入 " + added + " / " + importExtractedEvents.length + " 個事件");
});

document.addEventListener("DOMContentLoaded", init);
