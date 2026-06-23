// ═══════════════════════════════════════════════
// Tindo tinder.js — 抉擇視圖（Phase 3）
// 三池：邀請 / 任務 / 之後再說
// ═══════════════════════════════════════════════

let currentPool = 'all';
let unsureTasks = [];
let currentTinderIndex = 0;
let swipeHistory = [];
let showHistory = true;

async function loadHistoryFromServer() {
  try {
    var allResp = await fetch('/api/tasks');
    var allTasks = await allResp.json();
    swipeHistory = [];
    // 找回所有被 tinder 决定过的
    allTasks.forEach(function(t) {
      if (t.status === 'archived' || t.decision === 'skip' || t.decision === 'archive') {
        swipeHistory.push({
          taskId: t.id,
          title: t.title,
          decision: t.decision || 'archive',
          time: (t.updated_at || '').slice(11, 19),
        });
      }
    });
    swipeHistory.sort(function(a, b) { return b.taskId - a.taskId; });
    swipeHistory = swipeHistory.slice(0, 15);
  } catch(e) { swipeHistory = []; }
}

async function loadTinderTasks() {
  try {
    const resp = await fetch('/api/tasks/unsure');
    unsureTasks = await resp.json();
  } catch(e) { unsureTasks = []; }
  await loadHistoryFromServer();
  currentTinderIndex = 0;
  renderTinder();
}

// ── 池切換 ──────────────────────────────

document.querySelectorAll('.tinder-pool-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.tinder-pool-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    currentPool = btn.dataset.pool;
    currentTinderIndex = 0;
    renderTinder();
  });
});

function filterByPool(tasks) {
  if (currentPool === 'invite') {
    // 邀請：event 類型 + unsure + 不是被 skip 的
    return tasks.filter(function(t) { return t.event_type === 'event' && t.decision !== 'skip'; });
  }
  if (currentPool === 'task') {
    // 任務判定：ddl 類型 + unsure + 不是被 skip 的
    return tasks.filter(function(t) { return t.event_type === 'ddl' && t.decision !== 'skip'; });
  }
  if (currentPool === 'skipped') {
    // 之後再說
    return tasks.filter(function(t) { return t.decision === 'skip'; });
  }
  return tasks;
}

// ── 渲染 ────────────────────────────────

