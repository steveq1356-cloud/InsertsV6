/* InsertPress Planner — a virtual GRBL 1.1 controller.
 *
 * Enough of GRBL to rehearse a job without the machine and to test the
 * streamer: the 128-byte receive buffer, a 15-block planner, ok/error replies,
 * status reports, feed hold, cycle start, soft reset, jogging, G10 L20 origins,
 * G4 dwells, M0 pauses, G38.2/G38.3 probing against a float-sensor function,
 * check mode ($C), and the alarms a press can actually hit.
 *
 *   const g = new IP.VirtualGrbl({ onLine, probe: (x, y, z) => bool })
 *   g.receive('G0 X10\n'); g.receive(0x3f); g.tick(seconds)
 *
 * probe(x, y, z) gets the tip position in work coordinates and returns true
 * while the float sensor is pressed.
 */
(function (root) {
  'use strict';
  const IP = (root.IP = root.IP || {});

  const PLANNER = 15;
  const f3 = (v) => (Math.round(v * 1000) / 1000).toFixed(3);
  const vec = (a) => a.map(f3).join(',');

  class VirtualGrbl {
    constructor(opts) {
      opts = opts || {};
      this.onLine = opts.onLine || (() => {});
      this.probeFn = opts.probe || (() => false);
      this.rxSize = opts.rxSize || 128;
      this.settings = { 0: 10, 1: 25, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 10: 1, 11: 0.01, 12: 0.002, 13: 0, 20: 0, 21: 0, 22: 0,
        23: 0, 24: 25, 25: 500, 26: 250, 27: 1, 30: 1000, 31: 0, 32: 0, 100: 80, 101: 80, 102: 400,
        110: (opts.rapid && opts.rapid.xy) || 1500, 111: (opts.rapid && opts.rapid.xy) || 1500, 112: (opts.rapid && opts.rapid.z) || 400,
        120: 100, 121: 100, 122: 50, 130: 200, 131: 200, 132: 100 };
      this.mpos = (opts.mpos || [0, 0, 0]).slice();
      this.g54 = (opts.g54 || [0, 0, 0]).slice();
      this.prb = [0, 0, 0]; this.prbOk = 0;
      this.maxRx = 0; this.overflow = 0; this.lineCount = 0; this.time = 0;
      this.log = opts.log || null; // optional array of received lines
      this._boot(0);
    }

    /* ---------- output & state ---------- */
    _out(line) { this.onLine(line); }
    get work() { return this.mpos.map((v, i) => v - this.g54[i]); }
    _probeNow() { const w = this.work; return !!this.probeFn(w[0], w[1], w[2]); }
    _moving() { return !this.hold && (this.planner.length > 0 || (this.op && this.op.type === 'probe')); }
    state() {
      if (this.alarm) return 'Alarm';
      if (this.check) return 'Check';
      if (this.op && this.op.type === 'pause') return 'Hold:0';
      if (this.hold) return 'Hold:' + this.holdSub;
      if (this.planner.length && this.planner[0].jog) return 'Jog';
      if (this.planner.length || (this.op && this.op.type !== 'pause')) return 'Run';
      return 'Idle';
    }
    _boot(alarm) {
      this.rx = ''; this.pending = null; this.planner = []; this.op = null;
      this.hold = false; this.holdSub = 0; this.holdT = 0;
      this.modal = { abs: true, motion: 0, feed: 0, scale: 1 };
      this.check = false; this.ov = 100; this.feedNow = 0;
      this.reports = 0; this.wcoSent = null; this.ovSent = null;
      this.alarm = alarm || 0;
      if (alarm) this._out('ALARM:' + alarm);
      this._out("Grbl 1.1h ['$' for help]");
      if (alarm) this._out("[MSG:'$H'|'$X' to unlock]");
    }
    _alarm(code) {
      this.alarm = code; this.planner = []; this.op = null; this.hold = false;
      this._out('ALARM:' + code);
    }

    /* ---------- input ---------- */
    receive(data) {
      if (typeof data === 'number') { this._realtime(data); this._process(); return; }
      if (this.log) this.log.push(data);
      for (let i = 0; i < data.length; i++) {
        const ch = data[i], c = data.charCodeAt(i);
        if (ch === '?' || ch === '!' || ch === '~' || c === 0x18 || c >= 0x80) { this._realtime(c); continue; }
        this.rx += ch;
      }
      const used = this.rx.length + (this.pending != null ? this.pending.length + 1 : 0);
      if (used > this.maxRx) this.maxRx = used;
      if (used > this.rxSize) this.overflow++;
      this._process();
    }

    _realtime(c) {
      if (c === 0x3f) { this._out(this._status()); return; }
      if (c === 0x21) { // feed hold
        if (this.planner.length && this.planner[0].jog) { this.planner = []; return; } // hold cancels a jog
        if (this._moving() || (this.op && this.op.type === 'dwell')) { this.hold = true; this.holdSub = 1; this.holdT = 0.08; }
        else if (!this.alarm && !this.check) { this.hold = true; this.holdSub = 0; }
        return;
      }
      if (c === 0x7e) { // cycle start
        if (this.op && this.op.type === 'pause') { this.op = null; this.hold = false; this._out('ok'); }
        this.hold = false;
        return;
      }
      if (c === 0x18) { this._boot(this._moving() ? 3 : 0); return; }
      if (c === 0x85) { if (this.planner.length && this.planner[0].jog) this.planner = []; return; }
      if (c === 0x90) this.ov = 100;
      else if (c === 0x91) this.ov = Math.min(200, this.ov + 10);
      else if (c === 0x92) this.ov = Math.max(10, this.ov - 10);
      else if (c === 0x93) this.ov = Math.min(200, this.ov + 1);
      else if (c === 0x94) this.ov = Math.max(10, this.ov - 1);
    }

    _status() {
      let s = `<${this.state()}|MPos:${vec(this.mpos)}|FS:${Math.round(this._moving() ? this.feedNow : 0)},0`;
      if (this._probeNow()) s += '|Pn:P';
      this.reports++;
      const wk = this.g54.join();
      if (this.wcoSent !== wk || this.reports % 10 === 1) { s += `|WCO:${vec(this.g54)}`; this.wcoSent = wk; }
      else if (this.ovSent !== this.ov || this.reports % 10 === 5) { s += `|Ov:${this.ov},100,100`; this.ovSent = this.ov; }
      return s + '>';
    }

    _process() {
      for (let guard = 0; guard < 2000; guard++) {
        if (this.op) return;
        let line = this.pending;
        if (line == null) {
          const i = this.rx.indexOf('\n');
          if (i < 0) return;
          line = this.rx.slice(0, i).replace(/\r/g, '');
          this.rx = this.rx.slice(i + 1);
        }
        const r = this._exec(line);
        if (r === 'wait') { this.pending = line; return; }
        this.pending = null;
        if (r) this._out(r);
      }
    }

    /* ---------- commands ---------- */
    _exec(raw) {
      const s = raw.replace(/\s+/g, '').toUpperCase();
      if (!s) return 'ok';
      if (s.length > 80) return 'error:11';
      if (s[0] === '$') return this._system(s);
      if (this.alarm) return 'error:9';
      if (this.planner.length && this.planner[0].jog) return 'wait';
      const w = this._words(s);
      if (typeof w === 'string') return w;
      return this._gcode(w);
    }

    _words(s) {
      const re = /([A-Z])([-+]?(?:\d+\.?\d*|\.\d+))/y;
      const out = [];
      let pos = 0;
      while (pos < s.length) {
        re.lastIndex = pos;
        const m = re.exec(s);
        if (!m) return /[A-Z]/.test(s[pos]) ? 'error:2' : 'error:1';
        out.push({ l: m[1], v: parseFloat(m[2]), s: m[2] });
        pos = re.lastIndex;
      }
      return out;
    }

    _plannedEnd() { return this.planner.length ? this.planner[this.planner.length - 1].to.slice() : this.mpos.slice(); }

    _gcode(w) {
      const g = w.filter((x) => x.l === 'G').map((x) => x.s.replace(/^0+(?=\d)/, ''));
      const m = w.filter((x) => x.l === 'M').map((x) => x.v);
      const val = (l) => { const x = w.find((y) => y.l === l); return x ? x.v : null; };
      const axes = {};
      for (const x of w) if ('XYZ'.includes(x.l)) {
        if (axes[x.l] != null) return 'error:25';
        axes[x.l] = x.v;
      }
      const okG = ['0', '1', '4', '10', '17', '20', '21', '38.2', '38.3', '54', '90', '91', '94'];
      for (const k of g) if (!okG.includes(k)) return 'error:20';
      for (const k of m) if (![0, 1, 2, 3, 4, 5, 8, 9, 30].includes(k)) return 'error:20';
      for (const x of w) if (!'GMXYZFPLNST'.includes(x.l)) return 'error:20';

      const sync = () => this.planner.length > 0;
      if (val('F') != null) this.modal.feed = val('F') * this.modal.scale;
      if (g.includes('20')) this.modal.scale = 25.4;
      if (g.includes('21')) this.modal.scale = 1;
      if (g.includes('90')) this.modal.abs = true;
      if (g.includes('91')) this.modal.abs = false;
      const hasAxes = Object.keys(axes).length > 0;
      const sc = this.modal.scale;

      if (g.includes('10')) {
        const L = val('L'), P = val('P');
        if (L == null || P == null) return 'error:28';
        if (P !== 1 && P !== 0) return 'ok'; // only G54 is modelled
        if (sync()) return 'wait';
        const idx = { X: 0, Y: 1, Z: 2 };
        for (const a in axes) {
          if (L === 20) this.g54[idx[a]] = this.mpos[idx[a]] - axes[a] * sc;
          else if (L === 2) this.g54[idx[a]] = axes[a] * sc;
        }
        return 'ok';
      }
      if (g.includes('4')) {
        const P = val('P');
        if (P == null) return 'error:28';
        if (this.check) return 'ok';
        if (sync()) return 'wait';
        this.op = { type: 'dwell', left: P };
        return null;
      }
      if (m.includes(0) || m.includes(1)) {
        if (this.check) return 'ok';
        if (sync()) return 'wait';
        this.op = { type: 'pause' };
        return null;
      }
      if (m.includes(2) || m.includes(30)) {
        if (sync()) return 'wait';
        this.modal.abs = true; this.modal.motion = 0;
        return 'ok';
      }

      let motion = this.modal.motion;
      for (const k of g) if (['0', '1', '38.2', '38.3'].includes(k)) motion = k === '0' ? 0 : k === '1' ? 1 : k;
      if (typeof motion === 'number') this.modal.motion = motion;
      if (!hasAxes) return 'ok';

      const isProbe = motion === '38.2' || motion === '38.3';
      if (isProbe && sync()) return 'wait';
      if (!isProbe && this.planner.length >= PLANNER) return 'wait';
      const from = this._plannedEnd();
      const to = from.slice();
      const idx = { X: 0, Y: 1, Z: 2 };
      for (const a in axes) {
        const i = idx[a];
        to[i] = this.modal.abs ? axes[a] * sc + this.g54[i] : from[i] + axes[a] * sc;
      }
      if (motion !== 0 && !(this.modal.feed > 0)) return 'error:22';
      if (this.check) return 'ok';
      if (isProbe) {
        if (to.every((v, i) => Math.abs(v - from[i]) < 1e-9)) return 'error:33';
        if (this._probeNow()) { this._alarm(4); return 'ok'; }
        this.planner.push({ to, feed: this.modal.feed, probe: motion });
        this.op = { type: 'probe' };
        return null;
      }
      this.planner.push({ to, feed: motion === 0 ? 0 : this.modal.feed, rapid: motion === 0 });
      return 'ok';
    }

    _system(s) {
      const st = this.state();
      const busy = st === 'Run' || st.startsWith('Hold') || st === 'Jog';
      if (s.startsWith('$J=')) {
        if (this.alarm) return 'error:9';
        if (!(st === 'Idle' || st === 'Jog')) return 'error:8';
        const w = this._words(s.slice(3));
        if (typeof w === 'string') return 'error:16';
        let abs = this.modal.abs, scale = this.modal.scale, feed = null;
        const axes = {};
        for (const x of w) {
          if (x.l === 'G') {
            if (x.v === 91) abs = false; else if (x.v === 90) abs = true;
            else if (x.v === 21) scale = 1; else if (x.v === 20) scale = 25.4;
            else if (x.v !== 53) return 'error:16';
          } else if (x.l === 'F') feed = x.v;
          else if ('XYZ'.includes(x.l)) axes[x.l] = x.v;
          else return 'error:16';
        }
        if (!(feed > 0)) return 'error:22';
        if (this.planner.length >= PLANNER) return 'wait';
        const from = this._plannedEnd(), to = from.slice(), idx = { X: 0, Y: 1, Z: 2 };
        for (const a in axes) to[idx[a]] = abs ? axes[a] * scale + this.g54[idx[a]] : from[idx[a]] + axes[a] * scale;
        this.planner.push({ to, feed: feed * scale, jog: true });
        return 'ok';
      }
      if (s === '$X') {
        if (this.alarm) { this.alarm = 0; this._out('[MSG:Caution: Unlocked]'); }
        return 'ok';
      }
      if (busy) return 'error:8';
      if (s === '$') { this._out('[HLP:$$ $# $G $I $N $x=val $Nx=line $J=line $SLP $C $X $H ~ ! ? ctrl-x]'); return 'ok'; }
      if (s === '$$') { for (const k of Object.keys(this.settings)) this._out(`$${k}=${this.settings[k]}`); return 'ok'; }
      if (s === '$#') {
        this._out(`[G54:${vec(this.g54)}]`);
        for (const n of [55, 56, 57, 58, 59]) this._out(`[G${n}:0.000,0.000,0.000]`);
        this._out('[G28:0.000,0.000,0.000]'); this._out('[G30:0.000,0.000,0.000]');
        this._out('[G92:0.000,0.000,0.000]'); this._out('[TLO:0.000]');
        this._out(`[PRB:${vec(this.prb)}:${this.prbOk}]`);
        return 'ok';
      }
      if (s === '$G') {
        const mo = this.modal.motion === 0 ? 'G0' : this.modal.motion === 1 ? 'G1' : 'G' + this.modal.motion;
        this._out(`[GC:${mo} G54 G17 ${this.modal.scale === 1 ? 'G21' : 'G20'} ${this.modal.abs ? 'G90' : 'G91'} G94 M5 M9 T0 F${Math.round(this.modal.feed)} S0]`);
        return 'ok';
      }
      if (s === '$I') { this._out('[VER:1.1h.20190830:InsertPress simulator]'); this._out('[OPT:VZL,15,128]'); return 'ok'; }
      if (s === '$N') { this._out('$N0='); this._out('$N1='); return 'ok'; }
      if (s === '$H') return 'error:5';
      if (s === '$SLP') return 'ok';
      if (s === '$C') {
        if (this.check) { this._out('[MSG:Disabled]'); this._out('ok'); this._boot(0); return null; }
        if (this.alarm) return 'error:9';
        this.check = true; this._out('[MSG:Enabled]');
        return 'ok';
      }
      let m;
      if ((m = /^\$(\d+)=([-\d.]+)$/.exec(s))) { this.settings[m[1]] = +m[2]; return 'ok'; }
      return 'error:3';
    }

    /* ---------- time ---------- */
    tick(dt) {
      this.time += dt;
      if (this.hold && this.holdSub === 1) { this.holdT -= dt; if (this.holdT <= 0) this.holdSub = 0; }
      if (this.op && this.op.type === 'dwell' && !this.hold) {
        this.op.left -= dt;
        if (this.op.left <= 0) { this.op = null; this._out('ok'); }
      }
      let budget = dt;
      for (let guard = 0; guard < 200 && budget > 1e-9 && !this.hold && !this.alarm && this.planner.length; guard++) {
        const b = this.planner[0];
        const d = b.to.map((v, i) => v - this.mpos[i]);
        const L = Math.hypot(d[0], d[1], d[2]);
        let speed; // mm/s
        if (b.rapid) {
          const rate = [this.settings[110], this.settings[111], this.settings[112]];
          speed = Infinity;
          for (let i = 0; i < 3; i++) if (Math.abs(d[i]) > 1e-9) speed = Math.min(speed, rate[i] / (Math.abs(d[i]) / L));
          if (!isFinite(speed)) speed = rate[0];
          speed /= 60;
        } else speed = (b.feed * (b.jog ? 1 : this.ov / 100)) / 60;
        this.feedNow = speed * 60;
        if (L < 1e-9) { this._finish(b, false); continue; }
        if (b.probe) {
          // creep in small steps so the float sensor is sampled like a real probe cycle
          const step = Math.min(L, speed * budget);
          const n = Math.max(1, Math.ceil(step / 0.01));
          let hit = false;
          for (let k = 1; k <= n; k++) {
            for (let i = 0; i < 3; i++) this.mpos[i] += (d[i] / L) * (step / n);
            if (this._probeNow()) { hit = true; break; }
          }
          budget -= step / speed;
          if (hit) this._finish(b, true);
          else if (step >= L - 1e-9) { this.mpos = b.to.slice(); this._finish(b, false); }
          continue;
        }
        const step = speed * budget;
        if (step >= L) { this.mpos = b.to.slice(); budget -= L / speed; this._finish(b, false); }
        else { for (let i = 0; i < 3; i++) this.mpos[i] += (d[i] / L) * step; budget = 0; }
      }
      if (!this.planner.length) this.feedNow = 0;
      this._process();
    }

    _finish(b, tripped) {
      this.planner.shift();
      if (!b.probe) return;
      this.op = null;
      this.prb = this.mpos.slice(); this.prbOk = tripped ? 1 : 0;
      if (!tripped && b.probe === '38.2') {
        this._alarm(5);
        this._out(`[PRB:${vec(this.prb)}:0]`);
        this._out('ok');
        return;
      }
      this._out(`[PRB:${vec(this.prb)}:${tripped ? 1 : 0}]`);
      this._out('ok');
    }
  }

  IP.VirtualGrbl = VirtualGrbl;
})(typeof window !== 'undefined' ? window : globalThis);
