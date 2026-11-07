(function () {
  'use strict';

  // Hydrate the planner's existing browser state before its main script starts.
  // The synchronous local request avoids a race with the planner's initial render.
  var stateRequest = new XMLHttpRequest();
  try {
    stateRequest.open('GET', '/api/state', false);
    stateRequest.send(null);
    if (stateRequest.status === 200) {
      var response = JSON.parse(stateRequest.responseText);
      if (response.state) {
        localStorage.setItem('loan-leverage-planner-v1', JSON.stringify(response.state));
      }
    }
  } catch (error) {
    console.error('Could not load local planner data:', error);
  }

  var originalSetItem = Storage.prototype.setItem;
  var saveTimer;
  Storage.prototype.setItem = function (key, value) {
    originalSetItem.call(this, key, value);
    if (this !== localStorage || key !== 'loan-leverage-planner-v1') return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        var state = JSON.parse(localStorage.getItem('loan-leverage-planner-v1') || '{}');
        fetch('/api/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state)
        }).catch(function (error) { console.error('Could not save to SQLite:', error); });
      } catch (error) {
        console.error('Could not prepare planner data for SQLite:', error);
      }
    }, 500);
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
    '.local-storage-note{margin-top:6px;font-size:12px;color:var(--muted)}'
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
        var empty = document.createElement('p');
        empty.className = 'local-no-alerts';
        empty.textContent = 'No due-date or threshold alerts right now.';
        list.appendChild(empty);
        return;
      }
      alerts.forEach(function (alert) {
        var item = document.createElement('div');
        item.className = 'local-alert' + (alert.severity === 'danger' ? ' danger' : '');
        var title = document.createElement('div');
        title.className = 'local-alert-title';
        title.textContent = alert.title;
        var message = document.createElement('p');
        message.textContent = alert.message;
        var dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.textContent = 'Dismiss';
        dismiss.addEventListener('click', function () {
          fetch('/api/alerts/dismiss', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: alert.alert_key })
          }).then(refreshAlerts).catch(function () {});
        });
        item.appendChild(title);
        item.appendChild(message);
        item.appendChild(dismiss);
        list.appendChild(item);
      });
    }).catch(function () {
      var list = document.getElementById('local-alert-list');
      if (list) list.textContent = 'Notifications are unavailable. Check that the local server is running.';
    });
  }

  // Save the current browser state on first launch, then update SQLite after edits.
  window.addEventListener('load', function () {
    setTimeout(function () {
      try {
        var state = JSON.parse(localStorage.getItem('loan-leverage-planner-v1') || 'null');
        if (state && state.params) {
          fetch('/api/state', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state)
          }).catch(function (error) { console.error('Could not initialize SQLite state:', error); });
        }
      } catch (error) { /* The planner will continue with its defaults. */ }
      refreshAlerts();
      setInterval(refreshAlerts, 30000);
    }, 0);
  });
})();
