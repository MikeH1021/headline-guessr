(function () {
    var RANKS = [
        ['machine', 'Pattern recognition machine'],
        ['autist', 'Based autist'],
        ['noticer', 'High-level noticer'],
        ['squint', 'Starting to notice'],
        ['normie', 'Normie'],
        ['headline', 'Believes the headline'],
        ['liberal', 'Brainwashed liberal'],
    ];
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var day = document.body.getAttribute('data-round-day') || '';
    var streakNow = 0;

    function loadCareer() {
        try {
            var data = JSON.parse(localStorage.getItem('hg-career') || '{}');
            if (!data || typeof data !== 'object') return { max: 0, days: {} };
            if (!data.days || typeof data.days !== 'object') data.days = {};
            data.max = Number(data.max) || 0;
            return data;
        } catch (err) {
            return { max: 0, days: {} };
        }
    }

    function saveCareer(data) {
        var keys = Object.keys(data.days || {}).sort();
        if (keys.length > 366) {
            keys.slice(0, keys.length - 366).forEach(function (key) {
                delete data.days[key];
            });
        }
        try { localStorage.setItem('hg-career', JSON.stringify(data)); } catch (err) {}
    }

    function record(entry) {
        if (!day) return;
        var career = loadCareer();
        var prev = career.days[day] || {};
        var ms = Number(entry.ms) || Number(prev.ms) || 0;
        var nextScore = Number(entry.score) || 0;
        var bestScore = Math.max(Number(prev.best) || 0, Number(prev.score) || 0, nextScore);
        career.days[day] = {
            score: nextScore,
            best: bestScore,
            total: Number(entry.total) || 0,
            tier: entry.tier || '',
            title: entry.title || '',
            marks: entry.marks || '',
            ms: ms,
        };
        saveCareer(career);
    }

    function isoShift(iso, delta) {
        var when = new Date(iso + 'T12:00:00');
        when.setDate(when.getDate() + delta);
        return when.getFullYear() + '-'
            + String(when.getMonth() + 1).padStart(2, '0') + '-'
            + String(when.getDate()).padStart(2, '0');
    }

    function dayLabel(iso) {
        var parts = String(iso).split('-');
        var month = MONTHS[Number(parts[1]) - 1] || '';
        var label = month + ' ' + Number(parts[2]);
        var year = Number(parts[0]);
        if (year && year !== new Date().getFullYear()) label += ', ' + year;
        return label;
    }

    function formatPace(ms) {
        var total = Math.max(1, Math.round(Number(ms) / 1000));
        var minutes = Math.floor(total / 60);
        var seconds = total % 60;
        if (minutes <= 0) return seconds + 's';
        return minutes + 'm ' + String(seconds).padStart(2, '0') + 's';
    }

    function scoreLabel(row) {
        var text = (Number(row.score) || 0) + '/' + (Number(row.total) || 0);
        if (row.ms) text += ' · ' + formatPace(row.ms);
        return text;
    }

    function tiles(marks, parent, before) {
        var row = document.createElement('span');
        row.className = 'mini';
        row.setAttribute('aria-hidden', 'true');
        String(marks || '').split('').forEach(function (mark) {
            if (!mark) return;
            var cell = document.createElement('span');
            cell.className = mark === 'r' ? 'is-right' : 'is-wrong';
            row.appendChild(cell);
        });
        if (!row.childNodes.length) return;
        if (before) parent.insertBefore(row, before);
        else parent.appendChild(row);
    }

    function editionRow(iso, row) {
        var item = document.createElement('div');
        item.className = 'edition';
        var when = document.createElement('span');
        when.className = 'edition-day';
        when.textContent = dayLabel(iso);
        var score = document.createElement('span');
        score.className = 'edition-score';
        score.textContent = scoreLabel(row);
        item.appendChild(when);
        tiles(row.marks, item);
        item.appendChild(score);
        return item;
    }

    function fillArchive(days) {
        document.querySelectorAll('.archive-list [data-day]').forEach(function (item) {
            var row = days[item.getAttribute('data-day')];
            if (!row) return;
            var links = item.querySelector('.archive-links');
            if (row.marks && !item.querySelector('.mini')) tiles(row.marks, item, links);
            var score = item.querySelector('.edition-score');
            if (!score && (row.marks || row.score || row.total)) {
                score = document.createElement('span');
                score.className = 'edition-score';
                score.textContent = scoreLabel(row);
                if (links) item.insertBefore(score, links);
                else item.appendChild(score);
            } else if (score && row.ms && score.textContent.indexOf('·') === -1) {
                score.textContent += ' · ' + formatPace(row.ms);
            }
        });
    }

    function localEdition(iso, row) {
        var item = document.createElement('li');
        item.setAttribute('data-day', iso);
        var when = document.createElement('span');
        when.className = 'archive-day';
        when.textContent = dayLabel(iso);
        item.appendChild(when);
        tiles(row.marks, item);
        var score = document.createElement('span');
        score.className = 'edition-score';
        score.textContent = scoreLabel(row);
        item.appendChild(score);
        return item;
    }

    function paintDesk() {
        var career = loadCareer();
        var days = career.days || {};
        var keys = Object.keys(days).sort();
        var empty = document.getElementById('stats-empty');
        var body = document.getElementById('stats-body');
        var played = keys.length;
        if (empty) empty.hidden = played > 0;
        if (body) body.hidden = played === 0;
        if (!played) return;
        var right = 0;
        var asked = 0;
        var sweeps = 0;
        var counts = {};
        keys.forEach(function (key) {
            var row = days[key];
            right += Number(row.score) || 0;
            asked += Number(row.total) || 0;
            if (row.total && Number(row.score) === Number(row.total)) sweeps += 1;
            if (row.tier) counts[row.tier] = (counts[row.tier] || 0) + 1;
        });
        var playedNode = document.getElementById('stat-played');
        var streakNode = document.getElementById('stat-streak');
        var bestNode = document.getElementById('stat-best');
        var sweepsNode = document.getElementById('stat-sweeps');
        if (playedNode) playedNode.textContent = String(played);
        if (streakNode) streakNode.textContent = String(streakNow);
        if (bestNode) bestNode.textContent = String(Math.max(career.max || 0, streakNow));
        if (sweepsNode) sweepsNode.textContent = String(sweeps);
        var modeCount = 0;
        RANKS.forEach(function (pair) {
            modeCount = Math.max(modeCount, counts[pair[0]] || 0);
        });
        var leaders = RANKS.filter(function (pair) {
            return modeCount > 0 && (counts[pair[0]] || 0) === modeCount;
        });
        var most = document.getElementById('stats-most');
        if (most) {
            var line = leaders.length === 1 ? 'Most often: ' + leaders[0][1] + '.' : '';
            if (asked) line += (line ? ' ' : '') + right + ' of ' + asked + ' headlines right.';
            most.textContent = line.trim();
        }
        var list = document.getElementById('career-ranks');
        if (list) {
            list.textContent = '';
            var peak = 0;
            RANKS.forEach(function (pair) {
                peak = Math.max(peak, counts[pair[0]] || 0);
            });
            RANKS.forEach(function (pair) {
                var count = counts[pair[0]] || 0;
                var item = document.createElement('li');
                if (leaders.length === 1 && pair[0] === leaders[0][0]) item.className = 'is-top';
                var name = document.createElement('span');
                name.className = 'career-name';
                name.textContent = pair[1];
                var tally = document.createElement('span');
                tally.className = 'career-count';
                tally.textContent = String(count);
                var track = document.createElement('span');
                track.className = 'career-track';
                var bar = document.createElement('span');
                var width = peak ? Math.round(100 * count / peak) : 0;
                if (count && width < 8) width = 8;
                bar.style.width = width + '%';
                track.appendChild(bar);
                item.appendChild(name);
                item.appendChild(tally);
                item.appendChild(track);
                list.appendChild(item);
            });
        }
        var editions = document.getElementById('editions');
        if (editions) {
            editions.textContent = '';
            keys.slice().reverse().slice(0, 14).forEach(function (key) {
                editions.appendChild(editionRow(key, days[key]));
            });
        }
    }

    function paintEarlier() {
        var days = loadCareer().days || {};
        var list = document.querySelector('.archive-list');
        var listed = {};
        if (list) {
            list.querySelectorAll('[data-day]').forEach(function (node) {
                listed[node.getAttribute('data-day')] = true;
            });
            fillArchive(days);
        }
        var prior = Object.keys(days).filter(function (key) {
            return key !== day && !listed[key];
        }).sort().reverse().slice(0, 6);
        if (list) prior.forEach(function (key) { list.appendChild(localEdition(key, days[key])); });
        var earlier = document.getElementById('earlier');
        if (!earlier) return;
        earlier.textContent = '';
        if (list || !prior.length) {
            earlier.hidden = true;
            return;
        }
        var kicker = document.createElement('p');
        kicker.className = 'kicker';
        kicker.textContent = 'Earlier editions';
        earlier.appendChild(kicker);
        prior.forEach(function (key) {
            earlier.appendChild(editionRow(key, days[key]));
        });
        earlier.hidden = false;
    }

    var clocks = document.querySelectorAll('.next-round');
    function paintClock() {
        clocks.forEach(function (node) {
            var at = Date.parse(node.getAttribute('data-at'));
            var time = node.querySelector('time');
            if (!time || !at) return;
            var diff = at - Date.now();
            if (diff <= 0) {
                time.textContent = 'soon';
                return;
            }
            var total = Math.floor(diff / 1000);
            var hours = Math.floor(total / 3600);
            var minutes = Math.floor((total % 3600) / 60);
            var seconds = total % 60;
            time.textContent = hours > 0
                ? hours + 'h ' + minutes + 'm'
                : minutes + 'm ' + String(seconds).padStart(2, '0') + 's';
        });
    }
    if (clocks.length) {
        paintClock();
        window.setInterval(paintClock, 1000);
    }

    if (day && document.body.classList.contains('page-results')) {
        var number = document.querySelector('.score-num');
        var of = document.querySelector('.score-of');
        var title = document.querySelector('.rank-title');
        if (number && of && title) {
            var marks = Array.prototype.map.call(document.querySelectorAll('.score-block .share-tile'), function (tile) {
                return tile.classList.contains('is-right') ? 'r' : 'w';
            }).join('');
            var total = parseInt(String(of.textContent).replace(/\D/g, ''), 10) || marks.length;
            var score = parseInt(number.getAttribute('data-score'), 10);
            if (score !== score) score = 0;
            var ms = 0;
            try {
                var pace = JSON.parse(sessionStorage.getItem('hg-pace') || '{}');
                if (pace.day === day && Number(pace.ms) > 0) ms = Number(pace.ms);
            } catch (err) { ms = 0; }
            record({
                score: score,
                total: total,
                tier: title.getAttribute('data-tier') || '',
                title: title.textContent.trim(),
                marks: marks,
                ms: ms,
            });
        }
    }

    var today = document.getElementById('today-play');
    if (day && today) {
        record({
            score: parseInt(today.getAttribute('data-score'), 10) || 0,
            total: parseInt(today.getAttribute('data-total'), 10) || 0,
            tier: today.getAttribute('data-tier') || '',
            title: today.getAttribute('data-title') || '',
            marks: today.getAttribute('data-marks') || '',
            ms: 0,
        });
    }

    var streakNodes = document.querySelectorAll('.streak');
    if (day && streakNodes.length) {
        var saved = {};
        try { saved = JSON.parse(localStorage.getItem('hg-streak') || '{}'); } catch (err) { saved = {}; }
        var yesterday = isoShift(day, -1);
        var finishedToday = document.body.classList.contains('page-results') || !!document.getElementById('today-play');
        if (saved.last === day) {
            streakNow = Number(saved.streak) || 1;
        } else if (finishedToday) {
            streakNow = saved.last === yesterday ? (Number(saved.streak) || 0) + 1 : 1;
            try { localStorage.setItem('hg-streak', JSON.stringify({ last: day, streak: streakNow })); } catch (err) {}
        } else if (saved.last === yesterday) {
            streakNow = Number(saved.streak) || 0;
        }
        var career = loadCareer();
        if (streakNow > (Number(career.max) || 0)) {
            career.max = streakNow;
            saveCareer(career);
        }
        if (streakNow) {
            var best = Number(loadCareer().max) || streakNow;
            var label = streakNow === 1 ? '1-day streak' : streakNow + '-day streak';
            if (best > streakNow) label += ' · best ' + best;
            streakNodes.forEach(function (node) {
                node.hidden = false;
                node.textContent = label;
            });
        }
        if (
            document.body.classList.contains('page-home')
            && !document.getElementById('today-play')
            && saved.last === yesterday
            && streakNow >= 1
        ) {
            var nextStreak = streakNow + 1;
            var kicker = document.querySelector('.hero .kicker');
            if (kicker && kicker.textContent.trim() === 'A daily round') {
                kicker.textContent = 'Streak on the line';
                kicker.classList.add('is-live');
            }
            var play = document.querySelector('.hero .play-btn');
            if (play && play.getAttribute('href') === '/game' && play.textContent.trim() === 'Play') {
                play.textContent = 'Play · day ' + nextStreak;
                play.classList.add('is-chase');
                play.setAttribute('aria-label', 'Play and make it a ' + nextStreak + '-day streak');
            }
        }
        if (
            document.body.classList.contains('page-home')
            && !document.getElementById('today-play')
            && /^\d{4}-\d{2}-\d{2}$/.test(saved.last || '')
            && saved.last < yesterday
        ) {
            var cold = document.querySelector('.hero .kicker');
            if (cold && cold.textContent.trim() === 'A daily round') {
                cold.textContent = 'Streak snapped';
                cold.classList.add('is-snap');
            }
            var restart = document.querySelector('.hero .play-btn');
            if (restart && restart.getAttribute('href') === '/game' && restart.textContent.trim() === 'Play') {
                restart.textContent = 'Play · day 1';
                restart.classList.add('is-chase');
                restart.setAttribute('aria-label', 'Play and start a 1-day streak');
            }
        }
    }

    var entry = day ? (loadCareer().days || {})[day] : null;
    var paceSaved = {};
    try { paceSaved = JSON.parse(sessionStorage.getItem('hg-pace') || '{}'); } catch (err) { paceSaved = {}; }
    if (entry && entry.ms) {
        var faster = paceSaved.day === day ? (Number(paceSaved.faster) || 0) : 0;
        document.querySelectorAll('.pace').forEach(function (node) {
            node.hidden = false;
            node.textContent = 'in ' + formatPace(entry.ms);
            if (faster >= 1) {
                node.classList.add('is-faster');
                node.textContent += ' · ' + formatPace(faster * 1000) + ' faster';
            }
        });
    }
    if (document.body.classList.contains('page-results')) {
        var runSaved = {};
        try { runSaved = JSON.parse(sessionStorage.getItem('hg-run') || '{}'); } catch (err) { runSaved = {}; }
        var bestStraight = Number(runSaved.best) || 0;
        var scoreBlock = document.querySelector('.score-block');
        if (runSaved.day === day && bestStraight >= 2 && scoreBlock && !scoreBlock.querySelector('.best-run')) {
            var runNode = document.createElement('p');
            runNode.className = 'best-run';
            runNode.textContent = 'Best run ' + bestStraight;
            var paceNode = scoreBlock.querySelector('.pace');
            if (paceNode) paceNode.insertAdjacentElement('afterend', runNode);
            else {
                var scoreNode = scoreBlock.querySelector('.score');
                if (scoreNode) scoreNode.insertAdjacentElement('afterend', runNode);
            }
        }
        var chaseSaved = {};
        try { chaseSaved = JSON.parse(sessionStorage.getItem('hg-chase') || '{}'); } catch (err) { chaseSaved = {}; }
        if (chaseSaved.day === day && scoreBlock && !scoreBlock.querySelector('.new-best')) {
            var fresh = document.createElement('p');
            fresh.className = 'new-best';
            fresh.textContent = chaseSaved.held ? 'Sweep held' : 'New best';
            var scoreRow = scoreBlock.querySelector('.score');
            if (scoreRow) scoreRow.insertAdjacentElement('afterend', fresh);
        }
        var peakSaved = {};
        try { peakSaved = JSON.parse(sessionStorage.getItem('hg-peak') || '{}'); } catch (err) { peakSaved = {}; }
        if (peakSaved.day === day && scoreBlock && !scoreBlock.querySelector('.peak-round')) {
            var peak = document.createElement('p');
            peak.className = 'peak-round';
            peak.textContent = 'Best round';
            var peakAnchor = scoreBlock.querySelector('.new-best') || scoreBlock.querySelector('.score');
            if (peakAnchor) peakAnchor.insertAdjacentElement('afterend', peak);
        }
    }
    paintEarlier();

    var sheet = document.getElementById('stats-sheet');
    var lastFocus = null;
    function openStats(event) {
        if (!sheet) return;
        paintDesk();
        lastFocus = event.currentTarget;
        sheet.hidden = false;
        var close = document.getElementById('stats-close');
        if (close && close.focus) close.focus();
        if (window.HGSound) HGSound.tick();
    }
    function closeStats() {
        if (!sheet || sheet.hidden) return;
        sheet.hidden = true;
        if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    document.querySelectorAll('.stats-open').forEach(function (button) {
        button.addEventListener('click', openStats);
    });
    var closeButton = document.getElementById('stats-close');
    if (closeButton) closeButton.addEventListener('click', closeStats);
    if (sheet) {
        sheet.addEventListener('click', function (event) {
            if (event.target === sheet) closeStats();
        });
    }
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') closeStats();
        if (event.key !== 'Tab' || !sheet || sheet.hidden) return;
        var nodes = sheet.querySelectorAll('button, a');
        if (!nodes.length) return;
        var first = nodes[0];
        var last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });
})();
