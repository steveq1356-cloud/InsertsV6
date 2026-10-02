/* InsertPress Planner — STL loading and part placement.
 * Produces a flat Float32Array of triangle vertices [x,y,z, x,y,z, x,y,z, ...]
 * in millimetres, oriented and shifted so the part sits in the fence corner:
 * min X = 0, min Y = 0, min Z = 0 (bed surface).
 */
(function (root) {
  'use strict';
  const IP = (root.IP = root.IP || {});

  function parseSTL(buffer) {
    const dv = new DataView(buffer);
    // Binary STL: 80-byte header, uint32 count, 50 bytes per triangle.
    // Check the size first, because many binary files start with "solid" too.
    // A file with no triangles is refused below, like an empty ASCII one.
    if (buffer.byteLength >= 84) {
      const n = dv.getUint32(80, true);
      if (n > 0 && 84 + n * 50 === buffer.byteLength) return parseBinary(dv, n);
    }
    const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 1024)));
    if (/^\s*solid/i.test(head)) {
      const out = parseAscii(new TextDecoder().decode(new Uint8Array(buffer)));
      if (out.length) return out;
    }
    if (buffer.byteLength >= 84) {
      const n = dv.getUint32(80, true);
      if (n > 0 && 84 + n * 50 <= buffer.byteLength) return parseBinary(dv, n);
    }
    throw new Error('This file is not a readable STL. Export it from your CAD program as STL (binary or ASCII).');
  }

  function parseBinary(dv, n) {
    const pos = new Float32Array(n * 9);
    let o = 84;
    for (let i = 0; i < n; i++) {
      o += 12; // skip stored normal; we recompute from winding
      for (let j = 0; j < 9; j++) {
        pos[i * 9 + j] = dv.getFloat32(o, true);
        o += 4;
      }
      o += 2;
    }
    return pos;
  }

  function parseAscii(text) {
    const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
    const out = [];
    let m;
    while ((m = re.exec(text))) out.push(+m[1], +m[2], +m[3]);
    out.length -= out.length % 9;
    return new Float32Array(out);
  }

  /* ---------- 3 × 3 rotations, row-major [a b c; d e f; g h i] ---------- */
  const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  function mul(A, B) {
    const o = new Array(9);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
    return o.map(clean);
  }
  const clean = (v) => { const r = Math.round(v); return Math.abs(v - r) < 1e-9 ? r || 0 : v; };
  const apply = (M, x, y, z) => [M[0] * x + M[1] * y + M[2] * z, M[3] * x + M[4] * y + M[5] * z, M[6] * x + M[7] * y + M[8] * z];
  /** The quarter turns as one matrix (X first, then Y, then Z). */
  function quarterMatrix(rot) {
    const RX = [1, 0, 0, 0, 0, -1, 0, 1, 0], RY = [0, 0, 1, 0, 1, 0, -1, 0, 0], RZ = [0, -1, 0, 1, 0, 0, 0, 0, 1];
    let M = I3.slice();
    const n = (v) => (((v || 0) % 4) + 4) % 4;
    for (let k = 0; k < n(rot.x); k++) M = mul(RX, M);
    for (let k = 0; k < n(rot.y); k++) M = mul(RY, M);
    for (let k = 0; k < n(rot.z); k++) M = mul(RZ, M);
    return M;
  }
  /** Smallest rotation that turns face normal n to point straight down (−Z). */
  function faceDownMatrix(nx, ny, nz) {
    let l = Math.hypot(nx, ny, nz) || 1;
    let a = [nx / l, ny / l, nz / l];
    const big = a.map(Math.abs).indexOf(Math.max(...a.map(Math.abs)));
    if (Math.abs(a[big]) > 0.9995) { a = [0, 0, 0]; a[big] = Math.sign([nx, ny, nz][big]); }
    const c = -a[2]; // a · (0,0,−1)
    if (c > 1 - 1e-12) return I3.slice();
    if (c < -1 + 1e-12) return [1, 0, 0, 0, -1, 0, 0, 0, -1]; // face up: half turn about X
    const v = [-a[1], a[0], 0]; // a × (0,0,−1)
    const k = 1 / (1 + c);
    const V = [0, -v[2], v[1], v[2], 0, -v[0], -v[1], v[0], 0];
    const V2 = mul(V, V);
    return I3.map((x, i) => clean(x + V[i] + V2[i] * k));
  }

  /**
   * Orient (an optional general rotation `matrix`, then quarter turns about X,
   * then Y, then Z), scale, then drop into the fence corner.
   */
  function preparePart(raw, opts) {
    const rot = (opts && opts.rot) || { x: 0, y: 0, z: 0 };
    const scale = (opts && opts.scale) || 1;
    const M = opts && Array.isArray(opts.matrix) && opts.matrix.length === 9 ? opts.matrix : null;
    const pos = new Float32Array(raw.length);
    const turns = [((rot.x % 4) + 4) % 4, ((rot.y % 4) + 4) % 4, ((rot.z % 4) + 4) % 4];
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < raw.length; i += 3) {
      let x = raw[i] * scale, y = raw[i + 1] * scale, z = raw[i + 2] * scale, t;
      if (M) [x, y, z] = apply(M, x, y, z);
      for (let k = 0; k < turns[0]; k++) { t = y; y = -z; z = t; }   // +90° about X
      for (let k = 0; k < turns[1]; k++) { t = x; x = z; z = -t; }   // +90° about Y
      for (let k = 0; k < turns[2]; k++) { t = x; x = -y; y = t; }   // +90° about Z
      pos[i] = x; pos[i + 1] = y; pos[i + 2] = z;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    for (let i = 0; i < pos.length; i += 3) {
      pos[i] -= minX; pos[i + 1] -= minY; pos[i + 2] -= minZ;
    }
    return {
      positions: pos,
      triCount: pos.length / 9,
      size: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
    };
  }

  /** Write a binary STL (used by the example generator script). */
  function toBinarySTL(pos) {
    const n = pos.length / 9;
    const buf = new ArrayBuffer(84 + n * 50);
    const dv = new DataView(buf);
    const label = 'InsertPress Planner example part';
    for (let i = 0; i < label.length; i++) dv.setUint8(i, label.charCodeAt(i));
    dv.setUint32(80, n, true);
    let o = 84;
    for (let t = 0; t < n; t++) {
      const b = t * 9;
      const ux = pos[b + 3] - pos[b], uy = pos[b + 4] - pos[b + 1], uz = pos[b + 5] - pos[b + 2];
      const vx = pos[b + 6] - pos[b], vy = pos[b + 7] - pos[b + 1], vz = pos[b + 8] - pos[b + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
      o += 12;
      for (let j = 0; j < 9; j++) { dv.setFloat32(o, pos[b + j], true); o += 4; }
      o += 2;
    }
    return buf;
  }

  IP.stl = { parseSTL, preparePart, toBinarySTL, quarterMatrix, faceDownMatrix, mulMatrix: mul, applyMatrix: apply, I3 };
})(typeof window !== 'undefined' ? window : globalThis);
