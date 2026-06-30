// ═══════════════════════════════════════════════
// Tindo todolist.js — 代辦視圖
// ═══════════════════════════════════════════════

async function loadTodoList() {
  try {
    const tasks = await fetch("/api/tasks").then(r => r.json());
    renderTodoList(tasks);
  } catch (e) {
    document.getElementById("todolist-container").innerHTML =
      `<p style="color:var(--text-dim);text-align:center;padding:40px;">載入失敗：${e.message}</p>`;
  }
}

function renderTodoList(tasks) {
  // 過濾掉 archived 和 done
  const active = tasks.filter(t => t.status !== "archived" && t.status !== "done");

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = fmtDate(today);

  // 計算本週一
  const dayOfWeek = (today.getDay() + 6) % 7;
  const weekStart = addDays(today, -dayOfWeek);
  const weekEnd = addDays(weekStart, 6);

  const groups = {
    "待排程": [],
    "今天": [],
    "本週": [],
    "之後": [],
    "未排程": [],
  };

  active.forEach(t => {
    const sd = t.scheduled_date;
    if (!sd) {
      // 已決定但未排程 → 待排程；其他 → 未排程
      if (t.status === "decided") {
        groups["待排程"].push(t);
      } else {
        groups["未排程"].push(t);
      }
    } else if (sd === todayStr) {
      groups["今天"].push(t);
    } else if (sd >= fmtDate(weekStart) && sd <= fmtDate(weekEnd)) {
      groups["本週"].push(t);
    } else {
      groups["之後"].push(t);
    }
  });

  let html = "";
  for (const [label, items] of Object.entries(groups)) {
    if (!items.length) continue;
    html += `<div class="todolist-group">`;
    html += `<div class="todolist-group-title">${label} · ${items.length}</div>`;
    items.forEach(t => {
      html += renderTaskCard(t);
    });
    html += `</div>`;
  }

  // 已歸檔任務（摺疊顯示）
  var archived = tasks.filter(t => t.status === 'archived');
  if (archived.length > 0) {
    html += '<div class="todolist-group archived-group">';
    html += '<div class="todolist-group-title" onclick="var g=this.nextElementSibling;g.classList.toggle(\'hidden\')" style="cursor:pointer;">已歸檔 · ' + archived.length + ' ▼</div>';
    html += '<div class="hidden">';
    archived.forEach(t => { html += renderTaskCard(t); });
    html += '</div></div>';
  }

  document.getElementById("todolist-container").innerHTML = html || `<p style="color:var(--text-dim);text-align:center;padding:40px;">還沒有任務，點「+ 新增任務」開始吧</p>`;
}

function renderTaskCard(t) {
  const urgency = t.urgency || 3;
  const workload = t.workload || 2;
  const emoji = { ddl: "⏰", event: "📍" };
  const typeIcon = emoji[t.event_type] || "📌";
  const sourceBadge = getSourceBadge(t.source);
  // 逾期檢查
  var isOverdue = false;
  if (t.deadline && t.status !== "done") {
    var dl = new Date(t.deadline); dl.setHours(0,0,0,0);
    var td = new Date(); td.setHours(0,0,0,0);
    if (dl < td) isOverdue = true;
  }
  const conflictClass = (t.sync_status === "sync_conflict" ? " sync-conflict" : "") + (isOverdue ? " overdue" : "");
  const conflictIcon = t.sync_status === "sync_conflict"
    ? `<span class="conflict-icon" title="同步衝突：Notion 上有另一個版本，已建立副本">⚠️</span>` : "";

  // 副標資訊：日期/時間 + 時長 + 逾期標記
  let meta = "";
  const fmtShort = function(d) { if (!d) return ""; const p = d.split("-"); return parseInt(p[1]) + "/" + parseInt(p[2]); };
  // 逾期檢查
  var overdueHtml = "";
  if (t.deadline && t.status !== "done") {
    var dl = new Date(t.deadline);
    var today = new Date(); today.setHours(0,0,0,0);
    dl.setHours(0,0,0,0);
    var overdueDays = Math.floor((today - dl) / 86400000);
    if (overdueDays > 0) {
      overdueHtml = ' <span class="overdue-badge">逾期' + overdueDays + '天</span>';
    }
  }
  if (t.scheduled_date) {
    meta = fmtShort(t.scheduled_date);
    if (t.scheduled_time) meta += " " + t.scheduled_time.slice(0, 5);
    if (t.estimated_minutes) meta += " · " + t.estimated_minutes + "m";
  } else if (t.deadline) {
    meta = "截止 " + fmtShort(t.deadline);
    if (t.estimated_minutes) meta += " · " + t.estimated_minutes + "m";
  } else if (t.estimated_minutes) {
    meta = t.estimated_minutes + "m";
  }
  meta += overdueHtml;

  const timeLabel = t.estimated_minutes ? `${t.estimated_minutes}m` : "";

  return `
    <div class="task-card urgency-${urgency} workload-${workload}${conflictClass}"
         onclick="showTaskDetail(${t.id})">
      ${conflictIcon}
      <span class="task-source-badge">${sourceBadge}</span>
      <div class="task-body">
        <div class="task-title">${escapeHtml(t.title)}</div>
        <div class="task-meta">${meta}</div>
      </div>
      ${timeLabel ? `<span class="task-time-label">${timeLabel}</span>` : ""}
      <div class="task-workload-bar"></div>
    </div>
  `;
}

// ── helpers ────────────────────────────────

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
