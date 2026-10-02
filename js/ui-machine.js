/* InsertPress Planner — the run screen: connect, live readout, run with prompts
 * and the float-trip watch, tray pickups (skip empty pockets live, refill), the
 * tray inventory, moving and setting the origin, and a console.
 * app.js calls IP.ui.machine.init(ctx) once.
 */
(function () {
  'use strict';
  const IP = window.IP;
  const G = IP.grbl;
  IP.ui = IP.ui || {};

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const f3 = (v) => (v == null || !isFinite(v) ? '–' : (Math.round(v * 1000) / 1000).toFixed(3));
  const ICON = {
    up: '<svg viewBox="0 0 20 20"><path d="M10 15V5M5.5 9.5L10 5l4.5 4.5"/></svg>',
    stop: '<svg viewBox="0 0 20 20"><rect x="6" y="6" width="8" height="8" rx="1.5"/></svg>',
    back: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12 4l-6 6 6 6"/></svg>',
  };

  const MARKUP = `
  <header class="run-head">
    <button class="btn small" id="pd-back">${ICON.back}Back to the plan</button>
    <span class="pd-chip" id="pd-chip"><i></i><span id="pd-chip-t">Not connected</span></span>
  </header>
  <div class="pd-scroll" id="pd-scroll" tabindex="-1">
    <section class="pd-sec" id="pd-off">
      <h2 class="run-title">Connect the press</h2>
      <p class="pd-lede">Plug the Uno into USB. GRBL restarts when the port opens, so the first reply takes about two seconds.</p>
      <button class="btn primary block" id="pd-usb">Connect over USB</button>
      <p class="pd-note" id="pd-usb-note" hidden>USB needs Chrome or Edge on a desktop. You can still rehearse on the simulator, or download the G-code for another sender.</p>
      <div class="pd-or"><span>or</span></div>
      <button class="btn block" id="pd-sim">Rehearse on the simulator</button>
      <details class="pd-adv"><summary>Options</summary>
        <div class="pd-row"><label class="pd-lab" for="pd-baud">Baud rate</label>
          <select id="pd-baud" class="pd-sel"><option>115200</option><option>250000</option><option>57600</option><option>9600</option></select></div>
        <label class="pd-check"><input type="checkbox" id="pd-sim-stuck"> Simulator: make one insert stick, to practise a float trip</label>
        <label class="pd-check"><input type="checkbox" id="pd-sim-empty"> Simulator: leave the first two tray pockets empty, to practise skipping</label>
      </details>
    </section>

    <div id="pd-on" hidden>
      <section class="pd-sec dro">
        <div class="dro-top">
          <span class="pd-state" id="pd-state">Idle</span>
          <span class="pd-float" id="pd-float"><i></i><span>Float relaxed</span></span>
          <button class="pd-link" id="pd-disc">Disconnect</button>
        </div>
        ${['X', 'Y', 'Z'].map((a) => `<div class="dro-ax"><b>${a}</b><output id="dro-${a}">0.000</output><span class="dro-u">mm</span></div>`).join('')}
        <p class="pd-fine" id="dro-m"></p>
        <div class="pd-sim-row" id="pd-sim-row" hidden><span>Simulator speed</span>
          <span class="seg dark" id="pd-sim-speed"><button class="seg-btn" data-speed="1">1×</button><button class="seg-btn" data-speed="4" aria-checked="true">4×</button><button class="seg-btn" data-speed="16">16×</button></span></div>
      </section>

      <section class="pd-sec pd-alarm" id="pd-alarm" hidden>
        <b id="pd-alarm-t">Alarm</b><p id="pd-alarm-d"></p>
        <div class="pd-btns"><button class="btn small" id="pd-unlock">Unlock</button><button class="btn small pd-ghost" id="pd-reset">Soft reset</button></div>
      </section>

      <section class="pd-sec" id="pd-job-sec">
        <div class="pd-h"><h3>Job</h3><span class="pd-fine" id="pd-job-sum"></span></div>
        <div id="pd-setup">
          <p class="pd-warn" id="pd-block" hidden></p>
          <button class="btn primary block big" id="pd-run">Run job</button>
          <details class="pd-adv" id="pd-opts"><summary>Run options</summary>
            <div class="pd-row"><label class="pd-lab" for="pd-from">Start at hole</label><select id="pd-from" class="pd-sel"></select></div>
            <label class="pd-check"><input type="checkbox" id="pd-only"> Only that hole (test press)</label>
            <label class="pd-check"><input type="checkbox" id="pd-air"> Air pass: everything 20 mm higher, nothing touches</label>
            <label class="pd-check"><input type="checkbox" id="pd-trip" checked> Stop between holes if the float trips</label>
            <label class="pd-check"><input type="checkbox" id="pd-chime" checked> Chime when it needs me</label>
            <button class="btn small block pd-ghost" id="pd-check-run">Check every line on the controller ($C)</button>
          </details>
        </div>
        <div class="pd-confirm" id="pd-confirm" hidden>
          <b>Before it moves</b>
          <ul id="pd-confirm-list"></ul>
          <div class="pd-btns"><button class="btn primary" id="pd-go">Start</button><button class="btn pd-ghost" id="pd-cancel">Cancel</button></div>
        </div>
        <div id="pd-live" hidden>
          <div class="track" id="pd-track"></div>
          <div class="pd-now" id="pd-now"></div>
          <div class="pd-times"><span id="pd-el">0:00</span><span id="pd-left"></span></div>
          <div class="pd-prompt" id="pd-prompt" hidden>
            <b id="pd-prompt-t"></b>
            <button class="btn primary block" id="pd-cont">Continue</button>
          </div>
          <div class="pd-btns">
            <button class="btn pd-ghost" id="pd-pause">Pause</button>
            <button class="btn pd-ghost" id="pd-after" title="Finish this hole, then hold">Pause after hole</button>
            <button class="btn pd-danger" id="pd-stop">Stop</button></div>
          <div class="pd-ovr"><span>Press speed</span><b id="pd-ov">100%</b>
            <button class="pd-mini" data-ov="146" aria-label="Slower">−10</button><button class="pd-mini" data-ov="145" aria-label="Faster">+10</button><button class="pd-mini" data-ov="144">100%</button></div>
        </div>
        <ol class="pd-log" id="pd-log"></ol>
      </section>

      <details class="pd-sec pd-group" id="pd-tray-sec">
        <summary><span>Tray</span><span class="pd-fine" id="pd-tray-sum"></span></summary>
        <p class="pd-fine">Click a pocket to mark it full or empty. Pockets empty themselves as the machine picks.</p>
        <div class="tgrid" id="pd-tray"></div>
        <div class="pd-btns"><button class="btn small pd-ghost" id="pd-refill">Refill: all full</button><button class="btn small pd-ghost" id="pd-empty-all">All empty</button></div>
        <p class="pd-fine hot">The tip is hot when it picks: the tray must be metal or high-temp.</p>
      </details>

      <details class="pd-sec pd-group" id="pd-move-sec">
        <summary><span>Move and set the origin</span></summary>
        <div class="pd-h"><span class="pd-lab">Step</span><span class="seg dark" id="pd-step">
          ${[0.1, 1, 10, 50].map((s) => `<button class="seg-btn" data-step="${s}"${s === 1 ? ' aria-checked="true"' : ''}>${s} mm</button>`).join('')}</span></div>
        <div class="jog">
          <button class="jg" data-jog="y+" style="grid-area:yp" aria-label="Y plus">${ICON.up}<span>Y+</span></button>
          <button class="jg" data-jog="x-" style="grid-area:xm" aria-label="X minus">${ICON.up}<span>X−</span></button>
          <button class="jg stop" id="pd-jstop" style="grid-area:st" aria-label="Stop moving">${ICON.stop}</button>
          <button class="jg" data-jog="x+" style="grid-area:xp" aria-label="X plus">${ICON.up}<span>X+</span></button>
          <button class="jg" data-jog="y-" style="grid-area:ym" aria-label="Y minus">${ICON.up}<span>Y−</span></button>
          <button class="jg z" data-jog="z+" style="grid-area:zp" aria-label="Z up">${ICON.up}<span>Z+</span></button>
          <button class="jg z" data-jog="z-" style="grid-area:zm" aria-label="Z down">${ICON.up}<span>Z−</span></button>
        </div>
        <p class="pd-fine">Click to step, hold to keep moving. Arrow keys and Page Up/Down work too.</p>
        <div class="pd-btns"><button class="btn small pd-ghost" id="pd-raise">Lift to travel height</button><button class="btn small pd-ghost" id="pd-goto0">Go to the fence corner</button></div>
        <div class="pd-h sub"><h3>Origin</h3></div>
        <div class="pd-btns"><button class="btn small pd-ghost" id="pd-zxy" title="G10 L20 P1 X0 Y0">Fence corner is here (X0 Y0)</button></div>
        <div class="pd-btns"><button class="btn small pd-ghost" id="pd-touch">Find the bed with the float</button><button class="btn small pd-ghost" id="pd-zz" title="G10 L20 P1 Z0">Bed is here (Z0)</button></div>
      </details>

      <details class="pd-sec pd-group pd-con" id="pd-con">
        <summary><span>Console</span></summary>
        <div class="con-log" id="con-log" aria-live="off"></div>
        <div class="con-in"><input id="con-input" placeholder="$$, $G, G0 Z20 …" spellcheck="false" autocomplete="off"><button class="btn small" id="con-send">Send</button></div>
      </details>
    </div>
  </div>`;

  function init(ctx) {
    const { $, S } = ctx;
    const panel = $('run-side');
    panel.innerHTML = MARKUP;
    const st = { link: null, port: null, poll: null, step: 1, jogHold: null, banner: null, run: null, wake: null,
      lastPrompt: null, touch: null, shelf: null, carry: null, missKind: null, visible: false };
    const tray = () => ctx.trayOn();
    const insName = (k) => (IP.INSERTS[k] ? IP.INSERTS[k].name : k);

    function shown(on) { st.visible = on; if (on) { render(); renderTray(); } }
    $('pd-back').addEventListener('click', () => ctx.goScreen(S.part ? 'job' : 'start'));
    $('pd-usb-note').hidden = IP.SerialPort.supported();
    $('pd-usb').disabled = !IP.SerialPort.supported();

    /* ---------- console & log ---------- */
    const conLog = $('con-log');
    function con(text, kind) {
      const d = document.createElement('div');
      d.className = 'cl ' + (kind || '');
      d.textContent = text;
      conLog.appendChild(d);
      while (conLog.childNodes.length > 400) conLog.removeChild(conLog.firstChild);
      conLog.scrollTop = conLog.scrollHeight;
    }
    function log(html, kind) {
      const li = document.createElement('li');
      li.className = kind || '';
      li.innerHTML = html;
      $('pd-log').prepend(li);
      while ($('pd-log').children.length > 30) $('pd-log').lastChild.remove();
    }

    /* ---------- connect ---------- */
    async function connect(kind) {
      if (st.link) return;
      const handlers = { onLine: (l) => st.link && st.link.receive(l, performance.now()), onClose: (why) => closed(why) };
      let port;
      if (kind === 'sim') {
        port = new IP.SimPort(handlers, {
          rapid: { xy: S.settings.rapidXY, z: S.settings.rapidZ },
          probe: (x, y, z) => {
            if (z <= -(S.settings.tripTravel || 0.5)) return true; // the bed
            if (tray() && st.shelf && IP.tray.simProbe(S.settings, st.shelf, x, y, z)) return true;
            if (!st.run || !st.run.stuck) return false;
            const h = st.run.stuck;
            return Math.hypot(x - h.x, y - h.y) < 0.4 && z < h.H + 2.5;
          },
        });
      } else port = new IP.SerialPort(handlers);
      const link = new G.Link({ write: (l) => port.write(l), writeByte: (b) => port.writeByte(b) });
      wire(link);
      st.link = link; st.port = port;
      st.shelf = S.inv.slice();
      try { await port.open(+$('pd-baud').value); }
      catch (e) {
        st.link = null; st.port = null;
        if (e && e.name !== 'NotFoundError') ctx.toast(`Could not open the port: ${e.message}`, true);
        return;
      }
      $('pd-sim-row').hidden = kind !== 'sim';
      con(kind === 'sim' ? '; simulator started' : '; port open, waiting for GRBL', 'sys');
      st.banner = setTimeout(() => {
        if (st.link && !st.link.machine.version) { con('; no banner yet, sending a soft reset', 'sys'); port.writeByte(G.RT.reset); }
      }, 2500);
      setTimeout(() => {
        if (st.link && !st.link.machine.version) ctx.toast('No reply from GRBL. Check the baud rate and that the Uno is running GRBL 1.1.', true);
      }, 6000);
      st.poll = setInterval(() => {
        if (!st.link) return;
        st.port.writeByte(G.RT.status);
        st.link.tick(performance.now());
        if (st.run) tickRun();
      }, 200);
      render();
    }
    function closed(why) {
      const wasRunning = st.link && st.link.busy;
      clearInterval(st.poll); clearTimeout(st.banner);
      if (st.link) st.link.abort();
      st.link = null; st.port = null;
      ctx.setLive(null); ctx.setLiveTray(null);
      endWake();
      if (wasRunning) log('<b>Connection lost mid-job.</b> The controller may still run the few lines it already had. Check the machine.', 'bad');
      if (st.run && !st.run.over) finish(true); // back to the Run button; Start at hole moves to the next unfinished one
      if (why) ctx.toast(why, true);
      render();
    }
    $('pd-usb').addEventListener('click', () => connect('usb'));
    $('pd-sim').addEventListener('click', () => connect('sim'));
    $('pd-disc').addEventListener('click', () => {
      if (st.link && st.link.busy && !window.confirm('A job is running. Disconnect anyway? The machine keeps whatever it already received.')) return;
      if (st.port) st.port.close();
    });
    $('pd-sim-speed').addEventListener('click', (e) => {
      const b = e.target.closest('[data-speed]');
      if (!b || !st.port || st.port.kind !== 'sim') return;
      st.port.speed = +b.dataset.speed;
      $('pd-sim-speed').querySelectorAll('[data-speed]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    });

    function wire(link) {
      link.on('tx', (l) => { if (!link.busy || $('pd-con').open) con('> ' + l, 'tx'); });
      link.on('line', (l, msg) => {
        if (msg.type === 'status') return;
        if (msg.type === 'ok' && link.busy) return;
        con(l, msg.type === 'error' || msg.type === 'alarm' ? 'bad' : msg.type === 'ok' ? 'ok' : '');
        if (msg.type === 'probe' && st.touch) st.touch(msg);
      });
      link.on('welcome', (m) => {
        clearTimeout(st.banner);
        if (!/^1\.1/.test(m.version)) ctx.toast(`This is GRBL ${m.version}. The planner is written for 1.1.`, true);
      });
      link.on('status', () => render());
      link.on('alarm', (a) => { log(`<b>ALARM:${a.code}</b> ${esc(a.text)}`, 'bad'); render(); });
      link.on('state', (s) => onStreamState(s));
      link.on('ack', (a) => onAck(a));
      link.on('picked', (r) => {
        const n = r.entry.pick.n;
        ctx.tray.set(n - 1, 0);
        if (st.shelf) st.shelf[n - 1] = 0;
        const k = IP.INSERTS[r.entry.pick.size];
        st.carry = k ? { od: k.od, L: k.L, hang: k.L - (+S.settings.pilotLen || 0) } : null;
        renderTray();
      });
      link.on('missed', (r) => log(r.rejected ? `GRBL refused the pickup at pocket ${r.entry.pick.n}; trying another pocket.` : `Pocket ${r.entry.pick.n} was empty.`));
      link.on('trip', (t) => {
        const z = st.link.machine.toWork(t.mpos)[2];
        const target = t.entry.z;
        log(`<b>Hole ${esc(t.hole)}: float tripped</b> at Z ${f3(z)}, ${f3(z - target)} mm short of Z ${f3(target)}. The insert is probably not flush.`, 'bad');
        if (st.run) st.run.marks[t.hole] = 'trip';
        ctx.setRunMarks(st.run ? st.run.marks : {});
        chime(2);
      });
      link.on('lineError', (e) => {
        if (st.run && st.run.check) st.run.checkErrors.push(e);
        else log(`<b>GRBL rejected line ${e.entry.src + 1}</b> (${esc(e.entry.cmd)}): ${esc(e.text)}`, 'bad');
      });
    }

    /* ---------- tray pickups during a run ---------- */
    function onMiss(e, retry, info) {
      const s = S.settings, k = e.pick.size;
      if (retry && st.missKind === 'out') { ctx.tray.refill(k); if (st.shelf && st.port && st.port.kind === 'sim') for (const p of IP.tray.pockets(s)) if (p.size === k) st.shelf[p.i] = 1; log(`Refilled the ${insName(k)} pockets.`); }
      if (!retry && !(info && info.rejected)) ctx.tray.set(e.pick.n - 1, 0); // a refused line says nothing about the pocket
      renderTray();
      const p = IP.tray.nextFull(s, S.inv, k, retry ? 0 : e.pick.n);
      if (!p) { st.missKind = 'out'; chime(2); return { text: `No full ${insName(k)} pockets left. Refill the ${insName(k)} rows, then Continue.` }; }
      if (!retry && s.trayEmpty === 'pause') { st.missKind = 'ask'; chime(2); return { text: `Pocket ${e.pick.n} (${insName(k)}) was empty. Continue tries pocket ${p.n}.` }; }
      st.missKind = null;
      log(`Trying pocket ${p.n}.`);
      return { entries: G.splice(IP.tray.retryText(s, p, st.run.clearZ), e.hole) };
    }
    function remap(tp) {
      if (S.inv[tp.n - 1]) return null;
      return IP.tray.nextFull(S.settings, S.inv, tp.size, 0);
    }

    /* ---------- live readout ---------- */
    function render() {
      const L = st.link, on = !!L;
      const m = L ? L.machine : null;
      const state = !on ? 'Not connected' : !m.version ? 'Connecting' : m.state + (m.state === 'Hold' && m.sub === 1 ? ' (slowing)' : '');
      const running = on && L.busy;
      const run = st.run;
      let chip = state;
      if (running && run && !run.check) chip = `Running ${run.done}/${run.labels.length}`;
      $('pd-chip-t').textContent = chip;
      $('mach-state').textContent = chip;
      const tone = !on ? 'off' : m.state === 'Alarm' ? 'bad' : running || m.state === 'Run' || m.state === 'Jog' ? 'run' : 'on';
      $('pd-chip').dataset.tone = tone;
      $('btn-machine').dataset.tone = tone;
      $('btn-machine').classList.toggle('on', S.screen === 'run');
      if (!st.visible && !running) return;
      $('pd-off').hidden = on;
      $('pd-on').hidden = !on;
      $('pd-tray-sec').hidden = !tray();
      if (!on) return;
      $('pd-state').textContent = m.state === 'Hold' ? (m.sub === 1 ? 'Holding (slowing)' : 'Holding') : m.state;
      $('pd-state').dataset.tone = tone;
      $('pd-float').classList.toggle('on', m.probe);
      $('pd-float').querySelector('span').textContent = m.probe ? 'Float pressed' : 'Float relaxed';
      const w = m.wpos || [null, null, null];
      ['X', 'Y', 'Z'].forEach((a, i) => { $('dro-' + a).textContent = f3(w[i]); });
      $('dro-m').textContent = m.mpos ? `Machine ${f3(m.mpos[0])}  ${f3(m.mpos[1])}  ${f3(m.mpos[2])}` : '';
      $('pd-ov').textContent = (m.ov ? m.ov[0] : 100) + '%';
      const alarm = m.state === 'Alarm';
      $('pd-alarm').hidden = !alarm;
      if (alarm) {
        const a = m.alarm;
        $('pd-alarm-t').textContent = a ? `Alarm ${a.code}: ${a.text}` : 'Alarm: locked';
        $('pd-alarm-d').textContent = a ? a.hint : 'GRBL starts locked when homing is on, or after a hard stop. Unlock once you know where the tip is.';
      }
      const canJog = !running && (m.state === 'Idle' || m.state === 'Jog');
      $('pd-move-sec').hidden = running;
      panel.querySelectorAll('#pd-move-sec button').forEach((b) => { if (b.id !== 'pd-jstop') b.disabled = !canJog; });
      if (m.wpos) {
        const cur = running ? st.link.streamer.current() : null;
        ctx.setLive(m.wpos, m.state === 'Run' && cur && ['probe', 'dwell'].includes(cur.kind) && !cur.pick, st.carry);
      }
      renderJob();
      renderRunState();
    }

    function renderTray() {
      if (!tray()) return;
      const s = S.settings, full = S.inv;
      const pk = IP.tray.pockets(s);
      const { cols } = IP.tray.dims(s);
      const rows = [];
      const cur = st.link && st.link.busy ? st.link.streamer.pocketNow : null;
      for (let r = IP.tray.dims(s).rows - 1; r >= 0; r--) {
        const cells = pk.filter((p) => p.row === r).map((p) => `<button class="tp${full[p.i] && p.size ? ' full' : ''}${cur === p.n ? ' now' : ''}" data-pocket="${p.i}" ${p.size ? '' : 'disabled'} title="Pocket ${p.n}${p.size ? `, ${insName(p.size)}` : ''}: ${full[p.i] ? 'full' : 'empty'}" aria-label="Pocket ${p.n} ${full[p.i] ? 'full' : 'empty'}"></button>`).join('');
        rows.push(`<div class="trow"><span>${IP.tray.rowSize(s, r) ? esc(insName(IP.tray.rowSize(s, r))) : '–'}</span><div class="tcells" style="grid-template-columns:repeat(${cols},1fr)">${cells}</div></div>`);
      }
      $('pd-tray').innerHTML = rows.join('');
      const c = IP.tray.counts(s, full);
      $('pd-tray-sum').textContent = Object.entries(c).map(([k, v]) => `${v.full}/${v.total} ${insName(k)}`).join(' · ');
      ctx.setLiveTray(st.link && st.link.busy ? { full, next: cur != null ? cur - 1 : null } : null);
    }
    $('pd-tray').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pocket]');
      if (!b) return;
      const i = +b.dataset.pocket;
      ctx.tray.set(i, !S.inv[i]);
      if (st.shelf) st.shelf[i] = S.inv[i];
      renderTray();
    });
    $('pd-refill').addEventListener('click', () => { ctx.tray.refill(); if (st.shelf) st.shelf = S.inv.slice(); renderTray(); ctx.toast('Every pocket marked full.'); });
    $('pd-empty-all').addEventListener('click', () => { ctx.tray.setAll(S.inv.map(() => 0)); if (st.shelf) st.shelf = S.inv.slice(); renderTray(); });

    /* ---------- jog ---------- */
    $('pd-step').addEventListener('click', (e) => {
      const b = e.target.closest('[data-step]');
      if (!b) return;
      st.step = +b.dataset.step;
      $('pd-step').querySelectorAll('[data-step]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    });
    const feedFor = (axis, step) => {
      const s = S.settings;
      if (axis === 'z') return step <= 1 ? 150 : s.rapidZ;
      return step <= 1 ? 300 : s.rapidXY;
    };
    function jogStep(dir, dist) {
      if (!st.link) return;
      const axis = dir[0], sign = dir[1] === '+' ? 1 : -1;
      const step = dist != null ? dist : axis === 'z' ? Math.min(st.step, 10) : st.step;
      st.link.command(G.jog({ [axis]: sign * step }, feedFor(axis, step))).then((r) => {
        if (r.type === 'error') ctx.toast(`Jog refused: ${r.text}`, true);
      });
    }
    const jogPad = panel.querySelector('.jog');
    jogPad.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('[data-jog]');
      if (!b || b.disabled || e.button !== 0) return;
      b.setPointerCapture(e.pointerId);
      const dir = b.dataset.jog;
      st.jogHold = { dir, long: false, t: setTimeout(() => { st.jogHold.long = true; jogStep(dir, dir[0] === 'z' ? 30 : 200); }, 320) };
    });
    const release = () => {
      const j = st.jogHold;
      if (!j) return;
      st.jogHold = null;
      clearTimeout(j.t);
      if (j.long) { if (st.port) st.port.writeByte(G.RT.jogCancel); } else jogStep(j.dir);
    };
    jogPad.addEventListener('pointerup', release);
    jogPad.addEventListener('pointercancel', () => { if (st.jogHold) { clearTimeout(st.jogHold.t); if (st.jogHold.long && st.port) st.port.writeByte(G.RT.jogCancel); st.jogHold = null; } });
    window.addEventListener('blur', () => { if (st.jogHold && st.jogHold.long && st.port) st.port.writeByte(G.RT.jogCancel); st.jogHold = null; });
    $('pd-jstop').addEventListener('click', () => { if (st.port) st.port.writeByte(G.RT.jogCancel); });
    panel.addEventListener('keydown', (e) => {
      if (!st.link || e.target.closest('input, select, textarea, summary')) return;
      const map = { ArrowLeft: 'x-', ArrowRight: 'x+', ArrowUp: 'y+', ArrowDown: 'y-', PageUp: 'z+', PageDown: 'z-' };
      if (map[e.key] && !st.link.busy) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) jogStep(map[e.key]); }
    });

    /* ---------- origin ---------- */
    const cmd = async (line, what) => {
      const r = await st.link.command(line);
      if (r.type === 'error') ctx.toast(`${what || 'Command'} failed: ${r.text}`, true);
      else if (r.type === 'alarm') ctx.toast(`${what || 'Command'} raised ALARM:${r.code}. ${r.text}`, true);
      return r;
    };
    $('pd-zxy').addEventListener('click', () => cmd(G.setZero('XY'), 'Set X0 Y0').then((r) => r.type === 'ok' && ctx.toast('The fence corner is X0 Y0 now.')));
    $('pd-zz').addEventListener('click', () => cmd(G.setZero('Z'), 'Set Z0').then((r) => r.type === 'ok' && ctx.toast('The bed is Z0 now.')));
    const travelZ = () => {
      const r = S.result;
      const z = st.link.machine.wpos ? st.link.machine.wpos[2] : 0;
      return Math.max(z, r && r.clearZ ? r.clearZ : 20);
    };
    $('pd-raise').addEventListener('click', () => cmd(`G90G0Z${G.f3(travelZ())}`, 'Raise'));
    $('pd-goto0').addEventListener('click', async () => {
      if ((await cmd(`G90G0Z${G.f3(travelZ())}`, 'Raise')).type === 'ok') cmd('G0X0Y0', 'Go to X0 Y0');
    });
    $('pd-touch').addEventListener('click', async () => {
      const s = S.settings, m = st.link.machine;
      if (!m.wpos) return;
      if (m.probe) { ctx.toast('The float already reads pressed. Lift the tip first.', true); return; }
      if (!window.confirm(`The tip moves down up to ${s.touchMax} mm at ${s.touchFeed} mm/min until the float trips, then Z0 is set ${s.tripTravel} mm above that point. The iron can be cold. Go?`)) return;
      let prb = null;
      st.touch = (p) => { prb = p; };
      const r = await cmd(`G90G38.2Z${G.f3(m.wpos[2] - s.touchMax)}F${G.f3(s.touchFeed)}`, 'Touch-off');
      st.touch = null;
      if (r.type !== 'ok' || !prb || !prb.ok) { if (r.type === 'ok') ctx.toast('Touch-off ended without the float tripping.', true); return; }
      await cmd(`G10L2P1Z${G.f3(prb.pos[2] + s.tripTravel)}`, 'Set Z0');
      await cmd('G0Z5', 'Lift');
      log(`Found the bed: Z0 set ${s.tripTravel} mm above the trip point.`);
      ctx.toast('Z0 set from the float.');
    });
    $('pd-unlock').addEventListener('click', () => cmd('$X', 'Unlock'));
    $('pd-reset').addEventListener('click', () => st.port && st.port.writeByte(G.RT.reset));

    const sendCon = () => {
      const v = $('con-input').value.trim();
      if (!v || !st.link) return;
      if (st.link.busy) { ctx.toast('A job is running. Use the console when it stops.', true); return; }
      if (v.length > 70) { ctx.toast('GRBL lines must stay under 72 characters.', true); return; }
      $('con-input').value = '';
      st.link.command(v);
    };
    $('con-send').addEventListener('click', sendCon);
    $('con-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendCon(); } e.stopPropagation(); });

    /* ---------- job ---------- */
    function renderJob() {
      const holes = ctx.jobLabels();
      const sel = $('pd-from');
      const prev = sel.value;
      if (sel.options.length !== holes.length) sel.innerHTML = holes.map((l, i) => `<option value="${i}">${esc(l)}</option>`).join('');
      if (prev && +prev < holes.length) sel.value = prev;
      const r = S.result;
      $('pd-job-sum').textContent = holes.length && r ? `${esc(S.name)} · ${holes.length} insert${holes.length === 1 ? '' : 's'} · about ${ctx.fmtTime(r.seconds)}` : 'No holes yet';
      const errs = r ? r.issues.filter((i) => i.level === 'error') : [];
      const L = st.link;
      let block = '';
      if (!S.part) block = 'Open a part first. You can still move the machine and set the origin.';
      else if (!holes.length) block = 'Add holes to the press order first.';
      else if (errs.length) block = `Fix ${errs.length === 1 ? 'this' : `${errs.length} problems`} on the Review step first: ${esc(errs[0].text)}`;
      else if (L && L.machine.state === 'Alarm') block = 'Clear the alarm first.';
      else if (L && L.machine.state !== 'Idle' && !L.busy) block = `The machine is ${L.machine.state}. Wait for Idle.`;
      $('pd-block').hidden = !block;
      $('pd-block').innerHTML = block;
      const busy = !!(L && L.busy);
      $('pd-run').disabled = !!block || busy;
      $('pd-check-run').disabled = !!block || busy;
    }

    function buildProgram(check) {
      const from = +$('pd-from').value || 0;
      const only = $('pd-only').checked;
      const air = $('pd-air').checked && !check ? 20 : 0;
      const gen = ctx.buildRun({ from, only, air });
      return { gen, prog: G.prepare(gen.text), air, from, only };
    }

    $('pd-run').addEventListener('click', () => {
      const s = S.settings, m = st.link.machine;
      if (m.probe) { ctx.toast('The float reads pressed. GRBL would raise ALARM:4 at the first press. Lift the tip or check $6.', true); return; }
      const p = buildProgram(false);
      const items = [
        'X0 Y0 is the fence corner and Z0 the bed (or Find the bed ran this session).',
        p.air ? 'Air pass: the iron can stay cold.' : `The iron is at ${s.tipTemp} °C.`,
        `The part sits ${ctx.insts().length > 1 || S.place.x || S.place.y ? 'on the printed template outline' : 'in the fence corner'}.`,
      ];
      if (tray() && !p.air) {
        const c = IP.tray.counts(s, S.inv);
        items.push(`The tray holds what the planner shows: ${Object.entries(c).map(([k, v]) => `${v.full} ${insName(k)}`).join(', ')}. The tray is metal or high-temp.`);
        const short = p.gen.issues.filter((i) => i.short);
        for (const i of short) items.push(`<b>${esc(i.text)}</b>`);
      } else if (!p.air) items.push('You have the inserts ready; it pauses at each hole for you.');
      items.push(`${p.gen.stats.inserts} hole${p.gen.stats.inserts === 1 ? '' : 's'}${p.only ? ' (test press)' : ''}, starting at hole ${esc(ctx.jobLabels()[p.from])}. About ${ctx.fmtTime(p.gen.seconds)}.`);
      $('pd-confirm-list').innerHTML = items.map((t) => `<li>${t}</li>`).join('');
      $('pd-setup').hidden = true;
      $('pd-confirm').hidden = false;
      st.pending = p;
    });
    $('pd-cancel').addEventListener('click', () => { $('pd-confirm').hidden = true; $('pd-setup').hidden = false; st.pending = null; });
    $('pd-go').addEventListener('click', () => { $('pd-confirm').hidden = true; startRun(st.pending, false); });
    $('pd-check-run').addEventListener('click', async () => {
      const p = buildProgram(true);
      const r = await cmd('$C', 'Check mode');
      if (r.type !== 'ok') return;
      startRun(p, true);
    });

    function startRun(p, check) {
      if (!p || !st.link) return;
      const labels = G.holesOf(p.prog);
      const stuckIdx = Math.min(labels.length - 1, Math.floor(labels.length / 2));
      const world = ctx.worldHoles();
      const sim = st.port.kind === 'sim';
      st.run = { check, labels, marks: {}, done: 0, t0: performance.now(), est: p.gen.seconds, checkErrors: [], air: p.air, clearZ: p.gen.clearZ,
        stuck: !check && sim && $('pd-sim-stuck').checked ? world.find((h) => h.label === labels[stuckIdx]) : null };
      if (sim) {
        st.shelf = S.inv.slice();
        if ($('pd-sim-empty').checked && tray()) for (const pk of (p.gen.picks || []).slice(0, 2)) st.shelf[pk.pocket] = 0;
      }
      st.carry = null; st.missKind = null;
      st.lastPrompt = null;
      $('pd-track').innerHTML = check ? '' : labels.map((l) => `<i data-l="${esc(l)}" title="Hole ${esc(l)}"></i>`).join('');
      const opts = { pauseOnTrip: $('pd-trip').checked, check };
      if (tray() && !p.air) Object.assign(opts, { onMiss, remap });
      if (!st.link.stream(p.prog, opts, performance.now())) {
        ctx.toast('The controller is busy. Try again in a moment.', true);
        st.run = null; $('pd-setup').hidden = false;
        return;
      }
      $('pd-setup').hidden = true;
      $('pd-live').hidden = false;
      ctx.setRunMarks({});
      if (!check) { askWake(); log(`Started${p.air ? ' an air pass' : ''}: ${labels.length} hole${labels.length === 1 ? '' : 's'}.`); }
      render();
    }

    function onAck(a) {
      const run = st.run;
      if (!run || run.check || a.entry.kind !== 'probe' || a.entry.hole == null || a.entry.pick) return;
      const l = a.entry.hole;
      st.carry = null;
      if (run.marks[l] !== 'trip') run.marks[l] = 'done';
      run.done = Object.keys(run.marks).length;
      ctx.setRunMarks(run.marks);
    }

    function onStreamState(s) {
      const run = st.run;
      if (s.state === 'trip') log('Holding between holes. Check the insert, then Continue or Stop.', 'bad');
      if (s.state === 'between') { log('Paused between holes.'); chime(1); }
      if (s.state === 'pick') log(esc(s.text || 'The pocket was empty.'), 'bad');
      if (s.state === 'error') { log('<b>Stopped moving:</b> GRBL rejected a line. Skip it and continue, or stop.', 'bad'); chime(2); }
      if (s.state === 'alarm') { log(`<b>Run ended by an alarm.</b> ${esc((s.error && s.error.text) || '')} ${esc((s.error && s.error.hint) || '')}`, 'bad'); finish(); }
      if (s.state === 'stopped') { log(`Stopped${run && !run.check ? ` after ${run.done} of ${run.labels.length} holes` : ''}. Position was kept.`); finish(true); }
      if (s.state === 'done') {
        if (run && run.check) {
          const n = run.checkErrors.length;
          log(n ? `<b>Check found ${n} problem${n === 1 ? '' : 's'}:</b> ${run.checkErrors.slice(0, 4).map((e) => `line ${e.entry.src + 1} ${esc(e.text)}`).join('; ')}` : `Checked ${st.link.streamer.prog.length} lines on the controller. GRBL accepted every one.`, n ? 'bad' : 'good');
          if (st.link) st.link.command('$C');
        } else if (run) {
          const secs = (performance.now() - run.t0) / 1000;
          const sk = st.link.streamer.misses.length;
          log(`<b>Done:</b> ${run.done} hole${run.done === 1 ? '' : 's'} in ${ctx.fmtTime(secs)}${st.link.streamer.trips.length ? `, ${st.link.streamer.trips.length} float trip${st.link.streamer.trips.length === 1 ? '' : 's'}` : ''}${sk ? `, ${sk} empty pocket${sk === 1 ? '' : 's'} skipped` : ''}.`, 'good');
          chime(1);
          if (st.link.streamer.trips.length) {
            const first = run.labels.indexOf(st.link.streamer.trips[0].hole);
            if (first >= 0) $('pd-from').value = String(first);
          }
        }
        finish();
      }
      render();
    }

    function finish(stopped) {
      const run = st.run;
      if (run && stopped && !run.check) {
        const next = run.labels.findIndex((l) => !run.marks[l]);
        const base = ctx.jobLabels().indexOf(run.labels[Math.max(0, next)]);
        if (next >= 0 && base >= 0) $('pd-from').value = String(base);
      }
      st.run = run ? Object.assign(run, { over: true }) : null;
      st.carry = null;
      endWake();
      $('pd-live').hidden = true;
      $('pd-setup').hidden = false;
      $('pd-prompt').hidden = true;
      ctx.setLiveTray(null);
      renderTray();
    }

    function renderRunState() {
      const L = st.link, run = st.run;
      if (!L || !run || run.over) return;
      const s = L.streamer, cur = s.current(), m = L.machine;
      const waiting = m.state === 'Hold' && s.state === 'running' && cur && cur.kind === 'pause';
      const prompt = s.state === 'trip' ? 'The float tripped. Check that hole, then continue.'
        : s.state === 'between' ? 'Paused between holes. Continue when you are ready.'
        : s.state === 'pick' ? (st.missKind === 'out' ? `No full pockets left for this size. Refill them, then Continue.` : 'That pocket was empty. Continue tries the next one.')
        : s.state === 'error' ? `GRBL rejected: ${s.error ? s.error.text : ''}`
        : waiting ? (cur.msg || 'Paused for Cycle Start') : null;
      $('pd-prompt').hidden = !prompt;
      if (prompt) {
        $('pd-prompt-t').textContent = prompt;
        $('pd-cont').textContent = s.state === 'error' ? (s.pickErr ? 'Try another pocket' : 'Skip that line and continue') : s.state === 'pick' && st.missKind === 'out' ? 'I refilled them: continue' : 'Continue';
        const key = (cur ? cur.src : '') + s.state;
        if (waiting && st.lastPrompt !== key) chime(1);
        st.lastPrompt = key;
      }
      $('pd-prompt').dataset.tone = s.state === 'running' || s.state === 'between' ? 'go' : 'bad';
      const label = cur && cur.hole;
      const what = !cur ? 'Starting' : cur.pick ? `Picking up from pocket ${cur.pick.n}` : cur.toPocket ? `To pocket ${cur.toPocket.n}` : cur.kind === 'probe' ? `Pressing hole ${label}` : cur.kind === 'dwell' ? `Holding hole ${label}`
        : cur.kind === 'pause' ? (label ? `Waiting at hole ${label}` : 'Waiting to start') : label ? `Moving to hole ${label}` : 'Finishing';
      $('pd-now').textContent = run.check ? `Checking line ${s.acked} of ${s.prog.length}` : `${what}. ${run.done} of ${run.labels.length} done.`;
      $('pd-pause').textContent = s.state === 'held' ? 'Resume' : 'Pause';
      $('pd-pause').disabled = !['running', 'held'].includes(s.state);
      $('pd-after').disabled = s.state !== 'running' || s.holdAtBoundary;
      if (!run.check) {
        $('pd-track').querySelectorAll('i').forEach((i) => { i.className = run.marks[i.dataset.l] || (i.dataset.l === label ? 'now' : ''); });
        const marks = Object.assign({}, run.marks);
        if (label && !marks[label]) marks[label] = 'now';
        ctx.setRunMarks(marks);
      }
      if (tray()) renderTray();
    }

    function tickRun() {
      const run = st.run;
      if (!run || run.over) return;
      const el = (performance.now() - run.t0) / 1000;
      $('pd-el').textContent = ctx.fmtTime(el);
      const frac = run.labels.length ? run.done / run.labels.length : 0;
      const left = Math.max(0, run.est * (1 - frac));
      const at = new Date(Date.now() + left * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      $('pd-left').textContent = run.check ? '' : `about ${ctx.fmtTime(left)} left · done ${at}`;
    }

    $('pd-cont').addEventListener('click', () => {
      const s = st.link && st.link.streamer;
      if (!s) return;
      if (['trip', 'error', 'between', 'pick'].includes(s.state)) s.resume();
      else s.cycleStart();
      render();
    });
    $('pd-pause').addEventListener('click', () => {
      const s = st.link && st.link.streamer;
      if (!s) return;
      if (s.state === 'held') s.resume(); else s.pause();
      render();
    });
    $('pd-after').addEventListener('click', () => { if (st.link) { st.link.streamer.pauseAfterHole(); log('Will hold after this hole.'); render(); } });
    $('pd-stop').addEventListener('click', () => { if (st.link) { st.link.streamer.stop(performance.now()); log('Stopping: feed hold, then reset once the tip stops.'); } });
    panel.querySelectorAll('[data-ov]').forEach((b) => b.addEventListener('click', () => st.port && st.port.writeByte(+b.dataset.ov)));

    /* ---------- wake lock, chime, leaving ---------- */
    async function askWake() { try { if (navigator.wakeLock) st.wake = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed */ } }
    function endWake() { try { if (st.wake) st.wake.release(); } catch (e) { /* gone */ } st.wake = null; }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && st.link && st.link.busy && !st.wake) askWake(); });
    let audio = null;
    function chime(n) {
      if (!$('pd-chime').checked) return;
      try {
        audio = audio || new (window.AudioContext || window.webkitAudioContext)();
        const t = audio.currentTime;
        for (let i = 0; i < (n || 1) * 2; i++) {
          const o = audio.createOscillator(), g = audio.createGain();
          o.frequency.value = i % 2 ? 1175 : 880;
          g.gain.setValueAtTime(0.0001, t + i * 0.16);
          g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.16 + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.15);
          o.connect(g); g.connect(audio.destination);
          o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.16);
        }
      } catch (e) { /* no audio */ }
    }
    window.addEventListener('beforeunload', (e) => { if (st.link && st.link.busy) { e.preventDefault(); e.returnValue = ''; } });

    render();
    return { render, shown, renderTray, get connected() { return !!st.link; }, get running() { return !!(st.link && st.link.busy); }, state: st };
  }

  IP.ui.machine = { init };
})();
