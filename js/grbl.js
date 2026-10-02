/* InsertPress Planner — GRBL 1.1 protocol. Pure: no DOM, runs in Node for tests.
 *
 *   parse(line)        one line from GRBL -> { type, ... }
 *   prepare(text)      G-code text -> program entries (cleaned commands + hole info)
 *   Machine            latest status: state, work/machine position, float pin, overrides
 *   Streamer           character-counting sender for a whole job
 *   Link               one controller: status, single commands (promises), and the streamer
 *
 * Character counting: GRBL has a 128-byte receive buffer. We keep the bytes of
 * every line GRBL has not answered yet (ok/error) under that, so it never
 * overflows and never starves. Realtime commands (? ! ~ 0x18 0x85 0x9x) are single
 * bytes outside that budget.
 */
(function (root) {
  'use strict';
  const IP = (root.IP = root.IP || {});

  const RX_SIZE = 128;
  const RT = {
    status: 0x3f, hold: 0x21, start: 0x7e, reset: 0x18, jogCancel: 0x85,
    feedReset: 0x90, feedPlus10: 0x91, feedMinus10: 0x92, feedPlus1: 0x93, feedMinus1: 0x94,
  };

  // GRBL 1.1 error codes, in plain words.
  const ERRORS = {
    1: 'A word is missing its letter.',
    2: 'A number is missing or badly formatted.',
    3: 'GRBL does not know that $ command.',
    4: 'A value that must be positive is negative.',
    5: 'Homing is not enabled ($22=0).',
    6: 'Step pulse time must be over 3 µs ($0).',
    7: 'EEPROM read failed; settings were reset to defaults.',
    8: 'That $ command only works while the machine is idle.',
    9: 'G-code is locked out during an alarm or jog. Unlock first.',
    10: 'Soft limits need homing enabled.',
    11: 'Line too long; GRBL skipped it.',
    12: 'Step rate is too high for that setting.',
    13: 'Safety door is open.',
    14: 'Startup line too long for EEPROM.',
    15: 'Jog target is past the machine travel.',
    16: 'Bad jog command.',
    17: 'Laser mode needs PWM output.',
    20: 'Unsupported G-code command.',
    21: 'Two commands from the same group in one line.',
    22: 'No feed rate set (F).',
    23: 'That command needs a whole number.',
    24: 'Two commands in one line both want axis words.',
    25: 'A word is repeated in the line.',
    26: 'The command needs X, Y, or Z and none was given.',
    27: 'Line number out of range.',
    28: 'The command is missing a P or L value.',
    29: 'Only G54 to G59 work offsets exist.',
    30: 'G53 needs G0 or G1 active.',
    31: 'Axis words given while G80 is active.',
    32: 'Arc has no axis words in the plane.',
    33: 'Bad motion target (probe target equals the current position?).',
    34: 'Arc radius math failed.',
    35: 'Arc is missing its offset words.',
    36: 'Leftover words GRBL did not use.',
    37: 'Tool length offset on the wrong axis.',
    38: 'Tool number too large.',
  };

  // GRBL 1.1 alarms, with what they usually mean on this press.
  const ALARMS = {
    1: { text: 'Hard limit triggered.', hint: 'Position is probably lost. Unlock, then re-set the origin before pressing.' },
    2: { text: 'Move target is past the soft limits.', hint: 'Position was kept. Unlock and check the part placement and travel.' },
    3: { text: 'Reset while moving.', hint: 'Steps were likely lost. Unlock and re-set the origin.' },
    4: { text: 'The float sensor read pressed before a probe or press started.', hint: 'Lift the tip off whatever it rests on. If it reads pressed with nothing touching, flip $6 (probe pin invert) or check the wiring on A5.' },
    5: { text: 'Touch-off found nothing within its travel.', hint: 'Start closer to the bed, or raise the touch-off distance on the Machine step.' },
    6: { text: 'Homing was reset mid-cycle.', hint: 'Home again.' },
    7: { text: 'Safety door opened during homing.', hint: 'Close the door and home again.' },
    8: { text: 'Homing could not clear the limit switch.', hint: 'Raise the pull-off ($27) or check the switch wiring.' },
    9: { text: 'Homing could not find a limit switch.', hint: 'Check the switches and $130 to $132.' },
  };

  const errorText = (n) => ERRORS[n] || `Unknown error ${n}.`;
  const alarmInfo = (n) => ALARMS[n] || { text: `Alarm ${n}.`, hint: '' };
  const nums = (s) => s.split(',').map(Number);

  /* ---------- responses ---------- */

  function parseStatus(body) {
    const parts = body.split('|');
    const [state, sub] = parts[0].split(':');
    const out = { type: 'status', state, sub: sub != null ? +sub : null, pins: '' };
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      const c = p.indexOf(':');
      const k = c < 0 ? p : p.slice(0, c);
      const v = c < 0 ? '' : p.slice(c + 1);
      if (k === 'MPos') out.mpos = nums(v);
      else if (k === 'WPos') out.wpos = nums(v);
      else if (k === 'WCO') out.wco = nums(v);
      else if (k === 'Bf') out.buf = nums(v);
      else if (k === 'Ln') out.line = +v;
      else if (k === 'F') out.feed = +v;
      else if (k === 'FS') { const f = nums(v); out.feed = f[0]; out.spindle = f[1]; }
      else if (k === 'Pn') out.pins = v;
      else if (k === 'Ov') out.ov = nums(v);
      else if (k === 'A') out.acc = v;
    }
    return out;
  }

  function parse(line) {
    const s = String(line).trim();
    if (!s) return null;
    if (s === 'ok') return { type: 'ok' };
    let m;
    if ((m = /^error:(\d+)/i.exec(s))) { const code = +m[1]; return { type: 'error', code, text: errorText(code) }; }
    if ((m = /^ALARM:(\d+)/i.exec(s))) { const code = +m[1]; const a = alarmInfo(code); return { type: 'alarm', code, text: a.text, hint: a.hint }; }
    if (s[0] === '<' && s[s.length - 1] === '>') return parseStatus(s.slice(1, -1));
    if ((m = /^\[PRB:([-+\d.,eE]+):([01])\]$/.exec(s))) return { type: 'probe', pos: nums(m[1]), ok: m[2] === '1' };
    if ((m = /^\[MSG:(.*)\]$/.exec(s))) return { type: 'msg', text: m[1].trim() };
    if ((m = /^\[GC:(.*)\]$/.exec(s))) return { type: 'gc', modes: m[1].trim().split(/\s+/) };
    if ((m = /^\[(G5[4-9]|G28|G30|G92|TLO):([^\]]*)\]$/.exec(s))) return { type: 'offset', name: m[1], value: nums(m[2]) };
    if ((m = /^Grbl\s+(\S+)/i.exec(s))) return { type: 'welcome', version: m[1] };
    if ((m = /^\$(\d+)=(.*)$/.exec(s))) return { type: 'setting', n: +m[1], value: m[2].trim() };
    if ((m = /^\[(.*)\]$/.exec(s))) return { type: 'feedback', text: m[1] };
    return { type: 'other', text: s };
  }

  /* ---------- program preparation ---------- */

  /** Strip comments and whitespace. GRBL ignores whitespace, so this only saves buffer. */
  function clean(raw) {
    return String(raw).replace(/\([^)]*\)/g, '').replace(/;.*$/, '').replace(/\s+/g, '').toUpperCase();
  }

  /** Letter/number words of a cleaned line. */
  function words(cmd) {
    const out = [];
    const re = /([A-Z])([-+]?\d*\.?\d+)/g;
    let m;
    while ((m = re.exec(cmd))) out.push({ l: m[1], v: parseFloat(m[2]), s: m[2] });
    return out;
  }

  function kindOf(cmd) {
    if (cmd[0] === '$') return 'system';
    const w = words(cmd);
    let kind = 'setup';
    for (const x of w) {
      if (x.l === 'G' && (x.s === '38.2' || x.s === '38.3' || x.s === '38.4' || x.s === '38.5')) return 'probe';
      if (x.l === 'M' && (x.v === 0 || x.v === 1)) return 'pause';
      if (x.l === 'M' && (x.v === 2 || x.v === 30)) return 'end';
      if (x.l === 'G' && x.v === 4) kind = 'dwell';
      else if ('XYZ'.includes(x.l) && kind !== 'dwell') kind = 'motion';
    }
    return kind;
  }

  /**
   * Turn generated G-code into program entries:
   *   { cmd, src, kind, hole, boundary, msg, z }
   * src is the original line index (for highlighting), hole the label from the
   * "; Hole n/m" comment, boundary marks the first command of each hole (and of
   * the closing block), msg the (MSG,...) text shown at the following pause.
   */
  function prepare(text) {
    const lines = String(text).split(/\r?\n/);
    const out = [];
    let hole = null, msg = null, boundary = false;
    lines.forEach((raw, src) => {
      let m;
      if ((m = /^\s*;\s*Hole\s+([^\s/]+)\s*\//i.exec(raw))) { hole = m[1]; boundary = true; }
      else if (/^\s*;\s*Done\b/i.test(raw)) { hole = null; boundary = true; }
      if ((m = /\(MSG,([^)]*)\)/i.exec(raw))) msg = m[1].trim();
      const cmd = clean(raw);
      if (!cmd) return;
      const kind = kindOf(cmd);
      const zw = words(cmd).find((x) => x.l === 'Z');
      const e = { cmd, src, kind, hole, boundary, msg: kind === 'pause' ? msg : null, z: zw ? zw.v : null };
      if (kind === 'probe' && (m = /;\s*pick\s+P(\d+)\s+(\w+)/i.exec(raw))) e.pick = { n: +m[1], size: m[2] };
      if (kind === 'motion' && (m = /;\s*to\s+P(\d+)\s+(\w+)/i.exec(raw))) e.toPocket = { n: +m[1], size: m[2] };
      out.push(e);
      if (kind === 'pause') msg = null;
      boundary = false;
    });
    return out;
  }

  /** Program entries for G-code spliced in during a run (all belong to hole `hole`). */
  function splice(text, hole) {
    return prepare(text).map((e) => Object.assign(e, { src: -1, hole, boundary: false }));
  }

  /** Hole labels in program order. */
  function holesOf(prog) {
    const seen = [];
    for (const e of prog) if (e.hole != null && seen[seen.length - 1] !== e.hole) seen.push(e.hole);
    return seen;
  }

  /* ---------- small command builders ---------- */
  const f3 = (v) => {
    const t = (Math.round(v * 1000) / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    return t === '-0' ? '0' : t;
  };

  /** Incremental jog: { x, y, z } in mm, feed in mm/min. */
  function jog(d, feed) {
    let s = '$J=G91G21';
    for (const a of ['x', 'y', 'z']) if (d[a]) s += a.toUpperCase() + f3(d[a]);
    return s + 'F' + f3(Math.max(1, feed));
  }

  /** Set the current position as work zero on the listed axes, e.g. 'XY'. */
  function setZero(axes, values) {
    let s = 'G10L20P1';
    for (const a of axes.toUpperCase()) s += a + f3(values && values[a] != null ? values[a] : 0);
    return s;
  }

  /* ---------- machine state ---------- */

  class Machine {
    constructor() { this.reset(); }
    reset() {
      this.state = 'Unknown'; this.sub = null;
      this.mpos = null; this.wpos = null; this.wco = [0, 0, 0]; this.hasWco = false;
      this.feed = 0; this.ov = [100, 100, 100]; this.pins = ''; this.buf = null;
      this.version = null; this.alarm = null; this.statusCount = 0;
    }
    update(msg) {
      if (!msg) return;
      if (msg.type === 'status') {
        this.state = msg.state; this.sub = msg.sub;
        if (msg.wco) { this.wco = msg.wco; this.hasWco = true; }
        if (msg.mpos) { this.mpos = msg.mpos; this.wpos = msg.mpos.map((v, i) => v - this.wco[i]); }
        else if (msg.wpos) { this.wpos = msg.wpos; this.mpos = msg.wpos.map((v, i) => v + this.wco[i]); }
        if (msg.feed != null) this.feed = msg.feed;
        if (msg.ov) this.ov = msg.ov;
        if (msg.buf) this.buf = msg.buf;
        this.pins = msg.pins || '';
        if (msg.state !== 'Alarm') this.alarm = null;
        this.statusCount++;
      } else if (msg.type === 'welcome') {
        this.version = msg.version;
      } else if (msg.type === 'alarm') {
        this.state = 'Alarm'; this.alarm = msg;
      }
    }
    /** Float sensor on the probe pin reads pressed. */
    get probe() { return this.pins.indexOf('P') >= 0; }
    get idle() { return this.state === 'Idle'; }
    toWork(mpos) { return mpos.map((v, i) => v - this.wco[i]); }
  }

  /* ---------- streamer ---------- */

  const ACTIVE = ['running', 'held', 'trip', 'between', 'pick', 'error', 'stopping'];

  /**
   * States: idle, ready, running, held (user pause), trip (holding between holes
   * after the float tripped), between (holding between holes because the user
   * asked), pick (a pickup found an empty pocket and nothing else to try),
   * error (GRBL rejected a line; feed hold sent), alarm, stopping, stopped, done.
   *
   * Pickups (entries with .pick) are gates: nothing after one is sent until its
   * ok comes back, so a miss can be fixed before the press. load(prog, { onMiss })
   * where onMiss(entry, retry, info) returns { entries } to splice in after the
   * pickup (try another pocket) or { text } to hold in the 'pick' state; resume()
   * then asks again with retry = true. info.rejected is set when GRBL refused the
   * pickup line itself (the pocket may still be full); that is handled like a
   * miss once the user continues from the 'error' state, so nothing is pressed
   * with an empty tip. load(prog, { remap }) where remap({ n, size })
   * returns { n, x, y }: called just before a travel-to-pocket line is sent, so
   * a hole uses the pocket that is full now, not the one planned at export.
   *
   * `held` is true while GRBL sits in a feed hold we sent (pause or error).
   * Whatever leaves that hold toward running sends Cycle Start; a run that
   * finishes while held stays 'held' until resume().
   *
   * io = { send(line), realtime(byte), emit(type, data) }
   */
  class Streamer {
    constructor(io, opts) {
      this.io = io;
      this.rx = (opts && opts.rxSize) || RX_SIZE;
      this.prog = [];
      this.reset();
    }
    reset() {
      this.next = 0; this.acked = 0; this.inflight = []; this.used = 0;
      this.state = 'idle'; this.trips = []; this.errors = []; this.error = null;
      this.holdAtBoundary = false; this.userHold = false; this.stopAt = 0; this.resetAt = 0;
      this.startedAt = 0; this.endedAt = 0; this.check = false;
      this.gate = null; this.pickRes = null; this.missEntry = null; this.picks = []; this.misses = [];
      this.held = false; this.pickErr = null;
    }
    get active() { return ACTIVE.includes(this.state); }
    load(prog, opts) {
      this.reset();
      opts = opts || {};
      this.prog = prog;
      this.pauseOnTrip = opts.pauseOnTrip !== false;
      this.syncHoles = opts.syncHoles !== false;
      this.check = !!opts.check;
      this.onMiss = opts.onMiss || null;
      this.remap = opts.remap || null;
      this.pocketNow = null;
      this.state = prog.length ? 'ready' : 'idle';
    }
    _set(state, data) {
      if (this.state === state) return;
      this.state = state;
      this.io.emit('state', Object.assign({ state }, data || {}));
    }
    start(now) {
      if (this.state !== 'ready') return false;
      this.startedAt = now || 0;
      this._set('running');
      this.pump();
      return true;
    }
    /** Send as many lines as fit. */
    pump() {
      if (this.state !== 'running' && this.state !== 'held') return;
      while (this.next < this.prog.length && this.gate == null) {
        const e = this.prog[this.next];
        if (e.boundary && this.next > 0 && (this.holdAtBoundary || this.syncHoles)) {
          if (this.inflight.length) break; // let the previous hole finish first
          if (this.holdAtBoundary) {
            this.holdAtBoundary = false;
            const user = this.userHold;
            this.userHold = false;
            this._set(user ? 'between' : 'trip', { trip: user ? null : this.trips[this.trips.length - 1] });
            return;
          }
        }
        if (e.toPocket && this.remap && !this.check && !e.mapped) {
          const p = this.remap(e.toPocket);
          if (p && p.n !== e.toPocket.n) { e.cmd = `G0X${f3(p.x)}Y${f3(p.y)}`; e.toPocket = { n: p.n, size: e.toPocket.size }; }
          e.mapped = true;
        }
        const len = e.cmd.length + 1;
        if (this.inflight.length && this.used + len > this.rx - 1) break;
        if (e.toPocket) this.pocketNow = e.toPocket.n;
        if (e.pick && this.pocketNow != null) e.pick = { n: this.pocketNow, size: e.pick.size };
        this.io.send(e.cmd);
        this.inflight.push(this.next);
        this.used += len;
        if (e.pick && !this.check) this.gate = this.next;
        this.next++;
      }
    }
    /** Hold before the next hole starts (the current one finishes). */
    pauseAfterHole() { if (this.state === 'running' || this.state === 'held') { this.holdAtBoundary = true; this.userHold = true; } }
    /** Ask onMiss what to do about pickup `e`. Entries are spliced in; a user pause or error hold stays put. */
    _miss(e, retry, info) {
      const rep = this.onMiss ? this.onMiss(e, !!retry, info || {}) : null;
      if (rep && rep.entries && rep.entries.length) {
        this.prog.splice(this.next, 0, ...rep.entries);
        if (this.state === 'pick') this._run();
        return true;
      }
      this.missEntry = e;
      this._set('pick', { entry: e, text: rep && rep.text });
      return false;
    }
    /** Back to running, releasing GRBL's feed hold if we put it in one. */
    _run() {
      if (this.held) { this.io.realtime(RT.start); this.held = false; }
      this._set('running');
    }
    _shift() {
      const i = this.inflight.shift();
      if (i == null) return null;
      this.used -= this.prog[i].cmd.length + 1;
      this.acked++;
      return i;
    }
    /** The entry GRBL is working on (oldest unanswered), else the last answered. */
    current() {
      if (this.inflight.length) return this.prog[this.inflight[0]];
      return this.acked ? this.prog[this.acked - 1] : null;
    }
    progress() { return { acked: this.acked, sent: this.next, total: this.prog.length }; }

    handle(msg, now) {
      if (!msg) return;
      const t = msg.type;
      if (t === 'ok' || t === 'error') {
        const i = this._shift();
        if (i == null) return;
        const e = this.prog[i];
        if (t === 'error') {
          const err = { index: i, entry: e, code: msg.code, text: msg.text };
          this.errors.push(err);
          this.io.emit('lineError', err);
          if (!this.check && (this.state === 'running' || this.state === 'held')) {
            this.io.realtime(RT.hold); // a skipped line could leave the tip low; stop moving
            this.held = true;
            this.error = err;
            this._set('error', { error: err });
            if (this.gate === i) this.pickErr = e; // nothing was picked: resume() treats it as a miss
          }
        }
        this.io.emit('ack', { index: i, entry: e, ok: t === 'ok' });
        if (this.gate === i) {
          this.gate = null;
          const r = this.pickRes;
          this.pickRes = null;
          if (t === 'ok' && r && r.tripped) { this.picks.push(r); this.io.emit('picked', r); }
          else if (t === 'ok') {
            const rec = { entry: e, index: i, mpos: r ? r.mpos : null };
            this.misses.push(rec);
            this.io.emit('missed', rec);
            // only a live run asks what next; a stop or alarm in the meantime wins
            if (['running', 'held', 'error'].includes(this.state) && !this._miss(e, false)) return;
          }
        }
        // finishing while held waits for resume(), so GRBL is never left in a feed hold
        if (this.acked >= this.prog.length && this.state === 'running') this._done(now);
        else this.pump();
        return;
      }
      if (t === 'probe') {
        const e = this.inflight.length ? this.prog[this.inflight[0]] : null;
        if (!e || e.kind !== 'probe' || !this.active) return;
        const rec = { hole: e.hole, entry: e, index: this.inflight[0], mpos: msg.pos, tripped: msg.ok };
        this.io.emit('probe', rec);
        if (e.pick) { this.pickRes = rec; return; }
        if (msg.ok && e.hole != null) {
          this.trips.push(rec);
          if (this.pauseOnTrip) this.holdAtBoundary = true;
          this.io.emit('trip', rec);
        }
        return;
      }
      if (t === 'alarm') {
        if (!this.active) return;
        this.inflight = []; this.used = 0; this.gate = null; this.held = false; this.pickErr = null;
        this.error = { alarm: msg.code, text: msg.text, hint: msg.hint };
        this._set('alarm', { error: this.error });
        return;
      }
      if (t === 'welcome') {
        if (this.state === 'stopping') { this._finishStop(); return; }
        if (this.active) {
          this.inflight = []; this.used = 0; this.gate = null; this.held = false; this.pickErr = null;
          this.error = { text: 'The controller reset during the job.' };
          this._set('alarm', { error: this.error });
        }
        return;
      }
      if (t === 'status' && this.state === 'stopping' && !this.resetAt) {
        if ((msg.state === 'Hold' && msg.sub === 0) || msg.state === 'Idle' || msg.state === 'Alarm' || msg.state === 'Check') this._reset(now);
      }
    }
    _done(now) {
      this.endedAt = now || 0;
      this._set('done', { errors: this.errors.length, trips: this.trips.length });
    }
    _reset(now) { this.resetAt = now || 1; this.io.realtime(RT.reset); }
    _finishStop() { this.inflight = []; this.used = 0; this.gate = null; this.held = false; this.pickErr = null; this._set('stopped'); }
    /** Call regularly (now in ms) so a stop still completes if GRBL goes quiet. */
    tick(now) {
      if (this.state !== 'stopping') return;
      if (!this.resetAt && now - this.stopAt > 2500) this._reset(now);
      else if (this.resetAt && now - this.resetAt > 2500) this._finishStop();
    }
    pause() { if (this.state === 'running') { this.io.realtime(RT.hold); this.held = true; this._set('held'); } }
    resume() {
      if (this.state === 'held' || this.state === 'error') {
        this.io.realtime(RT.start); this.held = false; this.error = null; this._set('running');
        const pe = this.pickErr;
        if (pe) {
          // GRBL refused the pickup line, so the tip is empty: handle it like an empty pocket
          this.pickErr = null;
          const rec = { entry: pe, index: this.prog.indexOf(pe), mpos: null, rejected: true };
          this.misses.push(rec);
          this.io.emit('missed', rec);
          if (!this._miss(pe, false, { rejected: true })) return;
        }
        if (this.acked >= this.prog.length) this._done(); else this.pump();
      }
      else if (this.state === 'trip' || this.state === 'between') { this._run(); this.pump(); }
      else if (this.state === 'pick') {
        const e = this.missEntry;
        if (this._miss(e, true)) { this.missEntry = null; this.pump(); }
      }
    }
    /** Cycle Start for an M0 pause; the stream itself keeps going. */
    cycleStart() { this.io.realtime(RT.start); this.held = false; }
    /** Feed hold, wait for the machine to stop, then soft reset (keeps position). */
    stop(now) {
      if (!this.active || this.state === 'stopping') return;
      const wasIdle = ['trip', 'between', 'pick'].includes(this.state);
      this.io.realtime(RT.hold);
      this.stopAt = now || 0; this.resetAt = 0;
      this._set('stopping');
      if (wasIdle) this._reset(now);
    }
  }

  /* ---------- link: one controller ---------- */

  /**
   * io = { write(line), writeByte(byte) }. Feed every received line to receive().
   * Events: 'line' (raw, msg), 'status', 'state' (streamer), 'ack', 'trip',
   * 'lineError', 'alarm', 'welcome', 'msg'.
   */
  class Link {
    constructor(io, opts) {
      this.io = io;
      this.machine = new Machine();
      this.queue = [];
      this.waiting = null;
      this.listeners = {};
      this.streamer = new Streamer({
        send: (l) => this._write(l),
        realtime: (b) => this.realtime(b),
        emit: (type, data) => this.emit(type, data),
      }, opts);
    }
    on(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); return this; }
    emit(type, a, b) { for (const fn of this.listeners[type] || []) fn(a, b); }
    _write(line) { this.emit('tx', line); this.io.write(line); }
    realtime(byte) { this.io.writeByte(byte); }
    get busy() { return this.streamer.active; }

    receive(line, now) {
      const msg = parse(line);
      if (!msg) return;
      this.machine.update(msg);
      this.emit('line', line, msg);
      const t = msg.type;
      if (t === 'ok' || t === 'error') {
        if (this.streamer.inflight.length) this.streamer.handle(msg, now);
        else if (this.waiting) {
          const w = this.waiting;
          this.waiting = null;
          w.resolve(w.alarm || msg);
          this._next();
        }
        return;
      }
      if (t === 'status') this.emit('status', this.machine);
      if (t === 'alarm') {
        this.emit('alarm', msg);
        if (this.waiting && !this.streamer.inflight.length) {
          // A probe alarm (4, 5) is still followed by the probe line's own ok, so keep
          // waiting for it and resolve with the alarm then; resolving now would hand that
          // ok to the next command. Other alarms (limits) may never get a reply.
          if (msg.code === 4 || msg.code === 5) this.waiting.alarm = msg;
          else { const w = this.waiting; this.waiting = null; w.resolve(msg); this._next(); }
        }
      }
      if (t === 'welcome') {
        const w = this.waiting; this.waiting = null;
        if (w) w.resolve({ type: 'reset' });
        for (const q of this.queue.splice(0)) q.resolve({ type: 'reset' });
        this.emit('welcome', msg);
      }
      if (t === 'msg') this.emit('msg', msg);
      this.streamer.handle(msg, now);
    }

    /** Send one line and resolve with its reply ({type:'ok'} or {type:'error',...}). */
    command(line) {
      return new Promise((resolve) => {
        if (this.streamer.active) { resolve({ type: 'error', code: 0, text: 'A job is running.' }); return; }
        this.queue.push({ line, resolve });
        this._next();
      });
    }
    _next() {
      if (this.waiting || !this.queue.length || this.streamer.inflight.length) return;
      this.waiting = this.queue.shift();
      this._write(this.waiting.line);
    }
    /** Drop queued commands (e.g. on disconnect). */
    abort() {
      const w = this.waiting; this.waiting = null;
      if (w) w.resolve({ type: 'abort' });
      for (const q of this.queue.splice(0)) q.resolve({ type: 'abort' });
    }
    stream(prog, opts, now) {
      if (this.streamer.active || this.waiting || this.queue.length) return false;
      this.streamer.load(prog, opts);
      return this.streamer.start(now);
    }
    tick(now) { this.streamer.tick(now); }
  }

  IP.grbl = {
    RX_SIZE, RT, ERRORS, ALARMS, errorText, alarmInfo,
    parse, parseStatus, clean, words, kindOf, prepare, splice, holesOf, jog, setZero, f3,
    Machine, Streamer, Link,
  };
})(typeof window !== 'undefined' ? window : globalThis);
