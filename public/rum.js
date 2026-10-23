(function () {
    var who = '';
    try {
        who = localStorage.getItem('hg-who') || '';
        if (!/^[a-z0-9]{6,16}$/.test(who)) {
            who = (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).replace(/[^a-z0-9]/g, '').slice(0, 10);
            localStorage.setItem('hg-who', who);
        }
    } catch (err) {
        who = '';
    }

    function send(body) {
        body.who = who;
        body.path = location.pathname;
        var payload = JSON.stringify(body);
        try {
            if (navigator.sendBeacon) {
                var blob = new Blob([payload], { type: 'application/json' });
                if (navigator.sendBeacon('/rum', blob)) return;
            }
        } catch (err) {}
        try {
            fetch('/rum', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload,
                keepalive: true,
            }).catch(function () {});
        } catch (err) {}
    }

    send({
        kind: 'view',
        w: window.innerWidth,
        h: window.innerHeight,
        theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    });

    var loadMs = 0;
    var lcp = 0;
    var inp = 0;
    var cls = 0;
    window.addEventListener('load', function () {
        try {
            var nav = performance.getEntriesByType('navigation')[0];
            if (nav && nav.loadEventEnd) loadMs = Math.round(nav.loadEventEnd);
        } catch (err) {}
        window.setTimeout(sendVitals, 1200);
    });
    try {
        var lcpObserver = new PerformanceObserver(function (list) {
            var entries = list.getEntries();
            var last = entries[entries.length - 1];
            if (last && last.startTime) lcp = last.startTime;
        });
        lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (err) {}
    try {
        var clsObserver = new PerformanceObserver(function (list) {
            list.getEntries().forEach(function (entry) {
                if (!entry.hadRecentInput) cls += entry.value;
            });
        });
        clsObserver.observe({ type: 'layout-shift', buffered: true });
    } catch (err) {}
    try {
        var inpObserver = new PerformanceObserver(function (list) {
            list.getEntries().forEach(function (entry) {
                if (entry.duration > inp) inp = entry.duration;
            });
        });
        inpObserver.observe({ type: 'event', buffered: true, durationThreshold: 40 });
    } catch (err) {}

    function sendVitals() {
        var body = { kind: 'vital', cls: Math.round(cls * 1000) / 1000 };
        if (loadMs) body.load = loadMs;
        if (lcp) body.lcp = Math.round(lcp);
        if (inp) body.inp = Math.round(inp);
        send(body);
    }
    window.addEventListener('pagehide', sendVitals);

    window.addEventListener('error', function (event) {
        var message = event && event.message ? String(event.message) : '';
        if (!message || message === 'Script error.') return;
        if (/Minified React error #418|Hydration failed/.test(message)) return;
        send({ kind: 'error', message: message.slice(0, 180) });
    });

    if (document.body.classList.contains('page-results')) {
        var done = '';
        var stung = '';
        try {
            done = sessionStorage.getItem('hg-rum-done') || '';
            stung = sessionStorage.getItem('hg-stung') || '';
        } catch (err) {}
        if (stung === '1' && done !== '1') {
            try { sessionStorage.setItem('hg-rum-done', '1'); } catch (err) {}
            var number = document.querySelector('.score-num');
            var of = document.querySelector('.score-of');
            var ms = 0;
            try {
                var pace = JSON.parse(sessionStorage.getItem('hg-pace') || '{}');
                if (Number(pace.ms) > 0) ms = Number(pace.ms);
            } catch (err) {}
            var body = {
                kind: 'finish',
                score: number ? Number(number.getAttribute('data-score')) : 0,
                total: of ? parseInt(String(of.textContent).replace(/\D/g, ''), 10) || 0 : 0,
            };
            if (ms > 0 && ms <= 15 * 60 * 1000) body.ms = Math.round(ms);
            send(body);
        }
    }
})();