function renderTinder() {
  var stack = document.getElementById('tinder-stack');
  var empty = document.getElementById('tinder-empty');
  var count = document.getElementById('tinder-count');
  var title = document.getElementById('tinder-pool-title');

  var filtered = filterByPool(unsureTasks);
  var remaining = filtered.slice(currentTinderIndex);
  count.textContent = remaining.length + ' 個待處理';

  var poolLabels = { all: '需要你決定的事', invite: '📩 邀請 — 去不去？', task: '📋 任務 — 要不要處理？', skipped: '⏳ 之前跳過的 — 再想想' };
  title.textContent = poolLabels[currentPool] || '需要你決定的事';

  if (remaining.length === 0) {
    stack.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  stack.innerHTML = remaining.slice(0, 3).map(function(task, i) {
    var sourceLabel = task.source === 'gmail' ? '📧 Gmail'
                   : task.source === 'notion' ? '📓 Notion' : '🖐 手動';
    var typeLabel = task.event_type === 'event' ? '出席' : '截止';

    // 解析寄件人：姓名 + 機構
    var senderName = '', senderOrg = '', emailSubject = '';
    if (task.raw_content) {
      try {
        var rc = JSON.parse(task.raw_content);
        var rawFrom = rc.from || '';
        emailSubject = rc.subject || '';
        // 解析 "姓名 <email>" 或 "機構 <email>"
        var nameMatch = rawFrom.match(/^"?([^"<]+)"?\s*</);
        var emailMatch = rawFrom.match(/<([^>]+)>/);
        var emailAddr = '';
        if (nameMatch) {
          senderOrg = nameMatch[1].trim();
          // 太長且含 <> 的話取前面
          if (senderOrg.length > 50) senderOrg = senderOrg.split(',')[0].trim();
        }
        if (emailMatch) {
          emailAddr = emailMatch[1];
        }
        if (!senderOrg && emailAddr) {
          senderOrg = emailAddr.split('@')[0];
        }
        senderName = emailAddr;
        if (!senderOrg) senderOrg = rawFrom;
      } catch(e) {}
    }

    // 顯示日期
    var dateStr = task.deadline ? task.deadline.slice(0, 10) : '';
    var timeStr = task.deadline ? task.deadline.slice(11, 16) : '';

    return '<div class="tinder-card urgency-' + (task.urgency || 3) + '"'
         + ' data-task-id="' + task.id + '"'
         + ' data-date="' + dateStr + '"'
         + ' style="z-index: ' + (10 - i) + '; transform: translateY(' + (i * 8) + 'px) scale(' + (1 - i * 0.04) + ')"'
         + '>'
         + '<div class="tinder-card-scroll">'
         + (senderOrg ? '<div class="tinder-card-from"><span class="from-org">' + escapeHtml(senderOrg) + '</span>' + (senderName ? '<span class="from-email">' + escapeHtml(senderName) + '</span>' : '') + '</div>' : '')
         + (emailSubject ? '<div class="tinder-card-subject">' + escapeHtml(emailSubject) + '</div>' : '')
         + '<div class="tinder-card-title">' + escapeHtml(task.title) + '</div>'
         + '<div class="tinder-card-summary">' + escapeHtml(task.ai_summary || '無摘要') + '</div>'
         + (dateStr ? '<div class="tinder-card-when"><span class="when-label">時間</span><span class="when-value">' + dateStr + (timeStr ? ' ' + timeStr : '') + '</span><span class="when-type">' + typeLabel + '</span></div>' : '')
         + '<div class="tinder-card-day-schedule" id="day-schedule-' + task.id + '">載入當天行程...</div>'
         + '<div class="tinder-card-analysis" id="conflict-analysis-' + task.id + '">AI 分析中...</div>'
         + '<div class="tinder-card-meta">'
         + '<span class="tinder-card-meta-item">急: ' + (task.urgency || 3) + '/5</span>'
         + (task.estimated_minutes ? '<span class="tinder-card-meta-item">' + task.estimated_minutes + 'm</span>' : '')
         + '</div></div></div>';
  }).join('');

  // 載入當天行程和 AI 分析
  var topCard = stack.querySelector('.tinder-card');
  if (topCard) {
    var taskId = topCard.dataset.taskId;
    loadDayAnalysis(taskId, topCard.dataset.date);
  }

  var topTask = remaining[0];
  var doBtn = document.querySelector('.tinder-btn-do');
  var skipBtn = document.querySelector('.tinder-btn-skip');
  if (doBtn && topTask) {
    if (topTask.event_type === 'event') {
      doBtn.textContent = '✓ 出席';
      skipBtn.textContent = '✗ 暫緩';
    } else {
      doBtn.textContent = '要處理 →';
      skipBtn.textContent = '← 暫緩';
    }
  }
  setupSwipe(topCard);
  if (typeof renderHistory === 'function') renderHistory();
}

// ── 歷史面板 ──────────────────────────────

document.addEventListener('DOMContentLoaded', function() {
  var histBtn = document.getElementById('btn-toggle-history');
  if (histBtn) {
    histBtn.addEventListener('click', function() {
      showHistory = !showHistory;
      var panel = document.getElementById('tinder-history');
      if (panel) panel.classList.toggle('hidden', !showHistory);
      histBtn.textContent = showHistory ? '返回' : '歷史';
      renderHistory();
    });
  }
});

