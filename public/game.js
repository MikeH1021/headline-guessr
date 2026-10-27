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
    var freshStart = false;
    var rebuilding = false;
    var showBack = false;
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
        var up = index === total - 1 && ahead(ms) >= 1;
        var back = index === total - 1 && !up && behind(ms) >= 1;
        node.classList.toggle('is-under', up);
        node.classList.toggle('is-over', back);
        paintRace();
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

    function behind(ms) {
        if (!(ghostMs >= 1000) || !(ms > 0) || ms <= ghostMs) return 0;
        var gap = Math.round(ms / 1000) - Math.round(ghostMs / 1000);
        return gap >= 1 ? gap : 0;
    }

    function paintRace() {
        var node = document.getElementById('race');
        if (!node) {
            var progress = document.querySelector('.progress');
            if (!progress) return;
            node = document.createElement('p');
            node.className = 'race';
            node.id = 'race';
            node.hidden = true;
            progress.insertAdjacentElement('beforebegin', node);
        }
        var saved = readClock();
        var ms = saved.runningSince && clockHere(saved) ? liveMs(saved) : 0;
        var last = index === total - 1;
        var up = last ? ahead(ms) : 0;
        var back = last && !up ? behind(ms) : 0;
        var label = up >= 1 ? up + 's faster' : (back >= 1 ? back + 's behind' : '');
        if (!label) {
            node.hidden = true;
            node.classList.remove('is-faster');
            node.classList.remove('is-behind');
            node.removeAttribute('data-side');
            return;
        }
        var side = up >= 1 ? 'up' : 'back';
        var flipped = node.getAttribute('data-side') !== side;
        node.hidden = false;
        node.textContent = label;
        node.setAttribute('data-side', side);
        node.classList.toggle('is-faster', side === 'up');
        node.classList.toggle('is-behind', side === 'back');
        if (flipped) {
            node.classList.remove('is-pop');
            void node.offsetWidth;
            node.classList.add('is-pop');
        }
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
        var last = index === total - 1;
        if (count) {
            var label = last ? 'Last' : (index + 1) + ' of ' + total;
            var changed = count.textContent !== label;
            count.textContent = label;
            if (last && changed) {
                count.classList.remove('is-last');
                void count.offsetWidth;
            }
            count.classList.toggle('is-last', last);
        }
        pips.forEach(function (pip, pipIndex) {
            pip.classList.toggle('is-done', pipIndex < index);
            pip.classList.toggle('is-current', pipIndex === index);
            pip.classList.toggle('is-last', last && pipIndex === index && !pip.classList.contains('is-right') && !pip.classList.contains('is-wrong'));
        });
        paintRace();
    }

    function paintRun() {
        var start = run >= 2 ? index - run + 1 : -1;
        pips.forEach(function (pip, pipIndex) {
            pip.classList.toggle('is-straight', start >= 0 && pipIndex >= start && pipIndex <= index);
        });
        if (!tally) return;
        var snapped = tally.classList.contains('is-snap');
        var streak = run >= 2;
        tally.classList.toggle('is-hot', correctCount > 0);
        tally.classList.toggle('is-run', streak);
        tally.classList.toggle('is-back', showBack && !streak);
        tally.classList.remove('is-pop');
        tally.classList.remove('is-snap');
        if (streak) {
            tally.setAttribute('aria-label', 'Streak of ' + run);
            tally.textContent = '';
            var fire = document.createElement('span');
            fire.className = 'streak-fire';
            fire.setAttribute('aria-hidden', 'true');
            fire.textContent = '🔥';
            tally.appendChild(fire);
            tally.appendChild(document.createTextNode('Streak'));
        } else if (showBack) {
            tally.setAttribute('aria-label', 'Back in');
            tally.textContent = 'Back';
        } else {
            tally.removeAttribute('aria-label');
            tally.textContent = correctCount + ' right';
        }
        void tally.offsetWidth;
        if (streak) {
            tally.classList.add('is-pop');
            var flame = tally.querySelector('.streak-fire');
            if (flame) flame.classList.add('is-lit');
        } else if (showBack) {
            tally.classList.add('is-pop');
        } else if (snapped && run === 0) tally.classList.add('is-snap');
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
        function markSlip() {
            var first = !chaseNode.classList.contains('is-slip');
            chaseNode.hidden = false;
            chaseNode.textContent = 'Slipped';
            chaseNode.classList.remove('is-beat');
            chaseNode.classList.remove('is-close');
            if (!first) return;
            chaseNode.classList.remove('is-slip');
            void chaseNode.offsetWidth;
            chaseNode.classList.add('is-slip');
        }
        var holding = prior === total;
        var revealed = cards[index] && cards[index].classList.contains('is-revealed');
        var left = revealed ? total - index - 1 : total - index;
        var swept = holding && correctCount === total;
        var beaten = !holding && correctCount > prior;
        var closing = !holding && !beaten && correctCount === prior && left >= 1;
        if (holding && chaseSlipped) {
            markSlip();
            return;
        }
        if (!holding && !beaten && correctCount + left <= prior) {
            markSlip();
            return;
        }
        var label = swept ? 'Sweep held' : (beaten ? 'New best' : (closing ? 'One away' : (holding ? 'Hold the sweep' : 'Beat ' + prior)));
        if (chaseNode.textContent !== label) {
            chaseNode.hidden = false;
            chaseNode.textContent = label;
            chaseNode.classList.remove('is-beat');
            chaseNode.classList.remove('is-close');
            chaseNode.classList.remove('is-slip');
            if (swept || beaten || closing) {
                void chaseNode.offsetWidth;
                chaseNode.classList.add(swept || beaten ? 'is-beat' : 'is-close');
            }
        }
        if ((swept || beaten) && !chaseNoted) {
            chaseNoted = true;
            if (window.HGSound && HGSound.best) HGSound.best();
            try { if (navigator.vibrate) navigator.vibrate([10, 40, 16]); } catch (err) {}
        }
    }

    function storePeak() {
        try {
            var data = JSON.parse(localStorage.getItem('hg-career') || '{}');
            var days = data && data.days ? data.days : {};
            var bestOther = -1;
            var otherDays = 0;
            var todayScore = -1;
            Object.keys(days).forEach(function (key) {
                var row = days[key];
                var rowTotal = Number(row && row.total);
                var rowScore = Math.max(Number(row && row.score) || 0, Number(row && row.best) || 0);
                if (rowTotal !== total || rowScore < 0 || rowScore > rowTotal) return;
                if (key === roundDay) {
                    todayScore = rowScore;
                    return;
                }
                otherDays += 1;
                if (rowScore > bestOther) bestOther = rowScore;
            });
            var ceiling = bestOther;
            if (todayScore > ceiling) ceiling = todayScore;
            if (!(otherDays > 0 && correctCount > ceiling)) {
                var existing = JSON.parse(sessionStorage.getItem('hg-peak') || '{}');
                if (existing.day === roundDay) sessionStorage.removeItem('hg-peak');
                return;
            }
            sessionStorage.setItem('hg-peak', JSON.stringify({ day: roundDay }));
        } catch (err) {}
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

    function oneAway(card) {
        if (prior == null || prior === total || correctCount !== prior) return false;
        if (!card || card !== cards[index] || card.classList.contains('is-revealed')) return false;
        return total - index >= 1;
    }

    function lockBase(card) {
        var lock = card.querySelector('.lock');
        var label = (lock && lock.getAttribute('data-label')) || 'Lock in';
        if (card.classList.contains('is-revealed')) return label;
        if (oneAway(card)) return 'This one';
        if (freshStart && card === cards[index]) return 'Start again';
        if (rebuilding && card === cards[index]) return 'Make 2';
        if (card.classList.contains('is-hot')) return 'Keep it';
        return label;
    }

    function heatCard() {
        cards.forEach(function (card, cardIndex) {
            var live = run >= 2 && cardIndex === index && !card.classList.contains('is-revealed');
            var fresh = freshStart && cardIndex === index && !card.classList.contains('is-revealed') && !oneAway(card);
            var climb = rebuilding && cardIndex === index && !card.classList.contains('is-revealed') && !oneAway(card);
            card.classList.toggle('is-hot', live);
            card.classList.toggle('is-fresh', fresh);
            card.classList.toggle('is-climb', climb);
        });
        var card = cards[index];
        if (!card || card.classList.contains('is-revealed')) return;
        var lock = card.querySelector('.lock');
        var select = card.querySelector('select');
        if (!lock) return;
        lock.classList.toggle('is-one', oneAway(card));
        lock.classList.toggle('is-fresh', freshStart && !oneAway(card));
        lock.classList.toggle('is-climb', rebuilding && !oneAway(card));
        if (select && select.value) return;
        lock.textContent = lockBase(card);
    }

    function paintLock(card, value) {
        var lock = card.querySelector('.lock');
        var base = lockBase(card);
        lock.textContent = value ? base + ' · ' + value : base;
        lock.classList.toggle('is-ready', !!value);
        lock.classList.toggle('is-one', oneAway(card));
        lock.classList.toggle('is-fresh', freshStart && card === cards[index] && !oneAway(card));
        lock.classList.toggle('is-climb', rebuilding && card === cards[index] && !oneAway(card));
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
        if (reduce) return 480;
        if (run >= 3) return 800;
        return 1200;
    }

    function reveal(card) {
        var answer = card.getAttribute('data-answer') || '';
        var picked = card.querySelector('select').value;
        var correct = !!answer && picked === answer;
        var restarting = freshStart && !oneAway(card);
        card.classList.add('is-revealed');
        card.querySelectorAll('.choice').forEach(function (button) {
            button.disabled = true;
            var value = button.getAttribute('data-value');
            if (answer && value === answer) button.classList.add('is-right');
            else if (value === picked) button.classList.add('is-wrong');
        });
        var note = card.querySelector('.miss');
        note.classList.toggle('is-right', correct);
        var broke = 0;
        if (correct) {
            correctCount += 1;
            run += 1;
            if (run > bestRun) bestRun = run;
            freshStart = false;
            showBack = restarting;
            rebuilding = restarting && index < total - 1;
        } else {
            if (run >= 2) broke = run;
            if (broke && tally) tally.classList.add('is-snap');
            run = 0;
            if (prior === total) chaseSlipped = true;
            freshStart = broke > 0;
            showBack = false;
            rebuilding = false;
        }
        note.classList.toggle('is-run', correct && run >= 2);
        note.classList.toggle('is-snap', broke > 0);
        note.classList.toggle('is-back', correct && restarting);
        note.textContent = correct
            ? (restarting ? 'Back in.' : (run >= 2 ? 'Right. ' + run + ' straight.' : 'Right.'))
            : (broke ? 'Snapped at ' + broke + '. ' + answer + '.' : 'Wrong. ' + answer + '.');
        var lock = card.querySelector('.lock');
        lock.textContent = index === total - 1 ? 'See rank' : 'Next';
        lock.classList.toggle('is-right', correct);
        lock.classList.toggle('is-wrong', !correct);
        if (pips[index]) {
            pips[index].classList.add(correct ? 'is-right' : 'is-wrong');
            pips[index].classList.remove('is-last');
        }
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
            } else {
                HGSound.wrong();
                if (broke && HGSound.snap) HGSound.snap();
            }
        }
    }

    function armHold() {
        holding = true;
        var ms = holdMs();
        document.documentElement.style.setProperty('--hold', ms + 'ms');
        var lock = cards[index].querySelector('.lock');
        if (lock) lock.classList.add('is-holding');
        if (holdTimer) window.clearTimeout(holdTimer);
        holdTimer = window.setTimeout(releaseHold, ms);
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
        var landingLast = index + 1 === total - 1;
        if (window.HGSound) {
            if (landingLast && HGSound.last) HGSound.last();
            else HGSound.next();
        }
        current.classList.add('is-locked');
        current.classList.remove('is-active');
        current.classList.add('is-leaving');
        index += 1;
        upcoming.classList.add('is-active');
        updateProgress();
        heatCard();
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

    function dayShift(iso, delta) {
        var when = new Date(iso + 'T12:00:00');
        if (isNaN(when.getTime())) return '';
        when.setDate(when.getDate() + delta);
        return when.getFullYear() + '-'
            + String(when.getMonth() + 1).padStart(2, '0') + '-'
            + String(when.getDate()).padStart(2, '0');
    }

    function streakLine() {
        if (!roundDay || /[?&]day=/.test(location.search)) return null;
        var saved = {};
        try { saved = JSON.parse(localStorage.getItem('hg-streak') || '{}'); } catch (err) { saved = {}; }
        var yesterday = dayShift(roundDay, -1);
        var next = saved.last === roundDay
            ? (Number(saved.streak) || 1)
            : (saved.last === yesterday ? (Number(saved.streak) || 0) + 1 : 1);
        if (!(next >= 1)) return null;
        var best = 0;
        try { best = Number(JSON.parse(localStorage.getItem('hg-career') || '{}').max) || 0; } catch (err) {}
        if (next > best) best = next;
        var label = next === 1 ? '1-day streak' : next + '-day streak';
        if (best > next) label += ' · best ' + best;
        return { label: label, extended: saved.last !== roundDay };
    }

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
        if (correctCount === total - 1 && total > 1) {
            var shortLine = document.createElement('p');
            shortLine.className = 'one-short';
            shortLine.textContent = 'One short';
            stamp.appendChild(shortLine);
        }
        try {
            var chase = JSON.parse(sessionStorage.getItem('hg-chase') || '{}');
            if (chase.day === roundDay) {
                var bestLine = document.createElement('p');
                bestLine.className = 'stamp-best';
                bestLine.textContent = chase.held ? 'Sweep held' : 'New best';
                stamp.appendChild(bestLine);
            }
        } catch (err) {}
        try {
            var peak = JSON.parse(sessionStorage.getItem('hg-peak') || '{}');
            if (peak.day === roundDay) {
                var peakLine = document.createElement('p');
                peakLine.className = 'stamp-peak';
                peakLine.textContent = 'Best round';
                stamp.appendChild(peakLine);
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
        var streak = streakLine();
        if (streak) {
            var streakNode = document.createElement('p');
            streakNode.className = 'stamp-streak' + (streak.extended ? ' is-up' : '');
            streakNode.textContent = streak.label;
            stamp.appendChild(streakNode);
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
        storePeak();
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
