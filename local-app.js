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
    '.local-alert-list{display:grid;gap:10px}',
    '.local-alert{padding:12px 14px;border-radius:10px;background:var(--warn-bg);color:var(--warn)}',
    '.local-alert.danger{background:var(--bad-bg);color:var(--bad)}',
    '.local-alert-title{font-weight:600}',
    '.local-alert p{margin:3px 0 0;font-size:13px}',
    '.local-alert button{margin-top:7px;border:0;background:transparent;color:inherit;text-decoration:underline;cursor:pointer;font:inherit;font-size:12px;padding:0}',
    '.local-no-alerts{margin:0;padding:14px;border-radius:10px;background:var(--field);color:var(--muted);font-size:14px}',
    '.local-storage-note{font-size:12px;color:var(--muted)}',
    '.local-alert.good{background:var(--good-bg);color:var(--good)}',
    '.local-alert.info{background:var(--field);color:var(--fg)}',
    '.alertbox{border:1px solid var(--line);border-radius:14px;background:var(--surface);box-shadow:var(--card-shadow);transition:background .2s,border-color .2s}',
    '.alertbox summary{display:flex;align-items:center;gap:12px;padding:12px 14px;cursor:pointer;list-style:none}',
    '.alertbox summary::-webkit-details-marker{display:none}',
    '.alertbox .ab-icon{position:relative;flex:none;width:38px;height:38px;border-radius:10px;background:var(--field);display:grid;place-items:center;color:var(--muted)}',
    '.alertbox .ab-icon svg{width:20px;height:20px}',
    '.alertbox .ab-text{flex:1;min-width:0;display:flex;flex-direction:column}',
    '.alertbox .ab-title{font-family:var(--font-label);font-weight:600;font-size:16px}',
    '.alertbox .ab-sub{font-size:13px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.alertbox .ab-count{flex:none;min-width:24px;padding:2px 8px;border-radius:99px;font:600 12px var(--font-label);text-align:center;color:#fff;background:var(--muted)}',
    '.alertbox .ab-count:empty{display:none}',
    '.alertbox .ab-chev{flex:none;color:var(--muted);transition:transform .2s}',
    '.alertbox[open] .ab-chev{transform:rotate(180deg)}',
    '.alertbox .ab-body{padding:0 14px 14px;display:flex;flex-direction:column;gap:10px}',
    '.alertbox .ab-dot{position:absolute;top:-3px;right:-3px;width:12px;height:12px;border-radius:50%;border:2px solid var(--surface);background:var(--bad);display:none}',
    '.alertbox.s-danger{background:var(--bad-bg);border-color:var(--bad)}',
    '.alertbox.s-danger .ab-icon{background:var(--bad);color:#fff}.alertbox.s-danger .ab-count{background:var(--bad)}.alertbox.s-danger .ab-dot{display:block;background:var(--bad);animation:abpulse 1.6s infinite}',
    '.alertbox.s-warning{background:var(--warn-bg);border-color:var(--warn)}',
    '.alertbox.s-warning .ab-icon{background:var(--warn);color:#fff}.alertbox.s-warning .ab-count{background:var(--warn)}.alertbox.s-warning .ab-dot{display:block;background:var(--warn)}',
    '.alertbox.s-good{background:var(--good-bg);border-color:var(--good)}',
    '.alertbox.s-good .ab-icon{background:var(--good);color:#fff}.alertbox.s-good .ab-count{background:var(--good)}.alertbox.s-good .ab-dot{display:block;background:var(--good)}',
    '.alertbox.s-info .ab-icon{background:var(--accent);color:var(--accent-fg)}.alertbox.s-info .ab-count{background:var(--accent)}.alertbox.s-info .ab-dot{display:block;background:var(--accent)}',
    '@keyframes abpulse{0%{box-shadow:0 0 0 0 rgba(200,40,30,.55)}70%{box-shadow:0 0 0 8px rgba(200,40,30,0)}100%{box-shadow:0 0 0 0 rgba(200,40,30,0)}}',
    '@media(prefers-reduced-motion:reduce){.alertbox .ab-dot{animation:none!important}}',
    '.history-totals{margin:0;padding:10px 12px;border-radius:10px;background:var(--field);font-size:13.5px}',
    '.history-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:end}',
    '.history-filter{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--muted)}',
    '.history-filter input,.history-search{padding:9px 10px;border:1px solid var(--line);border-radius:8px;background:var(--field);color:var(--fg);font:inherit}',
    '.history-search{flex:1;min-width:170px}',
    '.history-summary{color:var(--muted);font-size:13px;margin:0}',
    '.history-plan{margin:0;color:var(--muted);font-size:13.5px}',
    '.history-sub{font-family:var(--font-label);font-weight:600;font-size:15px;margin:6px 0 0}',
    '.history-table{min-width:760px}',
    '.history-table td:first-child{font-family:var(--font-num)}',
    '.history-table td.txt{white-space:normal;min-width:150px;max-width:260px;text-align:left;font-family:var(--font-body);color:var(--muted)}',
    '.history-status{display:inline-block;padding:2px 7px;border-radius:99px;background:var(--field);font:600 11px var(--font-label);text-transform:uppercase}',
    '.history-status.profit,.history-status.buy{background:var(--good-bg);color:var(--good)}',
    '.history-status.watch{background:var(--warn-bg);color:var(--warn)}',
    '.history-status.exit,.history-status.sell{background:var(--bad-bg);color:var(--bad)}',
    '.history-empty{padding:14px;background:var(--field);border-radius:10px;color:var(--muted)}',
    '.history-delete{white-space:nowrap}',
    '.backup-status{flex-basis:100%;margin:0;color:var(--muted);font-size:13px}',
    '@media(max-width:600px){.history-table{font-size:12px}}'
  ].join('');
  document.head.appendChild(style);

  var nav = document.querySelector('nav');
  var wrap = document.querySelector('.wrap');
  var locals = {};

  function centerTab(button) {
    if (nav.scrollTo) nav.scrollTo({ left: button.offsetLeft - (nav.clientWidth - button.offsetWidth) / 2, behavior: 'smooth' });
  }
  // Extra tabs live in the same nav bar as the planner tabs, so they scroll and stay pinned with it.
  function addLocalTab(name, label, html, onShow) {
    var button = document.createElement('button');
    button.type = 'button'; button.dataset.tab = name; button.innerHTML = label;
    nav.appendChild(button);
    var section = document.createElement('section');
    section.id = 'local-' + name; section.className = 'wrap'; section.style.gap = '18px'; section.hidden = true;
    section.innerHTML = html;
    wrap.appendChild(section);
    locals[name] = { button: button, section: section, onShow: onShow };
  }
  addLocalTab('trade-history', 'Trade history',
    '<div class="group"><h2>Trade history</h2><p class="hint">Your security trades and dated daily logs, saved on this computer. These are records you enter, not broker-verified executions.</p><div id="trade-history-view" style="display:flex;flex-direction:column;gap:12px"></div></div>',
    function () { renderHistory(); });

  // Notification box above the tab bar. It changes colour and shows a dot when something needs attention.
  var box = document.createElement('details');
  box.className = 'alertbox';
  box.innerHTML = '<summary><span class="ab-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg><span class="ab-dot"></span></span>' +
    '<span class="ab-text"><span class="ab-title">Notifications</span><span class="ab-sub" id="ab-sub">Checking…</span></span>' +
    '<span class="ab-count" id="local-alert-count"></span>' +
    '<svg class="ab-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></summary>' +
    '<div class="ab-body"><div id="local-alert-list" class="local-alert-list"><p class="local-no-alerts">Checking reminders…</p></div>' +
    '<div class="local-storage-note">Checks installments, losses, good positions and stale prices from your latest daily log. They refresh while the app is open and cannot notify you when it is closed. They are reminders, not verified lender due dates.</div></div>';
  nav.parentNode.insertBefore(box, nav);

  nav.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-tab]');
    if (!button) return;
    var name = button.dataset.tab, local = locals[name];
    if (local) {
      event.preventDefault(); event.stopImmediatePropagation();
      document.querySelectorAll('nav button').forEach(function (b) { b.removeAttribute('aria-current'); });
      button.setAttribute('aria-current', 'page');
      document.querySelectorAll('section[id^="tab-"]').forEach(function (s) { s.hidden = true; });
      Object.keys(locals).forEach(function (k) { locals[k].section.hidden = k !== name; });
      if (local.onShow) local.onShow();
      centerTab(button); window.scrollTo(0, 0);
    } else {
      Object.keys(locals).forEach(function (k) { locals[k].section.hidden = true; });
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
      var top = ['danger', 'warning', 'good', 'info'].filter(function (sev) { return alerts.some(function (a) { return a.severity === sev; }); })[0];
      box.className = 'alertbox' + (top ? ' s-' + top : '');
      count.textContent = alerts.length ? String(alerts.length) : '';
      document.getElementById('ab-sub').textContent = alerts.length ? alerts[0].title + (alerts.length > 1 ? ' and ' + (alerts.length - 1) + ' more' : '') : 'All clear. Nothing needs attention.';
      list.textContent = '';
      if (!alerts.length) {
        var empty = document.createElement('p'); empty.className = 'local-no-alerts';
        empty.textContent = 'No due-date or threshold alerts right now.'; list.appendChild(empty); return;
      }
      alerts.forEach(function (alert) {
        var item = document.createElement('div'); item.className = 'local-alert ' + (alert.severity || 'warning');
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
      var sub = document.getElementById('ab-sub'); if (sub) sub.textContent = 'Unavailable. Is the local server running?';
    });
  }

  function readState() {
    try { return JSON.parse(localStorage.getItem('loan-leverage-planner-v1') || '{}'); }
    catch (error) { return {}; }
  }
  // The history tab shows the plan that is currently selected.
  function readActive() {
    var state = readState();
    if (state.plans && state.plans.length) {
      var p = state.plans.filter(function (x) { return x.id === state.activeId; })[0] || state.plans[0];
      return { params: p.params || {}, entries: p.entries || [], trades: p.trades || [] };
    }
    return { params: state.params || {}, entries: state.entries || [], trades: state.trades || [] };
  }
  function money(value) {
    return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function num(value) { return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 4 }); }
  function escapeCsv(value) { return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"'; }
  function holdingsText(entry) {
    return (entry.holdings || []).map(function (h) { return h.security + ' ' + num(h.qty) + ' @ ' + num(h.price); }).join('; ');
  }
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
  function inRange(date, filters) {
    if (filters.from && String(date) < filters.from) return false;
    if (filters.to && String(date) > filters.to) return false;
    return true;
  }
  function byNewest(a, b) {
    return a.date === b.date ? Number(b.ts || 0) - Number(a.ts || 0) : String(b.date).localeCompare(String(a.date));
  }
  function filteredEntries(entries, filters) {
    var query = (filters.search || '').trim().toLowerCase();
    return entries.slice().sort(byNewest).filter(function (entry) {
      if (!inRange(entry.date, filters)) return false;
      return !query || [entry.date, entry.value, entry.basis, entry.cash, entry.paid, entry.notes, holdingsText(entry)].join(' ').toLowerCase().indexOf(query) >= 0;
    });
  }
  function gross(t) { var a = Number(t.amount); return a > 0 ? a : (Number(t.qty) || 0) * (Number(t.price) || 0); }
  function total(t) { var v = Number(t.total); if (v > 0) return v; var g = gross(t), f = Number(t.fee) || 0; return t.side === 'sell' ? g - f : g + f; }
  function feeOf(t) { var g = gross(t), v = total(t); return t.side === 'sell' ? g - v : v - g; }
  function stats() { try { return window.PlannerBridge ? window.PlannerBridge.tradeStats() : {}; } catch (e) { return {}; } }
  function sign(n) { return (n > 0.005 ? '+' : '') + money(n); }
  function plText(st) {
    if (!st) return '—';
    return sign(st.pl) + (st.pct != null && isFinite(st.pct) ? ' (' + (st.pct > 0 ? '+' : '') + (st.pct * 100).toFixed(1) + '%)' : '');
  }
  function filteredTrades(trades, filters) {
    var query = (filters.search || '').trim().toLowerCase();
    return trades.slice().sort(byNewest).filter(function (t) {
      if (!inRange(t.date, filters)) return false;
      return !query || [t.date, t.security, t.side, t.qty, t.price, t.notes].join(' ').toLowerCase().indexOf(query) >= 0;
    });
  }
  function button(text, className) {
    var b = document.createElement('button'); b.type = 'button'; b.className = className; b.textContent = text; return b;
  }
  function makeTable(headers) {
    var scroller = document.createElement('div'); scroller.className = 'scroller';
    var table = document.createElement('table'); table.className = 'history-table';
    table.innerHTML = '<thead><tr>' + headers.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody></tbody>';
    scroller.appendChild(table);
    return { scroller: scroller, body: table.querySelector('tbody') };
  }
  function setupHistory(container) {
    if (container.dataset.ready) return;
    container.dataset.ready = 'true';
    var toolbar = document.createElement('div'); toolbar.className = 'history-toolbar';
    var search = document.createElement('input'); search.type = 'search'; search.className = 'history-search';
    search.placeholder = 'Search securities, notes, dates'; search.setAttribute('aria-label', 'Search trade history');
    function dateFilter(labelText, name) {
      var label = document.createElement('label'); label.className = 'history-filter'; label.textContent = labelText;
      var input = document.createElement('input'); input.type = 'date'; input.dataset.filter = name;
      label.appendChild(input); return label;
    }
    var from = dateFilter('From date', 'from'), to = dateFilter('To date', 'to');
    var exportTrades = button('Export trades CSV', 'btn ghost small');
    var exportLogs = button('Export logs CSV', 'btn ghost small');
    var exportDb = button('Export database', 'btn ghost small');
    var importDb = button('Import database', 'btn ghost small');
    var file = document.createElement('input'); file.type = 'file'; file.accept = '.sqlite,.sqlite3,application/vnd.sqlite3'; file.hidden = true;
    var status = document.createElement('p'); status.className = 'backup-status'; status.setAttribute('aria-live', 'polite');
    [search, from, to, exportTrades, exportLogs, exportDb, importDb, file].forEach(function (el) { toolbar.appendChild(el); });
    var summary = document.createElement('p'); summary.className = 'history-summary'; summary.setAttribute('aria-live', 'polite');
    var tradeHead = document.createElement('h3'); tradeHead.className = 'history-sub'; tradeHead.textContent = 'Security trades';
    var trades = makeTable(['Date', 'Security', 'Side', 'Quantity', 'Price', 'Amount', 'Total', 'Fee', 'Fee %', 'P/L', 'Notes', 'Action']);
    trades.body.id = 'history-trades-body';
    var logHead = document.createElement('h3'); logHead.className = 'history-sub'; logHead.textContent = 'Daily logs';
    var logs = makeTable(['Date', 'Market value', 'Cost basis', 'Cash', 'Paid', 'Price return', 'Est. result', 'Status', 'Holdings', 'Notes', 'Action']);
    logs.body.id = 'history-logs-body';
    var planP = document.createElement('p'); planP.className = 'history-plan';
    var totalsP = document.createElement('p'); totalsP.className = 'history-totals';
    [planP, toolbar, status, summary, totalsP, tradeHead, trades.scroller, logHead, logs.scroller].forEach(function (el) { container.appendChild(el); });

    [search, from.querySelector('input'), to.querySelector('input')].forEach(function (input) { input.addEventListener('input', renderHistory); });
    exportTrades.addEventListener('click', function () {
      var state = readActive(), rows = filteredTrades(state.trades || [], getFilters(container));
      var st = stats();
      var lines = [['Date', 'Security', 'Side', 'Quantity', 'Price', 'Amount', 'Total paid or received', 'Fee', 'Fee percent', 'Profit/loss', 'P/L type', 'Notes']];
      rows.forEach(function (t) {
        var g = gross(t), f = feeOf(t), x = st[t.id];
        lines.push([t.date, t.security, t.side, t.qty, t.price, g.toFixed(2), total(t).toFixed(2), f.toFixed(2), g > 0 ? (f / g * 100).toFixed(2) : '', x ? x.pl.toFixed(2) : '', x ? x.kind : '', t.notes || '']);
      });
      downloadCsv(lines, 'loan-planner-trades.csv');
    });
    exportLogs.addEventListener('click', function () {
      var state = readActive(), rows = filteredEntries(state.entries || [], getFilters(container));
      var lines = [['Date', 'Market value', 'Cost basis', 'Cash', 'Installments paid', 'Price return percent', 'Estimated result', 'Status', 'Holdings', 'Notes']];
      rows.forEach(function (entry) {
        var m = getMetrics(entry, state.params || {});
        lines.push([entry.date, entry.value, entry.basis, entry.cash, entry.paid || 0, m.returnPct == null ? '' : m.returnPct.toFixed(2), m.result.toFixed(2), m.status, holdingsText(entry), entry.notes || '']);
      });
      downloadCsv(lines, 'loan-planner-daily-logs.csv');
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
    container.addEventListener('click', function (event) {
      var t = event.target.closest('button[data-tdel]'), l = event.target.closest('button[data-ldel]');
      if (!t && !l) return;
      if (!window.PlannerBridge) return;
      if (!window.confirm(t ? 'Remove this trade? Holdings are recalculated from the remaining trades.' : 'Remove this daily log entry?')) return;
      if (t) window.PlannerBridge.removeTrade(t.getAttribute('data-tdel'));
      else window.PlannerBridge.removeLog(l.getAttribute('data-ldel'));
    });
  }
  function getFilters(container) {
    return { search: container.querySelector('.history-search').value,
      from: container.querySelector('[data-filter="from"]').value,
      to: container.querySelector('[data-filter="to"]').value };
  }
  function downloadCsv(lines, filename) {
    var text = '﻿' + lines.map(function (row) { return row.map(escapeCsv).join(','); }).join('\r\n');
    downloadBlob(new Blob([text], { type: 'text/csv;charset=utf-8' }), filename);
  }
  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = filename; link.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function cell(row, text, className) {
    var td = document.createElement('td'); td.textContent = text; if (className) td.className = className; row.appendChild(td); return td;
  }
  function badge(row, label) {
    var td = document.createElement('td'), b = document.createElement('span');
    b.className = 'history-status ' + label.toLowerCase(); b.textContent = label; td.appendChild(b); row.appendChild(td);
  }
  function emptyRow(body, cols, text) {
    var row = document.createElement('tr'), td = document.createElement('td'); td.colSpan = cols;
    var empty = document.createElement('div'); empty.className = 'history-empty'; empty.textContent = text;
    td.appendChild(empty); row.appendChild(td); body.appendChild(row);
  }
  function renderHistory() {
    var container = document.getElementById('trade-history-view'); if (!container) return;
    setupHistory(container);
    var state = readActive(), entries = state.entries || [], allTrades = state.trades || [];
    var filters = getFilters(container);
    var tradeRows = filteredTrades(allTrades, filters), logRows = filteredEntries(entries, filters);
    var totals = window.PlannerBridge ? window.PlannerBridge.totals() : null;
    container.querySelector('.history-plan').innerHTML = window.PlannerBridge ? 'Showing the selected plan: <b></b>' : '';
    if (window.PlannerBridge) container.querySelector('.history-plan b').textContent = window.PlannerBridge.activeName();
    var totalsEl = container.querySelector('.history-totals');
    totalsEl.textContent = totals && allTrades.length ? 'Total profit/loss on securities: ' + sign(totals.totalPL) + ' (unrealized ' + sign(totals.unrealized) + ', realized ' + sign(totals.realized) + '), after fees and before loan interest.' : 'Profit/loss appears here once you save trades.';
    container.querySelector('.history-summary').textContent =
      allTrades.length + ' saved trade' + (allTrades.length === 1 ? '' : 's') + ' (' + tradeRows.length + ' shown) · ' +
      entries.length + ' daily log' + (entries.length === 1 ? '' : 's') + ' (' + logRows.length + ' shown) · newest first';

    var tb = document.getElementById('history-trades-body'); tb.textContent = '';
    var tradeStats = stats();
    if (!tradeRows.length) emptyRow(tb, 12, allTrades.length ? 'No trades match the selected filters.' : 'No trades yet. Add one in the New trade tab.');
    tradeRows.forEach(function (t) {
      var row = document.createElement('tr'), g = gross(t), f = feeOf(t), st = tradeStats[t.id];
      cell(row, t.date || '');
      cell(row, t.security || '', 'txt');
      badge(row, t.side === 'sell' ? 'Sell' : 'Buy');
      cell(row, num(t.qty)); cell(row, num(t.price)); cell(row, money(g)); cell(row, money(total(t)));
      cell(row, money(f)); cell(row, g > 0 ? (f / g * 100).toFixed(2) + '%' : '—');
      var plCell = cell(row, plText(st), st ? (st.pl < 0 ? 'neg' : 'pos') : ''); if (st) plCell.title = st.kind + ' profit/loss, after fees';
      cell(row, t.notes || '', 'txt');
      var action = document.createElement('td'), remove = button('Remove', 'btn ghost small history-delete');
      remove.setAttribute('data-tdel', String(t.id)); action.appendChild(remove); row.appendChild(action); tb.appendChild(row);
    });

    var lb = document.getElementById('history-logs-body'); lb.textContent = '';
    if (!logRows.length) emptyRow(lb, 11, entries.length ? 'No daily logs match the selected filters.' : 'No daily logs yet. Add one in the Tracker tab.');
    logRows.forEach(function (entry) {
      var m = getMetrics(entry, state.params || {}), row = document.createElement('tr');
      cell(row, entry.date || ''); cell(row, money(entry.value)); cell(row, money(entry.basis)); cell(row, money(entry.cash)); cell(row, String(entry.paid || 0));
      cell(row, m.returnPct == null ? '—' : (m.returnPct > 0 ? '+' : '') + m.returnPct.toFixed(1) + '%', m.returnPct != null && m.returnPct < 0 ? 'neg' : 'pos');
      cell(row, money(m.result), m.result < 0 ? 'neg' : 'pos');
      badge(row, m.status);
      cell(row, holdingsText(entry) || '—', 'txt'); cell(row, entry.notes || '', 'txt');
      var action = document.createElement('td'), remove = button('Remove', 'btn ghost small history-delete');
      remove.setAttribute('data-ldel', String(entry.id)); action.appendChild(remove); row.appendChild(action); lb.appendChild(row);
    });
  }

  window.addEventListener('load', function () {
    renderHistory();
    var state = readState();
    if (state.plans || state.params) fetch('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
    refreshAlerts(); setInterval(refreshAlerts, 30000);
  });
})();
