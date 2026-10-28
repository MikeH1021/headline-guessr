(function () {
    if (window.HGSound) {
        HGSound.mountToggle();
        var played = false;
        try { played = sessionStorage.getItem('hg-stung') === '1'; } catch (err) { played = false; }
        if (!played) {
            var title = document.querySelector('.rank-title');
            if (title) {
                var tier = title.getAttribute('data-tier');
                function go() {
                    HGSound.resume();
                    if (HGSound.running()) HGSound.finish(tier);
                }
                go();
                if (!HGSound.running()) {
                    window.addEventListener('pointerdown', function once() {
                        window.removeEventListener('pointerdown', once);
                        go();
                    });
                }
            }
        }
    }

    var number = document.querySelector('.score-num');
    var copy = document.getElementById('copy-result');
    if (copy) {
        copy.addEventListener('click', function () {
            var date = document.querySelector('.dateline');
            var of = document.querySelector('.score-of');
            var tiles = Array.prototype.map.call(document.querySelectorAll('.score-block .share-tile'), function (tile) {
                return tile.classList.contains('is-right') ? '🟩' : '🟥';
            }).join('');
            var title = document.querySelector('.rank-title');
            var pace = document.querySelector('.score-block .pace');
            var bestRun = document.querySelector('.score-block .best-run');
            var fresh = document.querySelector('.score-block .new-best');
            var peak = document.querySelector('.score-block .peak-round');
            var oneShort = document.querySelector('.score-block .one-short');
            var perfect = document.querySelector('.score-block .perfect');
            var streak = document.querySelector('.streak');
            var scoreLine = (number ? (number.getAttribute('data-score') || number.textContent) : '') + (of ? of.textContent.trim() : '');
            if (pace && !pace.hidden && pace.textContent.trim()) scoreLine += ' ' + pace.textContent.trim();
            var text = [
                'Headline Guessr',
                date ? date.textContent.trim() : '',
                scoreLine,
                oneShort ? oneShort.textContent.trim() : '',
                perfect ? perfect.textContent.trim() : '',
                fresh ? fresh.textContent.trim() : '',
                peak ? peak.textContent.trim() : '',
                tiles,
                bestRun ? bestRun.textContent.trim() : '',
                title ? title.textContent.trim() : '',
                streak && !streak.hidden ? streak.textContent.trim() : '',
            ].filter(Boolean).join('\n');
            function done() {
                copy.textContent = 'Copied';
                copy.classList.remove('is-copied');
                void copy.offsetWidth;
                copy.classList.add('is-copied');
                if (window.HGSound) HGSound.tick();
                window.setTimeout(function () {
                    copy.textContent = 'Copy result';
                    copy.classList.remove('is-copied');
                }, 1600);
            }
            function fallback() {
                var area = document.createElement('textarea');
                area.value = text;
                document.body.appendChild(area);
                area.select();
                try { document.execCommand('copy'); } catch (err) {}
                area.remove();
                done();
            }
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
            else fallback();
        });
    }
    if (!number) return;
    var target = Number(number.getAttribute('data-score'));
    if (!target || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var started = performance.now();
    number.textContent = '0';
    function frame(now) {
        var progress = Math.min(1, (now - started) / 640);
        var eased = 1 - Math.pow(1 - progress, 3);
        number.textContent = String(Math.round(eased * target));
        if (progress < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
})();
