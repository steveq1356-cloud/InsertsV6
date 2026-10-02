/* InsertPress Planner — the Holes step.
 * Default: a simple list, one switch per hole, insert picker, drag to reorder.
 * Tools: size chips, status filter, sort, multi-select (checkboxes, Ctrl/Cmd-click,
 * Shift-click, Shift-drag in the view), bulk press/skip/insert/sink, shortest path,
 * place by hand, and the hole-size range.
 */
(function () {
  'use strict';
  const IP = window.IP;
  IP.ui = IP.ui || {};
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const X_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8"/></svg>';
  const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
  const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);

  function init(ctx) {
    const { $, S, fmt } = ctx;
    S.sel = new Set();
    S.list = { filter: 'all', sizes: [], sort: 'order', dir: 1, tools: false };
    let anchor = null, lastRows = [];

    $('hole-sort').innerHTML = IP.holeList.SORTS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
    $('bk-insert').innerHTML = '<option value="">Insert…</option>' + Object.entries(IP.INSERTS).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('');
    $('range-form').innerHTML = [['dMin', 'Smallest'], ['dMax', 'Largest']].map(([k, l]) =>
      `<label class="lab">${l}<span class="num-in"><input type="number" step="0.1" data-range="${k}"><span>mm</span></span></label>`).join('');

    const coords = (h) => IP.place.toWorld(ctx.insts()[0], h.x, h.y);
    const issueMap = () => {
      const m = new Map();
      for (const i of (S.result && S.result.issues) || []) {
        if (i.localId == null) continue;
        if (!m.has(i.localId)) m.set(i.localId, []);
        const t = i.text.replace(/^Hole \d+:?\s*/, '').replace(/^(is|measures|has|goes|would)/, 'This hole $1').replace(/^./, (c) => c.toUpperCase());
        if (!m.get(i.localId).some((x) => x.text === t)) m.get(i.localId).push({ text: t, level: i.level, kind: i.kind });
      }
      return m;
    };

    function holeMeta(h) {
      if (h.source === 'manual') return `Placed by hand, surface Z ${f1(h.H)}`;
      return `⌀${f2(h.dia)} · ${h.blind ? `${fmt(h.depth)} mm deep` : 'through'}${h.wall != null ? ` · ${f1(h.wall)} mm wall` : ''}`;
    }

    function inspector(h) {
      const ins = IP.INSERTS[h.insert];
      const st = S.settings;
      const sink = h.sink != null ? h.sink : st.sink;
      const need = h.dia ? (ins.od - h.dia) / 2 + st.wallMin : null;
      const w = coords(h);
      const cr = S.collRes.get('c0:' + h.id);
      const iron = !cr ? 'n/a' : cr.hits.length ? 'hits ' + cr.hits[0].zone.name : cr.clearance == null ? 'clear' : f1(cr.clearance) + ' mm';
      const cell = (label, val, bad) => `<div class="${bad ? 'bad' : ''}"><span>${label}</span><b>${val}</b></div>`;
      return `<div class="insp">
        ${cell('Measured', h.dia ? '⌀' + f2(h.dia) : 'n/a')}
        ${cell(esc(ins.name) + ' wants', '⌀' + f2(ins.hole), h.dia && Math.abs(h.dia - ins.hole) > 0.4)}
        ${cell('Knurl OD', '⌀' + f2(ins.od))}
        ${cell('Depth', h.blind ? f2(h.depth) : h.depth ? 'through' : 'n/a', h.blind && h.depth < ins.L + 0.3)}
        ${cell('Insert length', f2(ins.L))}
        ${cell('Wall', h.wall != null ? f2(h.wall) : 'n/a', need != null && h.wall != null && h.wall < need)}
        ${cell('Iron clearance', iron, cr && cr.hits.length)}
        ${cell('Bed X, Y', f1(w.x) + ', ' + f1(w.y))}
        ${cell('Press to', 'Z ' + f2(h.H - sink - (+st.pilotLen || 0)))}
      </div>
      <label class="sink">Finish below the surface
        <input type="number" step="0.05" data-sink="${h.id}" value="${h.sink != null ? h.sink : ''}" placeholder="${fmt(st.sink)}"> mm</label>`;
    }

    function render() {
      const tools = S.list.tools || S.sel.size > 0;
      $('tools-box').hidden = !tools;
      $('btn-tools').setAttribute('aria-pressed', String(tools));
      if (!tools) { S.list.filter = 'all'; S.list.sizes = []; S.list.sort = 'order'; }
      const issues = issueMap();
      let v = IP.holeList.view(S.holes, S.order, S.list, { coords, issues });
      // a size filter left over from another part (or units) would hide everything with no chip to clear it
      const known = new Set(v.sizes.map((g) => g.key));
      if (S.list.sizes.some((k) => !known.has(k))) {
        S.list.sizes = S.list.sizes.filter((k) => known.has(k));
        v = IP.holeList.view(S.holes, S.order, S.list, { coords, issues });
      }
      lastRows = v.rows;
      for (const id of [...S.sel]) if (!ctx.byId(id)) S.sel.delete(id);
      for (const el of document.querySelectorAll('[data-range]')) if (document.activeElement !== el) el.value = S.settings[el.dataset.range];

      if (tools) {
        const want = new Set(S.list.sizes);
        $('size-chips').innerHTML = v.sizes.map((g) => {
          const cls = [want.has(g.key) ? 'on' : '', g.inN === g.ids.length ? 'all' : g.inN ? 'some' : ''].join(' ');
          const name = g.key === 'hand' ? 'By hand' : '⌀' + g.key;
          return `<button class="chip ${cls}" data-chip="${g.key}" aria-pressed="${want.has(g.key)}" title="Show only ${name} holes (${g.inN} of ${g.ids.length} pressed)"><i class="dot"></i><b>${name}</b><span class="cnt">${g.ids.length}</span></button>`;
        }).join('');
        const c = v.counts;
        const seg = [['all', 'All', c.all], ['pressing', 'Pressing', c.pressing], ['skipped', 'Skipped', c.skipped], ['issues', 'Issues', c.issues]];
        $('hole-filter').innerHTML = seg.map(([k, l, n]) => `<button class="seg-btn${k === 'issues' && n ? ' warn' : ''}" data-filter="${k}" aria-checked="${S.list.filter === k}">${l}<span>${n}</span></button>`).join('');
        $('hole-sort').value = S.list.sort;
        $('hole-dir').hidden = S.list.sort === 'order';
        $('hole-dir').classList.toggle('desc', S.list.dir < 0);
        $('btn-use-sort').hidden = S.list.sort === 'order' || S.order.length < 2;
      }

      const n = S.order.length;
      const canDrag = S.list.sort === 'order';
      let divided = false;
      const html = [];
      for (const r of v.rows) {
        const h = r.h, used = r.idx >= 0;
        if (canDrag && !used && !divided && n && S.list.filter === 'all') { html.push('<li class="divider" aria-hidden="true">Skipped</li>'); divided = true; }
        const bad = r.issues.some((i) => i.level === 'error');
        const flags = r.issues.slice(0, 3).map((i) => `<div class="flag${i.level === 'error' ? ' err' : ''}">${esc(i.text)}</div>`).join('');
        const cls = `hole${tools ? '' : ' simple'}${used ? '' : ' skip'}${h.id === S.activeId ? ' active' : ''}${S.sel.has(h.id) ? ' sel' : ''}`;
        const ins = `<div class="ins"><select data-insert="${h.id}" aria-label="Insert">${ctx.insertOptions(h.insert)}</select></div>`;
        const detail = `${h.id === S.activeId ? inspector(h) : ''}${flags}`;
        if (!tools) {
          html.push(`<li class="${cls}" data-id="${h.id}" draggable="${canDrag && used}">
            <button class="tog" data-tog="${h.id}" role="switch" aria-checked="${used}" aria-label="Press this hole" title="${used ? 'Pressing. Click to skip' : 'Skipped. Click to press'}"><i></i></button>
            <span class="tag${bad ? ' bad' : ''}${used ? '' : ' off'}" ${used ? 'title="Drag to reorder"' : ''}>${used ? r.idx + 1 : '–'}</span>
            <div class="meta">${holeMeta(h)}</div>${ins}${detail}</li>`);
        } else {
          const w = coords(h);
          const action = used
            ? `<button class="x-btn" data-remove="${h.id}" title="Take out of the press order" aria-label="Take hole ${r.idx + 1} out">${X_ICON}</button>`
            : h.source === 'manual' ? `<button class="x-btn" data-delete="${h.id}" title="Delete this hand-placed hole" aria-label="Delete hole">${X_ICON}</button>` : '<span></span>';
          html.push(`<li class="${cls}" data-id="${h.id}" draggable="${canDrag && used}">
            <label class="ck" title="Select"><input type="checkbox" data-sel="${h.id}"${S.sel.has(h.id) ? ' checked' : ''} aria-label="Select hole"><span></span></label>
            <span class="tag${bad ? ' bad' : ''}${used ? '' : ' add'}" ${used ? 'title="Drag to reorder"' : `data-add="${h.id}" title="Add to the press order"`}>${used ? r.idx + 1 : '+'}</span>
            <div class="xy"><i>X</i><span>${f2(w.x)}</span><i>Y</i><span>${f2(w.y)}</span></div>
            ${ins}${action}
            <div class="meta">${holeMeta(h)}</div>${detail}</li>`);
        }
      }
      $('hole-list').innerHTML = html.join('');
      const shown = v.rows.length;
      $('list-head').hidden = !S.holes.length;
      $('shown-n').textContent = shown === S.holes.length ? `${shown} hole${shown === 1 ? '' : 's'}` : `${shown} of ${S.holes.length} shown`;
      const selShown = v.rows.filter((r) => S.sel.has(r.id)).length;
      $('sel-all').checked = shown > 0 && selShown === shown;
      $('sel-all').indeterminate = selShown > 0 && selShown < shown;
      $('btn-press-shown').disabled = !v.rows.some((r) => r.idx < 0);
      $('btn-skip-shown').disabled = !v.rows.some((r) => r.idx >= 0);

      const ns = S.sel.size;
      $('bulk').hidden = !ns;
      $('bulk-n').textContent = `${ns} selected`;
      $('bk-del').hidden = ![...S.sel].some((id) => { const h = ctx.byId(id); return h && h.source === 'manual'; });
      $('btn-optimize').disabled = S.order.length < 3;
      $('btn-press-all').disabled = !S.holes.length || S.order.length === S.holes.length;
      $('btn-press-none').disabled = !S.order.length;

      const copies = ctx.insts().length;
      $('count-line').innerHTML = !S.part ? '' : S.holes.length
        ? `<b>${S.order.length}</b> of ${S.holes.length} hole${S.holes.length === 1 ? '' : 's'} pressed${copies > 1 ? ` <span class="sub">· ${S.order.length * copies} inserts on ${copies} parts</span>` : ''}`
        : '<b>No holes</b>';
      const empty = $('order-empty');
      empty.hidden = !!S.holes.length || !S.part;
      if (!S.holes.length && S.part) {
        const down = S.ignored.some((i) => i.reason === 'blocked');
        empty.innerHTML = `<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="8"/><path d="M20 4v6M20 30v6M4 20h6M30 20h6"/></svg>
          <b>${down ? 'The holes open downward' : 'No insert holes face up'}</b>
          <p>${down ? 'Put the other side on the bed to reach them.' : 'Turn the part, widen the hole size range, or place holes by hand.'}</p>
          <div class="btn-row center">${down ? '<button class="btn small primary" data-empty="face">Pick the bottom face</button>' : ''}<button class="btn small" data-empty="place">Place by hand</button></div>`;
      }
      const big = S.ignored.filter((i) => i.reason === 'size').length;
      const blocked = S.ignored.filter((i) => i.reason === 'blocked').length;
      const parts = [];
      if (big) parts.push(`${big} round hole${big === 1 ? '' : 's'} outside ${fmt(S.settings.dMin)}–${fmt(S.settings.dMax)} mm`);
      if (blocked) parts.push(`${blocked} that open${blocked === 1 ? 's' : ''} downward`);
      $('ignored-note').textContent = parts.length ? `Not listed: ${parts.join(' and ')}.` : '';
      markHover();
    }

    function markHover() {
      document.querySelectorAll('#hole-list .hole').forEach((li) => li.classList.toggle('hover', +li.dataset.id === S.hoverId));
    }

    function select(id, mods) {
      if (mods.shift && anchor != null) {
        for (const x of IP.holeList.range(lastRows, anchor, id)) S.sel.add(x);
      } else if (mods.toggle) {
        if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id);
        anchor = id;
      } else {
        S.activeId = S.activeId === id ? null : id;
        anchor = id;
      }
      ctx.redraw();
    }
    function selectIds(ids, add) {
      if (!add) S.sel = new Set();
      for (const id of ids) S.sel.add(id);
      if (ids.length) anchor = ids[ids.length - 1];
      ctx.redraw();
    }
    function clearSel() { S.sel = new Set(); ctx.redraw(); }
    function selectShown() { selectIds(lastRows.map((r) => r.id), false); }
    function showTools(on) { if (S.list.tools !== on) { S.list.tools = on; render(); } }

    $('btn-tools').addEventListener('click', () => { S.list.tools = !(S.list.tools || S.sel.size); if (!S.list.tools) S.sel = new Set(); ctx.redraw(); });
    $('btn-press-all').addEventListener('click', () => { ctx.remember(); for (const h of S.holes) if (!S.order.includes(h.id)) S.order.push(h.id); ctx.refresh(); });
    $('btn-press-none').addEventListener('click', () => { ctx.remember(); S.order = []; S.activeId = null; ctx.refresh(); });
    $('range-form').addEventListener('change', (e) => {
      const k = e.target.dataset.range, v = parseFloat(e.target.value);
      if (k && isFinite(v)) ctx.setSetting(k, v);
    });
    $('size-chips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-chip]');
      if (!b) return;
      const s = new Set(S.list.sizes);
      if (s.has(b.dataset.chip)) s.delete(b.dataset.chip); else s.add(b.dataset.chip);
      S.list.sizes = [...s];
      render();
    });
    $('hole-filter').addEventListener('click', (e) => { const b = e.target.closest('[data-filter]'); if (b) { S.list.filter = b.dataset.filter; render(); } });
    $('hole-sort').addEventListener('change', (e) => { S.list.sort = e.target.value; S.list.dir = 1; render(); });
    $('hole-dir').addEventListener('click', () => { S.list.dir = -S.list.dir; render(); });
    $('btn-use-sort').addEventListener('click', () => {
      ctx.remember();
      S.order = IP.holeList.orderBy(S.holes, S.order, S.list.sort, S.list.dir, { coords });
      S.list.sort = 'order';
      ctx.refresh();
      ctx.toast('The press order now follows that sort.');
    });
    $('btn-optimize').addEventListener('click', () => {
      if (S.order.length < 3) { ctx.toast('Add at least three holes to reorder.'); return; }
      ctx.remember();
      const st = S.settings;
      const start = st.mode === 'xy' && st.park ? [st.parkX, st.parkY] : [0, 0];
      const inst = ctx.insts()[0];
      const pts = S.order.map((id) => { const h = ctx.byId(id); const w = IP.place.toWorld(inst, h.x, h.y); return { id, x: w.x, y: w.y, insert: h.insert }; });
      const tray = ctx.trayOn();
      S.order = (tray ? IP.tray.optimize(pts, st, S.inv, start) : IP.gcode.optimizeOrder(pts, start[0], start[1])).map((p) => p.id);
      ctx.refresh();
      ctx.toast(tray ? 'Reordered for the shortest round trips to the tray.' : 'Reordered for the shortest travel.');
    });
    $('sel-all').addEventListener('change', (e) => { if (e.target.checked) selectShown(); else clearSel(); });
    $('btn-press-shown').addEventListener('click', () => { ctx.remember(); for (const r of lastRows) if (r.idx < 0) S.order.push(r.id); ctx.refresh(); });
    $('btn-skip-shown').addEventListener('click', () => {
      ctx.remember();
      const out = new Set(lastRows.map((r) => r.id));
      S.order = S.order.filter((id) => !out.has(id));
      if (out.has(S.activeId)) S.activeId = null;
      ctx.refresh();
    });

    const selected = () => lastRows.map((r) => r.id).filter((id) => S.sel.has(id)).concat([...S.sel].filter((id) => !lastRows.some((r) => r.id === id)));
    $('bk-press').addEventListener('click', () => { ctx.remember(); for (const id of selected()) if (!S.order.includes(id)) S.order.push(id); ctx.refresh(); });
    $('bk-skip').addEventListener('click', () => { ctx.remember(); S.order = S.order.filter((id) => !S.sel.has(id)); ctx.refresh(); });
    $('bk-insert').addEventListener('change', (e) => {
      const v = e.target.value;
      if (!v) return;
      ctx.remember();
      for (const id of S.sel) { const h = ctx.byId(id); if (h) h.insert = v; }
      e.target.value = '';
      ctx.refresh();
      ctx.toast(`${S.sel.size} hole${S.sel.size === 1 ? '' : 's'} set to ${IP.INSERTS[v].name}.`);
    });
    $('bk-sink').addEventListener('change', (e) => {
      const v = parseFloat(e.target.value);
      ctx.remember();
      for (const id of S.sel) { const h = ctx.byId(id); if (h) h.sink = isFinite(v) ? v : null; }
      ctx.refresh();
      ctx.toast(isFinite(v) ? `Finish ${v} mm below the surface on ${S.sel.size} holes.` : 'The selected holes use the default finish depth again.');
    });
    $('bk-del').addEventListener('click', () => {
      ctx.remember();
      const del = new Set([...S.sel].filter((id) => { const h = ctx.byId(id); return h && h.source === 'manual'; }));
      S.holes = S.holes.filter((h) => !del.has(h.id));
      S.order = S.order.filter((id) => !del.has(id));
      for (const id of del) S.sel.delete(id);
      ctx.refresh();
    });
    $('bk-clear').addEventListener('click', clearSel);
    $('order-empty').addEventListener('click', (e) => {
      const b = e.target.closest('[data-empty]');
      if (!b) return;
      if (b.dataset.empty === 'face') { ctx.goStep('part'); ctx.setTool('face'); } else ctx.setTool('place');
    });

    const list = $('hole-list');
    list.addEventListener('click', (e) => {
      const tg = e.target.closest('[data-tog]');
      if (tg) { ctx.toggleOrder(+tg.dataset.tog); return; }
      const rm = e.target.closest('[data-remove]');
      if (rm) { ctx.toggleOrder(+rm.dataset.remove); return; }
      const del = e.target.closest('[data-delete]');
      if (del) { ctx.remember(); const id = +del.dataset.delete; S.holes = S.holes.filter((h) => h.id !== id); S.sel.delete(id); ctx.refresh(); return; }
      const add = e.target.closest('[data-add]');
      if (add) { ctx.toggleOrder(+add.dataset.add); return; }
      if (e.target.closest('select, input, label, .insp, .sink')) return;
      const li = e.target.closest('.hole');
      if (!li) return;
      const mods = { shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey };
      if (mods.shift || mods.toggle) S.list.tools = true;
      select(+li.dataset.id, mods);
    });
    list.addEventListener('change', (e) => {
      const ck = e.target.closest('[data-sel]');
      if (ck) {
        const id = +ck.dataset.sel;
        if (ck.checked) S.sel.add(id); else S.sel.delete(id);
        anchor = id;
        ctx.redraw();
        return;
      }
      const sel = e.target.closest('[data-insert]');
      if (sel) {
        const id = +sel.dataset.insert;
        ctx.remember();
        const ids = S.sel.has(id) && S.sel.size > 1 ? [...S.sel] : [id];
        for (const x of ids) { const h = ctx.byId(x); if (h) h.insert = sel.value; }
        if (ids.length > 1) ctx.toast(`${ids.length} selected holes set to ${IP.INSERTS[sel.value].name}.`);
        ctx.refresh();
        return;
      }
      const sk = e.target.closest('[data-sink]');
      if (sk) { ctx.remember(); const v = parseFloat(sk.value); ctx.byId(+sk.dataset.sink).sink = isFinite(v) ? v : null; ctx.refresh(); }
    });
    list.addEventListener('mouseover', (e) => {
      const li = e.target.closest('.hole');
      const id = li ? +li.dataset.id : null;
      if (id !== S.hoverId) { S.hoverId = id; ctx.updateView(); markHover(); }
    });
    list.addEventListener('mouseleave', () => { S.hoverId = null; ctx.updateView(); markHover(); });

    let dragId = null;
    list.addEventListener('dragstart', (e) => {
      const li = e.target.closest('.hole');
      if (!li || li.getAttribute('draggable') !== 'true') { e.preventDefault(); return; }
      dragId = +li.dataset.id;
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(dragId));
    });
    list.addEventListener('dragover', (e) => {
      if (dragId == null) return;
      e.preventDefault();
      list.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
      const li = e.target.closest('.hole');
      if (!li || !S.order.includes(+li.dataset.id)) return;
      const r = li.getBoundingClientRect();
      li.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
    });
    list.addEventListener('drop', (e) => {
      e.preventDefault();
      const li = e.target.closest('.hole');
      if (dragId == null || !li) return;
      const target = +li.dataset.id;
      if (target !== dragId && S.order.includes(target)) {
        ctx.remember();
        const after = li.classList.contains('drop-after');
        S.order.splice(S.order.indexOf(dragId), 1);
        S.order.splice(S.order.indexOf(target) + (after ? 1 : 0), 0, dragId);
      }
      dragId = null;
      ctx.refresh();
    });
    list.addEventListener('dragend', () => {
      dragId = null;
      list.querySelectorAll('.dragging, .drop-before, .drop-after').forEach((x) => x.classList.remove('dragging', 'drop-before', 'drop-after'));
    });

    return { render, select, selectIds, clearSel, selectShown, showTools, markHover, holeMeta, get rows() { return lastRows; } };
  }

  IP.ui.holes = { init };
})();
