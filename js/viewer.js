/* InsertPress Planner — 3D view (Three.js r128, Z up like the machine).
 * Interface shared with Viewer2D:
 *   setBed(x, y, park, fenceH)  setPart(positions, size)  setInstances([{rot, tx, ty}])
 *   setHoles(markers)  setPath(pts)  setPathVisible(v)  setTip(pos, kind, carry)  setIron(zones)
 *   setGhost(g)  setMeasure(m)  setXray(on)  setTray(t)  setGuides(lines)  frame(kind, bounds)
 *   resize()  setInsets(right)  project(x, y, z)  mmPerPx()
 * Handlers: onPick(info) onHover(id, cx, cy) tool() onMoveStart() onMove(dx, dy, mods) onMoveEnd()
 *           onMeasure(kind, point) onBox(ids, additive) onFrame()
 */
(function (root) {
  'use strict';
  const IP = (root.IP = root.IP || {});

  const C = {
    bed: 0x283237, grid: 0x334046, grid10: 0x46555c, limit: 0x6d7c84, steel: 0x8e999d,
    part: 0xd2d6d8, edges: 0x5f696e,
    found: 0xf3f1ea, used: 0xc09036, active: 0xffd27a, path: 0xd9ab4f, hot: 0xe0603a, sel: 0xffffff,
    tip: 0xb9c0c3, nut: 0x8d969a, body: 0x3a4449,
  };

  class Viewer {
    constructor(el, handlers) {
      this.el = el;
      this.h = handlers || {};
      this.bed = { x: 200, y: 200 };
      this.fenceH = 8;
      this.markerMeshes = [];
      this.markers = [];
      this.instMeshes = [];
      this.labelCache = new Map();
      this.instances = [{ rot: 0, tx: 0, ty: 0 }];
      this.zones = [{ d: 5, from: 0, name: 'tip' }, { d: 10, from: 25, name: 'tip nut' }, { d: 18, from: 45, name: 'iron body' }];
      this.insetRight = 0;

      const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }));
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
      el.appendChild(r.domElement);

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(35, 1, 0.5, 6000);
      this.camera.up.set(0, 0, 1);
      this.camera.position.set(-120, -160, 160);

      const c = r.domElement;
      // Registered before OrbitControls (capture) so a part drag or box select can switch orbiting off first.
      c.addEventListener('pointerdown', (e) => this._down(e), { capture: true });
      this.controls = new THREE.OrbitControls(this.camera, c);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.12;
      this.controls.screenSpacePanning = true;

      this.scene.add(new THREE.HemisphereLight(0xf2f4f5, 0x3a4348, 0.8));
      // the key light casts soft shadows of the part, the fence and the iron onto the bed (framed in setBed)
      const sun = (this.sun = new THREE.DirectionalLight(0xffffff, 0.72));
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.bias = -0.0004;
      sun.shadow.radius = 3;
      this.scene.add(sun, sun.target);
      const rim = new THREE.DirectionalLight(0xffe2b0, 0.22);
      rim.position.set(1, 0.8, 0.6);
      this.scene.add(rim);

      this.bedGroup = new THREE.Group();
      this.partGroup = new THREE.Group();
      this.markerGroup = new THREE.Group();
      this.pathGroup = new THREE.Group();
      this.ghostGroup = new THREE.Group();
      this.measureGroup = new THREE.Group();
      this.trayGroup = new THREE.Group();
      this.guideGroup = new THREE.Group();
      this.scene.add(this.bedGroup, this.partGroup, this.markerGroup, this.pathGroup, this.ghostGroup, this.measureGroup, this.trayGroup, this.guideGroup);
      this.tip = new THREE.Group();
      this.tip.visible = false;
      this.scene.add(this.tip);
      this._buildIron();
      this.setBed(200, 200);

      // HTML overlays: measure label and box-select rectangle
      this.mLabel = document.createElement('div');
      this.mLabel.className = 'm-label';
      this.mLabel.hidden = true;
      el.appendChild(this.mLabel);
      this.boxEl = document.createElement('div');
      this.boxEl.className = 'box-select';
      this.boxEl.hidden = true;
      el.appendChild(this.boxEl);

      this.raycaster = new THREE.Raycaster();
      this.mouse = new THREE.Vector2();
      c.addEventListener('pointermove', (e) => this._move(e));
      c.addEventListener('pointerup', (e) => this._up(e));
      c.addEventListener('pointerleave', () => {
        this._hoverId = null;
        if (this.h.onHover) this.h.onHover(null);
        if (this._tool() === 'measure' && this.h.onMeasure) this.h.onMeasure('leave', null);
      });

      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(el);
      this.resize();
      const loop = () => {
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
        this._placeLabel();
        if (this.h.onFrame) this.h.onFrame();
        requestAnimationFrame(loop);
      };
      loop();
    }

    resize() {
      const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
      this.w = w; this.hgt = h;
      this.renderer.setSize(w, h, false);
      this.renderer.domElement.style.width = w + 'px';
      this.renderer.domElement.style.height = h + 'px';
      this.camera.aspect = w / h;
      this._applyInset();
      this.camera.updateProjectionMatrix();
    }

    /** Keep the scene centred in the part of the view not covered by a right-side panel. */
    setInsets(right) { this.insetRight = right || 0; this._applyInset(); this.camera.updateProjectionMatrix(); }
    _applyInset() {
      const w = this.w || 1, h = this.hgt || 1;
      if (this.insetRight > 0) this.camera.setViewOffset(w, h, this.insetRight / 2, 0, w, h);
      else this.camera.clearViewOffset();
    }

    _clear(g, keepShared) {
      while (g.children.length) {
        const o = g.children.pop();
        if (keepShared) continue;
        o.traverse((n) => {
          if (n.geometry && !n.userData.shared) n.geometry.dispose();
          if (n.material && !n.userData.sharedMat) {
            if (n.material.map && !n.userData.sharedMat) n.material.map.dispose();
            n.material.dispose();
          }
        });
      }
    }

    _lines(arr, color, opacity) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: opacity != null, opacity: opacity == null ? 1 : opacity }));
    }

    /** A blurred dark rectangle with transparent edges: the bed's shadow on the stage. */
    _softShadow() {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 256;
      const x = cv.getContext('2d');
      const g = x.createRadialGradient(128, 128, 40, 128, 128, 128);
      g.addColorStop(0, 'rgba(8, 12, 14, .55)'); g.addColorStop(0.6, 'rgba(8, 12, 14, .3)'); g.addColorStop(1, 'rgba(8, 12, 14, 0)');
      x.fillStyle = g; x.fillRect(0, 0, 256, 256);
      return new THREE.CanvasTexture(cv);
    }

    /** Engraved scale for the top of a fence rail. */
    _ruleTexture(L) {
      const pxmm = 12;
      const cv = document.createElement('canvas');
      cv.width = Math.min(4096, Math.ceil(L * pxmm)); cv.height = 64;
      const x = cv.getContext('2d');
      const s = cv.width / L;
      const g = x.createLinearGradient(0, 0, 0, 64);
      g.addColorStop(0, '#c3cbce'); g.addColorStop(1, '#8e999d');
      x.fillStyle = g; x.fillRect(0, 0, cv.width, 64);
      x.strokeStyle = '#2a3236'; x.fillStyle = '#2a3236'; x.lineWidth = 2;
      x.font = '600 20px "JetBrains Mono", monospace';
      for (let i = 1; i < L; i++) {
        const len = i % 10 === 0 ? 34 : i % 5 === 0 ? 24 : 14;
        x.beginPath(); x.moveTo(i * s, 64); x.lineTo(i * s, 64 - len); x.stroke();
        if (i % 10 === 0) x.fillText(String(i), i * s + 3, 22);
      }
      const t = new THREE.CanvasTexture(cv);
      t.anisotropy = 4;
      return t;
    }

    setBed(x, y, park, fenceH) {
      this.bed = { x, y };
      if (fenceH != null) this.fenceH = Math.max(1, fenceH);
      this._clear(this.bedGroup);
      const M = 30, D = 8;
      // the bed is a slab with lit edges, sitting on a soft shadow, so it reads as a machine bed
      const plate = new THREE.Mesh(new THREE.BoxGeometry(x + M * 2, y + M * 2, D),
        new THREE.MeshStandardMaterial({ color: C.bed, roughness: 0.92, metalness: 0.08 }));
      plate.position.set(x / 2, y / 2, -D / 2 - 0.06);
      plate.receiveShadow = true;
      const floor = new THREE.Mesh(new THREE.PlaneGeometry((x + M * 2) * 1.5, (y + M * 2) * 1.5),
        new THREE.MeshBasicMaterial({ map: this._softShadow(), transparent: true, depthWrite: false }));
      floor.position.set(x / 2 + 8, y / 2 + 12, -D - 0.1);
      this.bedGroup.add(floor, plate);
      this.bedGroup.add(this._lines([-M, -M, 0.01, x + M, -M, 0.01, x + M, -M, 0.01, x + M, y + M, 0.01], 0x3d4a50));
      const sz = Math.max(x, y) * 0.75 + M;
      Object.assign(this.sun.shadow.camera, { left: -sz, right: sz, top: sz, bottom: -sz, near: 1, far: sz * 6 });
      this.sun.shadow.camera.updateProjectionMatrix();
      this.sun.target.position.set(x / 2, y / 2, 0);
      // from the left and a little in front, so shadows fall to the right where the camera sees them
      this.sun.position.set(x / 2 - sz * 1.1, y / 2 - sz * 0.45, sz * 1.5);
      const minor = [], major = [];
      for (let i = 10; i <= x; i += 10) (i % 50 ? minor : major).push(i, 0, 0, i, y, 0);
      for (let j = 10; j <= y; j += 10) (j % 50 ? minor : major).push(0, j, 0, x, j, 0);
      this.bedGroup.add(this._lines(minor, C.grid), this._lines(major, C.grid10));
      this.bedGroup.add(this._lines([0, 0, 0.02, x, 0, 0.02, x, 0, 0.02, x, y, 0.02, x, y, 0.02, 0, y, 0.02, 0, y, 0.02, 0, 0, 0.02], C.limit));
      // fence rails, steel rules on top
      const H = this.fenceH, T = 6;
      const L = Math.min(Math.max(x, y), 160);
      const mat = new THREE.MeshStandardMaterial({ color: C.steel, roughness: 0.4, metalness: 0.65 });
      const fx = new THREE.Mesh(new THREE.BoxGeometry(L + T, T, H), mat);
      fx.position.set(L / 2 - T / 2, -T / 2, H / 2);
      const fy = new THREE.Mesh(new THREE.BoxGeometry(T, L, H), mat.clone());
      fy.position.set(-T / 2, L / 2, H / 2);
      fx.castShadow = fy.castShadow = fx.receiveShadow = fy.receiveShadow = true;
      this.bedGroup.add(fx, fy);
      const tex = this._ruleTexture(L);
      const rx = new THREE.Mesh(new THREE.PlaneGeometry(L, T), new THREE.MeshBasicMaterial({ map: tex }));
      rx.position.set(L / 2, -T / 2, H + 0.02);
      const ry = new THREE.Mesh(new THREE.PlaneGeometry(L, T), new THREE.MeshBasicMaterial({ map: tex }));
      ry.rotation.z = Math.PI / 2;
      ry.scale.y = -1;
      ry.position.set(-T / 2, L / 2, H + 0.02);
      ry.userData.sharedMat = false;
      this.bedGroup.add(rx, ry);
      if (park) {
        const p = park, s = 4;
        this.bedGroup.add(this._lines([p.x - s, p.y, 0.05, p.x + s, p.y, 0.05, p.x, p.y - s, 0.05, p.x, p.y + s, 0.05], 0xb9c3c2));
      }
    }

    setPart(positions, size) {
      this._clear(this.partGroup, true);
      if (this.geom) { this.geom.dispose(); this.geom = null; }
      if (this.edgeGeom) { this.edgeGeom.dispose(); this.edgeGeom = null; }
      if (this.partMat) { this.partMat.dispose(); this.partMat = null; }
      if (this.edgeMat) { this.edgeMat.dispose(); this.edgeMat = null; }
      this.size = size;
      this.positions = positions;
      this.instMeshes = [];
      if (!positions) return;
      const g = (this.geom = new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      if (positions.length / 9 < 400000) this.edgeGeom = new THREE.EdgesGeometry(g, 35);
      this.partMat = new THREE.MeshStandardMaterial({
        color: C.part, roughness: 0.7, metalness: 0.05,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      });
      this.edgeMat = new THREE.LineBasicMaterial({ color: C.edges, transparent: true, opacity: 0.55 });
      this.setXray(this.xray);
      this.setInstances(this.instances);
    }

    setInstances(list) {
      this.instances = list && list.length ? list : [{ rot: 0, tx: 0, ty: 0 }];
      this._clear(this.partGroup, true);
      this.instMeshes = [];
      if (!this.geom) return;
      this.instances.forEach((inst, i) => {
        const m = new THREE.Mesh(this.geom, this.partMat);
        m.castShadow = m.receiveShadow = true;
        m.userData.inst = i;
        m.rotation.z = (inst.rot * Math.PI) / 180;
        m.position.set(inst.tx, inst.ty, 0);
        this.partGroup.add(m);
        this.instMeshes.push(m);
        if (this.edgeGeom) {
          const e = new THREE.LineSegments(this.edgeGeom, this.edgeMat);
          e.rotation.copy(m.rotation);
          e.position.copy(m.position);
          this.partGroup.add(e);
        }
      });
    }

    setXray(on) {
      this.xray = !!on;
      if (!this.partMat) return;
      this.partMat.transparent = this.xray;
      this.partMat.opacity = this.xray ? 0.32 : 1;
      this.partMat.depthWrite = !this.xray;
      this.partMat.needsUpdate = true;
      this.edgeMat.opacity = this.xray ? 0.9 : 0.55;
    }

    _ring(x, y, z, r0, r1, color, opacity) {
      const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 40),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthTest: false }));
      m.position.set(x, y, z);
      m.renderOrder = 2;
      this.markerGroup.add(m);
      return m;
    }

    /** markers: [{key, id, x, y, H, dia, depth, label, used, active, sel, bad, run}] in machine coordinates */
    setHoles(markers) {
      this._clear(this.markerGroup);
      this.markerMeshes = [];
      this.markers = markers;
      const s = this.size || { x: 60, y: 60 };
      const tag = Math.max(3.2, Math.min(8, Math.hypot(s.x, s.y) * 0.045));
      for (const h of markers) {
        const r = (h.dia || 4) / 2;
        const z = h.H + 0.03;
        let color = h.active ? C.active : h.used ? C.used : C.found;
        if (h.bad || h.run === 'trip') color = C.hot;
        if (h.run === 'done') {
          const disc = new THREE.Mesh(new THREE.CircleGeometry(r + 0.4, 32),
            new THREE.MeshStandardMaterial({ color: C.used, metalness: 0.75, roughness: 0.35 }));
          disc.position.set(h.x, h.y, h.H + 0.04);
          this.markerGroup.add(disc);
          this._ring(h.x, h.y, h.H + 0.06, r * 0.45, r * 0.6, 0x4a3a17, 1);
        } else {
          this._ring(h.x, h.y, z, r + 0.25, r + (h.used ? 1.3 : 0.8), color, h.used ? 1 : 0.8);
        }
        if (h.sel) this._ring(h.x, h.y, z + 0.01, r + 1.8, r + 2.3, C.sel, 0.95);
        if (h.depth) this.markerGroup.add(this._lines([h.x, h.y, h.H, h.x, h.y, h.H - h.depth], color, 0.7));
        const hit = new THREE.Mesh(new THREE.CircleGeometry(r + 1.6, 20),
          new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
        hit.position.set(h.x, h.y, z);
        hit.userData.id = h.id;
        hit.userData.marker = h;
        this.markerGroup.add(hit);
        this.markerMeshes.push(hit);
        if (h.used && h.label != null) {
          const sp = new THREE.Sprite(this._labelMat(String(h.label), h.active ? 'active' : (h.bad || h.run === 'trip') ? 'bad' : 'used'));
          sp.userData.sharedMat = true;
          sp.userData.shared = true;
          sp.position.set(h.x, h.y, h.H + tag * 0.95);
          const wide = String(h.label).length;
          sp.scale.set(tag * (wide > 2 ? 1.7 : wide > 1 ? 1.35 : 1), tag, 1);
          sp.renderOrder = 3;
          this.markerGroup.add(sp);
        }
      }
    }

    _labelMat(text, kind) {
      const key = text + ':' + kind;
      if (this.labelCache.has(key)) return this.labelCache.get(key);
      const c = document.createElement('canvas');
      const w = text.length > 2 ? 210 : text.length > 1 ? 172 : 128;
      c.width = w; c.height = 128;
      const x = c.getContext('2d');
      x.fillStyle = kind === 'active' ? '#ffd27a' : kind === 'bad' ? '#e0603a' : '#c09036';
      const rr = 22;
      x.beginPath();
      x.moveTo(rr, 6); x.lineTo(w - rr, 6); x.quadraticCurveTo(w - 6, 6, w - 6, rr);
      x.lineTo(w - 6, 122 - rr); x.quadraticCurveTo(w - 6, 122, w - rr, 122);
      x.lineTo(rr, 122); x.quadraticCurveTo(6, 122, 6, 122 - rr);
      x.lineTo(6, rr); x.quadraticCurveTo(6, 6, rr, 6);
      x.fill();
      x.fillStyle = kind === 'bad' ? '#ffffff' : '#2e220c';
      x.font = '700 74px Archivo, "Helvetica Neue", Arial, sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(text, w / 2, 68);
      const tex = new THREE.CanvasTexture(c);
      tex.anisotropy = 4;
      const m = new THREE.SpriteMaterial({ map: tex, depthTest: false });
      this.labelCache.set(key, m);
      return m;
    }

    setPath(pts) {
      this._clear(this.pathGroup);
      if (!pts || pts.length < 2) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
      const line = new THREE.Line(g, new THREE.LineDashedMaterial({ color: C.path, dashSize: 2.2, gapSize: 1.4 }));
      line.computeLineDistances();
      this.pathGroup.add(line);
    }

    setPathVisible(v) { this.pathGroup.visible = v; }

    /** Iron model built from the collision zones, tip end at the group origin. */
    setIron(zones) { if (zones && zones.length) { this.zones = zones; this._buildIron(); } }
    _buildIron() {
      this._clear(this.tip);
      // the carried insert went with the old iron; setTip builds it again
      this.carryMesh = null; this._carryKey = undefined;
      const z = this.zones;
      this.tipMat = new THREE.MeshStandardMaterial({ color: C.tip, roughness: 0.35, metalness: 0.8, emissive: 0x000000 });
      z.forEach((zone, i) => {
        const next = z[i + 1];
        const len = next ? Math.max(0.5, next.from - zone.from) : 70;
        const mat = i === 0 ? this.tipMat : new THREE.MeshStandardMaterial({ color: i === z.length - 1 ? C.body : C.nut, roughness: 0.55, metalness: 0.35 });
        const r = zone.d / 2;
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, i === 0 ? r * 0.82 : r, len, 32), mat);
        cyl.rotation.x = Math.PI / 2;
        cyl.position.z = zone.from + len / 2;
        cyl.castShadow = true;
        this.tip.add(cyl);
      });
      this.tipGlow = new THREE.Mesh(new THREE.RingGeometry(z[0].d / 2 + 0.4, z[0].d / 2 + 1.8, 32),
        new THREE.MeshBasicMaterial({ color: C.hot, transparent: true, opacity: 0, side: THREE.DoubleSide, depthTest: false }));
      this.tipGlow.renderOrder = 4;
      this.tip.add(this.tipGlow);
    }

    setTip(pos, kind, carry) {
      if (!pos) { this.tip.visible = false; return; }
      this.tip.visible = true;
      this.tip.position.set(pos[0], pos[1], pos[2]);
      const ck = carry ? carry.od + ':' + carry.L + ':' + carry.hang : '';
      if (ck !== this._carryKey) {
        this._carryKey = ck;
        if (this.carryMesh) { this.tip.remove(this.carryMesh); this.carryMesh.geometry.dispose(); this.carryMesh.material.dispose(); this.carryMesh = null; }
        if (carry) {
          this.carryMesh = new THREE.Mesh(new THREE.CylinderGeometry(carry.od / 2, carry.od / 2 * 0.92, carry.L, 24),
            new THREE.MeshStandardMaterial({ color: C.used, metalness: 0.75, roughness: 0.35 }));
          this.carryMesh.rotation.x = Math.PI / 2;
          this.carryMesh.position.z = -carry.hang + carry.L / 2;
          this.tip.add(this.carryMesh);
        }
      }
      const hot = kind === 'press' || kind === 'dwell' || kind === 'live-hot';
      this.tipMat.emissive.setHex(hot ? 0x8a2a08 : 0x000000);
      this.tipGlow.material.opacity = hot ? 0.85 : 0;
    }

    /** t = { box: { x0, y0, x1, y1, top }, pockets: [{ x, y, d, state, stick }] } */
    setTray(t) {
      this._clear(this.trayGroup);
      if (!t) return;
      const b = t.box, top = Math.max(0.5, b.top);
      const block = new THREE.Mesh(new THREE.BoxGeometry(b.x1 - b.x0, b.y1 - b.y0, top),
        new THREE.MeshStandardMaterial({ color: 0x77838a, metalness: 0.6, roughness: 0.45 }));
      block.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, top / 2);
      block.castShadow = block.receiveShadow = true;
      this.trayGroup.add(block);
      const brass = new THREE.MeshStandardMaterial({ color: C.used, metalness: 0.75, roughness: 0.35 });
      const dark = new THREE.MeshBasicMaterial({ color: 0x1b2327 });
      for (const p of t.pockets) {
        const r = p.d / 2;
        if (p.state === 'full' || p.state === 'job') {
          const h = Math.max(0.4, p.stick || 1);
          const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 0.9, h, 18), brass);
          m.rotation.x = Math.PI / 2;
          m.position.set(p.x, p.y, top + h / 2 - Math.max(0, -(p.stick || 0)));
          this.trayGroup.add(m);
        } else {
          const d = new THREE.Mesh(new THREE.CircleGeometry(r, 18), dark);
          d.position.set(p.x, p.y, top + 0.03);
          this.trayGroup.add(d);
        }
        if (p.state === 'job' || p.state === 'next') this.trayGroup.add(this._lines(circle(p.x, p.y, top + (p.stick > 0 ? p.stick : 0) + 0.1, r + 0.9), p.state === 'next' ? 0xffffff : 0xdfe6e4, 0.9));
      }
    }

    setGuides(lines) {
      this._clear(this.guideGroup);
      if (!lines || !lines.length) return;
      const arr = [];
      for (const g of lines) arr.push(g.x1, g.y1, 0.15, g.x2, g.y2, 0.15);
      const seg = this._lines(arr, C.path, 0.95);
      seg.material.depthTest = false;
      seg.renderOrder = 6;
      this.guideGroup.add(seg);
    }

    /** About how many mm one screen pixel covers near the middle of the view. */
    mmPerPx() {
      const c = this.controls.target;
      const a = this.project(c.x, c.y, 0), b = this.project(c.x + 10, c.y, 0);
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      return d > 0 ? 10 / d : 1;
    }

    /** g = { x, y, z (tip end at full depth), margin, hit: [zone index] } */
    setGhost(g) {
      this._clear(this.ghostGroup);
      if (!g) return;
      const z = this.zones;
      z.forEach((zone, i) => {
        const next = z[i + 1];
        const len = next ? Math.max(0.5, next.from - zone.from) : 50;
        const bad = g.hit && g.hit.includes(i);
        const r = zone.d / 2 + (g.margin || 0);
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 40, 1, true),
          new THREE.MeshBasicMaterial({ color: bad ? C.hot : 0xeef2f0, transparent: true, opacity: bad ? 0.32 : 0.1, side: THREE.DoubleSide, depthWrite: false }));
        mesh.rotation.x = Math.PI / 2;
        mesh.position.set(g.x, g.y, g.z + zone.from + len / 2);
        this.ghostGroup.add(mesh);
        const rim = this._lines(circle(g.x, g.y, g.z + zone.from, r), bad ? C.hot : 0xeef2f0, bad ? 0.9 : 0.45);
        this.ghostGroup.add(rim);
      });
    }

    /** m = { a, b, hover, live } with points { x, y, z, snap } */
    setMeasure(m) {
      this._clear(this.measureGroup);
      this.measure = m && m.a ? m : null;
      if (!this.measure) { this.mLabel.hidden = true; return; }
      const dot = (p) => {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
        s.position.set(p.x, p.y, p.z);
        s.renderOrder = 5;
        this.measureGroup.add(s);
      };
      dot(m.a);
      if (m.b) {
        dot(m.b);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute([m.a.x, m.a.y, m.a.z, m.b.x, m.b.y, m.b.z], 3));
        const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.95 }));
        line.renderOrder = 5;
        this.measureGroup.add(line);
        this.mLabel.textContent = IP.measure.label(IP.measure.between(m.a, m.b));
        this.mLabel.hidden = false;
      } else this.mLabel.hidden = true;
      if (m.hover && m.hover.snap !== 'surface' && m.hover.snap !== 'bed') {
        const ring = this._lines(circle(m.hover.x, m.hover.y, m.hover.z + 0.05, 1.6), 0xffffff, 0.9);
        ring.renderOrder = 5;
        ring.material.depthTest = false;
        this.measureGroup.add(ring);
      }
      this._placeLabel();
    }

    _placeLabel() {
      const m = this.measure;
      if (!m || !m.b || this.mLabel.hidden) return;
      const p = this.project((m.a.x + m.b.x) / 2, (m.a.y + m.b.y) / 2, (m.a.z + m.b.z) / 2);
      this.mLabel.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y - 22)}px) translate(-50%, -50%)`;
    }

    /** Screen position (px, relative to the view) of a world point. */
    project(x, y, z) {
      const v = new THREE.Vector3(x, y, z || 0).project(this.camera);
      return { x: ((v.x + 1) / 2) * (this.w || 1), y: ((1 - v.y) / 2) * (this.hgt || 1) };
    }

    frame(kind, b) {
      const s = b || (this.size ? { x: 0, y: 0, w: this.size.x, h: this.size.y, z: this.size.z } : { x: 0, y: 0, w: this.bed.x, h: this.bed.y, z: 10 });
      const c = new THREE.Vector3(s.x + s.w / 2, s.y + s.h / 2, (s.z || 10) / 2);
      const d = Math.max(s.w, s.h, s.z || 10, 30) * 2.3;
      if (kind === 'top') this.camera.position.set(c.x, c.y - d * 0.001, c.z + d * 1.15);
      else if (kind === 'front') this.camera.position.set(c.x, c.y - d * 1.2, c.z + d * 0.22);
      else this.camera.position.set(c.x - d * 0.68, c.y - d * 0.95, c.z + d * 0.85);
      this.controls.target.copy(c);
      this.controls.update();
    }

    _ray(e) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouse.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(this.mouse, this.camera);
    }

    _tool() { return this.h.tool ? this.h.tool() : 'select'; }

    _local(e) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      return { px: e.clientX - rect.left, py: e.clientY - rect.top };
    }

    _down(e) {
      this._press = { x: e.clientX, y: e.clientY, button: e.button };
      if (e.button !== 0) return;
      const tool = this._tool();
      if (tool === 'select' && e.shiftKey) {
        // box select: stop OrbitControls from seeing this drag
        e.stopImmediatePropagation();
        this.controls.enabled = false;
        const { px, py } = this._local(e);
        this._box = { x0: px, y0: py, x1: px, y1: py };
        this.renderer.domElement.setPointerCapture(e.pointerId);
        this._drawBox();
        return;
      }
      if (tool !== 'move' || !this.instMeshes.length) return;
      this._ray(e);
      const hit = this.raycaster.intersectObjects(this.instMeshes, false)[0];
      if (!hit) return;
      this.controls.enabled = false;
      this._drag = { plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), -hit.point.z), start: hit.point.clone() };
      this.renderer.domElement.setPointerCapture(e.pointerId);
      if (this.h.onMoveStart) this.h.onMoveStart();
    }

    _drawBox() {
      const b = this._box;
      if (!b) { this.boxEl.hidden = true; return; }
      this.boxEl.hidden = false;
      Object.assign(this.boxEl.style, {
        left: Math.min(b.x0, b.x1) + 'px', top: Math.min(b.y0, b.y1) + 'px',
        width: Math.abs(b.x1 - b.x0) + 'px', height: Math.abs(b.y1 - b.y0) + 'px',
      });
    }

    _move(e) {
      if (this._box) {
        const { px, py } = this._local(e);
        this._box.x1 = px; this._box.y1 = py;
        this._drawBox();
        return;
      }
      if (this._drag) {
        this._ray(e);
        const p = new THREE.Vector3();
        if (this.raycaster.ray.intersectPlane(this._drag.plane, p) && this.h.onMove) {
          this.h.onMove(p.x - this._drag.start.x, p.y - this._drag.start.y, { alt: e.altKey, shift: e.shiftKey });
        }
        return;
      }
      if (e.buttons) return;
      const tool = this._tool();
      if (tool === 'measure') {
        this.renderer.domElement.style.cursor = 'crosshair';
        if (this.h.onMeasure) this.h.onMeasure('move', this._measurePoint(e));
        return;
      }
      this._ray(e);
      if (tool === 'face') {
        this.renderer.domElement.style.cursor = this.raycaster.intersectObjects(this.instMeshes, false).length ? 'crosshair' : '';
        if (this.h.onHover) this.h.onHover(null);
        return;
      }
      const m = this.raycaster.intersectObjects(this.markerMeshes, false)[0];
      const id = m ? m.object.userData.id : null;
      let cursor = '';
      if (tool === 'move') cursor = this.raycaster.intersectObjects(this.instMeshes, false).length ? 'move' : '';
      else if (id != null) cursor = 'pointer';
      else if (tool === 'place') cursor = 'crosshair';
      this.renderer.domElement.style.cursor = cursor;
      this._hoverId = id;
      if (this.h.onHover) this.h.onHover(tool === 'move' ? null : id, e.clientX, e.clientY);
    }

    /** Point under the cursor for measuring, snapped to hole centres and mesh corners. */
    _measurePoint(e) {
      this._ray(e);
      const { px, py } = this._local(e);
      const mk = this.raycaster.intersectObjects(this.markerMeshes, false)[0];
      if (mk) { const h = mk.object.userData.marker; return { x: h.x, y: h.y, z: h.H, snap: 'hole', id: h.id }; }
      const hit = this.raycaster.intersectObjects(this.instMeshes, false)[0];
      if (hit) {
        if (hit.face && this.positions) {
          const P = this.positions, inst = this.instances[hit.object.userData.inst] || { rot: 0, tx: 0, ty: 0 };
          const a = (inst.rot * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
          const cands = [hit.face.a, hit.face.b, hit.face.c].map((vi) => {
            const lx = P[vi * 3], ly = P[vi * 3 + 1], lz = P[vi * 3 + 2];
            const x = co * lx - si * ly + inst.tx, y = si * lx + co * ly + inst.ty;
            const s = this.project(x, y, lz);
            return { sx: s.x, sy: s.y, x, y, z: lz };
          });
          const v = IP.measure.nearest(cands, px, py, 10);
          if (v) return { x: v.x, y: v.y, z: v.z, snap: 'corner' };
        }
        return { x: hit.point.x, y: hit.point.y, z: hit.point.z, snap: 'surface' };
      }
      const p = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), p)) return { x: p.x, y: p.y, z: 0, snap: 'bed' };
      return null;
    }

    _up(e) {
      if (this._box) {
        const b = this._box;
        this._box = null;
        this._drawBox();
        this.controls.enabled = true;
        this._press = null;
        if (Math.hypot(b.x1 - b.x0, b.y1 - b.y0) < 5) { this._click(e); return; }
        const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
        const ids = [...new Set(this.markers.filter((m) => {
          const p = this.project(m.x, m.y, m.H);
          return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
        }).map((m) => m.id))];
        if (this.h.onBox) this.h.onBox(ids, true);
        return;
      }
      if (this._drag) {
        this._drag = null;
        this.controls.enabled = true;
        if (this.h.onMoveEnd) this.h.onMoveEnd();
        this._press = null;
        return;
      }
      const p = this._press;
      this._press = null;
      if (!p || p.button !== 0) return;
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 5) return;
      this._click(e);
    }

    _click(e) {
      const tool = this._tool();
      if (tool === 'move') return;
      if (tool === 'measure') { const pt = this._measurePoint(e); if (pt && this.h.onMeasure) this.h.onMeasure('click', pt); return; }
      const mods = { shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey };
      this._ray(e);
      const m = tool === 'face' ? null : this.raycaster.intersectObjects(this.markerMeshes, false)[0];
      if (m) return this.h.onPick && this.h.onPick(Object.assign({ type: 'hole', id: m.object.userData.id }, mods));
      const hit = this.raycaster.intersectObjects(this.instMeshes, false)[0];
      if (hit && this.h.onPick) {
        // face normals are in the mesh's own frame, which is the part's oriented frame (copies only turn about Z)
        const n = hit.face ? hit.face.normal : { x: 0, y: 0, z: 1 };
        this.h.onPick(Object.assign({ type: 'surface', inst: hit.object.userData.inst, point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
          normalZ: hit.face ? hit.face.normal.z : 0, normal: { x: n.x, y: n.y, z: n.z } }, mods));
      } else if (this.h.onPick) this.h.onPick(Object.assign({ type: 'empty' }, mods));
    }
  }

  function circle(x, y, z, r) {
    const out = [];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      out.push(x + Math.cos(a0) * r, y + Math.sin(a0) * r, z, x + Math.cos(a1) * r, y + Math.sin(a1) * r, z);
    }
    return out;
  }

  IP.Viewer = Viewer;
})(typeof window !== 'undefined' ? window : globalThis);
