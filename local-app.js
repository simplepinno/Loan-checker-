(function () {
  'use strict';

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
        var state = readState();
        fetch('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) })
          .then(function (response) { if (!response.ok) throw new Error('HTTP ' + response.status); renderHistory(); refreshAlerts(); })
          .catch(function (error) { console.error('Could not save to SQLite:', error); });
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
    '.history-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin-bottom:10px}',
    '.history-filter{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--muted)}',
    '.history-filter input,.history-search{padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--field);color:var(--fg);font:inherit}',
    '.history-search{flex:1;min-width:170px}',
    '.history-summary{color:var(--muted);font-size:13px;margin:0 0 8px}',
    '.history-table{min-width:760px}',
    '.history-table td:first-child{font-family:var(--font-num)}',
    '.history-status{display:inline-block;padding:2px 7px;border-radius:99px;background:var(--field);font:600 11px var(--font-label);text-transform:uppercase}',
    '.history-status.profit{background:var(--good-bg);color:var(--good)}',
    '.history-status.watch{background:var(--warn-bg);color:var(--warn)}',
    '.history-status.exit{background:var(--bad-bg);color:var(--bad)}',
    '.history-empty{padding:14px;background:var(--field);border-radius:8px;color:var(--muted)}',
    '.history-delete{white-space:nowrap}',
    '.backup-status{flex-basis:100%;margin:0;color:var(--muted);font-size:13px}',
    '@media(max-width:600px){.history-table{font-size:12px}}'
  ].join('');
  document.head.appendChild(style);

  var panel = document.createElement('details');
  panel.className = 'local-alerts'; panel.open = true;
  panel.innerHTML = '<summary>Local notifications <span id="local-alert-count"></span></summary>' +
    '<div id="local-alert-list" class="local-alert-list"><p class="local-no-alerts">Checking reminders…</p></div>' +
    '<div class="local-storage-note">History and settings are stored in the local SQLite database on this computer.</div>';
  var nav = document.querySelector('nav');
  if (nav && nav.parentNode) nav.parentNode.insertBefore(panel, nav);

  // Add a dedicated tab without changing the existing planner's tab implementation.
  var historyButton = document.createElement('button');
  historyButton.type = 'button'; historyButton.dataset.tab = 'trade-history'; historyButton.textContent = 'Trade history';
  nav.appendChild(historyButton);
  var historySection = document.createElement('section');
  historySection.id = 'local-trade-history'; historySection.className = 'wrap'; historySection.hidden = true;
  historySection.innerHTML = '<div class="group"><h2>Trade history</h2><p class="hint">Dated tracker snapshots saved on this computer. These are records you enter, not broker-verified executions.</p><div id="trade-history-view"></div></div>';
  var wrap = document.querySelector('.wrap');
  wrap.appendChild(historySection);
  nav.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-tab]');
    if (!button) return;
    if (button === historyButton) {
      event.preventDefault(); event.stopImmediatePropagation();
      document.querySelectorAll('nav button').forEach(function (b) { b.removeAttribute('aria-current'); });
      historyButton.setAttribute('aria-current', 'page');
      ['plan', 'price-test', 'tracker', 'compare'].forEach(function (name) {
        var section = document.getElementById('tab-' + name);
        if (section) section.hidden = true;
      });
      historySection.hidden = false; renderHistory(); window.scrollTo(0, 0);
    } else {
      historySection.hidden = true;
      historyButton.removeAttribute('aria-current');
    }
  }, true);

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
        var item = document.createElement('div'); item.className = 'local-alert' + (alert.severity === 'danger' ? ' danger' : '');
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

  function readState() {
    try { return JSON.parse(localStorage.getItem('loan-leverage-planner-v1') || '{}'); }
    catch (error) { return {}; }
  }
  function money(value) {
    return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function escapeCsv(value) { return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"'; }
  function getMetrics(entry, params) {
    var basis = Number(entry.basis) || 0, value = Number(entry.value) || 0;
    var returnPct = basis > 0 ? (value / basis - 1) * 100 : null;
    var months = Math.max(1, Math.min(3, Number(params.months) || 1));
    var loan = Math.max(0, Number(params.loan) || 0);
    var owed = loan * (1 + Math.max(0, Number(params.rate) || 0) / 100);
    var remaining = Math.max(0, owed - Math.max(0, Number(entry.paid) || 0) * owed / months);
    var sellFee = Math.max(0, Number(params.sellFee) || 0) / 100;
    var result = (Number(entry.cash) || 0) + value * (1 - sellFee) - remaining - (Number(params.own) || 0);
    var watch = Math.max(0, Number(params.watch) || 0), stop = Math.max(0, Number(params.stop) || 0);
    var status = result >= 0 ? 'Profit' : (returnPct != null && returnPct <= -stop ? 'Exit' : (returnPct != null && returnPct <= -watch ? 'Watch' : 'Hold'));
    return { returnPct: returnPct, result: result, status: status };
  }
  function filteredEntries(entries, filters) {
    var query = (filters.search || '').trim().toLowerCase();
    return entries.slice().sort(function (a, b) {
      return a.date === b.date ? Number(b.ts || 0) - Number(a.ts || 0) : String(b.date).localeCompare(String(a.date));
    }).filter(function (entry) {
      if (filters.from && String(entry.date) < filters.from) return false;
      if (filters.to && String(entry.date) > filters.to) return false;
      return !query || [entry.date, entry.value, entry.basis, entry.cash, entry.paid].join(' ').toLowerCase().indexOf(query) >= 0;
    });
  }
  function setupHistory(container) {
    if (container.dataset.ready) return;
    container.dataset.ready = 'true';
    var toolbar = document.createElement('div'); toolbar.className = 'history-toolbar';
    var search = document.createElement('input'); search.type = 'search'; search.className = 'history-search';
    search.placeholder = 'Search dates and values'; search.setAttribute('aria-label', 'Search trade history');
    function dateFilter(labelText, name) {
      var label = document.createElement('label'); label.className = 'history-filter'; label.textContent = labelText;
      var input = document.createElement('input'); input.type = 'date'; input.dataset.filter = name;
      label.appendChild(input); return label;
    }
    var from = dateFilter('From date', 'from'), to = dateFilter('To date', 'to');
    var exportCsv = document.createElement('button'); exportCsv.type = 'button'; exportCsv.className = 'btn ghost small'; exportCsv.textContent = 'Export CSV';
    var exportDb = document.createElement('button'); exportDb.type = 'button'; exportDb.className = 'btn ghost small'; exportDb.textContent = 'Export database';
    var importDb = document.createElement('button'); importDb.type = 'button'; importDb.className = 'btn ghost small'; importDb.textContent = 'Import database';
    var file = document.createElement('input'); file.type = 'file'; file.accept = '.sqlite,.sqlite3,application/vnd.sqlite3'; file.hidden = true;
    var status = document.createElement('p'); status.className = 'backup-status'; status.setAttribute('aria-live', 'polite');
    toolbar.appendChild(search); toolbar.appendChild(from); toolbar.appendChild(to);
    toolbar.appendChild(exportCsv); toolbar.appendChild(exportDb); toolbar.appendChild(importDb); toolbar.appendChild(file);
    var summary = document.createElement('p'); summary.className = 'history-summary'; summary.setAttribute('aria-live', 'polite');
    var scroller = document.createElement('div'); scroller.className = 'scroller';
    var table = document.createElement('table'); table.className = 'history-table';
    table.innerHTML = '<thead><tr><th>Date</th><th>Market value</th><th>Cost basis</th><th>Cash</th><th>Paid</th><th>Price return</th><th>Est. result</th><th>Status</th><th>Action</th></tr></thead><tbody></tbody>';
    scroller.appendChild(table); container.appendChild(toolbar); container.appendChild(status); container.appendChild(summary); container.appendChild(scroller);
    [search, from.querySelector('input'), to.querySelector('input')].forEach(function (input) { input.addEventListener('input', renderHistory); });
    exportCsv.addEventListener('click', function () {
      var state = readState(); var rows = filteredEntries(state.entries || [], getFilters(container));
      var lines = [['Date','Market value','Cost basis','Cash','Installments paid','Price return percent','Estimated result','Status']];
      rows.forEach(function (entry) { var m = getMetrics(entry, state.params || {}); lines.push([entry.date,entry.value,entry.basis,entry.cash,entry.paid||0,m.returnPct == null ? '' : m.returnPct.toFixed(2),m.result.toFixed(2),m.status]); });
      var blob = new Blob(['\ufeff' + lines.map(function (row) { return row.map(escapeCsv).join(','); }).join('\r\n')], { type: 'text/csv;charset=utf-8' });
      downloadBlob(blob, 'loan-planner-history.csv');
    });
    exportDb.addEventListener('click', function () {
      status.textContent = 'Preparing complete SQLite backup…';
      fetch('/api/backup', { cache: 'no-store' }).then(function (response) {
        if (!response.ok) throw new Error('Could not export database.'); return response.blob();
      }).then(function (blob) { downloadBlob(blob, 'loan_planner_backup.sqlite3'); status.textContent = 'Database backup downloaded.'; })
        .catch(function (error) { status.textContent = error.message; });
    });
    importDb.addEventListener('click', function () {
      if (window.confirm('Importing replaces the current local database and all its data. Continue only if you have a backup.')) file.click();
    });
    file.addEventListener('change', function () {
      if (!file.files || !file.files[0]) return;
      var selected = file.files[0]; status.textContent = 'Validating and importing database…';
      fetch('/api/backup', { method: 'POST', headers: { 'Content-Type': 'application/vnd.sqlite3' }, body: selected })
        .then(function (response) { return response.json().then(function (data) { if (!response.ok) throw new Error(data.error || 'Import failed.'); return data; }); })
        .then(function () { status.textContent = 'Database imported. Reloading planner…'; setTimeout(function () { window.location.reload(); }, 500); })
        .catch(function (error) { status.textContent = error.message; })
        .finally(function () { file.value = ''; });
    });
  }
  function getFilters(container) {
    return { search: container.querySelector('.history-search').value,
      from: container.querySelector('[data-filter="from"]').value,
      to: container.querySelector('[data-filter="to"]').value };
  }
  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = filename; link.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function renderHistory() {
    var container = document.getElementById('trade-history-view'); if (!container) return;
    setupHistory(container);
    var state = readState(), entries = state.entries || [], matches = filteredEntries(entries, getFilters(container));
    var tbody = container.querySelector('tbody'); tbody.textContent = '';
    container.querySelector('.history-summary').textContent = entries.length + ' saved record' + (entries.length === 1 ? '' : 's') +
      ' · ' + matches.length + ' shown · newest first';
    if (!matches.length) {
      var row = document.createElement('tr'), cell = document.createElement('td'); cell.colSpan = 9;
      var empty = document.createElement('div'); empty.className = 'history-empty';
      empty.textContent = entries.length ? 'No history records match the selected filters.' : 'No records yet. Add dated entries in the Tracker tab.';
      cell.appendChild(empty); row.appendChild(cell); tbody.appendChild(row); return;
    }
    matches.forEach(function (entry) {
      var metrics = getMetrics(entry, state.params || {}), row = document.createElement('tr');
      [entry.date || '',money(entry.value),money(entry.basis),money(entry.cash),String(entry.paid||0),
        metrics.returnPct == null ? '—' : (metrics.returnPct > 0 ? '+' : '') + metrics.returnPct.toFixed(1) + '%',money(metrics.result),metrics.status]
        .forEach(function (value, index) {
          var cell = document.createElement('td');
          if (index === 5 || index === 6) cell.className = (index === 5 ? 'history-return ' : 'history-result ') + (index === 5 ? (metrics.returnPct < 0 ? 'neg' : 'pos') : (metrics.result < 0 ? 'neg' : 'pos'));
          if (index === 7) { var badge = document.createElement('span'); badge.className = 'history-status ' + metrics.status.toLowerCase(); badge.textContent = metrics.status; cell.appendChild(badge); }
          else cell.textContent = value;
          row.appendChild(cell);
        });
      var action = document.createElement('td'), remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'btn ghost small history-delete'; remove.setAttribute('data-del', String(entry.id)); remove.textContent = 'Remove';
      action.appendChild(remove); row.appendChild(action); tbody.appendChild(row);
    });
  }

  window.addEventListener('load', function () {
    renderHistory();
    var state = readState();
    if (state.params) fetch('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
    refreshAlerts(); setInterval(refreshAlerts, 30000);
  });
})();
