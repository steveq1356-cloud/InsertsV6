/* InsertPress Planner — machine setup: a short wizard (bed, fence, iron, float,
 * tray), re-openable at any page, with machine profiles. Also the settings field
 * schema (IP.ui.fields) that the Review step's Advanced block uses.
 */
(function () {
  'use strict';
  const IP = window.IP;
  IP.ui = IP.ui || {};
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (v) => IP.gcode.fmt(v);

  /* ---------- fields ---------- */
  const FIELDS = {
    mode: { label: 'Motion', type: 'select', options: [['xy', 'Moves X and Y'], ['manual', 'Z only (slide the part by hand)']] },
    bedX: { label: 'X travel from the fence', unit: 'mm', step: 10 },
    bedY: { label: 'Y travel from the fence', unit: 'mm', step: 10 },
    bedZ: { label: 'Z travel above the bed', unit: 'mm', step: 5 },
    park: { label: 'Park when finished', type: 'bool' },
    parkX: { label: 'Park X', unit: 'mm', step: 10 },
    parkY: { label: 'Park Y', unit: 'mm', step: 10 },
    rapidXY: { label: 'Rapid speed X/Y ($110)', unit: 'mm/min', step: 100, help: 'Used for the time estimate and preview.' },
    rapidZ: { label: 'Rapid speed Z ($112)', unit: 'mm/min', step: 50 },
    fenceH: { label: 'Fence height above the bed', unit: 'mm', step: 1 },
    ironTipD: { label: 'Tip diameter', unit: 'mm', step: 0.5 },
    ironTipL: { label: 'Tip length below the nut', unit: 'mm', step: 1 },
    ironNutD: { label: 'Tip nut diameter', unit: 'mm', step: 0.5 },
    ironNutL: { label: 'Tip nut length', unit: 'mm', step: 1 },
    ironBodyD: { label: 'Iron body diameter', unit: 'mm', step: 0.5 },
    carriageD: { label: 'Z carriage width (0 = ignore)', unit: 'mm', step: 1 },
    carriageZ: { label: 'Carriage starts above the tip', unit: 'mm', step: 1 },
    ironMargin: { label: 'Extra clearance all round', unit: 'mm', step: 0.1 },
    pilotLen: { label: 'Tip pilot length', unit: 'mm', step: 0.5, help: 'How far the tip goes into the insert before its face meets the insert top. 0 if the tip is flat.' },
    tripTravel: { label: 'Float travel before the sensor trips', unit: 'mm', step: 0.05 },
    touchFeed: { label: 'Touch-off speed', unit: 'mm/min', step: 10 },
    touchMax: { label: 'Touch-off gives up after', unit: 'mm', step: 5 },
    overloadStop: { label: 'Press with G38.3 (stops if the float trips)', type: 'bool' },
    feed: { label: 'Inserts come from', type: 'select', options: [['hand', 'By hand'], ['tray', 'The tray']] },
    trayX: { label: 'Pocket 1 X (front-left)', unit: 'mm', step: 1 },
    trayY: { label: 'Pocket 1 Y', unit: 'mm', step: 1 },
    trayPitch: { label: 'Pocket spacing', unit: 'mm', step: 0.5 },
    trayCols: { label: 'Columns (along X)', unit: '', step: 1 },
    trayRows: { label: 'Rows (along Y)', unit: '', step: 1 },
    trayTop: { label: 'Tray top height', unit: 'mm', step: 0.5 },
    pocketDepth: { label: 'Pocket depth', unit: 'mm', step: 0.5 },
    pickupDepth: { label: 'Pickup depth past the seat', unit: 'mm', step: 0.1 },
    pickupFeed: { label: 'Pickup speed', unit: 'mm/min', step: 10 },
    trayEdge: { label: 'Block edge beyond the outer pockets', unit: 'mm', step: 1 },
    trayEmpty: { label: 'An empty pocket during a run', type: 'select', options: [['next', 'Try the next full pocket'], ['pause', 'Stop and ask me']] },
    pressFeed: { label: 'Press speed', unit: 'mm/min', step: 5 },
    dwell: { label: 'Hold at depth', unit: 's', step: 0.5 },
    sink: { label: 'Finish below the surface', unit: 'mm', step: 0.05 },
    approachGap: { label: 'Slow down this far above', unit: 'mm', step: 0.5 },
    retractSlow: { label: 'Slow lift distance', unit: 'mm', step: 0.5 },
    retractFeed: { label: 'Slow lift speed', unit: 'mm/min', step: 10 },
    clearance: { label: 'Travel clearance over the tallest thing', unit: 'mm', step: 1 },
    loadMode: { label: 'Load inserts', type: 'select', options: [['each', 'Before each hole'], ['start', 'All at the start']] },
    wallMin: { label: 'Plastic wanted outside the insert', unit: 'mm', step: 0.1 },
    defaultInsert: { label: 'Insert for hand-placed holes', type: 'insert' },
    insertCost: { label: 'Cost per insert (0 hides cost)', unit: '$', step: 0.01 },
  };
  function html(key, s) {
    const f = FIELDS[key];
    if (!f) return '';
    const id = 'f-' + key;
    const help = f.help ? `<span class="help">${esc(f.help)}</span>` : '';
    let ctl;
    if (f.type === 'select' || f.type === 'insert') {
      const opts = f.type === 'insert' ? Object.entries(IP.INSERTS).map(([k, v]) => [k, v.name]) : f.options;
      ctl = `<select id="${id}" data-key="${key}">${opts.map(([v, l]) => `<option value="${v}"${v === s[key] ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    } else if (f.type === 'bool') {
      ctl = `<span class="switch"><input type="checkbox" role="switch" id="${id}" data-key="${key}"${s[key] ? ' checked' : ''}><span></span></span>`;
    } else {
      ctl = `<span class="num-in"><input type="number" id="${id}" data-key="${key}" step="${f.step}" value="${s[key]}"><span>${f.unit}</span></span>`;
    }
    return `<div class="set"><label for="${id}">${esc(f.label)}</label>${ctl}${help}</div>`;
  }
  function read(el) {
    const key = el && el.dataset && el.dataset.key;
    if (!key || !FIELDS[key]) return null;
    if (el.type === 'checkbox') return { key, value: el.checked };
    if (el.type === 'number') { const v = parseFloat(el.value); return isFinite(v) ? { key, value: v } : null; }
    return { key, value: el.value };
  }
  IP.ui.fields = { FIELDS, html, read };

  /* ---------- figures ---------- */
  function figBed(s) {
    const W = 300, H = 210, k = Math.min(230 / s.bedX, 170 / s.bedY);
    const x0 = 46, y0 = H - 22, X = (x) => x0 + x * k, Y = (y) => y0 - y * k;
    const o = [`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Bed, top view">`];
    o.push(`<rect x="${X(0)}" y="${Y(s.bedY)}" width="${s.bedX * k}" height="${s.bedY * k}" class="bed"/>`);
    o.push(`<path d="M${X(0) - 6} ${Y(s.bedY)} V${y0 + 6} H${X(s.bedX)}" class="fence"/>`);
    if (s.feed === 'tray' && s.mode === 'xy') { const t = IP.tray.outline(s); o.push(`<rect x="${X(t.x0)}" y="${Y(t.y1)}" width="${(t.x1 - t.x0) * k}" height="${(t.y1 - t.y0) * k}" class="tray"/><text x="${X(t.x0) + 3}" y="${Y(t.y1) + 11}" class="f">tray</text>`); }
    if (s.park) o.push(`<circle cx="${X(s.parkX)}" cy="${Y(s.parkY)}" r="4" class="park"/>`);
    o.push(`<text x="${X(s.bedX / 2)}" y="${y0 + 18}" text-anchor="middle" class="n">X ${fmt(s.bedX)} mm</text>`);
    o.push(`<text x="${X(0) - 14}" y="${Y(s.bedY / 2)}" text-anchor="middle" class="n" transform="rotate(-90 ${X(0) - 14} ${Y(s.bedY / 2)})">Y ${fmt(s.bedY)} mm</text>`);
    o.push(`<text x="${X(0) + 4}" y="${y0 - 5}" class="f">X0 Y0: fence corner</text></svg>`);
    return o.join('');
  }
  function figFence(s) {
    const H = 160, sc = Math.min(5, 100 / Math.max(10, s.fenceH));
    return `<svg viewBox="0 0 300 ${H}" role="img" aria-label="Fence, side view">
      <path d="M10 ${H - 20} H290" class="bedline"/>
      <rect x="40" y="${H - 20 - s.fenceH * sc}" width="18" height="${s.fenceH * sc}" class="steel"/>
      <rect x="58" y="${H - 20 - 10 * sc}" width="110" height="${10 * sc}" class="part"/>
      <path d="M190 ${H - 20} V${H - 20 - s.fenceH * sc}" class="dim"/><text x="196" y="${H - 20 - s.fenceH * sc / 2 + 4}" class="n">${fmt(s.fenceH)} mm</text>
      <text x="62" y="${H - 6}" class="f">part pushed against the fence</text></svg>`;
  }
  function figIron(s) {
    const z = IP.collision.zonesFrom(s);
    const top = z[z.length - 1].from + 26;
    const maxD = Math.max(...z.map((q) => q.d)) + 2 * s.ironMargin;
    const W = 300, H = 200, sc = Math.min((H - 34) / top, 110 / maxD), cx = 70;
    const Y = (mm) => H - 18 - mm * sc;
    const fills = { tip: '#b9c0c3', nut: '#8d969a', body: '#3a4449', carriage: '#56646b' };
    const o = [`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Iron, drawn to scale">`];
    o.push(`<path d="M8 ${Y(0)} H${W - 8}" class="bedline"/>`);
    o.push(`<text x="${W - 10}" y="${Y(0) - 5}" text-anchor="end" class="f">part surface</text>`);
    z.forEach((q, i) => {
      const to = z[i + 1] ? z[i + 1].from : top, r = (q.d / 2) * sc, m = s.ironMargin * sc;
      o.push(`<rect x="${cx - r - m}" y="${Y(to)}" width="${2 * (r + m)}" height="${(to - q.from) * sc}" fill="none" stroke="#c09036" stroke-dasharray="3 3"/>`);
      o.push(`<rect x="${cx - r}" y="${Y(to)}" width="${2 * r}" height="${(to - q.from) * sc}" fill="${fills[q.key]}" rx="${i ? 1.5 : 0}"/>`);
      const ty = Y((q.from + Math.min(to, q.from + 40)) / 2);
      o.push(`<text x="${cx + (maxD / 2) * sc + 18}" y="${ty - 2}" class="n">${q.name.replace(/^./, (c) => c.toUpperCase())}, ⌀${fmt(q.d)}</text>`);
      o.push(`<text x="${cx + (maxD / 2) * sc + 18}" y="${ty + 12}" class="f">from ${fmt(q.from)} mm up</text>`);
    });
    if (s.feed === 'tray') {
      const ins = IP.INSERTS.m3, hang = ins.L - (s.pilotLen || 0), r = (ins.od / 2) * sc;
      o.push(`<rect x="${cx - r}" y="${Y(0)}" width="${2 * r}" height="${hang * sc}" fill="#c09036" opacity=".75" transform="translate(0 ${-hang * sc})"/>`);
    }
    o.push('</svg>');
    return o.join('');
  }
  function figFloat(s) {
    return `<svg viewBox="0 0 300 180" role="img" aria-label="Float sensor">
      <rect x="110" y="14" width="80" height="62" rx="5" class="steel"/><text x="150" y="48" text-anchor="middle" class="n inv">Z carriage</text>
      <path d="M128 76 l8 6 -16 6 16 6 -16 6 16 6 -8 6" class="spring"/><path d="M172 76 l8 6 -16 6 16 6 -16 6 16 6 -8 6" class="spring"/>
      <rect x="132" y="118" width="36" height="22" rx="3" fill="#3a4449"/><rect x="144" y="140" width="12" height="18" fill="#b9c0c3"/>
      <path d="M10 160 H290" class="bedline"/>
      <path d="M210 112 V122" class="dim"/><text x="216" y="121" class="n">${fmt(s.tripTravel)} mm float travel</text>
      <text x="216" y="137" class="f">then the sensor on A5 trips</text></svg>`;
  }
  function figTray(s) {
    const pk = IP.tray.pockets(s), o = IP.tray.outline(s);
    const W = 300, H = 150, k = Math.min(130 / Math.max(1, o.x1 - o.x0), 120 / Math.max(1, o.y1 - o.y0));
    const X = (x) => 12 + (x - o.x0) * k, Y = (y) => H - 14 - (y - o.y0) * k;
    const sizes = [...new Set(pk.map((p) => p.size).filter(Boolean))];
    const colors = ['#c09036', '#8fa3ad', '#6b5320', '#e2c27f', '#56646b', '#d6dcdd'];
    const out = [`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tray plan">`];
    out.push(`<rect x="${X(o.x0)}" y="${Y(o.y1)}" width="${(o.x1 - o.x0) * k}" height="${(o.y1 - o.y0) * k}" rx="3" class="tray"/>`);
    for (const p of pk) {
      const col = p.size ? colors[sizes.indexOf(p.size) % colors.length] : '#1b2327';
      const r = Math.max(1.5, ((p.size ? IP.INSERTS[p.size].od : 3) / 2) * k);
      out.push(`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${r}" fill="${col}"/>`);
    }
    const p1 = pk[0];
    out.push(`<text x="${X(p1.x)}" y="${Y(p1.y) + 12}" text-anchor="middle" class="f">1</text>`);
    sizes.forEach((k2, i) => out.push(`<circle cx="${W - 120}" cy="${22 + i * 18}" r="5" fill="${colors[i % colors.length]}"/><text x="${W - 110}" y="${26 + i * 18}" class="n">${esc(IP.INSERTS[k2].name)}: ${pk.filter((p) => p.size === k2).length} pockets</text>`));
    out.push('</svg>');
    return out.join('');
  }
  function figPick(s) {
    const k = IP.tray.rowSize(s, 0) || 'm3';
    const g = IP.tray.geometry(s, k);
    const sc = 10, T = s.trayTop, Z = (z) => 112 - (z - T) * sc;
    const cx = 78, r = (g.od / 2) * sc, tr = (s.ironTipD / 2) * sc, br = (g.bore / 2) * sc;
    const rows = [['tip touches', g.seat, 52], ['float trips', g.trip, 80], ['empty if no trip by', g.limit, 108]];
    return `<svg viewBox="0 0 300 180" role="img" aria-label="Pickup heights">
      <rect x="16" y="${Z(T)}" width="${cx - br - 16}" height="${Z(g.floor) - Z(T) + 18}" class="steel"/>
      <rect x="${cx + br}" y="${Z(T)}" width="${150 - cx - br}" height="${Z(g.floor) - Z(T) + 18}" class="steel"/>
      <rect x="${cx - br}" y="${Z(g.floor)}" width="${2 * br}" height="18" class="steel"/>
      <rect x="${cx - r}" y="${Z(g.insertTop)}" width="${2 * r}" height="${g.L * sc}" fill="#c09036"/>
      <rect x="${cx - tr}" y="${Z(g.seat) - 52}" width="${2 * tr}" height="52" fill="#b9c0c3"/>
      ${rows.map(([t, z, y]) => `<path d="M${cx + tr + 3} ${Z(z)} H158 L190 ${y - 4} H196" class="dim"/><text x="200" y="${y}" class="n">Z ${fmt(z)}</text><text x="200" y="${y + 11}" class="f">${t}</text>`).join('')}
      <text x="16" y="168" class="f">Tray top Z ${fmt(T)} · ${esc(g.name)} hangs ${fmt(g.hang)} mm below the tip when carried</text></svg>`;
  }

  /* ---------- pages ---------- */
  const PAGES = [
    { id: 'bed', name: 'Bed', title: 'How far can it travel?', lede: 'Measured from the inside corner of the fence (X0 Y0). Z travel is how high the tip can go above the bed.',
      fields: ['mode', 'bedX', 'bedY', 'bedZ', 'park'], adv: ['parkX', 'parkY', 'rapidXY', 'rapidZ'], fig: figBed },
    { id: 'fence', name: 'Fence', title: 'How tall is the fence?', lede: 'Parts push into the fence corner. The collision check keeps the iron off the fence rails.',
      fields: ['fenceH'], adv: [], fig: figFence },
    { id: 'iron', name: 'Iron', title: 'Measure the iron', lede: 'Calipers from the tip end up. The defaults are a guess at a Pinecil V2 with a press tip, so measure yours.',
      fields: ['ironTipD', 'ironTipL', 'ironNutD', 'ironNutL', 'ironBodyD'], adv: ['pilotLen', 'carriageD', 'carriageZ', 'ironMargin'], fig: figIron },
    { id: 'float', name: 'Float', title: 'The float sensor', lede: 'The tip rides on a spring. Push it up slowly with a feeler gauge until the sensor on A5 trips; that distance goes here.',
      fields: ['tripTravel'], adv: ['overloadStop', 'touchFeed', 'touchMax'], fig: figFloat },
    { id: 'tray', name: 'Tray', title: 'The insert tray', lede: 'A fixed block with one insert per pocket. The machine picks each insert with the hot tip, so the tray must be metal or high-temp.',
      fields: ['feed', 'trayX', 'trayY', 'trayPitch', 'trayCols', 'trayRows', 'trayTop', 'pocketDepth', 'pickupDepth', 'pickupFeed'], adv: ['trayEdge', 'trayEmpty'], fig: figTray, rows: true },
    { id: 'done', name: 'Done', title: 'All set', lede: 'Save this as a machine profile so you can switch between setups. You can come back here any time from Machine setup.' },
  ];

  function init(ctx) {
    const { S } = ctx;
    const dlg = document.getElementById('setup');
    let page = 0;

    function rowsEditor(s) {
      const n = IP.tray.dims(s).rows;
      const opts = (sel) => [['', 'Unused']].concat(Object.entries(IP.INSERTS).map(([k, v]) => [k, v.name]))
        .map(([v, l]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${esc(l)}</option>`).join('');
      const out = [];
      for (let r = n - 1; r >= 0; r--) out.push(`<label class="row-sz"><span>Row ${r + 1}${r === 0 ? ' (front)' : r === n - 1 ? ' (back)' : ''}</span><select data-row="${r}">${opts(IP.tray.rowSize(s, r))}</select></label>`);
      return `<div class="set-block"><div class="set-h">Size in each row</div><div class="rows-ed">${out.join('')}</div></div>`;
    }

    function summary(s) {
      const tray = s.feed === 'tray' && s.mode === 'xy';
      const c = IP.tray.counts(s, S.inv);
      return `<ul class="sum">
        <li><b>${fmt(s.bedX)} × ${fmt(s.bedY)} × ${fmt(s.bedZ)} mm</b> travel, ${s.mode === 'xy' ? 'X/Y motion' : 'Z only'}</li>
        <li>Fence <b>${fmt(s.fenceH)} mm</b>, iron tip <b>⌀${fmt(s.ironTipD)}</b>, body <b>⌀${fmt(s.ironBodyD)}</b></li>
        <li>Float trips after <b>${fmt(s.tripTravel)} mm</b></li>
        <li>${tray ? `Tray: <b>${IP.tray.count(s)} pockets</b> (${Object.entries(c).map(([k, v]) => `${v.total} ${esc(IP.INSERTS[k].name)}`).join(', ')})` : 'Inserts loaded <b>by hand</b>'}</li></ul>
        <div class="set"><label for="prof-name">Profile name</label><input class="txt" id="prof-name" value="${esc(S.profile || 'My press')}"></div>`;
    }

    function render() {
      if (!dlg.open) return;
      const s = S.settings, p = PAGES[page];
      const keep = document.activeElement && dlg.contains(document.activeElement) ? document.activeElement.id || document.activeElement.dataset.row : null;
      const profs = ctx.profiles.list;
      const issues = p.id === 'tray' && s.feed === 'tray' ? IP.tray.issues(s, { hulls: S.part ? ctx.worldHulls() : [] }) : [];
      const advOpen = dlg.querySelector('.su-body details.adv') && dlg.querySelector('.su-body details.adv').open;
      dlg.innerHTML = `
        <header class="su-head">
          <h2>Machine setup</h2>
          <label class="su-prof">Profile <select id="su-prof">${profs.length ? '' : '<option value="">Default settings</option>'}${!ctx.profiles.current && profs.length ? '<option value="" selected>Unsaved settings</option>' : ''}${profs.map((n) => `<option value="${esc(n)}"${n === ctx.profiles.current ? ' selected' : ''}>${esc(n)}${n === ctx.profiles.current && ctx.profiles.dirty() ? ' (edited)' : ''}</option>`).join('')}</select></label>
          <button class="x-btn" id="su-x" aria-label="Close"><svg viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8"/></svg></button>
        </header>
        <nav class="su-steps">${PAGES.map((q, i) => `<button class="su-step${i === page ? ' on' : ''}${i < page ? ' done' : ''}" data-page="${i}"><i>${i + 1}</i>${q.name}</button>`).join('')}</nav>
        <div class="su-body">
          ${p.fig ? `<figure class="su-fig">${p.fig(s)}${p.id === 'tray' && s.feed === 'tray' ? figPick(s) : ''}</figure>` : ''}
          <div class="su-form">
            <h3>${p.title}</h3><p class="lede">${p.lede}</p>
            ${p.id === 'done' ? summary(s) : ''}
            ${(p.id === 'tray' && s.feed !== 'tray' ? ['feed'] : p.fields || []).map((k) => html(k, s)).join('')}
            ${p.rows && s.feed === 'tray' ? rowsEditor(s) : ''}
            ${issues.length ? `<ul class="issues">${issues.map((i) => `<li class="${i.level}">${esc(i.text)}</li>`).join('')}</ul>` : ''}
            ${p.adv && p.adv.length && !(p.id === 'tray' && s.feed !== 'tray') ? `<details class="adv"${advOpen ? ' open' : ''}><summary>Advanced</summary><div class="adv-in">${p.adv.map((k) => html(k, s)).join('')}</div></details>` : ''}
          </div>
        </div>
        <footer class="su-foot">
          ${page < PAGES.length - 1 ? '<button class="btn quiet" id="su-skip">Skip setup</button>' : `<button class="btn quiet" id="su-del"${ctx.profiles.current ? '' : ' hidden'}>Delete profile</button>`}
          <span class="grow"></span>
          ${page ? '<button class="btn" id="su-back">Back</button>' : ''}
          ${page < PAGES.length - 1 ? '<button class="btn primary" id="su-next">Next</button>' : '<button class="btn primary" id="su-save">Save profile and finish</button>'}
        </footer>`;
      if (keep) { const el = document.getElementById(keep) || dlg.querySelector(`[data-row="${keep}"]`); if (el) el.focus(); }
    }

    function open(where) {
      const i = PAGES.findIndex((p) => p.id === where);
      page = i >= 0 ? i : 0;
      if (!dlg.open) dlg.showModal();
      render();
    }
    function close() { IP.store.ls.set(ctx.K.setup, true); if (dlg.open) dlg.close(); if (ctx.ui.start) ctx.ui.start.render(); }

    dlg.addEventListener('change', (e) => {
      const t = e.target;
      if (t.id === 'su-prof') { if (t.value) ctx.profiles.use(t.value); render(); return; }
      if (t.dataset.row != null) {
        const n = IP.tray.dims(S.settings).rows;
        const arr = [];
        for (let r = 0; r < n; r++) arr.push(IP.tray.rowSize(S.settings, r));
        arr[+t.dataset.row] = t.value;
        ctx.setSetting('trayRowSizes', arr);
        ctx.tray.refill();
        render();
        return;
      }
      const r = read(t);
      if (!r) return;
      ctx.setSetting(r.key, r.value, { quiet: true });
      render();
    });
    dlg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) { if (e.target === dlg) close(); return; }
      if (b.dataset.page != null) { page = +b.dataset.page; render(); }
      else if (b.id === 'su-next') { page = Math.min(PAGES.length - 1, page + 1); render(); }
      else if (b.id === 'su-back') { page = Math.max(0, page - 1); render(); }
      else if (b.id === 'su-skip' || b.id === 'su-x') close();
      else if (b.id === 'su-save') {
        const name = (document.getElementById('prof-name').value || '').trim() || 'My press';
        ctx.profiles.save(name);
        ctx.toast(`Saved the ${name} profile.`);
        close();
      } else if (b.id === 'su-del') {
        if (!window.confirm(`Delete the ${ctx.profiles.current} profile? Your current settings stay as they are.`)) return;
        ctx.profiles.remove();
        render();
      }
    });
    dlg.addEventListener('cancel', () => IP.store.ls.set(ctx.K.setup, true));
    document.getElementById('btn-setup').addEventListener('click', () => open('bed'));
    return { open, close, render, get page() { return PAGES[page].id; } };
  }

  IP.ui.setup = { init, PAGES };
})();
