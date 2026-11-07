(function () {
  'use strict';

  // Load SQLite state before the planner's inline script initializes.
  var stateRequest = new XMLHttpRequest();
  try {
    stateRequest.open('GET', '/api/state', false);
    stateRequest.send(null);
    if (stateRequest.status === 200) {
      var response = JSON.parse(stateRequest.responseText);
      if (response.state) localStorage.setItem('loan-leverage-planner-v1', JSON.stringify(response.state));
    }
  } catch (error) { console.error('Could not load local planner data:', error); }

  var originalSetItem = Storage.prototype.setItem;
  var saveTimer;
  Storage.prototype.setItem = function (key, value) {
    originalSetItem.call(this, key, value);
    if (this !== localStorage || key !== 'loan-leverage-planner-v1') return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        var state = JSON.parse(localStorage.getItem('loan-leverage-planner-v1') || '{}');
        fetch('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) })
          .then(function (response) { if (!response.ok) throw new Error('HTTP ' + response.status); })
          .catch(function (error) { console.error('Could not save to SQLite:', error); });
        renderHistory();
        refreshAlerts();
      } catch (error) { console.error('Could not prepare planner data for SQLite:', error); }
    }, 350);
  };

  var style = document.createElement('style');
  style.textContent = [
    '.local-alerts{border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:12px 14px}',
    '.local-alerts summary{font-family:var(--font-label);font-weight:600;cursor:pointer}',
    '.local-alert-list{display:grid;gap:8px;margin-top:10px}',
    '.local-alert{padding:10px 12px;border-radius:6px;background:var(--warn-bg);color:var(--warn)}',
    '.local-alert.danger{background:var(--bad-bg);color:var(--bad)}',
    '.local-alert-title{font-weight:600}',
    '.local-alert p{margin:3px 0 0;font-size:13px}',
    '.local-alert button{margin-top:7px;border:0;background:transparent;color:inherit;text-decoration:underline;cursor:pointer;font:inherit;font-size:12px}',
    '.local-no-alerts{margin:8px 0 0;color:var(--muted);font-size:13px}',
    '.local-storage-note{margin-top:6px;font-size:12px;color:var(--muted)}',
    '.history-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}',
    '.history-toolbar input{flex:1;min-width:190px;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--field);color:var(--fg);font:inherit}',
    '.history-summary{color:var(--muted);font-size:13px;margin:0 0 8px}',
    '.history-table{min-width:760px}',
    '.history-table td:first-child{font-family:var(--font-num)}',
    '.history-return,.history-result{font-weight:600}',
    '.history-status{display:inline-block;padding:2px 7px;border-radius:99px;background:var(--field);font:600 11px var(--font-label);text-transform:uppercase}',
    '.history-status.profit{background:var(--good-bg);color:var(--good)}',
    '.history-status.watch{background:var(--warn-bg);color:var(--warn)}',
    '.history-status.exit{background:var(--bad-bg);color:var(--bad)}',
    '.history-empty{padding:14px;background:var(--field);border-radius:8px;color:var(--muted)}',
    '.history-delete{white-space:nowrap}',
    '@media(max-width:600px){.history-table{font-size:12px}.history-toolbar .btn{width:auto}}'
  ].join('');
  document.head.appendChild(style);

  var panel = document.createElement('details');
  panel.className = 'local-alerts';
  panel.open = true;
  panel.innerHTML = '<summary>Local notifications <span id="local-alert-count"></span></summary>' +
    '<div id="local-alert-list" class="local-alert-list"><p class="local-no-alerts">Checking reminders…</p></div>' +
    '<div class="local-storage-note">History and settings are stored in the local SQLite database on this computer.</div>';
  var nav = document.querySelector('nav');
  if (nav && nav.parentNode) nav.parentNode.insertBefore(panel, nav);

  function refreshAlerts() {
    fetch('/api/alerts', { cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    }).then(function (data) {
      var list = document.getElementById('local-alert-list');
      var count = document.getElementById('local-alert-count');
      var alerts = data.alerts || [];
      count.textContent = alerts.length ? '(' + alerts.length + ')' : '';
      list.textContent = '';
      if (!alerts.length) {
        var empty = document.createElement('p'); empty.className = 'local-no-alerts';
        empty.textContent = 'No due-date or threshold alerts right now.'; list.appendChild(empty); return;
      }
      alerts.forEach(function (alert) {
        var item = document.createElement('div');
        item.className = 'local-alert' + (alert.severity === 'danger' ? ' danger' : '');
        var title = document.createElement('div'); title.className = 'local-alert-title'; title.textContent = alert.title;
        var message = document.createElement('p'); message.textContent = alert.message;
        var dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.textContent = 'Dismiss';
        dismiss.addEventListener('click', function () {
          fetch('/api/alerts/dismiss', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: alert.alert_key }) }).then(refreshAlerts).catch(function () {});
        });
        item.appendChild(title); item.appendChild(message); item.appendChild(dismiss); list.appendChild(item);
      });
    }).catch(function () {
      var list = document.getElementById('local-alert-list');
      if (list) list.textContent = 'Notifications are unavailable. Check that the local server is running.';
    });
  }

  function money(value) {
    return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function escapeCsv(value) { return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"'; }
  function ensureHistoryView(container) {
    if (container.querySelector('.history-toolbar')) return;
    container.textContent = '';
    var toolbar = document.createElement('div'); toolbar.className = 'history-toolbar';
    var search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Search dates and values';
    search.setAttribute('aria-label', 'Search tracker history');
    var exportButton = document.createElement('button'); exportButton.type = 'button'; exportButton.className = 'btn ghost small'; exportButton.textContent = 'Export CSV';
    toolbar.appendChild(search); toolbar.appendChild(exportButton);
    var summary = document.createElement('p'); summary.className = 'history-summary'; summary.setAttribute('aria-live', 'polite');
    var scroller = document.createElement('div'); scroller.className = 'scroller';
    var table = document.createElement('table'); table.className = 'history-table';
    table.innerHTML = '<thead><tr><th>Date</th><th>Market value</th><th>Cost basis</th><th>Cash</th><th>Paid</th><th>Return</th><th>Est. result</th><th>Status</th><th>Action</th></tr></thead><tbody></tbody>';
    scroller.appendChild(table); container.appendChild(toolbar); container.appendChild(summary); container.appendChild(scroller);
    search.addEventListener('input', updateHistoryRows);
    exportButton.addEventListener('click', function () {
      var state = readState(); var rows = filteredEntries(state.entries || [], search.value);
      var lines = [['Date','Market value','Cost basis','Cash','Installments paid','Return percent','Estimated result','Status']];
      rows.forEach(function (entry) {
        var metrics = getMetrics(entry, state.params || {});
        lines.push([entry.date, entry.value, entry.basis, entry.cash, entry.paid || 0,
          metrics.returnPct == null ? '' : metrics.returnPct.toFixed(2), metrics.result.toFixed(2), metrics.status]);
      });
      var blob = new Blob(['\ufeff' + lines.map(function (row) { return row.map(escapeCsv).join(','); }).join('\r\n')], { type: 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob); var link = document.createElement('a');
      link.href = url; link.download = 'loan-planner-history.csv'; link.click(); URL.revokeObjectURL(url);
    });
  }
  function readState() {
    try { return JSON.parse(localStorage.getItem('loan-leverage-planner-v1') || '{}'); }
    catch (error) { return {}; }
  }
  function filteredEntries(entries, query) {
    var q = String(query || '').trim().toLowerCase();
    return entries.slice().sort(function (a, b) {
      return a.date === b.date ? Number(b.ts || 0) - Number(a.ts || 0) : String(b.date).localeCompare(String(a.date));
    }).filter(function (entry) {
      return !q || [entry.date, entry.value, entry.basis, entry.cash, entry.paid].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function getMetrics(entry, params) {
    var basis = Number(entry.basis) || 0, value = Number(entry.value) || 0;
    var priceReturn = basis > 0 ? (value / basis - 1) * 100 : null;
    var months = Math.max(1, Math.min(3, Number(params.months) || 1));
    var loan = Math.max(0, Number(params.loan) || 0);
    var owed = loan * (1 + Math.max(0, Number(params.rate) || 0) / 100);
    var installment = owed / months;
    var remaining = Math.max(0, owed - Math.max(0, Number(entry.paid) || 0) * installment);
    var sellFee = Math.max(0, Number(params.sellFee) || 0) / 100;
    var result = (Number(entry.cash) || 0) + value * (1 - sellFee) - remaining - (Number(params.own) || 0);
    var watch = Math.max(0, Number(params.watch) || 0);
    var stop = Math.max(0, Number(params.stop) || 0);
    var status = result >= 0 ? 'Profit' : (priceReturn != null && priceReturn <= -stop ? 'Exit' : (priceReturn != null && priceReturn <= -watch ? 'Watch' : 'Hold'));
    return { returnPct: priceReturn, result: result, status: status };
  }
  function updateHistoryRows() {
    var container = document.getElementById('t-list');
    if (!container) return;
    ensureHistoryView(container);
    var state = readState(), entries = state.entries || [];
    var search = container.querySelector('.history-toolbar input');
    var matches = filteredEntries(entries, search ? search.value : '');
    var tbody = container.querySelector('tbody'); tbody.textContent = '';
    container.querySelector('.history-summary').textContent = entries.length + ' saved record' + (entries.length === 1 ? '' : 's') +
      (matches.length !== entries.length ? ' · ' + matches.length + ' match your search' : '') +
      ' · daily tracker snapshots, newest first';
    if (!matches.length) {
      var row = document.createElement('tr'); var cell = document.createElement('td'); cell.colSpan = 9;
      cell.innerHTML = '<div class="history-empty">' + (entries.length ? 'No history records match this search.' : 'No records yet. Add a dated entry in the Log today section above.') + '</div>';
      row.appendChild(cell); tbody.appendChild(row); return;
    }
    matches.forEach(function (entry) {
      var metrics = getMetrics(entry, state.params || {});
      var row = document.createElement('tr');
      [entry.date || '', money(entry.value), money(entry.basis), money(entry.cash), String(entry.paid || 0),
        metrics.returnPct == null ? '—' : (metrics.returnPct > 0 ? '+' : '') + metrics.returnPct.toFixed(1) + '%',
        money(metrics.result), metrics.status].forEach(function (value, index) {
        var cell = document.createElement('td');
        if (index === 5 || index === 6) cell.className = (index === 5 ? 'history-return ' : 'history-result ') + (Number(value) < 0 ? 'neg' : (Number(value) > 0 ? 'pos' : ''));
        if (index === 7) { var badge = document.createElement('span'); badge.className = 'history-status ' + metrics.status.toLowerCase(); badge.textContent = metrics.status; cell.appendChild(badge); }
        else cell.textContent = value;
        row.appendChild(cell);
      });
      var action = document.createElement('td'); var remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'btn ghost small history-delete'; remove.setAttribute('data-del', String(entry.id));
      remove.textContent = 'Remove'; action.appendChild(remove); row.appendChild(action); tbody.appendChild(row);
    });
  }
  var historyObserver;
  var historyScheduled = false;
  function renderHistory() {
    if (historyScheduled) return;
    historyScheduled = true;
    setTimeout(function () {
      historyScheduled = false;
      var container = document.getElementById('t-list');
      if (!container) return;
      if (historyObserver) historyObserver.disconnect();
      updateHistoryRows();
      historyObserver.observe(container, { childList: true, subtree: true });
    }, 0);
  }

  window.addEventListener('load', function () {
    var container = document.getElementById('t-list');
    if (container) {
      historyObserver = new MutationObserver(renderHistory);
      renderHistory();
    }
    try {
      var state = readState();
      if (state.params) fetch('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
    } catch (error) { /* Continue with planner defaults. */ }
    refreshAlerts();
    setInterval(refreshAlerts, 30000);
  });
})();
