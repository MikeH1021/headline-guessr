(function () {
    var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
    if (!cards.length) return;

    var index = 0;
    var busy = false;
    var holding = false;
    var scoring = false;
    var holdTimer = null;
    var correctCount = 0;
    var run = 0;
    var bestRun = 0;
    var prior = null;
    var chaseNode = null;
    var chaseNoted = false;
    var chaseSlipped = false;
    var ghostMs = 0;
    var count = document.getElementById('count');
    var tally = document.getElementById('tally');
    var pips = Array.prototype.slice.call(document.querySelectorAll('.pip'));
    var form = document.getElementById('game-form');
    var total = cards.length;
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var roundDay = document.body.getAttribute('data-round-day') || '';
    var clockTimer = null;
    var attemptId = String(Date.now());
    document.documentElement.style.setProperty('--hold', (reduce ? 480 : 1200) + 'ms');

    function readClock() {
        try { return JSON.parse(sessionStorage.getItem('hg-clock') || '{}'); } catch (err) { return {}; }
    }

    function writeClock(saved) {
        try { sessionStorage.setItem('hg-clock', JSON.stringify(saved)); } catch (err) {}
    }

    function clockHere(saved) {
        return saved.day === roundDay && saved.attempt === attemptId;
    }

    function liveMs(saved) {
        var elapsed = saved.elapsed || 0;
        if (!saved.runningSince) return Math.max(0, elapsed);
        var end = saved.hiddenAt || Date.now();
        return Math.max(0, elapsed + (end - saved.runningSince));
    }

    function freezeClock() {
        var saved = readClock();
        if (!saved.runningSince || !clockHere(saved)) return;
        saved.elapsed = liveMs(saved);
        delete saved.runningSince;
        delete saved.hiddenAt;
        writeClock(saved);
    }

    document.addEventListener('visibilitychange', function () {
        var saved = readClock();
        if (!saved.runningSince || !clockHere(saved)) return;
        if (document.hidden) {
            if (!saved.hiddenAt) {
                saved.hiddenAt = Date.now();
                writeClock(saved);
            }
            return;
        }
        if (saved.hiddenAt) {
            saved.runningSince += Math.max(0, Date.now() - saved.hiddenAt);
            delete saved.hiddenAt;
            writeClock(saved);
            paintLive();
        }
    });

    window.addEventListener('pagehide', freezeClock);

    window.addEventListener('pageshow', function (event) {
        if (!event.persisted) return;
        var saved = readClock();
        if (!clockHere(saved) || saved.runningSince) return;
        saved.runningSince = Date.now();
        writeClock(saved);
        paintLive();
    });

    function paintLive() {
        var node = document.getElementById('pace-live');
        var saved = readClock();
        if (!node || !saved.runningSince || !clockHere(saved)) return;
        var ms = liveMs(saved);
        var seconds = Math.max(0, Math.floor(ms / 1000));
        node.hidden = false;
        node.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
        node.classList.toggle('is-under', index === total - 1 && ahead(ms) >= 1);
    }

    function startClock() {
        var saved = readClock();
        if (!(saved.runningSince && clockHere(saved))) {
            writeClock({ day: roundDay, attempt: attemptId, elapsed: 0, runningSince: Date.now() });
        }
        paintLive();
        if (!clockTimer) clockTimer = window.setInterval(paintLive, 250);
    }

    function readGhost() {
        try {
            var data = JSON.parse(localStorage.getItem('hg-career') || '{}');
            var row = data && data.days ? data.days[roundDay] : null;
            var ms = Number(row && row.ms);
            var savedTotal = Number(row && row.total);
            if (savedTotal === total && ms >= 1000) ghostMs = ms;
        } catch (err) {}
    }

    function ahead(ms) {
        if (!(ghostMs >= 1000) || !(ms > 0) || ms >= ghostMs) return 0;
        var gap = Math.round(ghostMs / 1000) - Math.round(ms / 1000);
        return gap >= 1 ? gap : 0;
    }

    function storePace() {
        var saved = readClock();
        if (saved.day !== roundDay) return;
        var ms = liveMs(saved);
        if (!(ms > 0)) return;
        try {
            sessionStorage.setItem('hg-pace', JSON.stringify({ day: roundDay, ms: ms, faster: ahead(ms) }));
        } catch (err) {}
    }

    function updateProgress() {
        if (count) count.textContent = (index + 1) + ' of ' + total;
        pips.forEach(function (pip, pipIndex) {
            pip.classList.toggle('is-done', pipIndex < index);
            pip.classList.toggle('is-current', pipIndex === index);
        });
    }

    function paintRun() {
        var start = run >= 2 ? index - run + 1 : -1;
        pips.forEach(function (pip, pipIndex) {
            pip.classList.toggle('is-straight', start >= 0 && pipIndex >= start && pipIndex <= index);
        });
        if (!tally) return;
        var snapped = tally.classList.contains('is-snap');
        tally.textContent = correctCount + ' right';
        tally.classList.toggle('is-hot', correctCount > 0);
        tally.classList.toggle('is-run', run >= 2);
        tally.classList.remove('is-pop');
        tally.classList.remove('is-snap');
        void tally.offsetWidth;
        if (run >= 2) tally.classList.add('is-pop');
        else if (snapped) tally.classList.add('is-snap');
    }

    function storeRun() {
        try {
            if (bestRun >= 2) sessionStorage.setItem('hg-run', JSON.stringify({ day: roundDay, best: bestRun }));
            else sessionStorage.removeItem('hg-run');
        } catch (err) {}
    }

    function readPrior() {
        if (!form) return;
        if (form.hasAttribute('data-prior')) {
            var score = Number(form.getAttribute('data-prior'));
            if (score >= 1 && score <= total) prior = score;
            return;
        }
        try {
            var data = JSON.parse(localStorage.getItem('hg-career') || '{}');
            var row = data && data.days ? data.days[roundDay] : null;
            var savedScore = Number(row && row.score);
            var savedTotal = Number(row && row.total);
            if (savedTotal === total && savedScore >= 1 && savedScore <= total) prior = savedScore;
        } catch (err) {}
    }

    function paintChase() {
        if (prior == null) return;
        if (!chaseNode) chaseNode = document.getElementById('chase');
        if (!chaseNode) {
            var progress = document.querySelector('.progress');
            if (!progress) return;
            chaseNode = document.createElement('p');
            chaseNode.className = 'chase';
            chaseNode.id = 'chase';
            chaseNode.setAttribute('aria-live', 'polite');
            progress.insertAdjacentElement('beforebegin', chaseNode);
        }
        var holding = prior === total;
        if (holding && chaseSlipped) {
            chaseNode.hidden = true;
            return;
        }
        var swept = holding && correctCount === total;
        var beaten = !holding && correctCount > prior;
        var label = swept ? 'Sweep held' : (beaten ? 'New best' : (holding ? 'Hold the sweep' : 'Beat ' + prior));
        if (chaseNode.textContent !== label) {
            chaseNode.hidden = false;
            chaseNode.textContent = label;
            if (swept || beaten) {
                chaseNode.classList.remove('is-beat');
                void chaseNode.offsetWidth;
                chaseNode.classList.add('is-beat');
            }
        }
        if ((swept || beaten) && !chaseNoted) {
            chaseNoted = true;
            if (window.HGSound && HGSound.best) HGSound.best();
            try { if (navigator.vibrate) navigator.vibrate([10, 40, 16]); } catch (err) {}
        }
    }

    function storeChase() {
        try {
            if (prior == null) return;
            var held = prior === total && correctCount === total;
            var beat = held || correctCount > prior;
            var existing = JSON.parse(sessionStorage.getItem('hg-chase') || '{}');
            if (!beat) {
                if (existing.day === roundDay) sessionStorage.removeItem('hg-chase');
                return;
            }
            sessionStorage.setItem('hg-chase', JSON.stringify({ day: roundDay, held: held }));
        } catch (err) {}
    }

    function paintLock(card, value) {
        var lock = card.querySelector('.lock');
        var base = lock.getAttribute('data-label') || 'Lock in';
        lock.textContent = value ? base + ' · ' + value : base;
        lock.classList.toggle('is-ready', !!value);
    }

    function selectChoice(card, value) {
        var select = card.querySelector('select');
        select.value = value || '';
        card.querySelectorAll('.choice').forEach(function (button) {
            var on = button.getAttribute('data-value') === select.value;
            button.classList.toggle('is-selected', on);
            button.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        card.querySelector('.miss').textContent = '';
        card.classList.remove('is-shake');
        paintLock(card, select.value);
        if (value) {
            startClock();
            if (window.HGSound) HGSound.tick();
        }
    }

    function showMiss(card) {
        var miss = card.querySelector('.miss');
        miss.textContent = '';
        card.classList.remove('is-shake');
        void card.offsetWidth;
        miss.textContent = 'Pick one before you lock it in.';
        card.classList.add('is-shake');
        if (window.HGSound) HGSound.miss();
    }

    function focusHeadline(card) {
        var headline = card.querySelector('.headline');
        if (headline && headline.focus) headline.focus({ preventScroll: true });
    }

    function fitLock(card) {
        var lock = card.querySelector('.lock');
        if (!lock || !lock.getBoundingClientRect) return;
        var box = lock.getBoundingClientRect();
        if (box.bottom > window.innerHeight - 8 || box.top < 0) {
            lock.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        }
    }

    function holdMs() {
        return reduce ? 480 : 1200;
    }

    function reveal(card) {
        var answer = card.getAttribute('data-answer') || '';
        var picked = card.querySelector('select').value;
        var correct = !!answer && picked === answer;
        card.classList.add('is-revealed');
        card.querySelectorAll('.choice').forEach(function (button) {
            button.disabled = true;
            var value = button.getAttribute('data-value');
            if (answer && value === answer) button.classList.add('is-right');
            else if (value === picked) button.classList.add('is-wrong');
        });
        var note = card.querySelector('.miss');
        note.classList.toggle('is-right', correct);
        if (correct) {
            correctCount += 1;
            run += 1;
            if (run > bestRun) bestRun = run;
        } else {
            if (run >= 2 && tally) tally.classList.add('is-snap');
            run = 0;
            if (prior === total) chaseSlipped = true;
        }
        note.classList.toggle('is-run', correct && run >= 2);
        note.textContent = correct
            ? (run >= 2 ? 'Right. ' + run + ' straight.' : 'Right.')
            : 'Wrong. ' + answer + '.';
        var lock = card.querySelector('.lock');
        lock.textContent = index === total - 1 ? 'See rank' : 'Next';
        lock.classList.toggle('is-right', correct);
        lock.classList.toggle('is-wrong', !correct);
        if (pips[index]) pips[index].classList.add(correct ? 'is-right' : 'is-wrong');
        paintRun();
        if (lock.scrollIntoView) lock.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
        var wrap = document.querySelector('.stage-wrap');
        if (wrap) {
            wrap.classList.add('is-flipping');
            window.setTimeout(function () { wrap.classList.remove('is-flipping'); }, reduce ? 40 : 720);
        }
        paintChase();
        if (window.HGSound) {
            if (correct) {
                HGSound.right();
                if (run >= 2 && HGSound.straight) HGSound.straight(run);
            } else HGSound.wrong();
        }
    }

    function armHold() {
        holding = true;
        var lock = cards[index].querySelector('.lock');
        if (lock) lock.classList.add('is-holding');
        if (holdTimer) window.clearTimeout(holdTimer);
        holdTimer = window.setTimeout(releaseHold, holdMs());
    }

    function releaseHold() {
        if (!holding) return;
        holding = false;
        var lock = cards[index].querySelector('.lock');
        if (lock) lock.classList.remove('is-holding');
        if (holdTimer) {
            window.clearTimeout(holdTimer);
            holdTimer = null;
        }
        if (index === total - 1) beginScore();
        else commitNext();
    }

    function commitNext() {
        var current = cards[index];
        var upcoming = cards[index + 1];
        if (!upcoming) return;
        if (window.HGSound) HGSound.next();
        current.classList.add('is-locked');
        current.classList.remove('is-active');
        current.classList.add('is-leaving');
        index += 1;
        upcoming.classList.add('is-active');
        updateProgress();
        var wrap = document.querySelector('.stage-wrap');
        if (wrap) wrap.scrollTop = 0;
        focusHeadline(upcoming);
        fitLock(upcoming);

        var finished = false;
        function done(event) {
            if (event && event.target !== current) return;
            if (finished) return;
            finished = true;
            current.classList.remove('is-leaving');
            current.classList.remove('is-locked');
            busy = false;
        }
        current.addEventListener('animationend', done);
        window.setTimeout(done, reduce ? 40 : 520);
    }

    function showNext() {
        if (!cards[index + 1]) return;
        busy = true;
        reveal(cards[index]);
        armHold();
    }

    cards.forEach(function (card) {
        card.querySelectorAll('.choice').forEach(function (button) {
            button.addEventListener('click', function () {
                if (busy || card !== cards[index]) return;
                selectChoice(card, button.getAttribute('data-value'));
            });
        });
        card.querySelector('select').addEventListener('change', function () {
            selectChoice(card, this.value);
        });
    });

    function showStamp(title, line, tier) {
        var stamp = document.createElement('div');
        stamp.className = 'stamp' + (tier ? ' is-' + tier : '');
        stamp.setAttribute('role', 'status');
        var grain = document.createElement('div');
        grain.className = 'stamp-grain';
        grain.setAttribute('aria-hidden', 'true');
        stamp.appendChild(grain);
        var row = document.querySelector('.pips');
        if (row) {
            var clone = row.cloneNode(true);
            clone.className = 'pips stamp-pips';
            stamp.appendChild(clone);
        }
        var score = document.createElement('p');
        score.className = 'stamp-score';
        score.textContent = correctCount + ' / ' + total;
        var kicker = document.createElement('p');
        kicker.className = 'kicker';
        kicker.textContent = 'You are';
        var heading = document.createElement('p');
        heading.className = 'stamp-title' + (tier === 'machine' ? ' is-machine' : '');
        heading.textContent = title;
        var note = document.createElement('p');
        note.className = 'stamp-line';
        note.textContent = line || '';
        stamp.appendChild(score);
        try {
            var chase = JSON.parse(sessionStorage.getItem('hg-chase') || '{}');
            if (chase.day === roundDay) {
                var bestLine = document.createElement('p');
                bestLine.className = 'stamp-best';
                bestLine.textContent = chase.held ? 'Sweep held' : 'New best';
                stamp.appendChild(bestLine);
            }
        } catch (err) {}
        stamp.appendChild(kicker);
        stamp.appendChild(heading);
        stamp.appendChild(note);
        try {
            var pace = JSON.parse(sessionStorage.getItem('hg-pace') || '{}');
            if (pace.day === roundDay && Number(pace.ms) > 0) {
                var totalSeconds = Math.max(1, Math.round(Number(pace.ms) / 1000));
                var minutes = Math.floor(totalSeconds / 60);
                var seconds = totalSeconds % 60;
                var paceLine = document.createElement('p');
                paceLine.className = 'stamp-pace';
                var paceText = minutes > 0
                    ? 'in ' + minutes + 'm ' + String(seconds).padStart(2, '0') + 's'
                    : 'in ' + seconds + 's';
                var faster = Number(pace.faster) || 0;
                if (faster >= 1) {
                    paceLine.classList.add('is-faster');
                    var fastMin = Math.floor(faster / 60);
                    var fastSec = faster % 60;
                    paceText += fastMin > 0
                        ? ' · ' + fastMin + 'm ' + String(fastSec).padStart(2, '0') + 's faster'
                        : ' · ' + fastSec + 's faster';
                }
                paceLine.textContent = paceText;
                stamp.appendChild(paceLine);
            }
        } catch (err) {}
        if (bestRun >= 2) {
            var runLine = document.createElement('p');
            runLine.className = 'stamp-run';
            runLine.textContent = 'Best run ' + bestRun;
            stamp.appendChild(runLine);
        }
        document.body.appendChild(stamp);
        return stamp;
    }

    form.addEventListener('submit', function (event) {
        if (holding) {
            event.preventDefault();
            releaseHold();
            return;
        }
        var select = cards[index].querySelector('select');
        if (busy || index !== total - 1 || !select.value) {
            event.preventDefault();
            if (!select.value && !busy) showMiss(cards[index]);
            return;
        }
        event.preventDefault();
        busy = true;
        reveal(cards[index]);
        if (window.HGSound) HGSound.resume();
        armHold();
    });

    function beginScore() {
        if (scoring) return;
        scoring = true;
        var lock = cards[index].querySelector('.lock');
        cards[index].classList.add('is-locked');
        lock.textContent = 'Scoring';
        storePace();
        storeRun();
        storeChase();
        scoreRound();
    }

    function scoreRound() {
        fetch(form.action, {
            method: 'POST',
            body: new FormData(form),
            credentials: 'same-origin',
            headers: { 'Accept': 'text/html' },
        }).then(function (response) {
            if (!response.ok) throw new Error('score failed');
            return response.text();
        }).then(function (html) {
            var doc = new DOMParser().parseFromString(html, 'text/html');
            var titleNode = doc.querySelector('.rank-title');
            if (!titleNode) {
                window.location.href = '/game';
                return;
            }
            var tier = titleNode.getAttribute('data-tier');
            var lineNode = doc.querySelector('.rank-line');
            var wait = 700;
            try {
                if (window.HGSound) wait = HGSound.finish(tier) || wait;
            } catch (err) {}
            var stamp = showStamp(titleNode.textContent, lineNode ? lineNode.textContent : '', tier);
            if (doc.querySelector('.perfect') && stamp) {
                var sweep = document.createElement('p');
                sweep.className = 'perfect';
                sweep.textContent = 'Clean sweep';
                stamp.insertBefore(sweep, stamp.firstChild);
                var scraps = document.createElement('div');
                scraps.className = 'scraps';
                scraps.setAttribute('aria-hidden', 'true');
                for (var scrap = 0; scrap < 16; scrap += 1) {
                    scraps.appendChild(document.createElement('span')).className = 'scrap';
                }
                stamp.insertBefore(scraps, stamp.firstChild);
            }
            try { sessionStorage.setItem('hg-stung', '1'); } catch (err) {}
            window.setTimeout(function () {
                window.location.href = '/results';
            }, wait);
        }).catch(function () {
            busy = false;
            form.submit();
        });
    }

    form.addEventListener('click', function (event) {
        var button = event.target.closest('.lock');
        if (!button) return;
        if (holding) {
            event.preventDefault();
            releaseHold();
            return;
        }
        if (busy) return;
        var card = cards[index];
        var select = card.querySelector('select');
        if (!select.value) {
            event.preventDefault();
            showMiss(card);
            return;
        }
        if (index === total - 1) return;
        event.preventDefault();
        showNext();
    });

    form.addEventListener('keydown', function (event) {
        if (holding && event.key === 'Enter') {
            event.preventDefault();
            releaseHold();
            return;
        }
        if (busy) return;
        var card = cards[index];
        if (event.key >= '1' && event.key <= '5') {
            var choice = card.querySelectorAll('.choice')[Number(event.key) - 1];
            if (!choice) return;
            event.preventDefault();
            selectChoice(card, choice.getAttribute('data-value'));
            return;
        }
        if (event.key !== 'Enter') return;
        var pressed = event.target.closest && event.target.closest('.choice');
        var select = card.querySelector('select');
        if (pressed && pressed.getAttribute('data-value') !== select.value) return;
        if (!select.value) {
            event.preventDefault();
            showMiss(card);
            return;
        }
        event.preventDefault();
        card.querySelector('.lock').click();
    });

    readGhost();
    readPrior();
    paintChase();
    updateProgress();
    fitLock(cards[0]);
    if (readClock().day === roundDay && readClock().start) {
        paintLive();
        clockTimer = window.setInterval(paintLive, 250);
    }
    try {
        sessionStorage.removeItem('hg-stung');
        sessionStorage.removeItem('hg-rum-done');
    } catch (err) {}
    if (window.HGSound) HGSound.mountToggle();
    if (form.focus) form.focus({ preventScroll: true });
})();
