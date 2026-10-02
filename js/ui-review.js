/* InsertPress Planner — the Review step: job time, problems, press settings
 * (plastic and iron up front, the rest under Advanced), where the inserts come
 * from, parts list, export, the 1:1 template, the G-code, and the animated preview.
 */
(function () {
  'use strict';
  const IP = window.IP;
  IP.ui = IP.ui || {};
  const TIME_PARTS = [
    ['travel', 'Travel', '#6f9bb0'], ['tray', 'Tray trips', '#9c7a3c'], ['rapidZ', 'Z moves', '#a3acb0'], ['press', 'Pressing', '#e8743f'],
    ['dwell', 'Holding', '#b6461f'], ['lift', 'Lifting', '#d9ab4f'], ['load', 'Loading', '#4c565b'],
  ];
  const ADV = ['pressFeed', 'dwell', 'sink', 'approachGap', 'retractSlow', 'retractFeed', 'clearance', 'loadMode', 'wallMin', 'defaultInsert', 'insertCost'];

  function init(ctx) {
    const { $, S, esc, fmt, fmtTime } = ctx;
    const F = IP.ui.fields;
    let codeEls = [], shown = false;

    $('job-material').innerHTML = Object.entries(IP.MATERIALS).map(([k, m]) => `<option value="${k}">${m.name}</option>`).join('');

    function renderForm() {
      const s = S.settings;
      if (document.activeElement !== $('job-material')) $('job-material').value = s.material;
      if (document.activeElement !== $('job-temp')) $('job-temp').value = s.tipTemp;
      const tray = s.mode === 'xy';
      document.querySelectorAll('#job-feed [data-feed]').forEach((b) => {
        b.setAttribute('aria-checked', String(b.dataset.feed === (ctx.trayOn() ? 'tray' : 'hand')));
        if (b.dataset.feed === 'tray') b.disabled = !tray;
      });
      const form = $('job-adv-form');
      if (!form.contains(document.activeElement)) form.innerHTML = ADV.filter((k) => k !== 'loadMode' || !ctx.trayOn()).map((k) => F.html(k, s)).join('');
      const note = $('feed-note');
      if (s.mode !== 'xy') note.innerHTML = 'The tray needs X and Y motion; this machine is set to Z only.';
      else if (!ctx.trayOn()) note.innerHTML = s.loadMode === 'start' ? 'You place every insert at the start, then it presses them all.' : 'The machine pauses over each hole for you to set an insert on it.';
      else {
        const c = IP.tray.counts(s, S.inv);
        const need = {};
        for (const h of ctx.worldHoles()) need[h.insert] = (need[h.insert] || 0) + 1;
        const parts = Object.keys(need).map((k) => {
          const have = c[k] ? c[k].full : 0;
          return `<span class="${have < need[k] ? 'short' : ''}"><b>${need[k]}</b> ${esc(IP.INSERTS[k].name)} <i>(${have} in tray)</i></span>`;
        });
        note.innerHTML = `${parts.join(' ') || 'No inserts yet.'} <button class="link" id="btn-edit-tray">Edit tray</button>`;
      }
    }

    function render() {
      renderForm();
      const r = S.result;
      const exp = !!(r && r.text) && !r.issues.some((i) => i.level === 'error');
      $('btn-export').disabled = !exp;
      $('btn-export').title = r && r.issues.some((i) => i.level === 'error') ? 'Fix the problems first' : '';
      $('btn-run-machine').disabled = !(r && r.text);
      ['btn-copy', 'btn-air'].forEach((id) => { $(id).disabled = !(r && r.text); });
      $('btn-template').disabled = !S.order.length;
      $('btn-save-job-2').disabled = !S.part;
      if (!r || !r.stats) {
        $('time-big').textContent = '–';
        $('time-sub').textContent = 'Add holes to see the job time.';
        ['time-bar', 'time-legend', 'bom', 'issues'].forEach((id) => { $(id).innerHTML = ''; });
        $('bom-aside').textContent = '';
        renderCode(r); timelineVis();
        return;
      }
      const st = r.stats, T = st.time, total = r.seconds || 1;
      $('time-big').textContent = fmtTime(r.seconds);
      const copies = ctx.insts().length;
      $('time-sub').textContent = `${st.inserts} insert${st.inserts === 1 ? '' : 's'}${copies > 1 ? ` on ${copies} parts, ${fmtTime(r.seconds / copies)} each` : ''}${ctx.trayOn() ? ', picked from the tray' : ''}.`;
      $('time-bar').innerHTML = TIME_PARTS.map(([k, , col]) => (T[k] > 0 ? `<i style="width:${(T[k] / total) * 100}%;background:${col}" title="${k}"></i>` : '')).join('');
      $('time-legend').innerHTML = TIME_PARTS.filter(([k]) => T[k] > 0.05).map(([k, label, col]) => `<li><i style="background:${col}"></i>${label}<b>${fmtTime(T[k])}</b></li>`).join('');
      const cost = S.settings.insertCost > 0;
      const rows = Object.entries(st.bom).map(([name, q]) => `<tr><td>${esc(name)} heat-set insert</td><td>${q}</td>${cost ? `<td>$${(q * S.settings.insertCost).toFixed(2)}</td>` : ''}</tr>`).join('');
      $('bom').innerHTML = `<tr><th>Item</th><th>Qty</th>${cost ? '<th>Cost</th>' : ''}</tr>${rows}<tr class="total"><td>Total</td><td>${st.inserts}</td>${cost ? `<td>$${st.cost.toFixed(2)}</td>` : ''}</tr>`;
      $('bom-aside').textContent = `Travel Z ${fmt(r.clearZ)} · ${st.travelDist >= 1000 ? (st.travelDist / 1000).toFixed(2) + ' m' : Math.round(st.travelDist) + ' mm'} X/Y`;
      const iss = r.issues.slice().sort((a, b) => (a.level === 'error' ? 0 : 1) - (b.level === 'error' ? 0 : 1));
      $('issues').innerHTML = iss.slice(0, 8).map((i) => `<li class="${i.level}">${esc(i.text)}</li>`).join('') + (iss.length > 8 ? `<li>And ${iss.length - 8} more like these.</li>` : '');
      renderCode(r);
      timelineVis();
      if (sim.t > r.seconds) sim.t = 0;
      if (shown) simSet(sim.t);
    }

    function renderCode(r) {
      const code = $('code');
      if (!r || !r.text) { code.innerHTML = '<span class="ln c">; Add at least one hole to the press order.</span>'; codeEls = []; $('code-lines').textContent = ''; return; }
      if (!$('code-box').open) { codeEls = []; code.dataset.stale = '1'; $('code-lines').textContent = `${r.stats.lines} lines`; return; }
      const lines = r.text.trimEnd().split('\n');
      $('code-lines').textContent = `${lines.length} lines`;
      code.innerHTML = lines.map((l) => {
        const [cmd, ...rest] = l.split(';');
        const note = rest.join(';');
        const comment = rest.length ? `<span class="c">;${esc(note)}</span>` : '';
        let cls = '';
        if (/^\(MSG|^M0/.test(cmd)) cls = 'm';
        else if (/press|pick/.test(note)) cls = 'g';
        return `<span class="ln">${cls ? `<span class="${cls}">${esc(cmd)}</span>` : esc(cmd)}${comment}</span>`;
      }).join('');
      code.dataset.stale = '';
      codeEls = Array.from(code.children);
    }
    $('code-box').addEventListener('toggle', () => { if ($('code-box').open) { renderCode(S.result); markCodeLine(true); } });

    function timelineVis() {
      const has = !!(S.result && S.result.moves.length) && shown && !S.live && S.screen === 'job';
      $('timeline').hidden = !has;
      $('stage').classList.toggle('has-timeline', has);
      if (!has && !S.live) { simStop(); ctx.viewer.setTip(null); }
    }

    /* ---------- preview ---------- */
    const sim = { t: 0, playing: false, speed: 4, last: 0, line: -1, picks: -1 };
    function simSet(t) {
      const r = S.result;
      if (!r || !r.moves.length) return;
      sim.t = ctx.clamp(t, 0, r.seconds);
      const smp = IP.gcode.sample(r.moves, sim.t);
      const m = smp.move;
      if (!S.live) ctx.viewer.setTip(smp.pos, m.kind === 'pick' ? 'press' : m.kind, m.carry || null);
      $('sim-range').value = String(Math.round((sim.t / (r.seconds || 1)) * 1000));
      $('sim-time').textContent = `${fmtTime(sim.t)} / ${fmtTime(r.seconds)}`;
      const hn = m.hole != null ? `<b>hole ${m.hole}</b> of ${r.stats.inserts}` : '';
      const pocket = m.pocket != null ? `pocket ${m.pocket + 1}` : 'the tray';
      const what = {
        travel: () => (m.pocket != null ? `To ${pocket} for ${hn}` : m.carry ? `Carrying an insert to ${hn}` : `Moving to ${hn}`),
        rapid: () => (m.to[2] < m.from[2] ? `Dropping to ${m.pocket != null ? pocket : hn || 'start'}` : `Raising${hn ? ' from ' + (m.pocket != null ? pocket : hn) : ''}`),
        pick: () => `Picking up from ${pocket}`,
        press: () => `Pressing ${hn}`,
        dwell: () => `Holding ${hn}`,
        lift: () => `Easing off ${m.pocket != null ? pocket : hn}`,
        pause: () => (m.hole != null ? (ctx.trayOn() ? `Paused: refill the tray` : `Paused: load ${hn}`) : 'Paused: waiting for Cycle Start'),
      }[m.kind];
      $('sim-what').innerHTML = sim.t <= 1e-6 ? 'Ready. Press play to watch the job.' : sim.t >= r.seconds - 1e-6 ? 'Done' : what ? what() : '';
      $('sim-xyz').innerHTML = `X ${ctx.f2(smp.pos[0])}<br>Y ${ctx.f2(smp.pos[1])}<br>Z ${ctx.f2(smp.pos[2])}`;
      if (m.line !== sim.line) { sim.line = m.line; markCodeLine(false); }
      if (ctx.trayOn()) {
        const n = r.moves.filter((x) => x.kind === 'pick' && x.t0 <= sim.t).length;
        if (n !== sim.picks) { sim.picks = n; ctx.updateTray(sim.t); }
      }
    }
    function markCodeLine(force) {
      const code = $('code');
      code.querySelectorAll('.ln.now').forEach((n) => n.classList.remove('now'));
      const el = codeEls[sim.line];
      if (!el) return;
      el.classList.add('now');
      if (sim.playing || force) code.scrollTop = Math.max(0, el.offsetTop - code.clientHeight / 2);
    }
    function loop(ts) {
      if (!sim.playing) return;
      const dt = sim.last ? ((ts - sim.last) / 1000) * sim.speed : 0;
      sim.last = ts;
      simSet(sim.t + dt);
      if (sim.t >= S.result.seconds - 1e-6) { simStop(); return; }
      requestAnimationFrame(loop);
    }
    function simPlay() {
      if (!S.result || !S.result.moves.length) return;
      if (S.step !== 'review') ctx.goStep('review');
      if (sim.t >= S.result.seconds - 1e-6) sim.t = 0;
      sim.playing = true; sim.last = 0;
      $('sim-play').classList.add('on');
      requestAnimationFrame(loop);
    }
    function simStop() { sim.playing = false; $('sim-play').classList.remove('on'); }
    $('sim-play').addEventListener('click', () => (sim.playing ? simStop() : simPlay()));
    $('sim-range').addEventListener('input', (e) => { simStop(); if (S.result) { simSet((+e.target.value / 1000) * S.result.seconds); markCodeLine(true); } });
    $('sim-speed').addEventListener('change', (e) => { sim.speed = +e.target.value; });

    /* ---------- template ---------- */
    function buildTemplate() {
      const list = ctx.insts();
      const ab = ctx.arrayBox();
      const tray = ctx.trayOn() ? IP.tray.outline(S.settings) : null;
      const W = Math.ceil(Math.max(ab.x + ab.w, tray ? tray.x1 : 0, 80) + 14);
      const H = Math.ceil(Math.max(ab.y + ab.h, tray ? tray.y1 : 0, 60) + 30);
      const Y = (y) => (H - y).toFixed(2);
      const X = (x) => x.toFixed(2);
      const o = [];
      o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">`);
      o.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
      for (let x = 10; x < W; x += 10) o.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${x % 50 ? '#eee' : '#d8d8d8'}" stroke-width="0.2"/>`);
      for (let y = 10; y < H; y += 10) o.push(`<line x1="0" y1="${Y(y)}" x2="${W}" y2="${Y(y)}" stroke="${y % 50 ? '#eee' : '#d8d8d8'}" stroke-width="0.2"/>`);
      o.push(`<path d="M0.4 ${H - 40} V${H - 0.4} H40" fill="none" stroke="#000" stroke-width="0.8"/>`);
      o.push(`<text x="3" y="${H - 3}" font-size="2.6">Fence corner (X0 Y0)</text>`);
      if (tray) {
        o.push(`<rect x="${X(tray.x0)}" y="${Y(tray.y1)}" width="${X(tray.x1 - tray.x0)}" height="${X(tray.y1 - tray.y0)}" fill="#eef0f1" stroke="#555" stroke-width="0.3" stroke-dasharray="1.5 1"/>`);
        o.push(`<text x="${X(tray.x0 + 1)}" y="${Y(tray.y1) - 1}" font-size="2.6">Tray</text>`);
      }
      list.forEach((inst) => {
        const pts = S.hull.map(([x, y]) => { const w = IP.place.toWorld(inst, x, y); return `${X(w.x)},${Y(w.y)}`; }).join(' ');
        o.push(`<polygon points="${pts}" fill="#f6edda" stroke="#8a6420" stroke-width="0.35"/>`);
        const c = IP.place.toWorld(inst, S.part.size.x / 2, S.part.size.y / 2);
        if (list.length > 1) o.push(`<text x="${X(c.x)}" y="${Y(c.y)}" font-size="3.2" fill="#8a6420" text-anchor="middle">Copy ${inst.i + 1}</text>`);
      });
      const wh = ctx.worldHoles();
      wh.forEach((h) => {
        const r = (h.dia || IP.INSERTS[h.insert].hole) / 2;
        o.push(`<circle cx="${X(h.x)}" cy="${Y(h.y)}" r="${r.toFixed(2)}" fill="none" stroke="#000" stroke-width="0.25"/>`);
        o.push(`<path d="M${X(h.x - r - 1.5)} ${Y(h.y)} H${X(h.x + r + 1.5)} M${X(h.x)} ${Y(h.y - r - 1.5)} V${Y(h.y + r + 1.5)}" stroke="#000" stroke-width="0.15"/>`);
        o.push(`<text x="${X(h.x + r + 0.8)}" y="${(H - h.y - r - 0.6).toFixed(2)}" font-size="2.4">${h.label}</text>`);
      });
      const sy = 8;
      o.push(`<path d="M10 ${sy} H60 M10 ${sy - 2} V${sy + 2} M60 ${sy - 2} V${sy + 2}" stroke="#000" stroke-width="0.4"/>`);
      o.push(`<text x="62" y="${sy + 1}" font-size="2.8">50 mm. Measure this after printing at 100%.</text>`);
      o.push(`<text x="10" y="${sy + 8}" font-size="3.4" font-weight="bold">${esc(S.name)}: ${wh.length} inserts, ${list.length} part${list.length > 1 ? 's' : ''}</text>`);
      o.push('</svg>');
      return o.join('\n');
    }

    /* ---------- events ---------- */
    $('job-material').addEventListener('change', (e) => ctx.setSetting('material', e.target.value));
    $('job-temp').addEventListener('change', (e) => { const v = parseFloat(e.target.value); if (isFinite(v)) ctx.setSetting('tipTemp', v); });
    $('job-feed').addEventListener('click', (e) => {
      const b = e.target.closest('[data-feed]');
      if (!b || b.disabled) return;
      ctx.setSetting('feed', b.dataset.feed);
      if (b.dataset.feed === 'tray') ctx.toast('The machine picks each insert from the tray. Check the tray in Machine setup.');
    });
    $('feed-note').addEventListener('click', (e) => { if (e.target.id === 'btn-edit-tray') ctx.ui.setup.open('tray'); });
    $('job-adv-form').addEventListener('change', (e) => { const r = F.read(e.target); if (r) ctx.setSetting(r.key, r.value); });
    const exportText = () => ctx.buildRun({ from: 0, export: true }).text;
    $('btn-export').addEventListener('click', () => {
      ctx.download(`${S.name}.gcode`, exportText(), 'text/plain');
      ctx.toast(ctx.trayOn() ? `Downloaded ${S.name}.gcode. Pockets come from the current tray; an empty one stops it with ALARM:5.` : `Downloaded ${S.name}.gcode`);
    });
    $('btn-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(exportText()); ctx.toast('Copied the G-code.'); }
      catch (e) { ctx.toast('Copy is blocked here. Use Download G-code instead.', true); }
    });
    $('btn-air').addEventListener('click', () => {
      ctx.download(`${S.name}-air-pass.gcode`, ctx.buildRun({ from: 0, air: 20 }).text, 'text/plain');
      ctx.toast('Downloaded the air pass: every Z is 20 mm higher, so nothing touches.');
    });
    $('btn-template').addEventListener('click', () => {
      ctx.download(`${S.name}-template.svg`, buildTemplate(), 'image/svg+xml');
      ctx.toast('Downloaded the placement template. Print it at 100% scale.');
    });
    $('btn-run-machine').addEventListener('click', () => ctx.goScreen('run'));

    return {
      render,
      stop: simStop,
      toggle() { if (sim.playing) simStop(); else simPlay(); },
      simTime: () => (shown && S.result && sim.t > 0 ? sim.t : null),
      stepShown(on) { shown = on; timelineVis(); if (on) { renderCode(S.result); simSet(sim.t); } else { sim.picks = -1; ctx.updateTray(null); } },
      liveChanged() { timelineVis(); if (!S.live && shown) simSet(sim.t); },
      buildTemplate,
    };
  }

  IP.ui.review = { init };
})();
