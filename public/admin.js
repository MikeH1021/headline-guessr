(function () {
    var select = document.getElementById('model');
    var notes = Array.prototype.slice.call(document.querySelectorAll('[data-note]'));
    function showNote() {
        if (!select) return;
        notes.forEach(function (note) {
            note.hidden = note.getAttribute('data-note') !== select.value;
        });
    }
    if (select) {
        select.addEventListener('change', showNote);
        showNote();
    }

    document.querySelectorAll('form[data-confirm]').forEach(function (form) {
        form.addEventListener('submit', function (event) {
            if (!confirm(form.getAttribute('data-confirm') || 'Continue?')) event.preventDefault();
        });
    });

    var debugBox = document.getElementById('debug-refresh');
    var refreshBtn = document.getElementById('refresh-btn');
    var state = document.getElementById('refresh-state');
    var log = document.getElementById('refresh-log');
    var readyList = document.getElementById('ready-list');
    if (debugBox && refreshBtn) {
        debugBox.addEventListener('change', function () {
            refreshBtn.disabled = !debugBox.checked;
        });
    }

    var drawn = 0;
    var drawnFirst = '';

    function appendEvent(event) {
        var item = document.createElement('p');
        item.textContent = event.at + '  ' + event.message;
        log.appendChild(item);
        if (event.reasoning) {
            var notesNode = document.createElement('pre');
            notesNode.textContent = event.reasoning;
            log.appendChild(notesNode);
        }
    }

    function drawLog(events) {
        if (!log) return;
        events = events || [];
        var first = events.length ? events[0].at + '\n' + events[0].message : '';
        if (drawn && (events.length < drawn || first !== drawnFirst)) {
            log.textContent = '';
            drawn = 0;
        }
        var nearBottom = drawn === 0 || (log.scrollHeight - log.clientHeight - log.scrollTop < 80);
        for (var index = drawn; index < events.length; index++) appendEvent(events[index]);
        drawn = events.length;
        drawnFirst = first;
        if (nearBottom) log.scrollTop = log.scrollHeight;
    }

    function paintQueue(items) {
        var list = document.getElementById('queue-list');
        var empty = document.getElementById('queue-empty');
        items = items || [];
        var signature = items.map(function (item) { return item.key; }).join('|');
        if (!list || list.dataset.signature === signature) return;
        list.dataset.signature = signature;
        list.textContent = '';
        items.forEach(function (item) {
            var row = document.createElement('li');
            var form = document.createElement('form');
            form.method = 'post';
            form.action = '/admin/post';
            var name = document.createElement('span');
            name.className = 'feed-name';
            name.textContent = item.source;
            var detail = document.createElement('span');
            detail.className = 'feed-url';
            detail.textContent = item.headline + ' — ' + item.ethnicity;
            var key = document.createElement('input');
            key.type = 'hidden';
            key.name = 'queue_key';
            key.value = item.key;
            var button = document.createElement('button');
            button.className = 'btn btn-ghost';
            button.type = 'submit';
            button.name = 'action';
            button.value = 'drop_queue';
            button.textContent = 'Remove';
            form.appendChild(name);
            form.appendChild(detail);
            form.appendChild(key);
            form.appendChild(button);
            row.appendChild(form);
            list.appendChild(row);
        });
        if (empty) empty.hidden = items.length > 0;
    }

    function drawStatus(data) {
        if (!state) return;
        var queued = typeof data.queued === 'number' ? data.queued : (data.queue || []).length;
        var line = data.running
            ? 'Classifying across the feeds. ' + queued + ' confirmed in the queue.'
            : (data.finished_at ? 'Done at ' + data.finished_at + '. ' + data.ready + ' in the round. ' + queued + ' still in the queue.' : 'No refresh yet.');
        if (data.error) line += ' ' + data.error;
        if (data.refreshed_at && !data.running) line += ' Round saved ' + data.refreshed_at + '.';
        state.textContent = line;
        drawLog(data.events || []);
        if (data.queue) paintQueue(data.queue);
        if (readyList) {
            readyList.textContent = '';
            if (!data.running && data.cards && data.cards.length) {
                data.cards.forEach(function (card) {
                    var row = document.createElement('li');
                    row.textContent = card.source + ': ' + card.headline + ' — ' + card.ethnicity;
                    readyList.appendChild(row);
                });
            }
        }
        if (data.rum) paintRum(data.rum);
    }

    function paintRum(data) {
        var empty = document.getElementById('rum-empty');
        var body = document.getElementById('rum-body');
        var views = data && data.views ? data.views : 0;
        if (empty) empty.hidden = views > 0;
        if (body) body.hidden = !views;
        if (!views) return;
        document.getElementById('rum-views').textContent = String(data.views);
        document.getElementById('rum-people').textContent = String(data.visitors);
        document.getElementById('rum-finishes').textContent = String(data.finishes);
        document.getElementById('rum-time').textContent = data.median_finish || '—';
        var today = data.today_views + ' view' + (data.today_views === 1 ? '' : 's');
        today += ' · ' + data.today_visitors + ' visitor' + (data.today_visitors === 1 ? '' : 's');
        today += ' · ' + data.today_finishes + ' finish' + (data.today_finishes === 1 ? '' : 'es');
        document.getElementById('rum-today').textContent = 'Today: ' + today;
        var score = document.getElementById('rum-score');
        score.textContent = data.asked ? (data.right + ' of ' + data.asked + ' headlines right on finished rounds.') : '';
        document.getElementById('rum-mix').textContent = data.mix || '';
        document.getElementById('rum-vitals').textContent = data.vitals || '';
        var pages = document.getElementById('rum-pages');
        pages.textContent = '';
        var peak = 0;
        (data.pages || []).forEach(function (row) { peak = Math.max(peak, row.count); });
        (data.pages || []).forEach(function (row) {
            var item = document.createElement('li');
            var name = document.createElement('span');
            name.className = 'career-name';
            name.textContent = row.label;
            var tally = document.createElement('span');
            tally.className = 'career-count';
            tally.textContent = String(row.count);
            var track = document.createElement('span');
            track.className = 'career-track';
            var bar = document.createElement('span');
            bar.style.width = (peak ? Math.round(100 * row.count / peak) : 0) + '%';
            track.appendChild(bar);
            item.appendChild(name);
            item.appendChild(tally);
            item.appendChild(track);
            pages.appendChild(item);
        });
        var recent = document.getElementById('rum-recent');
        recent.textContent = '';
        (data.recent || []).forEach(function (row) {
            var item = document.createElement('li');
            var time = document.createElement('time');
            time.textContent = row.time;
            var kind = document.createElement('span');
            kind.className = 'rum-kind';
            kind.textContent = row.kind;
            var detail = document.createElement('span');
            detail.textContent = row.detail;
            item.appendChild(time);
            item.appendChild(kind);
            item.appendChild(detail);
            recent.appendChild(item);
        });
        var errors = document.getElementById('rum-errors');
        errors.textContent = '';
        (data.errors || []).forEach(function (message) {
            var item = document.createElement('li');
            item.textContent = message;
            errors.appendChild(item);
        });
    }

    function pollStatus() {
        fetch('/admin/status').then(function (response) {
            if (response.status === 401) {
                if (state) state.textContent = 'Sign in again to watch the refresh.';
                return null;
            }
            return response.json();
        }).then(function (data) {
            if (data) drawStatus(data);
        }).catch(function () {
            if (state) state.textContent = 'The progress log could not be loaded.';
        });
    }

    if (state) {
        pollStatus();
        setInterval(pollStatus, 1000);
    }
})();
