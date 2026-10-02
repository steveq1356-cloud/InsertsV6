/* InsertPress Planner v5 — app core: state, history, screens and steps, loading,
 * orientation, dragging with snapping, the rotate handle, collisions, tray state,
 * jobs, session restore, keyboard. The step panes, setup, review, and run screen
 * live in ui-*.js and get `ctx`.
 */
(function () {
  'use strict';
  const IP = window.IP;
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const fmt = IP.gcode.fmt;
  const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
  const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const ls = IP.store.ls;

  function fmtTime(s) {
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  }

  /* ---------- storage keys ---------- */
  const K = {
    settings: 'insertpress.settings.v1', profiles: 'insertpress.profiles.v1', current: 'insertpress.profiles.v1.current',
    tray: 'insertpress.tray.v1', setup: 'insertpress.setup.v5', session: 'insertpress.session.v5', recent: 'insertpress.recent.v5',
  };
  const loadSettings = () => {
    const s = Object.assign({}, IP.DEFAULT_SETTINGS, ls.get(K.settings, {}));
    if (!Array.isArray(s.trayRowSizes)) s.trayRowSizes = IP.DEFAULT_SETTINGS.trayRowSizes.slice();
    return s;
  };

  const S = {
    raw: null, srcBuf: null, name: '', rot: { x: 0, y: 0, z: 0 }, tilt: null, scale: 1, exampleId: null,
    part: null, hull: null, mstats: null,
    place: { x: 0, y: 0, rot: 0, locked: false }, copies: { nx: 1, ny: 1, gap: 6, skip: [] },
    holes: [], ignored: [], order: [],
    settings: loadSettings(), profiles: ls.get(K.profiles, {}), profile: ls.get(K.current, ''),
    screen: 'start', step: 'part', tool: 'move', view: 'iso',
    activeId: null, hoverId: null, shift: false,
    nextId: 1, result: null, pendingJob: null, recentId: null,
    sel: new Set(), runMarks: {}, live: null, liveTray: null, measure: null, showIron: true, cindex: null,
    collide: new Set(), collideLocal: new Set(), collRes: new Map(), inv: null,
  };
  if (S.profile && !S.profiles[S.profile]) S.profile = '';
  const ui = {};

  /* ---------- tray inventory, per machine profile ---------- */
  const invKey = () => S.profile || '';
  function loadInv() { S.inv = IP.tray.fit((ls.get(K.tray, {}) || {})[invKey()], S.settings); }
  function saveInv() { const all = ls.get(K.tray, {}) || {}; all[invKey()] = S.inv; ls.set(K.tray, all); }
  loadInv();
  const trayOn = () => S.settings.feed === 'tray' && S.settings.mode === 'xy';

  /* ---------- toast ---------- */
  let toastTimer;
  function toast(msg, isError) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), isError ? 5600 : 3000);
  }

  /* ---------- viewer ---------- */
  let dragBase = null, overlayFrame = null;
  const handlers = {
    onPick, onHover,
    tool: () => S.tool,
    onMoveStart() {
      if (S.place.locked) { toast('The position is locked. Unlock it on the Part step to move it.'); dragBase = null; return; }
      remember(); dragBase = Object.assign({}, S.place);
    },
    onMove(dx, dy, mods) { if (dragBase) dragTo(dragBase.x + dx, dragBase.y + dy, mods || {}); },
    onMoveEnd() { if (!dragBase) return; dragBase = null; viewer.setGuides(null); $('snap-label').hidden = true; refresh(); },
    onMeasure(kind, pt) { measureEvent(kind, pt); },
    onBox(ids, add) { if (!S.part || !ui.holes) return; ui.holes.selectIds(ids, add); if (S.step !== 'holes') goStep('holes'); ui.holes.showTools(true); },
    onFrame() { if (overlayFrame) overlayFrame(); },
  };
  const has3D = !!(window.THREE && THREE.OrbitControls);
  let viewer;
  try { viewer = has3D ? new IP.Viewer($('viewport'), handlers) : new IP.Viewer2D($('viewport'), handlers); }
  catch (e) { console.error('3D view failed; using the top view instead.', e); $('viewport').innerHTML = ''; viewer = new IP.Viewer2D($('viewport'), handlers); }
  const is2D = viewer instanceof IP.Viewer2D;
  if (is2D) { $('view-seg').hidden = true; $('lab-xray').hidden = true; }
  const ironZones = () => IP.collision.zonesFrom(S.settings);
  function setBed() {
    const s = S.settings;
    viewer.setBed(s.bedX, s.bedY, s.park && s.mode === 'xy' ? { x: s.parkX, y: s.parkY } : null, s.fenceH);
    viewer.setIron(ironZones());
  }
  setBed();

  /* ---------- history ---------- */
  const hist = { u: [], r: [] };
  const snap = () => JSON.stringify({ holes: S.holes, order: S.order, place: S.place, copies: S.copies, settings: S.settings,
    rot: S.rot, tilt: S.tilt, scale: S.scale, nextId: S.nextId });
  function remember() {
    if (!S.part) return;
    hist.u.push(snap());
    if (hist.u.length > 150) hist.u.shift();
    hist.r = [];
    updHist();
  }
  function updHist() { $('btn-undo').disabled = !hist.u.length; $('btn-redo').disabled = !hist.r.length; }
  function restore(js) {
    const o = JSON.parse(js);
    const lockChanged = !!o.place.locked !== !!S.place.locked;
    const geom =JSON.stringify([o.rot, o.tilt, o.scale]) !== JSON.stringify([S.rot, S.tilt, S.scale]);
    S.rot = o.rot; S.tilt = o.tilt || null; S.scale = o.scale;
    if (geom) { preparePart(); S.ignored = IP.holes.detect(S.part.positions, S.settings).ignored; }
    S.holes = o.holes; S.order = o.order; S.place = o.place; S.copies = o.copies; S.nextId = o.nextId;
    const settingsChanged = JSON.stringify(o.settings) !== JSON.stringify(S.settings);
    S.settings = o.settings;
    // the inventory is what is physically in the tray, so it is not undone; only refit it to the pocket count
    if (settingsChanged) { saveSettings(); setBed(); S.inv = IP.tray.fit(S.inv, S.settings); saveInv(); if (ui.setup) ui.setup.render(); }
    viewer.setInstances(insts());
    if (!S.holes.some((h) => h.id === S.activeId)) S.activeId = null;
    if (lockChanged && S.screen === 'job') setTool(S.step === 'part' && !S.place.locked ? 'move' : 'select');
    refresh();
    updHist();
  }
  function undo() { if (!hist.u.length) return; hist.r.push(snap()); restore(hist.u.pop()); toast('Undone.'); }
  function redo() { if (!hist.r.length) return; hist.u.push(snap()); restore(hist.r.pop()); toast('Redone.'); }
  function resetHistory() { hist.u = []; hist.r = []; updHist(); }

  /* ---------- screens, steps, tools ---------- */
  const STEPS = ['part', 'holes', 'review'];
  const STEP_NAMES = { part: 'Part', holes: 'Holes', review: 'Review' };
  function goScreen(name) {
    if (name === 'job' && !S.part) name = 'start';
    const was = S.screen;
    S.screen = name;
    document.body.dataset.screen = name;
    $('crumb').hidden = !S.part || name === 'start';
    $('btn-save-job').hidden = !S.part || name === 'start';
    $('job-side').hidden = name !== 'job';
    $('run-side').hidden = name !== 'run';
    if (name === 'start' && ui.start) ui.start.render();
    if (ui.machine) ui.machine.shown(name === 'run');
    if (name !== 'job' && ui.review) ui.review.stop();
    if (ui.review) ui.review.stepShown(name === 'job' && S.step === 'review');
    if (was !== name) { window.scrollTo(0, 0); requestAnimationFrame(() => { viewer.resize(); fitView(); }); }
    updateView();
    renderChrome();
  }
  function goStep(name) {
    S.step = name;
    if (S.screen !== 'job') goScreen('job');
    $$('.step').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.step === name)));
    STEPS.forEach((s) => { $('pane-' + s).hidden = s !== name; });
    $('panes').scrollTop = 0;
    setTool(name === 'part' && !S.place.locked ? 'move' : 'select');
    if (name !== 'review' && ui.review) ui.review.stop();
    renderChrome();
    updateView();
    fitView();
    if (ui.review) ui.review.stepShown(name === 'review');
  }
  function setTool(t) {
    if (t === 'move' && S.place.locked) { toast('The position is locked. Unlock it on the Part step to move it.'); t = 'select'; }
    S.tool = t;
    $$('.tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
    $('btn-add').setAttribute('aria-pressed', String(t === 'place'));
    $('btn-face').setAttribute('aria-pressed', String(t === 'face'));
    const hint = $('add-hint');
    const msg = {
      place: 'Click a flat top surface to place a hole. <kbd>Esc</kbd> to finish.',
      measure: 'Click two points to measure. Snaps to hole centres and corners. <kbd>Esc</kbd> clears.',
      face: 'Click the face that should sit on the bed. <kbd>Esc</kbd> cancels.',
    }[t];
    hint.hidden = !msg;
    if (msg) hint.innerHTML = msg;
    if (t !== 'select') $('tip-card').hidden = true;
    if (t !== 'measure') clearMeasure();
  }

  /** One line under the step bar: what to do next. */
  function hintFor() {
    if (!S.part) return '';
    const r = S.result;
    const errs = r ? r.issues.filter((i) => i.level === 'error') : [];
    if (S.step === 'part') {
      if (!S.holes.length) return S.ignored.some((i) => i.reason === 'blocked') ? 'The holes open downward. Pick the bottom face, or turn the part over.' : 'No insert holes face up. Turn the part, or place holes by hand on the next step.';
      const b = arrayBox(), s = S.settings;
      if (b.x < -0.01 || b.y < -0.01 || b.x + b.w > s.bedX + 0.01 || b.y + b.h > s.bedY + 0.01) return 'Part of it runs past the travel. Drag it back onto the bed.';
      if (errs.some((i) => i.kind === 'tray' && /sits on the tray/.test(i.text))) return 'It sits on the tray. Drag it clear, or use Fill the bed.';
      return 'Drag it where it will sit, or press Fence corner. Then Next.';
    }
    if (S.step === 'holes') {
      if (!S.order.length) return 'Turn on the holes to press: the switches here, or click the rings in the view.';
      const bad = errs.filter((i) => i.kind === 'collision').length;
      if (bad) return `${bad} hole${bad === 1 ? ' is' : 's are'} blocked by the iron (red). Skip ${bad === 1 ? 'it' : 'them'} or move the part.`;
      return `${S.order.length * insts().length} insert${S.order.length * insts().length === 1 ? '' : 's'} to press. Next: check the job.`;
    }
    if (errs.length) return `Fix ${errs.length === 1 ? 'the problem' : `the ${errs.length} problems`} below before running.`;
    if (!S.order.length) return 'No holes to press yet. Go back to Holes.';
    return 'Ready. Go to the machine, or download the G-code.';
  }

  function renderChrome() {
    const idx = STEPS.indexOf(S.step);
    $('btn-back').hidden = idx === 0;
    const nb = $('btn-next');
    nb.childNodes[0].nodeValue = idx < STEPS.length - 1 ? `Next: ${STEP_NAMES[STEPS[idx + 1]]}` : 'Go to the machine';
    nb.disabled = !S.part || (idx === STEPS.length - 1 && !(S.result && S.result.text));
    $('next-hint').textContent = hintFor();
    const copies = insts().length;
    const pill = $('pill-holes');
    pill.hidden = !S.order.length;
    pill.textContent = S.order.length * copies;
    const r = S.result;
    const errs = r ? r.issues.filter((i) => i.level === 'error').length : 0;
    $('pill-issues').hidden = !errs;
    $('pill-issues').textContent = errs;
    const done = { part: !!S.part && S.holes.length > 0, holes: S.order.length > 0 };
    $$('.step').forEach((b) => b.classList.toggle('done', !!done[b.dataset.step] && b.dataset.step !== S.step));
    $('file-chip').textContent = S.part ? `${S.name}.stl` : '';
    $('btn-save-job').disabled = !S.part;
    $('tool-rail').hidden = !S.part || S.screen !== 'job';
    $('legend').hidden = !S.part || S.screen === 'start';
    $('status').textContent = is2D && S.screen !== 'start' ? '2D top view (the 3D view needs an internet connection). Drag to pan, scroll to zoom.' : '';
  }

  /* ---------- measure ---------- */
  const snapName = (p) => ({ hole: 'hole centre', corner: 'corner', surface: 'surface', bed: 'bed' }[p.snap] || 'point');
  function clearMeasure() { S.measure = null; viewer.setMeasure(null); $('measure-card').hidden = true; }
  function measureEvent(kind, pt) {
    const m = S.measure || (S.measure = { a: null, b: null, hover: null });
    if (kind === 'leave') m.hover = null;
    else if (kind === 'move') m.hover = pt;
    else if (kind === 'click' && pt) { if (!m.a || m.b) { m.a = pt; m.b = null; } else m.b = pt; }
    const b = m.b || (m.a && m.hover ? m.hover : null);
    viewer.setMeasure(m.a ? { a: m.a, b, hover: m.hover, live: !m.b } : null);
    const card = $('measure-card');
    if (m.a && b) {
      const mm = IP.measure.between(m.a, b);
      card.hidden = false;
      card.classList.toggle('live', !m.b);
      card.innerHTML = `<b>${IP.measure.label(mm)}</b><span class="m-d">${IP.measure.detail(mm)}</span><span class="m-s">${snapName(m.a)} to ${snapName(b)}</span>`;
    } else card.hidden = true;
  }

  /* ---------- loading ---------- */
  function readFile(file) {
    if (!file) return;
    const name = file.name || 'part.stl';
    const r = new FileReader();
    r.onerror = () => toast(`Could not read ${name}.`, true);
    if (/\.(json|ipjob)$/i.test(name)) { r.onload = () => openJob(r.result); r.readAsText(file); }
    else { r.onload = () => loadSTL(r.result, name); r.readAsArrayBuffer(file); }
  }

  function startPart(raw, name, opts) {
    opts = opts || {};
    S.raw = raw;
    S.name = name;
    S.exampleId = opts.example || null;
    S.srcBuf = opts.buf || null;
    S.rot = { x: 0, y: 0, z: 0 }; S.tilt = null;
    S.activeId = null; S.sel = new Set(); S.runMarks = {};
    S.recentId = opts.recentId || null;
    S.pendingJob = null;
    if (S.list) Object.assign(S.list, { filter: 'all', sizes: [], sort: 'order', dir: 1 });
    resetHistory();
    if (opts.job) applyJob(opts.job);
    else {
      S.scale = 1;
      S.place = { x: 0, y: 0, rot: 0, locked: false }; S.copies = { nx: 1, ny: 1, gap: S.copies.gap || 6, skip: [] };
      rebuild();
      goStep('part');
    }
    if (!S.recentId && ui.start) ui.start.remember();
    scheduleSave();
  }

  function loadSTL(buf, name, job, recentId) {
    let raw;
    try { raw = IP.stl.parseSTL(buf); } catch (e) { toast(e.message, true); return false; }
    if (!raw.length) { toast(`${name} has no triangles.`, true); return false; }
    const base = name.replace(/\.stl$/i, '');
    const p = S.pendingJob;
    // a job waiting for its STL only applies to that STL (same name or triangle count)
    const fits = p && (!p.part || p.part.name === base || p.part.triangles === raw.length / 9);
    if (p && !job && !fits) toast(`This is not ${p.part.name}.stl, so it opens as a new part. The job is no longer waiting.`);
    startPart(raw, base, { buf, job: job || (fits ? p : null), recentId });
    return true;
  }

  function loadExample(id, job, recentId) {
    const ex = IP.EXAMPLES.find((e) => e.id === id) || IP.EXAMPLES[0];
    startPart(ex.make(), ex.file.replace(/\.stl$/i, ''), { example: ex.id, job, recentId });
    if (!job) {
      if (ex.id === 'cover') toast('Its holes open underneath. Pick the bottom face (click the top) or Turn on X twice.');
      else if (ex.id === 'panel') toast('Try Fill the bed under Copies.');
      else if (ex.id === 'bracket') toast('Three holes sit too close to the upright for the iron. Go to Holes to see them in red.');
    }
  }

  function preparePart() {
    S.part = IP.stl.preparePart(S.raw, { rot: S.rot, scale: S.scale, matrix: S.tilt });
    S.hull = IP.place.footprintHull(S.part.positions);
    S.mstats = IP.place.meshStats(S.part.positions);
    S.cindex = new IP.collision.Index(S.part.positions);
    viewer.setPart(S.part.positions, S.part.size);
    viewer.setInstances(insts());
  }

  function rebuild() {
    preparePart();
    S.holes = []; S.order = []; S.activeId = null;
    detect(false);
    fitView();
  }

  const xyKey = (h) => Math.round(h.x * 20) + ':' + Math.round(h.y * 20);
  function detect(keep) {
    if (!S.part) return;
    const res = IP.holes.detect(S.part.positions, { dMin: S.settings.dMin, dMax: S.settings.dMax });
    const old = keep ? new Map(S.holes.filter((h) => h.source === 'auto').map((h) => [xyKey(h), h])) : new Map();
    const manual = keep ? S.holes.filter((h) => h.source === 'manual') : [];
    const auto = res.holes.map((r) => {
      const prev = old.get(xyKey(r));
      return {
        id: prev ? prev.id : S.nextId++, source: 'auto',
        x: r.x, y: r.y, H: r.top, dia: r.dia, depth: r.depth, blind: r.blind, wall: r.wall,
        insert: prev ? prev.insert : IP.gcode.guessInsert(r.dia, 'm3'),
        sink: prev ? prev.sink : null,
      };
    });
    S.holes = auto.concat(manual);
    const ids = new Set(S.holes.map((h) => h.id));
    S.order = S.order.filter((id) => ids.has(id));
    // new parts start with every found hole in the press order
    if (!keep) S.order = auto.map((h) => h.id);
    S.ignored = res.ignored;
    refresh();
  }

  /* ---------- geometry helpers ---------- */
  const byId = (id) => S.holes.find((h) => h.id === id);
  const insts = () => (S.hull ? IP.place.instances(S.hull, S.place, S.copies) : [{ i: 0, rot: 0, tx: 0, ty: 0 }]);
  const arrayBox = () => IP.place.arrayBounds(S.hull, S.place, S.copies);
  const worldHulls = () => insts().map((i) => IP.place.worldHull(S.hull, i));
  function frameBox() {
    const s = S.settings;
    if (!S.part || S.screen === 'run' || S.step === 'part') return { x: 0, y: 0, w: s.bedX, h: s.bedY, z: S.part ? S.part.size.z : 10 };
    const b = arrayBox();
    let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
    if (trayOn() && S.step === 'review') { const o = IP.tray.outline(s); x0 = Math.min(x0, o.x0); y0 = Math.min(y0, o.y0); x1 = Math.max(x1, o.x1); y1 = Math.max(y1, o.y1); }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, z: S.part.size.z };
  }
  function fitView() { viewer.frame(S.view, frameBox()); }

  /** Holes in press order for every copy, in machine coordinates. */
  function worldHoles() {
    const list = insts();
    const out = [];
    const n = S.order.length;
    for (const inst of list) {
      S.order.forEach((id, idx) => {
        const h = byId(id);
        if (!h) return;
        const w = IP.place.toWorld(inst, h.x, h.y);
        out.push({ x: w.x, y: w.y, H: h.H, dia: h.dia, depth: h.depth, blind: h.blind, wall: h.wall,
          insert: h.insert, sink: h.sink, label: String(inst.i * n + idx + 1), copy: inst.i, localId: id });
      });
    }
    return out;
  }

  /* ---------- dragging with snapping ---------- */
  function dragTo(x, y, mods) {
    const b = arrayBox();
    let label = '', guides = null;
    if (!mods.alt) {
      const others = trayOn() ? [Object.assign({ name: 'tray' }, IP.tray.outline(S.settings))] : [];
      const thr = 9 * (viewer.mmPerPx ? viewer.mmPerPx() : 0.5);
      const r = IP.snap.snapBox({ x, y, w: b.w, h: b.h }, { bed: { x: S.settings.bedX, y: S.settings.bedY }, grid: 10, gap: S.copies.gap || 6, others }, thr);
      const q = mods.shift ? 0.1 : 0.5;
      x = r.snapped.x ? r.x : Math.round(x / q) * q;
      y = r.snapped.y ? r.y : Math.round(y / q) * q;
      label = r.label; guides = r.guides;
    } else { x = Math.round(x * 10) / 10; y = Math.round(y * 10) / 10; }
    S.place.x = Math.round(x * 1000) / 1000; S.place.y = Math.round(y * 1000) / 1000;
    viewer.setGuides(guides);
    const sl = $('snap-label');
    sl.hidden = !label && !mods.alt;
    sl.textContent = label || 'Moving freely';
    livePlacement();
  }
  function livePlacement() {
    viewer.setInstances(insts());
    updateView();
    if (ui.part) ui.part.renderPlacement();
  }

  /* ---------- rotate handle (HTML over the view) ---------- */
  const rot = { drag: null };
  overlayFrame = () => {
    const el = $('rot-handle');
    const show = S.part && S.screen === 'job' && S.step === 'part' && !S.place.locked && S.tool !== 'face' && S.tool !== 'measure';
    if (!show) { if (!el.hidden) el.hidden = true; return; }
    const b = arrayBox();
    const p = viewer.project(b.x + b.w, b.y + b.h, S.part.size.z);
    const stage = $('stage').getBoundingClientRect(), vp = $('viewport').getBoundingClientRect();
    el.hidden = false;
    el.style.transform = `translate(${Math.round(p.x + vp.left - stage.left + 10)}px, ${Math.round(p.y + vp.top - stage.top - 34)}px)`;
  };
  $('rot-handle').addEventListener('pointerdown', (e) => {
    if (!S.part || S.place.locked || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const b = arrayBox();
    const c = viewer.project(b.x + b.w / 2, b.y + b.h / 2, S.part.size.z / 2);
    const vp = $('viewport').getBoundingClientRect();
    const cx = c.x + vp.left, cy = c.y + vp.top;
    remember();
    rot.drag = { cx, cy, a0: Math.atan2(-(e.clientY - cy), e.clientX - cx), r0: S.place.rot };
    $('rot-handle').classList.add('on');
  });
  $('rot-handle').addEventListener('pointermove', (e) => {
    const d = rot.drag;
    if (!d) return;
    const a = Math.atan2(-(e.clientY - d.cy), e.clientX - d.cx);
    const deg = IP.snap.snapAngle(d.r0 + ((a - d.a0) * 180) / Math.PI, e.altKey);
    if (deg === S.place.rot) return;
    Object.assign(S.place, IP.place.rotateKeep(S.hull, S.place, S.copies, deg));
    $('rot-deg').textContent = deg + '°';
    livePlacement();
  });
  const rotEnd = () => { if (!rot.drag) return; rot.drag = null; $('rot-handle').classList.remove('on'); $('rot-deg').textContent = ''; refresh(); };
  $('rot-handle').addEventListener('pointerup', rotEnd);
  $('rot-handle').addEventListener('pointercancel', rotEnd);

  /* ---------- orientation ---------- */
  function turn(axis) {
    if (!S.raw) return;
    remember();
    S.rot[axis] = (S.rot[axis] + 1) % 4;
    rebuild();
    toast(`${S.holes.length} hole${S.holes.length === 1 ? '' : 's'} face up now.`);
  }
  function faceDown(n) {
    remember();
    const cur = IP.stl.mulMatrix(IP.stl.quarterMatrix(S.rot), S.tilt || IP.stl.I3);
    const M = IP.stl.mulMatrix(IP.stl.faceDownMatrix(n.x, n.y, n.z), cur);
    S.tilt = M.every((v, i) => v === IP.stl.I3[i]) ? null : M;
    S.rot = { x: 0, y: 0, z: 0 };
    rebuild();
    setTool(S.step === 'part' ? 'move' : 'select');
    const tilted = Math.abs(Math.abs(n.z) - 1) > 1e-3 && Math.abs(n.z) > 1e-3;
    toast(`That face is on the bed now. ${S.holes.length} hole${S.holes.length === 1 ? '' : 's'} face up${tilted ? '. Angled faces only work if the holes end up vertical' : ''}.`);
  }
  function resetOrientation() { if (!S.raw) return; remember(); S.rot = { x: 0, y: 0, z: 0 }; S.tilt = null; rebuild(); }

  /* ---------- picking & hover ---------- */
  function onPick(p) {
    if (!S.part) return;
    if (S.tool === 'face') {
      if (p.type === 'surface' && p.normal) faceDown(p.normal);
      return;
    }
    if (p.type === 'hole') {
      if (p.shift || p.toggle) { ui.holes.select(p.id, { toggle: true }); ui.holes.showTools(true); }
      else toggleOrder(p.id);
      if (S.step !== 'holes') goStep('holes');
      return;
    }
    if (S.tool !== 'place') {
      if (S.sel.size && !p.shift && !p.toggle) ui.holes.clearSel();
      return;
    }
    if (p.type !== 'surface' || p.normalZ < 0.9) { toast('That spot is not a flat, upward face of the part. Pick a top face.', true); return; }
    const inst = insts()[p.inst || 0];
    const loc = IP.place.toLocal(inst, p.point.x, p.point.y);
    if (S.holes.some((h) => Math.hypot(h.x - loc.x, h.y - loc.y) < 1.5)) { toast('There is already a hole there.'); return; }
    remember();
    const h = { id: S.nextId++, source: 'manual', x: loc.x, y: loc.y, H: p.point.z, dia: null, depth: null, blind: false, wall: null,
      insert: S.settings.defaultInsert, sink: null };
    S.holes.push(h);
    S.order.push(h.id);
    S.activeId = h.id;
    refresh();
    if (S.step !== 'holes') goStep('holes');
  }

  function onHover(id, cx, cy) {
    const card = $('tip-card');
    if (id == null || S.tool !== 'select') card.hidden = true;
    else {
      const h = byId(id);
      if (h) {
        const idx = S.order.indexOf(id);
        const ins = IP.INSERTS[h.insert];
        const copies = insts().length;
        card.innerHTML = `<b>${idx >= 0 ? 'Hole ' + (idx + 1) + (copies > 1 ? ` <span class="fine">on each of ${copies} copies</span>` : '') : 'Not pressed'}</b>
          <div>${h.source === 'manual' ? 'Placed by hand' : '⌀' + f2(h.dia) + ' mm, ' + (h.blind ? fmt(h.depth) + ' mm deep' : 'through')}</div>
          <div>${esc(ins.name)} insert${h.wall != null ? `, ${f1(h.wall)} mm wall` : ''}</div>
          <div class="act">${idx >= 0 ? 'Click to skip it' : 'Click to press it'}</div>`;
        card.hidden = false;
        const pad = 16, w = card.offsetWidth, hh = card.offsetHeight;
        let left = cx + pad, top = cy + pad;
        if (left + w > window.innerWidth - 8) left = cx - w - pad;
        if (top + hh > window.innerHeight - 8) top = cy - hh - pad;
        card.style.left = left + 'px';
        card.style.top = top + 'px';
      }
    }
    if (id !== S.hoverId) { S.hoverId = id; updateView(); if (ui.holes) ui.holes.markHover(); }
  }

  function toggleOrder(id) {
    if (!byId(id)) return;
    remember();
    const i = S.order.indexOf(id);
    if (i >= 0) { S.order.splice(i, 1); if (S.activeId === id) S.activeId = null; }
    else S.order.push(id);
    refresh();
  }

  /* ---------- the whole refresh ---------- */
  const insertOptions = (sel) => Object.entries(IP.INSERTS)
    .map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(v.name)}</option>`).join('');

  function refresh() {
    if (S.order.some((id) => !byId(id))) S.order = S.order.filter((id) => byId(id));
    if (S.part) viewer.setInstances(insts());
    regen();
    if (ui.part) ui.part.render();
    if (ui.holes) ui.holes.render();
    if (ui.review) ui.review.render();
    if (ui.machine) ui.machine.render();
    renderChrome();
    updateView();
    scheduleSave();
  }

  /** Which pockets the job uses, and how full they look at preview time t (or live). */
  function trayView(t) {
    if (!trayOn()) return null;
    const s = S.settings, o = IP.tray.outline(s);
    const live = S.liveTray;
    const full = live ? live.full : S.inv;
    const picks = S.result && S.result.picks ? S.result.picks : [];
    const job = new Set(picks.map((p) => p.pocket));
    let taken = new Set(), next = live ? live.next : null;
    if (!live && t != null && S.result) {
      for (const m of S.result.moves) {
        if (m.kind !== 'pick' || m.pocket == null) continue;
        if (m.t1 <= t) taken.add(m.pocket); else if (m.t0 <= t) next = m.pocket;
      }
    }
    const pockets = IP.tray.pockets(s).map((p) => {
      const g = p.size ? IP.tray.geometry(s, p.size) : null;
      let state = full[p.i] && p.size ? 'full' : 'empty';
      if (!live && taken.has(p.i)) state = 'empty';
      else if (state === 'full' && job.has(p.i) && !live) state = 'job';
      if (next === p.i) state = 'next';
      return { x: p.x, y: p.y, d: g ? g.bore : 3, state, stick: g ? g.stick : 0, n: p.n };
    });
    return { box: { x0: o.x0, y0: o.y0, x1: o.x1, y1: o.y1, top: s.trayTop }, pockets, label: 'Tray' };
  }

  function updateView(simT) {
    viewer.setTray(trayView(simT != null ? simT : ui.review ? ui.review.simTime() : null));
    if (!S.part) { viewer.setHoles([]); viewer.setGhost(null); viewer.setPath(null); return; }
    const list = insts();
    const n = S.order.length;
    const markers = [];
    for (const inst of list) {
      for (const h of S.holes) {
        const idx = S.order.indexOf(h.id);
        const w = IP.place.toWorld(inst, h.x, h.y);
        const label = idx >= 0 ? String(inst.i * n + idx + 1) : null;
        markers.push({ key: inst.i + ':' + h.id, id: h.id, x: w.x, y: w.y, H: h.H, depth: h.depth,
          dia: h.dia || IP.INSERTS[h.insert].hole, used: idx >= 0, label,
          active: h.id === S.activeId || h.id === S.hoverId, sel: S.sel.has(h.id),
          bad: label != null ? S.collide.has(label) : S.collideLocal.has(h.id),
          run: label != null ? S.runMarks[label] || null : null });
      }
    }
    viewer.setHoles(markers);
    const gid = S.hoverId != null ? S.hoverId : S.activeId;
    const gh = gid != null && S.showIron && S.screen === 'job' ? byId(gid) : null;
    if (gh) {
      const w = IP.place.toWorld(list[0], gh.x, gh.y);
      const res = S.collRes.get('c0:' + gh.id);
      const zones = ironZones();
      viewer.setGhost({ x: w.x, y: w.y, z: gh.H - (gh.sink != null ? gh.sink : S.settings.sink) - (+S.settings.pilotLen || 0), margin: S.settings.ironMargin,
        hit: res ? res.hits.map((x) => zones.findIndex((z) => z.key === x.zone.key)) : [] });
    } else viewer.setGhost(null);
    const r = S.result;
    if (r && r.moves.length && S.settings.mode === 'xy' && S.step !== 'part') {
      const pts = [r.moves[0].from];
      for (const m of r.moves) pts.push(m.to);
      viewer.setPath(pts);
    } else viewer.setPath(null);
  }

  /* ---------- G-code, issues, collisions ---------- */
  function regen() {
    if (!S.part) { S.result = null; return; }
    S.result = IP.gcode.generate({ name: S.name, partTop: S.part.size.z, copies: insts().length, holes: worldHoles(), settings: S.settings,
      tray: { full: S.inv } });
    const extra = collisions();
    if (trayOn()) {
      const sizes = [...new Set(worldHoles().map((h) => h.insert))];
      extra.push(...IP.tray.issues(S.settings, { hulls: worldHulls(), sizes }).filter((i) => !/No tray row holds/.test(i.text)));
    }
    const sb = arrayBox(), s = S.settings;
    if (s.mode === 'xy' && (sb.x < -0.01 || sb.y < -0.01 || sb.x + sb.w > s.bedX + 0.01 || sb.y + sb.h > s.bedY + 0.01) && !S.order.length) {
      extra.push({ level: 'warn', text: `The part runs past the ${s.bedX} × ${s.bedY} mm travel.` });
    }
    S.result.issues = extra.concat(S.result.issues);
  }

  /** Iron collision check for every hole on every copy (issues only for holes being pressed), and every pickup pocket. */
  function collisions() {
    S.collide = new Set(); S.collideLocal = new Set(); S.collRes = new Map();
    if (!S.part || !S.cindex) return [];
    const list = insts(), n = S.order.length, all = [];
    for (const inst of list) for (const h of S.holes) {
      const idx = S.order.indexOf(h.id);
      const w = IP.place.toWorld(inst, h.x, h.y);
      all.push({ x: w.x, y: w.y, H: h.H, sink: h.sink, label: idx >= 0 ? String(inst.i * n + idx + 1) : 'u' + h.id, localId: h.id, copy: inst.i, used: idx >= 0 });
    }
    const s = S.settings;
    const ctxC = { index: S.cindex, instances: list, partSize: S.part.size, zones: ironZones(),
      margin: s.ironMargin, sink: s.sink, fenceH: s.fenceH, pilot: s.pilotLen,
      boxes: trayOn() ? [Object.assign({ source: 'tray' }, IP.tray.outline(s))] : [] };
    const res = IP.collision.check(all, ctxC);
    const used = [];
    res.forEach((r, i) => {
      S.collRes.set('c' + r.copy + ':' + r.localId, r);
      if (!r.hits.length) return;
      if (all[i].used) { S.collide.add(r.label); used.push(r); } else if (r.copy === 0) S.collideLocal.add(r.localId);
    });
    const out = IP.collision.issues(used);
    if (trayOn() && n) {
      const A = IP.tray.assign(worldHoles(), s, S.inv);
      const seen = new Set();
      const pk = [];
      for (const p of A.picks) {
        if (!p || seen.has(p.i)) continue;
        seen.add(p.i);
        const g = IP.tray.geometry(s, p.size);
        // worst case is an empty pocket: the probe runs all the way down to the limit
        pk.push({ x: p.x, y: p.y, H: g.insertTop, sink: g.pilot + s.pickupDepth, label: 'P' + p.n, pocket: p.n });
      }
      const pr = IP.collision.check(pk, Object.assign({}, ctxC, { boxes: [] }));
      pr.forEach((r) => { r.single = list.length === 1; });
      out.push(...IP.collision.issues(pr.filter((r) => r.hits.length)));
    }
    return out;
  }

  /* ---------- jobs ---------- */
  function jobObject() {
    return {
      format: 'insertpress-job', version: 6,
      part: { name: S.name, triangles: S.part.triCount, rot: S.rot, tilt: S.tilt, scale: S.scale, example: S.exampleId },
      place: S.place, copies: S.copies, settings: S.settings,
      holes: S.holes, order: S.order,
    };
  }
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function saveJob() {
    if (!S.part) return;
    download(`${S.name}.ipjob.json`, JSON.stringify(jobObject(), null, 2), 'application/json');
    toast('Saved the job file. Open it with its STL to carry on.');
  }

  function openJob(text) {
    let job;
    try { job = JSON.parse(text); } catch (e) { toast('That job file is not valid JSON.', true); return; }
    if (job.format !== 'insertpress-job') { toast('That file is not an InsertPress job.', true); return; }
    if (job.part && job.part.example && IP.EXAMPLES.some((e) => e.id === job.part.example)) { loadExample(job.part.example, job); toast('Opened job.'); return; }
    if (!S.raw || (job.part && S.raw.length / 9 !== job.part.triangles)) {
      S.pendingJob = job;
      toast(`Job loaded. Now open ${job.part ? job.part.name + '.stl' : 'its STL'}.`);
      return;
    }
    applyJob(job);
    toast('Opened job.');
  }

  /** Settings on the Machine setup pages (except where inserts come from, which is per job). */
  const machineKeys = () => IP.ui.setup.PAGES.flatMap((p) => (p.fields || []).concat(p.adv || []))
    .filter((k) => k !== 'feed').concat('trayRowSizes');

  /** Apply a v3, v4, v5, or v6 job to the loaded STL (v6 has the v5 format). */
  function applyJob(job, keepStep) {
    if (job.part && S.raw.length / 9 !== job.part.triangles) toast('This STL has a different triangle count than the job expects. Holes may not line up.', true);
    // the job brings its press settings; the machine (bed, fence, iron, float, tray) stays as set up
    const mine = {}, js = job.settings || {};
    machineKeys().forEach((k) => { mine[k] = S.settings[k]; });
    const differs = machineKeys().some((k) => k in js && JSON.stringify(js[k]) !== JSON.stringify(mine[k]));
    S.settings = Object.assign({}, IP.DEFAULT_SETTINGS, js, mine);
    if (!Array.isArray(S.settings.trayRowSizes)) S.settings.trayRowSizes = IP.DEFAULT_SETTINGS.trayRowSizes.slice();
    if (differs && !keepStep) toast('The job was planned on a different machine setup. It uses yours.');
    saveSettings(); setBed(); loadInv();
    S.rot = (job.part && job.part.rot) || { x: 0, y: 0, z: 0 };
    S.tilt = (job.part && Array.isArray(job.part.tilt) && job.part.tilt) || null;
    S.scale = (job.part && job.part.scale) || 1;
    S.place = Object.assign({ x: 0, y: 0, rot: 0, locked: false }, job.place || {});
    S.copies = Object.assign({ nx: 1, ny: 1, gap: 6, skip: [] }, job.copies || {});
    preparePart();
    S.holes = (job.holes || []).map((h) => Object.assign({}, h));
    S.order = (job.order || []).filter((id) => S.holes.some((h) => h.id === id));
    S.nextId = Math.max(0, ...S.holes.map((h) => h.id)) + 1;
    S.ignored = [];
    detect(true);
    if (ui.setup) ui.setup.render();
    if (!keepStep) goStep(S.order.length ? 'holes' : 'part');
    fitView();
  }

  /* ---------- session restore ---------- */
  let saveTimer = null;
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveSession, 700); }
  function saveSession() {
    if (!S.part) return;
    const inserts = S.order.length * insts().length;
    const rec = { job: jobObject(), step: S.step, name: S.name, savedAt: Date.now(), inserts, example: S.exampleId, recentId: S.recentId };
    ls.set(K.session, rec);
    if (ui.start) ui.start.update(rec);
  }

  /* ---------- settings ---------- */
  function saveSettings() { ls.set(K.settings, S.settings); }
  /** Change one setting from any form: remembered for undo, saved, and applied. */
  function setSetting(key, v, opts) {
    opts = opts || {};
    if (JSON.stringify(S.settings[key]) === JSON.stringify(v)) return;
    remember();
    S.settings[key] = v;
    if (key === 'material') {
      const m = IP.MATERIALS[v];
      Object.assign(S.settings, { tipTemp: m.tipTemp, pressFeed: m.pressFeed, dwell: m.dwell });
      if (!opts.quiet) toast(`${m.name}: iron ${m.tipTemp} °C, press ${m.pressFeed} mm/min, hold ${m.dwell} s.`);
    }
    if (/^tray(Rows|Cols)$/.test(key)) { S.inv = IP.tray.fit(S.inv, S.settings); saveInv(); }
    saveSettings();
    if (/^(bed|park|fence|iron|carriage|mode)/.test(key)) setBed();
    if (key === 'dMin' || key === 'dMax') { detect(true); return; }
    refresh();
    if (key === 'feed' || /^tray|^bed/.test(key)) fitView();
  }
  function replaceSettings(next, msg) {
    remember();
    S.settings = Object.assign({}, IP.DEFAULT_SETTINGS, next);
    saveSettings(); setBed(); loadInv();
    if (S.part) detect(true); else refresh();
    if (msg) toast(msg);
  }

  /* ---------- events ---------- */
  $('file-stl').addEventListener('change', (e) => { readFile(e.target.files[0]); e.target.value = ''; });
  $('file-job').addEventListener('change', (e) => { readFile(e.target.files[0]); e.target.value = ''; });
  $('btn-undo').addEventListener('click', undo);
  $('btn-redo').addEventListener('click', redo);
  $('btn-home').addEventListener('click', () => goScreen('start'));
  $('btn-machine').addEventListener('click', () => goScreen(S.screen === 'run' ? (S.part ? 'job' : 'start') : 'run'));
  ['btn-save-job', 'btn-save-job-2'].forEach((id) => $(id).addEventListener('click', saveJob));
  $$('.step').forEach((b) => b.addEventListener('click', () => goStep(b.dataset.step)));
  $('btn-next').addEventListener('click', () => {
    if (S.step === 'review') { goScreen('run'); return; }
    goStep(STEPS[Math.min(STEPS.indexOf(S.step) + 1, STEPS.length - 1)]);
  });
  $('btn-back').addEventListener('click', () => goStep(STEPS[Math.max(STEPS.indexOf(S.step) - 1, 0)]));
  $$('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  $('btn-add').addEventListener('click', () => setTool(S.tool === 'place' ? 'select' : 'place'));
  $('btn-face').addEventListener('click', () => setTool(S.tool === 'face' ? (S.step === 'part' ? 'move' : 'select') : 'face'));
  $$('[data-rot]').forEach((b) => b.addEventListener('click', () => turn(b.dataset.rot)));
  $('btn-orient-reset').addEventListener('click', resetOrientation);
  $$('[data-units]').forEach((b) => b.addEventListener('click', () => {
    const v = +b.dataset.units;
    if (v === S.scale) return;
    remember();
    S.scale = v;
    if (S.raw) rebuild();
  }));

  // view
  $$('[data-view]').forEach((b) => b.addEventListener('click', () => { S.view = b.dataset.view; fitView(); }));
  $('btn-fit').addEventListener('click', fitView);
  $('chk-xray').addEventListener('change', (e) => viewer.setXray(e.target.checked));
  $('chk-iron').addEventListener('change', (e) => { S.showIron = e.target.checked; updateView(); });
  $('chk-path').addEventListener('change', (e) => viewer.setPathVisible(e.target.checked));
  document.addEventListener('click', (e) => { const d = document.querySelector('.view-more[open]'); if (d && !d.contains(e.target)) d.open = false; });
  $('btn-keys').addEventListener('click', () => $('keys').showModal());
  $('keys').addEventListener('click', (e) => { if (e.target.id === 'keys' || e.target.closest('[data-close]')) $('keys').close(); });

  // file drag and drop, anywhere
  let dragDepth = 0;
  const isFileDrag = (e) => [...((e.dataTransfer && e.dataTransfer.types) || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!isFileDrag(e)) return; dragDepth++; $('drop-veil').hidden = false; });
  window.addEventListener('dragleave', (e) => { if (!isFileDrag(e)) return; if (--dragDepth <= 0) { dragDepth = 0; $('drop-veil').hidden = true; } });
  window.addEventListener('dragover', (e) => { if (isFileDrag(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    dragDepth = 0; $('drop-veil').hidden = true;
    readFile(e.dataTransfer.files[0]);
  });

  // keyboard
  window.addEventListener('keyup', (e) => { if (e.key === 'Shift') S.shift = false; });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') S.shift = true;
    const mod = e.ctrlKey || e.metaKey;
    if (e.target.closest && e.target.closest('input, select, textarea, dialog')) return;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === 'a' && S.part && S.step === 'holes' && S.screen === 'job') { e.preventDefault(); ui.holes.showTools(true); ui.holes.selectShown(); return; }
    if (mod || e.altKey) return;
    if (e.key === '?') { $('keys').showModal(); return; }
    if (!S.part || S.screen !== 'job') return;
    const k = e.key.toLowerCase();
    if (k === 'r') setTool('measure');
    else if (k === 'i') { $('chk-iron').click(); }
    else if (e.key === 'Escape' && S.measure && S.measure.a) clearMeasure();
    else if (e.key === 'Escape' && S.sel.size) ui.holes.clearSel();
    else if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel.size) {
      remember(); S.order = S.order.filter((id) => !S.sel.has(id)); refresh();
    }
    else if (k === 'v') setTool('select');
    else if (k === 'm') setTool('move');
    else if (k === 'h') setTool('place');
    else if (k === 'b') setTool('face');
    else if (k === 'f') fitView();
    else if (e.key === 'Escape') setTool(S.step === 'part' ? 'move' : 'select');
    else if (e.key === ' ') { e.preventDefault(); if (ui.review) ui.review.toggle(); }
    else if (e.key.startsWith('Arrow') && S.tool === 'move' && !S.place.locked) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      remember();
      if (e.key === 'ArrowLeft') S.place.x -= d;
      if (e.key === 'ArrowRight') S.place.x += d;
      if (e.key === 'ArrowUp') S.place.y += d;
      if (e.key === 'ArrowDown') S.place.y -= d;
      viewer.setInstances(insts());
      refresh();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && S.activeId != null && S.order.includes(S.activeId)) {
      toggleOrder(S.activeId);
    }
  });

  /* ---------- modules ---------- */
  const ctx = {
    IP, S, $, $$, esc, fmt, f1, f2, clamp, fmtTime, toast, viewer, is2D, K,
    byId, insts, arrayBox, worldHoles, worldHulls, refresh, updateView, remember, toggleOrder, goStep, goScreen, setTool, fitView,
    livePlacement, insertOptions, download, saveJob, jobObject, openJob, applyJob, loadSTL, loadExample, readFile, saveSession,
    setSetting, replaceSettings, saveSettings, setBed, trayOn, turn, resetOrientation,
    tray: {
      get full() { return S.inv; },
      set(i, v) { S.inv[i] = v ? 1 : 0; saveInv(); refresh(); },
      setAll(arr) { S.inv = IP.tray.fit(arr, S.settings); saveInv(); refresh(); },
      refill(size) {
        for (const p of IP.tray.pockets(S.settings)) if (!size || p.size === size) S.inv[p.i] = p.size ? 1 : 0;
        saveInv(); refresh();
      },
      reload() { loadInv(); refresh(); },
      save: saveInv,
    },
    redraw() { ui.holes.render(); updateView(); },
    jobLabels: () => (S.part ? worldHoles().map((h) => h.label) : []),
    buildRun(o) {
      const all = worldHoles();
      const holes = o.only ? all.slice(o.from, o.from + 1) : all.slice(o.from);
      return IP.gcode.generate({ name: S.name, partTop: S.part.size.z, copies: insts().length, holes, settings: S.settings, air: o.air,
        tray: { full: S.inv }, pickProbe: o.export ? 'G38.2' : 'G38.3' });
    },
    setLive(pos, hot, carry) {
      const was = !!S.live;
      S.live = pos ? { pos, hot } : null;
      if (pos) viewer.setTip(pos, hot ? 'live-hot' : 'live', carry || null);
      if (was !== !!pos && ui.review) ui.review.liveChanged(!!pos);
    },
    setLiveTray(t) { S.liveTray = t; viewer.setTray(trayView(null)); },
    updateTray(t) { viewer.setTray(trayView(t)); },
    setRunMarks(m) { S.runMarks = m || {}; updateView(); },
    profiles: {
      get list() { return Object.keys(S.profiles).sort(); },
      get current() { return S.profile; },
      dirty() { return !!S.profile && JSON.stringify(S.profiles[S.profile]) !== JSON.stringify(S.settings); },
      use(name) {
        if (!S.profiles[name]) return;
        S.profile = name; ls.set(K.current, name);
        replaceSettings(S.profiles[name], `Using the ${name} profile.`);
      },
      save(name) {
        S.profiles[name] = JSON.parse(JSON.stringify(S.settings));
        const oldKey = invKey();
        S.profile = name;
        ls.set(K.profiles, S.profiles); ls.set(K.current, name);
        if (oldKey !== name) saveInv();
      },
      remove() {
        if (!S.profile) return;
        delete S.profiles[S.profile];
        ls.set(K.profiles, S.profiles);
        S.profile = ''; ls.set(K.current, '');
        loadInv();
      },
    },
  };
  ui.setup = IP.ui.setup.init(ctx);
  ui.start = IP.ui.start.init(ctx);
  ui.part = IP.ui.part.init(ctx);
  ui.holes = IP.ui.holes.init(ctx);
  ui.review = IP.ui.review.init(ctx);
  ui.machine = IP.ui.machine.init(ctx);
  ctx.ui = ui;
  IP.app = { S, viewer, ctx, ui }; // for the console and tests

  goScreen('start');
  refresh();
})();
