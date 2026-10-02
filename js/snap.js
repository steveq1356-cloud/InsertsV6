/* InsertPress Planner — magnetic snapping while dragging parts. Pure.
 *
 * snapBox(box, env, thr) moves a dragged box { x, y, w, h } (the whole array's
 * footprint, mm) onto nearby targets within thr mm, per axis:
 *   fence:  left edge to X 0, front edge to Y 0 (both = the fence corner)
 *   bed:    right/back edge to the travel limit, centre to the bed centre
 *   others: beside another object (the tray, another part), `gap` apart, or edges flush
 *   grid:   front-left corner to the grid (weakest; only when nothing else is close)
 * env = { bed: { x, y }, grid, gap, others: [{ x0, y0, x1, y1, name }] }
 * Returns { x, y, snapped: { x: target|null, y: target|null }, label, guides: [{ x1, y1, x2, y2 }] }.
 */
(function (root) {
  'use strict';
  const IP = (root.IP = root.IP || {});

  function targets(box, env) {
    const bed = env.bed || { x: 200, y: 200 };
    const gap = env.gap || 0;
    const X = [], Y = [];
    // value = where box.x (or box.y) must be; line = the guide's fixed coordinate
    X.push({ v: 0, line: 0, name: 'left fence', kind: 'fence', span: [0, bed.y] });
    Y.push({ v: 0, line: 0, name: 'front fence', kind: 'fence', span: [0, bed.x] });
    X.push({ v: bed.x - box.w, line: bed.x, name: 'bed edge', kind: 'bed', span: [0, bed.y] });
    Y.push({ v: bed.y - box.h, line: bed.y, name: 'bed edge', kind: 'bed', span: [0, bed.x] });
    X.push({ v: (bed.x - box.w) / 2, line: bed.x / 2, name: 'bed centre', kind: 'centre', span: [0, bed.y] });
    Y.push({ v: (bed.y - box.h) / 2, line: bed.y / 2, name: 'bed centre', kind: 'centre', span: [0, bed.x] });
    for (const o of env.others || []) {
      const nm = o.name || 'part';
      const ys = [Math.min(o.y0, box.y), Math.max(o.y1, box.y + box.h)];
      const xs = [Math.min(o.x0, box.x), Math.max(o.x1, box.x + box.w)];
      X.push({ v: o.x1 + gap, line: o.x1 + gap, name: nm, kind: 'other', span: ys });
      X.push({ v: o.x0 - gap - box.w, line: o.x0 - gap, name: nm, kind: 'other', span: ys });
      X.push({ v: o.x0, line: o.x0, name: nm, kind: 'other', span: ys });
      Y.push({ v: o.y1 + gap, line: o.y1 + gap, name: nm, kind: 'other', span: xs });
      Y.push({ v: o.y0 - gap - box.h, line: o.y0 - gap, name: nm, kind: 'other', span: xs });
      Y.push({ v: o.y0, line: o.y0, name: nm, kind: 'other', span: xs });
    }
    return { X, Y };
  }

  function pick(list, cur, thr) {
    let best = null, bd = thr;
    for (const t of list) {
      const d = Math.abs(t.v - cur);
      if (d <= bd + 1e-9) { bd = d; best = t; }
    }
    return best;
  }

  function snapBox(box, env, thr) {
    env = env || {};
    const T = targets(box, env);
    let sx = pick(T.X, box.x, thr), sy = pick(T.Y, box.y, thr);
    const grid = env.grid || 0;
    if (!sx && grid) { const g = Math.round(box.x / grid) * grid; if (Math.abs(g - box.x) <= thr * 0.5) sx = { v: g, line: g, name: 'grid', kind: 'grid', span: [0, (env.bed || {}).y || 200] }; }
    if (!sy && grid) { const g = Math.round(box.y / grid) * grid; if (Math.abs(g - box.y) <= thr * 0.5) sy = { v: g, line: g, name: 'grid', kind: 'grid', span: [0, (env.bed || {}).x || 200] }; }
    const x = sx ? sx.v : box.x, y = sy ? sy.v : box.y;
    const guides = [];
    if (sx) guides.push({ x1: sx.line, y1: sx.span[0], x2: sx.line, y2: sx.span[1], kind: sx.kind });
    if (sy) guides.push({ x1: sy.span[0], y1: sy.line, x2: sy.span[1], y2: sy.line, kind: sy.kind });
    return { x, y, snapped: { x: sx, y: sy }, label: label(sx, sy), guides };
  }

  function label(sx, sy) {
    if (!sx && !sy) return '';
    if (sx && sy && sx.kind === 'fence' && sy.kind === 'fence') return 'Snapped to fence corner';
    if (sx && sy && sx.kind === 'centre' && sy.kind === 'centre') return 'Snapped to bed centre';
    const names = [];
    for (const s of [sx, sy]) if (s && !names.includes(s.name)) names.push(s.name);
    return 'Snapped to ' + names.join(' and ');
  }

  /** Angle snapping for the rotate handle: 15° steps, 90° sticky within 8°; free = whole degrees. */
  function snapAngle(deg, free) {
    const a = ((deg % 360) + 360) % 360;
    if (free) return Math.round(a) % 360;
    const q = Math.round(a / 90) * 90;
    if (Math.abs(a - q) <= 8) return q % 360;
    return (Math.round(a / 15) * 15) % 360;
  }

  IP.snap = { snapBox, snapAngle, label };
})(typeof window !== 'undefined' ? window : globalThis);
