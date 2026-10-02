/* InsertPress Planner — 2D top view.
 * Used when Three.js can't load (offline, blocked CDN). Same interface as IP.Viewer:
 *   setBed(x, y, park, fenceH)  setPart(positions, size)  setInstances([{rot, tx, ty}])
 *   setHoles(markers)  setPath(pts)  setPathVisible(v)  setTip(pos, kind, carry)  setIron(zones)
 *   setGhost(g)  setMeasure(m)  setXray(on)  setTray(t)  setGuides(lines)  frame(kind, bounds)
 *   resize()  setInsets(right)  project(x, y, z)  mmPerPx()
 * Handlers: onPick(info) onHover(id, cx, cy) tool() onMoveStart() onMove(dx, dy, mods) onMoveEnd()
 *           onMeasure(kind, point) onBox(ids, additive) onFrame()
 * Tools: select, move (drag parts), place, measure, face (click the face that goes down).
 */
(function (root) {
  'use strict';
  const IP = (root.IP = root.IP || {});

  const COL = {
    plate: 'rgba(255,255,255,0.028)', minor: 'rgba(255,255,255,0.04)', major: 'rgba(255,255,255,0.1)',
    limit: 'rgba(170,184,190,0.5)', steel: '#8e999d', steelHi: '#b7c0c3', steelLo: '#5f6a6e', tick: '#2a3236',
    brass: '#c09036', brassHi: '#d9ab4f', brassInk: '#2e220c', found: 'rgba(246,244,238,0.9)',
    hot: '#e0603a', hotFill: 'rgba(224,96,58,0.28)', path: 'rgba(217,171,79,0.85)', live: '#f2f4f2',
  };

  class Viewer2D {
    constructor(el, handlers) {
      this.el = el;
      this.h = handlers || {};
      this.bed = { x: 200, y: 200 };
      this.fenceH = 8;
      this.markers = [];
      this.instances = [{ rot: 0, tx: 0, ty: 0 }];
      this.path = null;
      this.pathVisible = true;
      this.tip = null;
      this.zones = [{ d: 5, from: 0 }, { d: 18, from: 45 }];
      this.ghost = null;
      this.measure = null;
      this.box = null;
      this.tray = null;
      this.guides = null;
      this.view = { k: 2, ox: 60, oy: 400 };
      this.dpr = 1;
      const c = (this.canvas = document.createElement('canvas'));
      c.style.display = 'block';
      c.style.touchAction = 'none';
      el.appendChild(c);
      this.ctx = c.getContext('2d');

      let drag = null;
      c.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
        const { px, py } = this._local(e);
        const tool = this._tool();
        if (e.button === 0 && tool === 'move' && this._instAt(px, py) != null) {
          drag = { kind: 'part', wx: this.wx(px), wy: this.wy(py) };
          if (this.h.onMoveStart) this.h.onMoveStart();
        } else if (e.button === 0 && tool === 'select' && e.shiftKey) {
          drag = { kind: 'box', x0: px, y0: py };
          this.box = { x0: px, y0: py, x1: px, y1: py };
        } else {
          drag = { kind: 'pan', x: e.clientX, y: e.clientY, ox: this.view.ox, oy: this.view.oy, moved: 0, button: e.button };
        }
        c.setPointerCapture(e.pointerId);
      });
      c.addEventListener('contextmenu', (e) => e.preventDefault());
      c.addEventListener('pointermove', (e) => {
        const { px, py } = this._local(e);
        if (drag && drag.kind === 'part') {
          if (this.h.onMove) this.h.onMove(this.wx(px) - drag.wx, this.wy(py) - drag.wy, { alt: e.altKey, shift: e.shiftKey });
          return;
        }
        if (drag && drag.kind === 'box') {
          this.box.x1 = px; this.box.y1 = py;
          this.draw();
          return;
        }
        if (drag) {
          drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.x, e.clientY - drag.y));
          if (drag.moved > 4) {
            this.view.ox = drag.ox + (e.clientX - drag.x);
            this.view.oy = drag.oy + (e.clientY - drag.y);
            this._userView = true;
            this.draw();
          }
          return;
        }
        this._hover(e);
      });
      c.addEventListener('pointerup', (e) => {
        if (drag && drag.kind === 'part') { if (this.h.onMoveEnd) this.h.onMoveEnd(); }
        else if (drag && drag.kind === 'box') {
          const b = this.box;
          this.box = null;
          if (Math.hypot(b.x1 - b.x0, b.y1 - b.y0) < 5) this._pick(e);
          else {
            const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
            const ids = [...new Set(this.markers.filter((m) => {
              const X = this.sx(m.x), Y = this.sy(m.y);
              return X >= x0 && X <= x1 && Y >= y0 && Y <= y1;
            }).map((m) => m.id))];
            if (this.h.onBox) this.h.onBox(ids, true);
          }
          this.draw();
        } else if (drag && drag.moved <= 4 && drag.button === 0) this._pick(e);
        drag = null;
      });
      c.addEventListener('pointerleave', () => {
        if (this.h.onHover) this.h.onHover(null);
        if (this._tool() === 'measure' && this.h.onMeasure) this.h.onMeasure('leave', null);
      });
      c.addEventListener('wheel', (e) => {
        e.preventDefault();
        const { px, py } = this._local(e);
        const k = Math.min(80, Math.max(0.3, this.view.k * Math.exp(-e.deltaY * 0.0015)));
        const real = k / this.view.k;
        this.view.ox = px - (px - this.view.ox) * real;
        this.view.oy = py - (py - this.view.oy) * real;
        this.view.k = k;
        this._userView = true;
        this.draw();
      }, { passive: false });

      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(el);
      this.resize();
    }

    _tool() { return this.h.tool ? this.h.tool() : 'select'; }

    resize() {
      const dpr = (this.dpr = Math.min(window.devicePixelRatio || 1, 2));
      this.w = this.el.clientWidth || 1;
      this.hgt = this.el.clientHeight || 1;
      this.canvas.width = this.w * dpr;
      this.canvas.height = this.hgt * dpr;
      this.canvas.style.width = this.w + 'px';
      this.canvas.style.height = this.hgt + 'px';
      this.frame(null, this._bounds);
    }

    setBed(x, y, park, fenceH) { this.bed = { x, y }; this.park = park || null; if (fenceH != null) this.fenceH = fenceH; this.draw(); }

    setPart(positions, size) {
      this.size = size;
      this.tris = positions;
      this.up = [];
      this.runs = [];
      this.edges = null;
      if (positions) {
        const P = positions, n = P.length / 9;
        for (let t = 0; t < n; t++) {
          const b = t * 9;
          const ux = P[b + 3] - P[b], uy = P[b + 4] - P[b + 1], uz = P[b + 5] - P[b + 2];
          const vx = P[b + 6] - P[b], vy = P[b + 7] - P[b + 1], vz = P[b + 8] - P[b + 2];
          const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          const l = Math.hypot(nx, ny, nz);
          if (!l || nz / l < 0.3) continue;
          this.up.push({ b, z: (P[b + 2] + P[b + 5] + P[b + 8]) / 3, nz: nz / l, nx: nx / l, ny: ny / l });
        }
        this.up.sort((a, b) => a.z - b.z);
        // shade: height sets the value, a soft light from the front-left adds relief on slopes
        const zt = Math.max(size.z, 0.001);
        let cur = null;
        for (const t of this.up) {
          const lit = Math.max(0, -0.45 * t.nx - 0.55 * t.ny + 0.7 * t.nz);
          const v = Math.round(118 + 88 * (t.z / zt) + 34 * (lit - 0.7));
          const col = `rgb(${v},${v + 5},${v + 8})`;
          if (!cur || cur.col !== col) { cur = { col, path: new Path2D() }; this.runs.push(cur); }
          const b = t.b;
          cur.path.moveTo(P[b], P[b + 1]);
          cur.path.lineTo(P[b + 3], P[b + 4]);
          cur.path.lineTo(P[b + 6], P[b + 7]);
          cur.path.closePath();
        }
        if (n < 300000) this.edges = this._featureEdges(P);
        this.hull = IP.place ? IP.place.footprintHull(P) : null;
      }
      this._userView = false;
      this.draw();
    }

    /** Edges where an up-facing region ends: outlines of tops, steps, and holes. */
    _featureEdges(P) {
      const q = 1e3;
      const key = (i) => Math.round(P[i] * q) + ',' + Math.round(P[i + 1] * q) + ',' + Math.round(P[i + 2] * q);
      const count = new Map();
      for (const t of this.up) {
        const ks = [key(t.b), key(t.b + 3), key(t.b + 6)];
        for (let e = 0; e < 3; e++) {
          const a = ks[e], c = ks[(e + 1) % 3];
          const k = a < c ? a + '|' + c : c + '|' + a;
          const rec = count.get(k);
          if (rec) rec.n++;
          else count.set(k, { n: 1, i: t.b + e * 3, j: t.b + ((e + 1) % 3) * 3 });
        }
      }
      const path = new Path2D();
      for (const r of count.values()) {
        if (r.n !== 1) continue;
        path.moveTo(P[r.i], P[r.i + 1]);
        path.lineTo(P[r.j], P[r.j + 1]);
      }
      return path;
    }

    setInstances(list) { this.instances = list && list.length ? list : [{ rot: 0, tx: 0, ty: 0 }]; this.draw(); }
    setHoles(markers) { this.markers = markers; this.draw(); }
    setPath(pts) { this.path = pts; this.draw(); }
    setPathVisible(v) { this.pathVisible = v; this.draw(); }
    setTip(pos, kind, carry) { this.tip = pos ? { pos, kind, carry: carry || null } : null; this.draw(); }
    setTray(t) { this.tray = t || null; this.draw(); }
    setGuides(g) { this.guides = g && g.length ? g : null; this.draw(); }
    mmPerPx() { return 1 / this.view.k; }
    setIron(zones) { if (zones && zones.length) this.zones = zones; this.draw(); }
    setGhost(g) { this.ghost = g || null; this.draw(); }
    setMeasure(m) { this.measure = m || null; this.draw(); }
    setXray() {}

    frame(kind, b) {
      if (b) this._bounds = b;
      const s = this._bounds || (this.size ? { x: 0, y: 0, w: this.size.x, h: this.size.y } : { x: 0, y: 0, w: this.bed.x, h: this.bed.y });
      const x0 = Math.min(s.x, 0) - 14, y0 = Math.min(s.y, 0) - 14;
      const x1 = Math.max(s.x + s.w, 20) + 8, y1 = Math.max(s.y + s.h, 20) + 8;
      const padL = 96, padR = this.padRight || 48, padTop = 70, padBot = 120; // room for the tool rail and timeline
      const k = Math.min((this.w - padL - padR) / (x1 - x0), (this.hgt - padTop - padBot) / (y1 - y0));
      this.view.k = Math.max(0.3, Math.min(40, k));
      this.view.ox = padL + ((this.w - padL - padR) - (x1 - x0) * this.view.k) / 2 - x0 * this.view.k;
      this.view.oy = padTop + ((this.hgt - padTop - padBot) + (y1 - y0) * this.view.k) / 2 + y0 * this.view.k;
      this.draw();
    }
    setInsets(right) { this.padRight = right; }

    sx(x) { return this.view.ox + x * this.view.k; }
    sy(y) { return this.view.oy - y * this.view.k; }
    wx(px) { return (px - this.view.ox) / this.view.k; }
    wy(py) { return (this.view.oy - py) / this.view.k; }
    project(x, y) { return { x: this.sx(x), y: this.sy(y) }; }

    _screen() { const d = this.dpr; this.ctx.setTransform(d, 0, 0, d, 0, 0); }

    draw() {
      const c = this.ctx;
      if (!c || !this.w) return;
      this._screen();
      c.clearRect(0, 0, this.w, this.hgt);
      this._drawBed(c);
      this._drawTray(c);
      this._drawParts(c);
      this._drawGuides(c);
      this._drawPath(c);
      this._drawGhost(c);
      this._drawHoles(c);
      this._drawTip(c);
      this._drawMeasure(c);
      if (this.box) {
        const b = this.box;
        c.save();
        c.fillStyle = 'rgba(217,171,79,0.08)'; c.strokeStyle = COL.brassHi; c.lineWidth = 1; c.setLineDash([5, 4]);
        c.fillRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
        c.strokeRect(Math.min(b.x0, b.x1) + 0.5, Math.min(b.y0, b.y1) + 0.5, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
        c.restore();
      }
      if (this.h.onFrame) this.h.onFrame();
    }

    _drawTray(c) {
      const t = this.tray;
      if (!t) return;
      const k = this.view.k, b = t.box;
      const X0 = this.sx(b.x0), Y0 = this.sy(b.y1), W = (b.x1 - b.x0) * k, H = (b.y1 - b.y0) * k;
      c.save();
      const g = c.createLinearGradient(X0, Y0, X0, Y0 + H);
      g.addColorStop(0, '#59656a'); g.addColorStop(1, '#465156');
      c.fillStyle = g;
      roundRect(c, X0, Y0, W, H, Math.min(6, 1.5 * k)); c.fill();
      c.lineWidth = 1; c.strokeStyle = 'rgba(220,228,230,0.35)'; c.stroke();
      for (const p of t.pockets) {
        const x = this.sx(p.x), y = this.sy(p.y), r = Math.max(2.2, (p.d / 2) * k);
        c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
        if (p.state === 'full' || p.state === 'job') {
          c.fillStyle = COL.brass; c.fill();
          c.beginPath(); c.arc(x, y, r * 0.45, 0, Math.PI * 2); c.fillStyle = '#4a3a17'; c.fill();
        } else { c.fillStyle = '#1b2327'; c.fill(); c.lineWidth = 1; c.strokeStyle = 'rgba(200,210,212,0.35)'; c.stroke(); }
        if (p.state === 'job' || p.state === 'next') {
          c.beginPath(); c.arc(x, y, r + Math.max(2, k * 0.6), 0, Math.PI * 2);
          c.lineWidth = p.state === 'next' ? 2.5 : 1.5; c.strokeStyle = p.state === 'next' ? '#fff' : 'rgba(255,255,255,0.75)'; c.stroke();
        }
      }
      if (k > 1.4) {
        c.fillStyle = 'rgba(225,232,230,0.8)';
        c.font = '600 11px Archivo, "Helvetica Neue", Arial, sans-serif';
        c.textAlign = 'left'; c.textBaseline = 'bottom';
        c.fillText(t.label || 'Tray', X0 + 2, Y0 - 4);
      }
      c.restore();
    }

    _drawGuides(c) {
      if (!this.guides) return;
      c.save();
      c.strokeStyle = COL.brassHi; c.lineWidth = 1.5; c.setLineDash([7, 5]);
      for (const g of this.guides) {
        c.beginPath(); c.moveTo(this.sx(g.x1), this.sy(g.y1)); c.lineTo(this.sx(g.x2), this.sy(g.y2)); c.stroke();
      }
      c.restore();
    }

    _drawBed(c) {
      const k = this.view.k, B = this.bed;
      c.fillStyle = COL.plate;
      c.fillRect(this.sx(0), this.sy(B.y), B.x * k, B.y * k);
      const step = k > 6 ? 5 : 10;
      c.lineWidth = 1;
      for (let i = step; i <= B.x; i += step) {
        c.strokeStyle = i % 50 === 0 ? COL.major : COL.minor;
        const X = Math.round(this.sx(i)) + 0.5;
        c.beginPath(); c.moveTo(X, this.sy(0)); c.lineTo(X, this.sy(B.y)); c.stroke();
      }
      for (let j = step; j <= B.y; j += step) {
        c.strokeStyle = j % 50 === 0 ? COL.major : COL.minor;
        const Y = Math.round(this.sy(j)) + 0.5;
        c.beginPath(); c.moveTo(this.sx(0), Y); c.lineTo(this.sx(B.x), Y); c.stroke();
      }
      c.strokeStyle = COL.limit;
      c.setLineDash([6, 5]);
      c.strokeRect(this.sx(0) + 0.5, this.sy(B.y) + 0.5, B.x * k, B.y * k);
      c.setLineDash([]);
      c.fillStyle = 'rgba(190,200,203,0.55)';
      c.font = '11px "JetBrains Mono", ui-monospace, Menlo, monospace';
      c.textAlign = 'right'; c.textBaseline = 'bottom';
      c.fillText(`${B.x} × ${B.y} travel`, this.sx(B.x) - 4, this.sy(B.y) - 4);

      // fence rails as steel rules, ticks on the working edge
      const fw = Math.max(9, Math.min(22, 4 * k));
      const fl = Math.min(Math.max(B.x, B.y), 160);
      const x0 = this.sx(0), y0 = this.sy(0);
      const steel = (x, y, w, h, vertical) => {
        const g = vertical ? c.createLinearGradient(x, 0, x + w, 0) : c.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, vertical ? COL.steelLo : COL.steelHi);
        g.addColorStop(1, vertical ? COL.steelHi : COL.steelLo);
        c.fillStyle = g;
        c.fillRect(x, y, w, h);
      };
      steel(x0 - fw, this.sy(fl), fw, fl * k + fw, true);
      steel(x0 - fw, y0, fl * k + fw, fw, false);
      c.strokeStyle = COL.tick; c.fillStyle = COL.tick; c.lineWidth = 1;
      const minor = k >= 5 ? 1 : k >= 1.6 ? 5 : 10;
      const lab = k >= 3.2 ? 10 : k >= 1.2 ? 50 : 100;
      c.font = `600 ${Math.max(9, Math.min(11, fw * 0.5))}px "JetBrains Mono", ui-monospace, monospace`;
      for (let i = minor; i <= fl; i += minor) {
        const len = i % 10 === 0 ? fw * 0.55 : i % 5 === 0 ? fw * 0.38 : fw * 0.22;
        const X = Math.round(this.sx(i)) + 0.5, Y = Math.round(this.sy(i)) + 0.5;
        c.beginPath(); c.moveTo(X, y0); c.lineTo(X, y0 + len); c.stroke();
        c.beginPath(); c.moveTo(x0, Y); c.lineTo(x0 - len, Y); c.stroke();
        if (i % lab === 0 && fw >= 11) {
          c.textAlign = 'left'; c.textBaseline = 'bottom';
          c.fillText(String(i), X + 2, y0 + fw - 1);
          c.save(); c.translate(x0 - fw + 1, Y - 2); c.rotate(-Math.PI / 2);
          c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText(String(i), 0, 0); c.restore();
        }
      }
      // corner: axis names on the rules
      c.fillStyle = 'rgba(214,222,224,0.75)';
      c.font = '600 11px Archivo, "Helvetica Neue", Arial, sans-serif';
      c.textAlign = 'left'; c.textBaseline = 'top';
      c.fillText('X', this.sx(Math.min(fl, B.x)) + 6, y0 + 2);
      c.textAlign = 'center'; c.textBaseline = 'bottom';
      c.fillText('Y', x0 - fw / 2, this.sy(Math.min(fl, B.y)) - 5);
      if (this.park) {
        const X = this.sx(this.park.x), Y = this.sy(this.park.y);
        c.strokeStyle = 'rgba(200,210,212,0.7)'; c.lineWidth = 1.5;
        c.beginPath(); c.arc(X, Y, 5, 0, Math.PI * 2); c.moveTo(X - 9, Y); c.lineTo(X + 9, Y); c.moveTo(X, Y - 9); c.lineTo(X, Y + 9); c.stroke();
      }
    }

    _drawParts(c) {
      if (!this.runs || !this.runs.length) return;
      const k = this.view.k, d = this.dpr;
      for (const inst of this.instances) {
        const a = (inst.rot * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
        c.setTransform(d * k * co, -d * k * si, -d * k * si, -d * k * co, d * (this.view.ox + k * inst.tx), d * (this.view.oy - k * inst.ty));
        // drop shadow from the hull so the part lifts off the bed
        if (this.hull && this.hull.length > 2) {
          c.save();
          c.translate(0.9 / k * 2, -0.9 / k * 2);
          c.beginPath();
          this.hull.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
          c.closePath();
          c.fillStyle = 'rgba(8,12,14,0.35)';
          c.fill();
          c.restore();
        }
        c.lineWidth = 0.8 / k;
        c.lineJoin = 'round';
        for (const r of this.runs) { c.fillStyle = r.col; c.strokeStyle = r.col; c.fill(r.path); c.stroke(r.path); }
        if (this.edges) { c.lineWidth = 1 / k; c.strokeStyle = 'rgba(38,48,53,0.55)'; c.stroke(this.edges); }
      }
      this._screen();
    }

    _drawPath(c) {
      if (!this.path || !this.pathVisible || this.path.length < 2) return;
      c.save();
      c.strokeStyle = COL.path; c.lineWidth = 1.4; c.setLineDash([5, 4]);
      c.beginPath();
      let last = null;
      for (const p of this.path) {
        if (last && last[0] === p[0] && last[1] === p[1]) continue;
        if (!last) c.moveTo(this.sx(p[0]), this.sy(p[1])); else c.lineTo(this.sx(p[0]), this.sy(p[1]));
        last = p;
      }
      c.stroke();
      c.restore();
    }

    _drawGhost(c) {
      const g = this.ghost;
      if (!g) return;
      const X = this.sx(g.x), Y = this.sy(g.y), k = this.view.k;
      const zs = this.zones.map((z, i) => ({ z, i })).sort((a, b) => b.z.d - a.z.d);
      c.save();
      for (const { z, i } of zs) {
        const R = (z.d / 2 + (g.margin || 0)) * k;
        const bad = g.hit && g.hit.includes(i);
        c.beginPath(); c.arc(X, Y, R, 0, Math.PI * 2);
        c.fillStyle = bad ? COL.hotFill : 'rgba(240,244,242,0.05)';
        c.fill();
        c.lineWidth = bad ? 2 : 1.2;
        c.setLineDash(bad ? [] : [4, 4]);
        c.strokeStyle = bad ? COL.hot : 'rgba(240,244,242,0.55)';
        c.stroke();
        if (R > 26) {
          c.setLineDash([]);
          c.fillStyle = bad ? '#ffb39b' : 'rgba(225,232,230,0.8)';
          c.font = '600 10.5px Archivo, "Helvetica Neue", Arial, sans-serif';
          c.textAlign = 'center'; c.textBaseline = 'bottom';
          c.fillText(`${z.name || ''} ⌀${Math.round(z.d * 10) / 10}`, X, Y - R - 3);
        }
      }
      c.restore();
    }

    _drawHoles(c) {
      const k = this.view.k;
      c.font = '700 11.5px Archivo, "Helvetica Neue", Arial, sans-serif';
      for (const h of this.markers) {
        const r = Math.max(4, ((h.dia || 4) / 2) * k);
        const x = this.sx(h.x), y = this.sy(h.y);
        if (h.sel) {
          c.beginPath(); c.arc(x, y, r + 5, 0, Math.PI * 2);
          c.lineWidth = 2; c.strokeStyle = 'rgba(255,255,255,0.95)'; c.stroke();
        }
        c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
        if (h.run === 'done') {
          // a pressed-in insert: brass with knurl ticks
          c.fillStyle = COL.brass; c.fill();
          c.lineWidth = 1.5; c.strokeStyle = COL.brassHi; c.stroke();
          c.strokeStyle = 'rgba(46,34,12,0.55)'; c.lineWidth = 1;
          const n = Math.max(8, Math.min(20, Math.round(r)));
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            c.beginPath(); c.moveTo(x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62); c.lineTo(x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92); c.stroke();
          }
          c.beginPath(); c.arc(x, y, r * 0.42, 0, Math.PI * 2); c.fillStyle = '#4a3a17'; c.fill();
        } else if (h.run === 'trip') {
          c.fillStyle = COL.hotFill; c.fill();
          c.lineWidth = 3; c.strokeStyle = COL.hot; c.stroke();
        } else if (h.used) {
          c.fillStyle = h.active ? 'rgba(255,210,122,.42)' : 'rgba(192,144,54,.32)'; c.fill();
          c.lineWidth = h.run === 'now' ? 4 : 2.5;
          c.strokeStyle = h.bad ? COL.hot : h.active ? '#ffd27a' : COL.brass; c.stroke();
        } else {
          c.fillStyle = h.active ? 'rgba(192,144,54,.25)' : 'rgba(31,40,45,.18)'; c.fill();
          c.lineWidth = 3.5; c.strokeStyle = 'rgba(255,255,255,.85)'; c.stroke();
          c.lineWidth = 1.6; c.strokeStyle = h.bad ? COL.hot : h.active ? '#8a6420' : '#1f282d'; c.setLineDash([4, 3]); c.stroke(); c.setLineDash([]);
        }
        if (h.bad && h.run !== 'done') {
          const bx = x - r * 0.75 - 8, by = y + r * 0.75 - 2;
          c.beginPath(); c.arc(bx, by, 7, 0, Math.PI * 2); c.fillStyle = COL.hot; c.fill();
          c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
          c.font = '800 10px Archivo, "Helvetica Neue", Arial, sans-serif';
          c.fillText('!', bx, by + 0.5);
          c.font = '700 11.5px Archivo, "Helvetica Neue", Arial, sans-serif';
        }
        if (h.used && h.label != null && k > 2.2) {
          const label = String(h.label);
          const tw = Math.max(20, c.measureText(label).width + 10);
          const tx = x + r * 0.7, ty = y - r * 0.7 - 18;
          c.fillStyle = h.run === 'trip' || h.bad ? COL.hot : h.active ? '#ffd27a' : COL.brass;
          roundRect(c, tx, ty, tw, 18, 4); c.fill();
          c.fillStyle = h.run === 'trip' || h.bad ? '#fff' : COL.brassInk; c.textAlign = 'center'; c.textBaseline = 'middle';
          c.fillText(label, tx + tw / 2, ty + 9.5);
        }
      }
    }

    _drawTip(c) {
      if (!this.tip) return;
      const [tx, ty] = this.tip.pos;
      const X = this.sx(tx), Y = this.sy(ty), k = this.view.k;
      const live = this.tip.kind === 'live' || this.tip.kind === 'live-hot';
      const hot = this.tip.kind === 'press' || this.tip.kind === 'dwell' || this.tip.kind === 'live-hot';
      const body = this.zones[this.zones.length - 1];
      const tipZ = this.zones[0];
      c.save();
      // iron body outline
      c.beginPath(); c.arc(X, Y, Math.max(10, (body.d / 2) * k), 0, Math.PI * 2);
      c.setLineDash([3, 4]); c.lineWidth = 1; c.strokeStyle = 'rgba(230,236,234,0.45)'; c.stroke(); c.setLineDash([]);
      const R = Math.max(6, (tipZ.d / 2) * k);
      if (this.tip.carry) {
        const rc = Math.max(R + 2, (this.tip.carry.od / 2) * k + 1);
        c.beginPath(); c.arc(X, Y, rc, 0, Math.PI * 2); c.fillStyle = 'rgba(192,144,54,0.85)'; c.fill();
        c.lineWidth = 1.5; c.strokeStyle = COL.brassHi; c.stroke();
      }
      c.beginPath(); c.arc(X, Y, R, 0, Math.PI * 2);
      c.fillStyle = hot ? 'rgba(224,96,58,.38)' : live ? 'rgba(240,244,242,.18)' : 'rgba(185,192,195,.25)'; c.fill();
      c.lineWidth = 2; c.strokeStyle = hot ? COL.hot : COL.live; c.stroke();
      c.beginPath(); c.moveTo(X - R - 7, Y); c.lineTo(X + R + 7, Y); c.moveTo(X, Y - R - 7); c.lineTo(X, Y + R + 7);
      c.lineWidth = 1; c.stroke();
      if (live) {
        c.font = '600 10.5px "JetBrains Mono", ui-monospace, monospace';
        c.fillStyle = 'rgba(240,244,242,0.85)'; c.textAlign = 'left'; c.textBaseline = 'top';
        c.fillText(`Z ${(Math.round(this.tip.pos[2] * 100) / 100).toFixed(2)}`, X + R + 9, Y + 4);
      }
      c.restore();
    }

    _drawMeasure(c) {
      const m = this.measure;
      if (!m || !m.a) return;
      const A = { x: this.sx(m.a.x), y: this.sy(m.a.y) };
      c.save();
      const dot = (p, snap) => {
        c.beginPath(); c.arc(p.x, p.y, 4, 0, Math.PI * 2);
        c.fillStyle = '#fff'; c.fill();
        c.lineWidth = 1.5; c.strokeStyle = '#1b2327'; c.stroke();
        if (snap && snap !== 'surface' && snap !== 'bed') {
          c.beginPath(); c.arc(p.x, p.y, 8, 0, Math.PI * 2); c.lineWidth = 1.2; c.strokeStyle = 'rgba(255,255,255,.8)'; c.stroke();
        }
      };
      if (m.b) {
        const B = { x: this.sx(m.b.x), y: this.sy(m.b.y) };
        c.lineWidth = 3; c.strokeStyle = 'rgba(12,16,18,0.55)';
        c.beginPath(); c.moveTo(A.x, A.y); c.lineTo(B.x, B.y); c.stroke();
        c.lineWidth = 1.5; c.strokeStyle = '#fff'; if (m.live) c.setLineDash([6, 4]);
        c.beginPath(); c.moveTo(A.x, A.y); c.lineTo(B.x, B.y); c.stroke(); c.setLineDash([]);
        dot(A, m.a.snap); dot(B, m.b.snap);
        const mm = IP.measure.between(m.a, m.b);
        const text = IP.measure.label(mm);
        c.font = '600 12px "JetBrains Mono", ui-monospace, monospace';
        const tw = c.measureText(text).width + 14;
        const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2 - 16;
        c.fillStyle = 'rgba(246,247,245,0.96)';
        roundRect(c, mx - tw / 2, my - 11, tw, 22, 6); c.fill();
        c.fillStyle = '#1b2327'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(text, mx, my + 0.5);
      } else dot(A, m.a.snap);
      if (m.hover) {
        const H = { x: this.sx(m.hover.x), y: this.sy(m.hover.y) };
        c.beginPath(); c.arc(H.x, H.y, m.hover.snap === 'surface' || m.hover.snap === 'bed' ? 3 : 7, 0, Math.PI * 2);
        c.lineWidth = 1.5; c.strokeStyle = '#fff'; c.stroke();
      }
      c.restore();
    }

    _local(e) {
      const r = this.canvas.getBoundingClientRect();
      return { px: e.clientX - r.left, py: e.clientY - r.top };
    }

    _holeAt(px, py) {
      let best = null, bd = Infinity;
      for (const h of this.markers) {
        const d = Math.hypot(this.sx(h.x) - px, this.sy(h.y) - py);
        const r = Math.max(8, ((h.dia || 4) / 2) * this.view.k + 4);
        if (d < r && d < bd) { bd = d; best = h; }
      }
      return best;
    }

    /** Highest up-facing surface under a screen point: { inst, z, nz, b } or null. */
    _surfaceAt(px, py) {
      if (!this.tris) return null;
      const wx = this.wx(px), wy = this.wy(py), P = this.tris;
      let hit = null;
      this.instances.forEach((inst, i) => {
        const a = (inst.rot * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
        const dx = wx - inst.tx, dy = wy - inst.ty;
        const x = co * dx + si * dy, y = -si * dx + co * dy;
        if (x < -1 || y < -1 || x > this.size.x + 1 || y > this.size.y + 1) return;
        for (let j = this.up.length - 1; j >= 0; j--) {
          const t = this.up[j], b = t.b;
          if (hit && hit.z >= t.z + 1) break;
          const x0 = P[b], y0 = P[b + 1], x1 = P[b + 3], y1 = P[b + 4], x2 = P[b + 6], y2 = P[b + 7];
          const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
          if (!d) continue;
          const l0 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / d;
          const l1 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / d;
          const l2 = 1 - l0 - l1;
          if (l0 < 0 || l1 < 0 || l2 < 0) continue;
          const z = l0 * P[b + 2] + l1 * P[b + 5] + l2 * P[b + 8];
          if (!hit || z > hit.z) hit = { inst: i, z, nz: t.nz, b };
          break;
        }
      });
      return hit;
    }

    _instAt(px, py) { const s = this._surfaceAt(px, py); return s ? s.inst : null; }

    /** Measure point under the cursor, snapped to a hole centre or a corner when close. */
    _measurePoint(px, py) {
      const h = this._holeAt(px, py);
      if (h) return { x: h.x, y: h.y, z: h.H, snap: 'hole', id: h.id };
      const s = this._surfaceAt(px, py);
      const cands = [];
      const P = this.tris;
      const add = (inst, lx, ly, lz) => {
        const a = (inst.rot * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
        const x = co * lx - si * ly + inst.tx, y = si * lx + co * ly + inst.ty;
        cands.push({ sx: this.sx(x), sy: this.sy(y), x, y, z: lz });
      };
      if (s) {
        const inst = this.instances[s.inst];
        for (let k = 0; k < 9; k += 3) add(inst, P[s.b + k], P[s.b + k + 1], P[s.b + k + 2]);
      }
      if (this.hull) for (const inst of this.instances) for (const [x, y] of this.hull) add(inst, x, y, 0);
      const v = IP.measure.nearest(cands, px, py, 10);
      if (v) return { x: v.x, y: v.y, z: v.z, snap: 'corner' };
      return { x: this.wx(px), y: this.wy(py), z: s ? s.z : 0, snap: s ? 'surface' : 'bed' };
    }

    _pick(e) {
      const { px, py } = this._local(e);
      const tool = this._tool();
      if (tool === 'move') return;
      if (tool === 'measure') { if (this.h.onMeasure) this.h.onMeasure('click', this._measurePoint(px, py)); return; }
      const mods = { shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey };
      const h = tool === 'face' ? null : this._holeAt(px, py);
      if (h) return this.h.onPick && this.h.onPick(Object.assign({ type: 'hole', id: h.id }, mods));
      const s = this._surfaceAt(px, py);
      const t = s ? this.up.find((u) => u.b === s.b) : null;
      if (s && this.h.onPick) this.h.onPick(Object.assign({ type: 'surface', inst: s.inst, point: { x: this.wx(px), y: this.wy(py), z: s.z }, normalZ: s.nz,
        normal: t ? { x: t.nx, y: t.ny, z: t.nz } : { x: 0, y: 0, z: 1 } }, mods));
      else if (this.h.onPick) this.h.onPick(Object.assign({ type: 'empty' }, mods));
    }

    _hover(e) {
      const { px, py } = this._local(e);
      const tool = this._tool();
      if (tool === 'move') {
        this.canvas.style.cursor = this._instAt(px, py) != null ? 'move' : 'grab';
        if (this.h.onHover) this.h.onHover(null);
        return;
      }
      if (tool === 'measure') {
        this.canvas.style.cursor = 'crosshair';
        if (this.h.onMeasure) this.h.onMeasure('move', this._measurePoint(px, py));
        return;
      }
      if (tool === 'face') {
        this.canvas.style.cursor = this._instAt(px, py) != null ? 'crosshair' : 'grab';
        if (this.h.onHover) this.h.onHover(null);
        return;
      }
      const h = this._holeAt(px, py);
      const id = h ? h.id : null;
      this.canvas.style.cursor = id != null ? 'pointer' : tool === 'place' ? 'crosshair' : 'grab';
      if (this.h.onHover) this.h.onHover(id, e.clientX, e.clientY);
    }
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }

  IP.Viewer2D = Viewer2D;
})(typeof window !== 'undefined' ? window : globalThis);
