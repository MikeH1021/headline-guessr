(function () {
    var STORAGE = 'hg-mute';
    var bus = null;
    var ctx = null;

    function muted() {
        try { return localStorage.getItem(STORAGE) === '1'; } catch (err) { return false; }
    }

    function setMuted(value) {
        try { localStorage.setItem(STORAGE, value ? '1' : '0'); } catch (err) {}
    }

    function context() {
        var AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        if (!ctx) {
            ctx = new AudioCtx();
            var master = ctx.createGain();
            master.gain.value = 0.9;
            var comp = ctx.createDynamicsCompressor();
            comp.threshold.value = -16;
            comp.knee.value = 18;
            comp.ratio.value = 3.2;
            comp.attack.value = 0.003;
            comp.release.value = 0.18;
            master.connect(comp);
            comp.connect(ctx.destination);
            bus = master;
        }
        return ctx;
    }

    function resume() {
        var audio = context();
        if (audio && audio.state === 'suspended') audio.resume();
        return audio;
    }

    function running() {
        return !!(ctx && ctx.state === 'running');
    }

    function voice(audio, when, freq, dur, type, peak, slide) {
        var osc = audio.createOscillator();
        var gain = audio.createGain();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(Math.max(40, freq), when);
        if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slide), when + dur);
        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + Math.min(0.03, dur * 0.25));
        gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
        osc.connect(gain);
        gain.connect(bus);
        osc.start(when);
        osc.stop(when + dur + 0.03);
    }

    function knock(audio, when, dur, peak, freq) {
        var length = Math.max(1, Math.floor(audio.sampleRate * dur));
        var buffer = audio.createBuffer(1, length, audio.sampleRate);
        var data = buffer.getChannelData(0);
        for (var i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
        var src = audio.createBufferSource();
        src.buffer = buffer;
        var filter = audio.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = freq || 1200;
        filter.Q.value = 0.8;
        var gain = audio.createGain();
        gain.gain.setValueAtTime(Math.max(0.0002, peak), when);
        gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(bus);
        src.start(when);
        src.stop(when + dur + 0.02);
    }

    function chord(audio, when, freqs, dur, type, peak) {
        freqs.forEach(function (freq) {
            voice(audio, when, freq, dur, type, peak);
        });
    }

    function tick() {
        if (muted()) return;
        var audio = resume();
        if (!audio) return;
        var now = audio.currentTime;
        knock(audio, now, 0.03, 0.12, 2200);
        voice(audio, now, 740, 0.05, 'triangle', 0.04);
    }

    function next() {
        if (muted()) return;
        var audio = resume();
        if (!audio) return;
        var now = audio.currentTime;
        knock(audio, now, 0.045, 0.22, 900);
        voice(audio, now, 160, 0.09, 'sine', 0.16, 90);
        voice(audio, now + 0.02, 520, 0.11, 'triangle', 0.07, 780);
    }

    function last() {
        if (muted()) return;
        var audio = resume();
        if (!audio) return;
        var now = audio.currentTime;
        knock(audio, now, 0.04, 0.16, 1400);
        voice(audio, now, 880, 0.09, 'triangle', 0.07);
        voice(audio, now + 0.09, 1318, 0.16, 'sine', 0.06);
    }

    function miss() {
        if (muted()) return;
        var audio = resume();
        if (!audio) return;
        var now = audio.currentTime;
        voice(audio, now, 196, 0.16, 'triangle', 0.08, 110);
        knock(audio, now, 0.05, 0.06, 280);
    }

    function right() {
        if (muted()) return;
        var audio = resume();
        if (!audio) return;
        var now = audio.currentTime;
        voice(audio, now, 523, 0.12, 'triangle', 0.1);
        voice(audio, now + 0.07, 659, 0.12, 'triangle', 0.09);
        voice(audio, now + 0.14, 784, 0.16, 'triangle', 0.1);
        voice(audio, now + 0.22, 1046, 0.2, 'sine', 0.06);
        knock(audio, now + 0.14, 0.04, 0.08, 1800);
    }

    function straight(count) {
        if (muted()) return;
        var audio = resume();
        if (!audio) return;
        var now = audio.currentTime;
        // One sine, tuned as a just interval of the C6 (1046 Hz) that right()
        // is still holding. A tempered third is about 14 cents sharp against
        // that note, which is the sour clash. No second voice and no knock.
        var root = 1046;
        var ladder = [root * 5 / 4, root * 3 / 2, root * 2, root * 5 / 2, root * 3, root * 4];
        var index = Math.max(0, Math.min(ladder.length - 1, (count | 0) - 2));
        var quiet = index >= 4;
        voice(audio, now + 0.24, ladder[index], 0.2, 'sine', quiet ? 0.03 : 0.046);
    }

    function best() {
        if (muted()) return;
        var audio = resume();
        if (!audio) return;
        var now = audio.currentTime;
        voice(audio, now + 0.3, 1174, 0.1, 'sine', 0.045);
        voice(audio, now + 0.4, 1568, 0.16, 'triangle', 0.05);
        voice(audio, now + 0.52, 2093, 0.14, 'sine', 0.03);
    }

    function wrong() {
        if (muted()) return;
        var audio = resume();
        if (!audio) return;
        var now = audio.currentTime;
        voice(audio, now, 392, 0.16, 'sawtooth', 0.045, 277);
        voice(audio, now + 0.12, 311, 0.22, 'triangle', 0.08, 185);
        voice(audio, now + 0.16, 233, 0.28, 'sine', 0.05, 140);
        knock(audio, now + 0.02, 0.08, 0.1, 240);
    }

    function playTier(audio, tier) {
        var now = audio.currentTime + 0.02;
        if (tier === 'liberal') {
            voice(audio, now, 466, 0.32, 'sawtooth', 0.05, 311);
            voice(audio, now + 0.28, 349, 0.3, 'sawtooth', 0.045, 247);
            voice(audio, now + 0.56, 220, 0.55, 'triangle', 0.08, 98);
            voice(audio, now + 0.7, 116, 0.4, 'sine', 0.03);
            return 1300;
        }
        if (tier === 'headline') {
            voice(audio, now, 440, 0.28, 'sine', 0.09, 392);
            voice(audio, now + 0.26, 330, 0.4, 'sine', 0.07, 262);
            return 800;
        }
        if (tier === 'normie') {
            voice(audio, now, 523, 0.22, 'sine', 0.1);
            voice(audio, now + 0.2, 659, 0.28, 'sine', 0.09);
            voice(audio, now + 0.42, 784, 0.18, 'triangle', 0.03);
            return 750;
        }
        if (tier === 'squint') {
            voice(audio, now, 392, 0.18, 'triangle', 0.08);
            voice(audio, now + 0.16, 494, 0.18, 'triangle', 0.08);
            voice(audio, now + 0.32, 587, 0.36, 'sine', 0.09);
            voice(audio, now + 0.5, 784, 0.22, 'sine', 0.04);
            return 950;
        }
        if (tier === 'noticer') {
            voice(audio, now, 523, 0.16, 'triangle', 0.08);
            voice(audio, now + 0.14, 659, 0.16, 'triangle', 0.08);
            voice(audio, now + 0.28, 784, 0.2, 'triangle', 0.09);
            chord(audio, now + 0.46, [523, 659, 784], 0.45, 'sine', 0.05);
            voice(audio, now + 0.5, 1568, 0.22, 'sine', 0.04);
            return 1250;
        }
        if (tier === 'autist') {
            [523, 659, 784, 1046].forEach(function (freq, index) {
                voice(audio, now + index * 0.12, freq, 0.2, 'triangle', 0.08);
            });
            chord(audio, now + 0.5, [262, 330, 392, 523], 0.7, 'sine', 0.045);
            voice(audio, now + 0.62, 1568, 0.18, 'sine', 0.04);
            voice(audio, now + 0.78, 2093, 0.16, 'sine', 0.03);
            return 1600;
        }
        [262, 330, 392, 523].forEach(function (freq) {
            voice(audio, now, freq, 0.42, 'triangle', freq < 300 ? 0.1 : 0.06);
        });
        voice(audio, now, 262, 0.42, 'sawtooth', 0.03);
        [523, 659, 784, 1046, 1319, 1568].forEach(function (freq, index) {
            voice(audio, now + 0.16 + index * 0.09, freq, 0.18, 'triangle', 0.07);
        });
        chord(audio, now + 0.78, [262, 330, 392, 523, 784], 0.7, 'sine', 0.05);
        [1568, 1976, 2349, 2637].forEach(function (freq, index) {
            voice(audio, now + 0.9 + index * 0.07, freq, 0.16, 'sine', 0.035);
        });
        voice(audio, now + 1.25, 1200, 0.55, 'sine', 0.03, 2400);
        chord(audio, now + 1.45, [196, 262, 330, 392, 523], 0.8, 'triangle', 0.06);
        return 2300;
    }

    function finish(tier) {
        if (muted()) return 0;
        var audio = resume();
        if (!audio) return 0;
        return Math.max(700, playTier(audio, tier));
    }

    function mountToggle() {
        var bar = document.querySelector('.topbar');
        if (!bar || document.getElementById('sound-toggle')) return;
        var button = document.createElement('button');
        button.type = 'button';
        button.id = 'sound-toggle';
        button.className = 'sound-toggle';
        function paint() {
            var off = muted();
            button.classList.toggle('is-off', off);
            button.setAttribute('aria-pressed', off ? 'true' : 'false');
            button.setAttribute('aria-label', off ? 'Unmute sound' : 'Mute sound');
            button.textContent = off ? 'Muted' : 'Sound';
        }
        button.addEventListener('click', function () {
            resume();
            setMuted(!muted());
            paint();
            if (!muted()) tick();
        });
        var cluster = document.createElement('div');
        cluster.className = 'top-tools';
        var anchor = bar.querySelector('.count, .dateline');
        if (anchor) {
            anchor.parentNode.insertBefore(cluster, anchor);
            cluster.appendChild(anchor);
        } else {
            bar.appendChild(cluster);
        }
        cluster.appendChild(button);
        paint();
    }

    window.HGSound = {
        resume: resume,
        running: running,
        muted: muted,
        tick: tick,
        next: next,
        last: last,
        miss: miss,
        right: right,
        straight: straight,
        best: best,
        wrong: wrong,
        finish: finish,
        mountToggle: mountToggle,
    };
})();