function renderHistory() {
  var el = document.getElementById('tinder-history');
  if (!el || !showHistory) return;
  if (swipeHistory.length === 0) {
    el.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-3);font-size:0.8rem;">尚無歷史</div>';
    return;
  }
  var labels = { do: '處理', archive: '不處理', skip: '再說' };
  el.innerHTML = swipeHistory.map(function(h) {
    return '<div class="tinder-history-item">'
      + '<span>' + escapeHtml(h.title) + '<span class="hi-decision ' + h.decision + '">' + (labels[h.decision] || h.decision) + '</span></span>'
      + '<button class="hi-restore" data-id="' + h.taskId + '">恢復</button>'
      + '<button class="hi-never" data-id="' + h.taskId + '">🚫 以後不處理</button>'
      + '</div>';
  }).join('');

  el.querySelectorAll('.hi-never').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var tid = this.dataset.id;
      var item = swipeHistory.find(function(h) { return h.taskId == tid; });
      var title = item ? item.title : '';
      await fetch('/api/gmail/reject-pattern', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({sender: '', subject: title}),
      });
      swipeHistory = swipeHistory.filter(function(h) { return h.taskId != tid; });
      loadTinderTasks();
      renderHistory();
    });
  });

  el.querySelectorAll('.hi-restore').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var tid = this.dataset.id;
      // 重設為 unsure
      await fetch('/api/tasks/' + tid, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({status: 'unsure', decision: null}),
      });
      swipeHistory = swipeHistory.filter(function(h) { return h.taskId != tid; });
      loadTinderTasks();
      renderHistory();
    });
  });
}

// ── 拖拽 ────────────────────────────────

function setupSwipe(card) {
  if (!card) return;
  var startX = 0, startY = 0, dx = 0, dy = 0, dragging = false;

  function onStart(e) {
    dragging = true;
    card.classList.add('dragging');
    var t = e.touches ? e.touches[0] : e;
    startX = t.clientX; startY = t.clientY;
  }
  function onMove(e) {
    if (!dragging) return;
    var t = e.touches ? e.touches[0] : e;
    dx = t.clientX - startX;
    dy = t.clientY - startY;
    card.style.transform = 'translate(' + dx + 'px, ' + dy + 'px) rotate(' + (dx / 20) + 'deg)';
  }
  function onEnd() {
    if (!dragging) return;
    dragging = false;
    card.classList.remove('dragging');
    var threshold = 80;
    if (dx > threshold)       doTinderDecision(card, 'do', 'swipe-right');
    else if (dx < -threshold) doTinderDecision(card, 'archive', 'swipe-left');
    else if (dy < -threshold) doTinderDecision(card, 'skip', 'swipe-up');
    else card.style.transform = '';
    dx = 0; dy = 0;
  }

  card.addEventListener('mousedown', onStart);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onEnd);
  card.addEventListener('touchstart', onStart, {passive: true});
  card.addEventListener('touchmove', onMove, {passive: true});
  card.addEventListener('touchend', onEnd);
}

// ── 抉擇 ────────────────────────────────

async function doTinderDecision(card, decision, animClass) {
  var taskId = card.dataset.taskId;
  var task = unsureTasks.find(function(t) { return t.id == taskId; });
  card.classList.add(animClass);

  await fetch('/api/tasks/' + taskId + '/tinder-decide', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({decision: decision}),
  });

  swipeHistory.unshift({
    taskId: taskId,
    title: task ? task.title : '',
    decision: decision,
    time: new Date().toLocaleTimeString(),
  });
  if (swipeHistory.length > 15) swipeHistory.pop();

  setTimeout(function() {
    currentTinderIndex++;
    renderTinder();
    updateTinderBadge();

    if (decision === 'do') {
      if (typeof loadTodoList === 'function') loadTodoList();
      if (typeof renderInitialCalendar === 'function') renderInitialCalendar();

      if (task && task.event_type === 'ddl') {
        // DDL：自動開排程 modal 選哪天做
        if (typeof openScheduleModal === 'function') {
          setTimeout(function() {
            openScheduleModal({
              context: 'edit',
              taskId: task.id,
              taskTitle: task.title,
              deadline: task.deadline,
              estimatedMinutes: task.estimated_minutes || 60,
            });
          }, 400);
        }
      } else if (task && task.event_type === 'event') {
        // Event：顯示已加入月曆的提示
        var toast = document.createElement('div');
        toast.className = 'gmail-added-toast';
        var dl = task.deadline ? task.deadline.slice(0, 10) : '';
        toast.innerHTML = '<div class="toast-title" style="color:#4c9aff;">已加入月曆</div>'
          + '<div class="toast-item">' + escapeHtml(task.title) + '</div>'
          + (dl ? '<div class="toast-item">' + dl + '</div>' : '');
        document.body.appendChild(toast);
        setTimeout(function() {
          toast.style.opacity = '0';
          toast.style.transition = 'opacity 0.5s';
          setTimeout(function() { if (toast.parentNode) toast.remove(); }, 500);
        }, 2000);
      }
    }

    // 不處理（archive）的 Gmail 任務 → server 端刪除郵件
    if (decision === 'archive' && task && task.source === 'gmail' && task.source_id) {
      fetch('/api/gmail/trash-by-source/' + encodeURIComponent(task.source_id), { method: 'POST' });
    }
  }, 300);
}

