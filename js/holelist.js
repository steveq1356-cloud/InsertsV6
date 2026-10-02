/* InsertPress Planner — hole list filtering, sorting, and selection helpers.
 * Pure: the list UI (ui-holes.js) renders what view() returns.
 */
(function (root) {
  'use strict';
  const IP = (root.IP = root.IP || {});

  const SORTS = [
    ['order', 'Press order'], ['x', 'X'], ['y', 'Y'], ['dia', 'Diameter'],
    ['depth', 'Depth'], ['wall', 'Wall'], ['insert', 'Insert'],
  ];

  function sizeKey(h) { return h.source === 'manual' || !h.dia ? 'hand' : (Math.round(h.dia * 10) / 10).toFixed(1); }

  function keyFn(sort, ctx) {
    const at = (h) => (ctx && ctx.coords ? ctx.coords(h) : h);
    const insertRank = (k) => { const i = Object.keys(IP.INSERTS || {}).indexOf(k); return i < 0 ? 99 : i; };
    switch (sort) {
      case 'x': return (h) => at(h).x;
      case 'y': return (h) => at(h).y;
      case 'dia': return (h) => (h.dia ? h.dia : Infinity);
      case 'depth': return (h) => (h.blind && h.depth != null ? h.depth : Infinity);
      case 'wall': return (h) => (h.wall != null ? h.wall : Infinity);
      case 'insert': return (h) => insertRank(h.insert);
      default: return null;
    }
  }

  /**
   * opts = { filter: 'all'|'pressing'|'skipped'|'issues', sizes: [sizeKey], sort, dir: 1|-1 }
   * ctx  = { coords(h) -> {x,y}, issues: Map(id -> [issue]) }
   * Returns { rows: [{ id, h, idx, det, issues }], counts, sizes: [{ key, ids, inN }] }
   */
  function view(holes, order, opts, ctx) {
    opts = Object.assign({ filter: 'all', sizes: [], sort: 'order', dir: 1 }, opts || {});
    const pos = new Map(order.map((id, i) => [id, i]));
    const issuesOf = (id) => (ctx && ctx.issues && ctx.issues.get(id)) || [];
    const counts = { all: holes.length, pressing: 0, skipped: 0, issues: 0 };
    const groups = new Map();
    holes.forEach((h) => {
      const used = pos.has(h.id);
      if (used) counts.pressing++; else counts.skipped++;
      if (issuesOf(h.id).length) counts.issues++;
      const k = sizeKey(h);
      if (!groups.has(k)) groups.set(k, { key: k, ids: [], inN: 0, dia: h.dia || Infinity });
      const g = groups.get(k);
      g.ids.push(h.id);
      if (used) g.inN++;
    });
    const sizes = [...groups.values()].sort((a, b) => a.dia - b.dia);
    const want = new Set(opts.sizes || []);
    let rows = holes.map((h, det) => ({ id: h.id, h, det, idx: pos.has(h.id) ? pos.get(h.id) : -1, issues: issuesOf(h.id) }));
    rows = rows.filter((r) => {
      if (opts.filter === 'pressing' && r.idx < 0) return false;
      if (opts.filter === 'skipped' && r.idx >= 0) return false;
      if (opts.filter === 'issues' && !r.issues.length) return false;
      if (want.size && !want.has(sizeKey(r.h))) return false;
      return true;
    });
    const k = keyFn(opts.sort, ctx);
    const dir = opts.dir < 0 ? -1 : 1;
    if (!k) rows.sort((a, b) => ((a.idx < 0) - (b.idx < 0)) || (a.idx - b.idx) || (a.det - b.det));
    else {
      rows.sort((a, b) => {
        const va = k(a.h), vb = k(b.h);
        if (va === vb) return a.det - b.det;
        if (va === Infinity) return 1;
        if (vb === Infinity) return -1;
        return (va - vb) * dir;
      });
    }
    return { rows, counts, sizes };
  }

  /** Ids from a to b (inclusive) in the order the rows are shown. */
  function range(rows, a, b) {
    const ia = rows.findIndex((r) => r.id === a), ib = rows.findIndex((r) => r.id === b);
    if (ia < 0 || ib < 0) return b != null ? [b] : [];
    const [lo, hi] = ia < ib ? [ia, ib] : [ib, ia];
    return rows.slice(lo, hi + 1).map((r) => r.id);
  }

  /** The press order re-sorted by a list sort (only holes already being pressed). */
  function orderBy(holes, order, sort, dir, ctx) {
    const k = keyFn(sort, ctx);
    if (!k) return order.slice();
    const byId = new Map(holes.map((h) => [h.id, h]));
    const d = dir < 0 ? -1 : 1;
    return order.slice().sort((a, b) => {
      const va = k(byId.get(a)), vb = k(byId.get(b));
      if (va === vb) return order.indexOf(a) - order.indexOf(b);
      if (va === Infinity) return 1;
      if (vb === Infinity) return -1;
      return (va - vb) * d;
    });
  }

  IP.holeList = { SORTS, sizeKey, view, range, orderBy };
})(typeof window !== 'undefined' ? window : globalThis);
