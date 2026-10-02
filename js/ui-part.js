/* InsertPress Planner — the Part step: what was loaded, lay flat, position
 * (align buttons, lock, exact numbers), and copies with auto-fill.
 */
(function () {
  'use strict';
  const IP = window.IP;
  IP.ui = IP.ui || {};

  function init(ctx) {
    const { $, $$, S, fmt, f1 } = ctx;
    let thumbFor = null;

    function render() {
      if (!S.part) return;
      const s = S.part.size;
      $('part-name').textContent = S.name;
      const found = S.holes.filter((h) => h.source === 'auto').length;
      $('part-sub').textContent = `${f1(s.x)} × ${f1(s.y)} × ${f1(s.z)} mm · ${found} insert hole${found === 1 ? '' : 's'} found`;
      const m = S.mstats;
      $('part-stats').innerHTML = [[f1(m.volume / 1000), 'cm³'], [f1(m.area / 100), 'cm² surface'], [S.part.triCount.toLocaleString(), 'triangles']]
        .map(([b, sp]) => `<div><b>${b}</b><span>${sp}</span></div>`).join('');
      $$('[data-units]').forEach((b) => b.setAttribute('aria-checked', String(+b.dataset.units === S.scale)));
      const key = S.name + ':' + S.part.triCount + ':' + JSON.stringify([S.rot, S.tilt, S.scale]);
      if (thumbFor !== key) {
        thumbFor = key;
        try { $('part-thumb').style.backgroundImage = `url(${IP.thumb.render(S.part.positions, 52, 52, { pad: 3 })})`; } catch (e) { /* no canvas */ }
      }
      renderPlacement();
    }

    function renderPlacement() {
      if (!S.part) return;
      const set = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v; };
      set('pos-x', fmt(S.place.x)); set('pos-y', fmt(S.place.y)); set('pos-rot', fmt(S.place.rot));
      set('cp-nx', S.copies.nx); set('cp-ny', S.copies.ny); set('cp-gap', fmt(S.copies.gap));
      const locked = !!S.place.locked;
      const lb = $('btn-lock');
      lb.setAttribute('aria-pressed', String(locked));
      lb.querySelector('span').textContent = locked ? 'Locked' : 'Unlocked';
      $$('.al, #pos-x, #pos-y, #pos-rot, [data-rot], #btn-face').forEach((el) => { el.disabled = locked; });
      const b = ctx.arrayBox(), st = S.settings;
      const n = ctx.insts().length;
      $('copies-n').textContent = n > 1 ? `${n} parts` : '';
      const fits = b.x >= -0.01 && b.y >= -0.01 && b.x + b.w <= st.bedX + 0.01 && b.y + b.h <= st.bedY + 0.01;
      const el = $('array-info');
      el.classList.toggle('warn', !fits);
      const skipped = (S.copies.skip || []).length;
      el.innerHTML = `${f1(b.w)} × ${f1(b.h)} mm${skipped ? `, ${skipped} left off the tray` : ''}. `
        + (fits ? `Fits the ${st.bedX} × ${st.bedY} travel.` : `<b>Runs past the ${st.bedX} × ${st.bedY} travel.</b>`);
      $('btn-one').hidden = n === 1 && !skipped;
    }

    const num = (id, d) => { const v = parseFloat($(id).value); return isFinite(v) ? v : d; };
    ['pos-x', 'pos-y', 'pos-rot'].forEach((id) => $(id).addEventListener('change', () => {
      if (S.place.locked) return;
      ctx.remember();
      const r = ((num('pos-rot', S.place.rot) % 360) + 360) % 360;
      if (r !== S.place.rot) Object.assign(S.place, IP.place.rotateKeep(S.hull, S.place, S.copies, r));
      S.place.x = num('pos-x', S.place.x);
      S.place.y = num('pos-y', S.place.y);
      ctx.viewer.setInstances(ctx.insts());
      ctx.refresh();
    }));
    ['cp-nx', 'cp-ny', 'cp-gap'].forEach((id) => $(id).addEventListener('change', () => {
      ctx.remember();
      S.copies.nx = ctx.clamp(Math.round(num('cp-nx', 1)), 1, 20);
      S.copies.ny = ctx.clamp(Math.round(num('cp-ny', 1)), 1, 20);
      S.copies.gap = Math.max(0, num('cp-gap', S.copies.gap));
      S.copies.skip = [];
      ctx.viewer.setInstances(ctx.insts());
      ctx.refresh();
    }));
    $$('.al').forEach((b) => b.addEventListener('click', () => {
      if (S.place.locked) return;
      ctx.remember();
      const p = IP.place.align(S.hull, S.place, S.copies, { x: S.settings.bedX, y: S.settings.bedY }, b.dataset.align);
      S.place.x = p.x; S.place.y = p.y;
      ctx.viewer.setInstances(ctx.insts());
      ctx.refresh();
      ctx.toast({ corner: 'In the fence corner.', left: 'Against the left fence (X 0).', front: 'Against the front fence (Y 0).', center: 'Centred on the bed.' }[b.dataset.align]);
    }));
    $('btn-lock').addEventListener('click', () => {
      ctx.remember();
      S.place.locked = !S.place.locked;
      ctx.setTool(S.place.locked ? 'select' : S.step === 'part' ? 'move' : 'select');
      ctx.refresh();
      ctx.toast(S.place.locked ? 'Position locked: dragging, nudging, and the align buttons are off.' : 'Position unlocked.');
    });
    $('btn-autofill').addEventListener('click', () => {
      ctx.remember();
      const gap = Math.max(0, S.copies.gap);
      const avoid = [];
      if (ctx.trayOn()) { const o = IP.tray.outline(S.settings); avoid.push({ x0: o.x0 - gap, y0: o.y0 - gap, x1: o.x1 + gap, y1: o.y1 + gap }); }
      const f = IP.place.autoFill(S.hull, S.place, { x: S.settings.bedX, y: S.settings.bedY }, gap, avoid);
      S.copies = { nx: f.nx, ny: f.ny, gap, skip: f.skip };
      ctx.viewer.setInstances(ctx.insts());
      ctx.refresh();
      ctx.fitView();
      if (f.blocked) ctx.toast('The part sits on the tray, so no copies fit. Move it off the tray first.', true);
      else ctx.toast(`${f.count} ${f.count === 1 ? 'copy fits' : 'copies fit'} with ${fmt(gap)} mm gaps${f.skip.length ? `, ${f.skip.length} left off the tray` : ''}.`);
    });
    $('btn-one').addEventListener('click', () => {
      ctx.remember();
      S.copies = { nx: 1, ny: 1, gap: S.copies.gap, skip: [] };
      ctx.viewer.setInstances(ctx.insts());
      ctx.refresh();
    });

    return { render, renderPlacement };
  }

  IP.ui.part = { init };
})();
