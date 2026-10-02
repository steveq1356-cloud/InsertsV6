// A tiny stand-in for the Three.js r128 API surface viewer.js uses, so the 3D
// code path can run in a headless browser without WebGL. Only real r128 names.
(function () {
  class Vector3 {
    constructor(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    clone() { return new Vector3(this.x, this.y, this.z); }
    project() { this.x = this.x / 200 - 0.5; this.y = this.y / 200 - 0.5; return this; }
  }
  class Vector2 { constructor(x, y) { this.x = x || 0; this.y = y || 0; } set(x, y) { this.x = x; this.y = y; return this; } }
  class Euler { constructor() { this.x = 0; this.y = 0; this.z = 0; } copy(e) { this.x = e.x; this.y = e.y; this.z = e.z; return this; } }
  class Object3D {
    constructor() { this.children = []; this.position = new Vector3(); this.rotation = new Euler(); this.scale = new Vector3(1, 1, 1); this.visible = true; this.userData = {}; this.up = new Vector3(0, 1, 0); }
    add(...o) { this.children.push(...o); return this; }
    remove(o) { this.children = this.children.filter((c) => c !== o); return this; }
    traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn); }
  }
  class Geo { constructor() { this.attributes = {}; } setAttribute(n, a) { this.attributes[n] = a; return this; } computeVertexNormals() {} computeBoundingSphere() {} dispose() {} }
  class Mat { constructor(o) { Object.assign(this, o || {}); this.emissive = { setHex() {} }; } dispose() {} clone() { return new Mat(this); } }
  class Mesh extends Object3D { constructor(g, m) { super(); this.geometry = g; this.material = m; } }
  class Line extends Mesh { computeLineDistances() { return this; } }
  window.THREE = {
    Vector3, Vector2, Object3D, Group: Object3D, Scene: Object3D,
    PerspectiveCamera: class extends Object3D { constructor() { super(); this.aspect = 1; } updateProjectionMatrix() {} setViewOffset() {} clearViewOffset() {} },
    WebGLRenderer: class { constructor() { this.domElement = document.createElement('canvas'); this.shadowMap = { enabled: false, type: 0 }; } setPixelRatio() {} setSize() {} render() {} },
    HemisphereLight: Object3D,
    DirectionalLight: class extends Object3D {
      constructor() { super(); this.target = new Object3D(); this.shadow = { mapSize: new Vector2(), camera: { updateProjectionMatrix() {} }, bias: 0, radius: 1 }; }
    },
    PCFSoftShadowMap: 2,
    Mesh, Line, LineSegments: Line, Sprite: Mesh,
    BufferGeometry: Geo, PlaneGeometry: Geo, BoxGeometry: Geo, CylinderGeometry: Geo, CircleGeometry: Geo, RingGeometry: Geo, SphereGeometry: Geo, EdgesGeometry: Geo,
    BufferAttribute: class { constructor(a, n) { this.array = a; this.itemSize = n; } },
    Float32BufferAttribute: class { constructor(a, n) { this.array = a; this.itemSize = n; } },
    MeshStandardMaterial: Mat, MeshBasicMaterial: Mat, LineBasicMaterial: Mat, LineDashedMaterial: Mat, SpriteMaterial: Mat,
    CanvasTexture: class { dispose() {} },
    Plane: class { constructor(n, c) { this.normal = n; this.constant = c; } },
    Raycaster: class { constructor() { this.ray = { intersectPlane: () => null }; } setFromCamera() {} intersectObjects() { return []; } },
    DoubleSide: 2,
    __Orbit: class { constructor() { this.target = new Vector3(); this.enabled = true; } update() {} },
  };
})();