// ── 按鈕 ────────────────────────────────

document.querySelectorAll('.tinder-actions button').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var card = document.querySelector('.tinder-card');
    if (!card) return;
    var action = btn.dataset.action;
    var anim = action === 'do' ? 'swipe-right'
             : action === 'archive' ? 'swipe-left' : 'swipe-up';
    doTinderDecision(card, action, anim);
  });
});

// ── 當天行程 + AI 衝突分析 ────────────────

async function loadDayAnalysis(taskId, date) {
  var scheduleEl = document.getElementById('day-schedule-' + taskId);
  var analysisEl = document.getElementById('conflict-analysis-' + taskId);
  if (!date) {
    if (scheduleEl) scheduleEl.innerHTML = '<div class="schedule-empty">日期未提取，無法分析</div>';
    if (analysisEl) analysisEl.textContent = '';
    return;
  }
  try {
    var resp = await fetch('/api/tasks/by-date-range?start=' + date + '&end=' + date);
    var data = await resp.json();
    var dayTasks = (data.days && data.days[0]) ? data.days[0].tasks || [] : [];
    var totalMin = (data.days && data.days[0]) ? data.days[0].total_minutes || 0 : 0;

    if (dayTasks.length > 0) {
      scheduleEl.innerHTML = '<div class="schedule-mini-title">當天已有行程 (' + totalMin + 'm)</div>'
        + dayTasks.slice(0, 4).map(function(t) {
          return '<div class="schedule-mini-item event-' + (t.event_type || 'ddl') + '">'
            + '<span class="sm-time">' + (t.scheduled_time || '--:--').slice(0,5) + '</span>'
            + '<span class="sm-title">' + escapeHtml(t.title) + '</span>'
            + '<span class="sm-dur">' + (t.estimated_minutes || 0) + 'm</span>'
            + '</div>';
        }).join('') + (dayTasks.length > 4 ? '<div class="schedule-mini-more">+' + (dayTasks.length - 4) + ' 個</div>' : '');
    } else {
      scheduleEl.innerHTML = '<div class="schedule-empty">當天無其他行程</div>';
    }

    // AI 衝突分析
    var task = unsureTasks.find(function(t) { return t.id == taskId; });
    if (!task) return;
    var aiResp = await fetch('/api/analyze-conflict', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        date: date,
        task_title: task.title,
        task_minutes: task.estimated_minutes || 60,
        existing_tasks: dayTasks.map(function(t) { return {title: t.title, scheduled_time: t.scheduled_time, estimated_minutes: t.estimated_minutes}; }),
      }),
    });
    var ai = await aiResp.json();
    if (ai.error) { analysisEl.textContent = ''; return; }
    var cls = ai.fatigue_level === '高' ? 'analysis-warn' : ai.fatigue_level === '中' ? 'analysis-caution' : 'analysis-ok';
    analysisEl.innerHTML = '<div class="' + cls + '">'
      + (ai.conflict ? '⚠️ 有時間衝突 ' : '') + '疲勞度: ' + ai.fatigue_level + ' · ' + (ai.advice || '')
      + '</div>';
  } catch(e) {
    if (scheduleEl) scheduleEl.textContent = '';
    if (analysisEl) analysisEl.textContent = '';
  }
}

// ── 紅點 ────────────────────────────────

async function updateTinderBadge() {
  try {
    var resp = await fetch('/api/tasks/unsure');
    var tasks = await resp.json();
    var badge = document.getElementById('tinder-badge');
    if (tasks.length > 0) {
      badge.textContent = tasks.length;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch(e) {}
}
setInterval(updateTinderBadge, 30000);
updateTinderBadge();
