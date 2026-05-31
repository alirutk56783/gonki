import * as THREE from "three";
import * as CANNON from "cannon-es";

// Centerline control points of the circuit (in XZ plane, world units = meters).
const CONTROL_POINTS = [
  [0, -150],
  [90, -135],
  [150, -80],
  [140, -5],
  [180, 70],
  [120, 140],
  [30, 155],
  [-55, 140],
  [-130, 95],
  [-160, 10],
  [-140, -75],
  [-60, -140],
];

export const ROAD_WIDTH = 20;
export const TOTAL_LAPS = 3;

export class Track {
  constructor(scene, world, materials) {
    this.scene = scene;
    this.world = world;
    this.materials = materials;

    this.curve = new THREE.CatmullRomCurve3(
      CONTROL_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      true,
      "catmullrom",
      0.5
    );

    this.samples = 800;
    this.points = this.curve.getSpacedPoints(this.samples);
    this.points.pop(); // drop duplicated closing point

    this._buildGround();
    this._buildRoad();
    this._buildCurbs();
    this._buildBarriers();
    this._buildStartLine();
    this._buildDecor();
  }

  _buildGround() {
    const geo = new THREE.PlaneGeometry(2400, 2400, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x35663a, roughness: 1, metalness: 0 });
    const ground = new THREE.Mesh(geo, mat);
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const body = new CANNON.Body({ mass: 0, material: this.materials.ground });
    body.addShape(new CANNON.Plane());
    body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(body);
  }

  _normalAt(i) {
    const t = this.curve.getTangentAt((i % this.points.length) / this.points.length);
    return new THREE.Vector3(-t.z, 0, t.x).normalize();
  }

  _buildRoad() {
    const half = ROAD_WIDTH / 2;
    const n = this.points.length;
    const positions = [];
    const indices = [];

    for (let i = 0; i <= n; i++) {
      const idx = i % n;
      const p = this.points[idx];
      const normal = this._normalAt(i);
      const left = p.clone().addScaledVector(normal, half);
      const right = p.clone().addScaledVector(normal, -half);
      positions.push(left.x, 0.01, left.z, right.x, 0.01, right.z);
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      indices.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a2d34, roughness: 0.9, metalness: 0.0 });
    const road = new THREE.Mesh(geo, mat);
    road.receiveShadow = true;
    this.scene.add(road);

    this._buildCenterLine();
  }

  _buildCenterLine() {
    const n = this.points.length;
    const dashMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.6 });
    const geo = new THREE.PlaneGeometry(0.5, 3);
    geo.rotateX(-Math.PI / 2);
    const count = Math.floor(n / 10);
    const inst = new THREE.InstancedMesh(geo, dashMat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    let k = 0;
    for (let i = 0; i < n && k < count; i += 10) {
      const p = this.points[i];
      const t = this.curve.getTangentAt(i / n);
      q.setFromAxisAngle(up, Math.atan2(t.x, t.z));
      m.compose(new THREE.Vector3(p.x, 0.03, p.z), q, new THREE.Vector3(1, 1, 1));
      inst.setMatrixAt(k++, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    this.scene.add(inst);
  }

  // Red/white kerbs flush with the road edge.
  _buildCurbs() {
    const n = this.points.length;
    const offset = ROAD_WIDTH / 2 - 0.6;
    const step = 4;
    const geo = new THREE.BoxGeometry(1.2, 0.12, 1, 1, 1, 1);

    const segments = [];
    for (const side of [1, -1]) {
      for (let i = 0; i < n; i += step) {
        const p = this.points[i];
        const t = this.curve.getTangentAt(i / n);
        const normal = new THREE.Vector3(-t.z, 0, t.x).normalize();
        const c = p.clone().addScaledVector(normal, side * offset);
        const next = this.points[(i + step) % n];
        const segLen = p.distanceTo(next) + 0.5;
        segments.push({ pos: c, angle: Math.atan2(t.x, t.z), segLen, red: (i / step) % 2 === 0 });
      }
    }

    this._instanceColoredSegments(geo, segments, 0xffffff, 0xd92b3a, 0.06);
  }

  _buildBarriers() {
    const n = this.points.length;
    const half = ROAD_WIDTH / 2 + 1.2;
    const step = 6;
    const height = 1.2;
    const thickness = 0.6;
    const geo = new THREE.BoxGeometry(thickness, height, 1);

    const segments = [];
    for (const side of [1, -1]) {
      for (let i = 0; i < n; i += step) {
        const p = this.points[i];
        const t = this.curve.getTangentAt(i / n);
        const normal = new THREE.Vector3(-t.z, 0, t.x).normalize();
        const center = p.clone().addScaledVector(normal, side * half);
        const next = this.points[(i + step) % n];
        const segLen = p.distanceTo(next) + 0.5;
        const angle = Math.atan2(t.x, t.z);
        segments.push({ pos: center, angle, segLen, red: (i / step) % 2 === 0 });

        // Static physics body for the barrier.
        const body = new CANNON.Body({ mass: 0, material: this.materials.barrier });
        body.addShape(new CANNON.Box(new CANNON.Vec3(thickness / 2, height / 2, segLen / 2)));
        body.position.set(center.x, height / 2, center.z);
        body.quaternion.setFromEuler(0, angle, 0);
        this.world.addBody(body);
      }
    }

    this._instanceColoredSegments(geo, segments, 0xf2f2f2, 0xd92b3a, height / 2);
  }

  // Builds two InstancedMeshes (white + red) from segments scaled along Z.
  _instanceColoredSegments(geo, segments, whiteHex, redHex, yPos) {
    const reds = segments.filter((s) => s.red);
    const whites = segments.filter((s) => !s.red);
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();
    const m = new THREE.Matrix4();

    const make = (list, hex) => {
      const mat = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.7, metalness: 0.0 });
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      inst.castShadow = true;
      inst.receiveShadow = true;
      list.forEach((s, idx) => {
        q.setFromAxisAngle(up, s.angle);
        m.compose(
          new THREE.Vector3(s.pos.x, yPos, s.pos.z),
          q,
          new THREE.Vector3(1, 1, s.segLen)
        );
        inst.setMatrixAt(idx, m);
      });
      inst.instanceMatrix.needsUpdate = true;
      this.scene.add(inst);
    };

    make(whites, whiteHex);
    make(reds, redHex);
  }

  _buildStartLine() {
    const p = this.points[0];
    const t = this.curve.getTangentAt(0);
    const angle = Math.atan2(t.x, t.z);

    const tex = makeCheckerTexture();
    const geo = new THREE.PlaneGeometry(ROAD_WIDTH, 4);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    const line = new THREE.Mesh(geo, mat);
    line.position.set(p.x, 0.05, p.z);
    line.rotation.y = angle;
    this.scene.add(line);

    // Start gantry
    const postMat = new THREE.MeshStandardMaterial({ color: 0x1c2030, roughness: 0.6, metalness: 0.4 });
    const normal = new THREE.Vector3(-t.z, 0, t.x).normalize();
    for (const side of [1, -1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, 0.6), postMat);
      const pp = p.clone().addScaledVector(normal, side * (ROAD_WIDTH / 2 + 0.5));
      post.position.set(pp.x, 3.5, pp.z);
      post.castShadow = true;
      this.scene.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(ROAD_WIDTH + 2, 1.2, 0.6), postMat);
    beam.position.set(p.x, 7, p.z);
    beam.rotation.y = angle;
    beam.castShadow = true;
    this.scene.add(beam);

    this.startPoint = p.clone();
    this.startAngle = angle;
    this.startTangent = t.clone();
  }

  _buildDecor() {
    const n = this.points.length;
    const trunkGeo = new THREE.CylinderGeometry(0.4, 0.6, 3, 6);
    const leafGeo = new THREE.ConeGeometry(2.6, 6, 7);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4422, roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 1 });

    const spots = [];
    for (let i = 0; i < n; i += 14) {
      const p = this.points[i];
      const normal = this._normalAt(i);
      for (const side of [1, -1]) {
        const dist = ROAD_WIDTH / 2 + 10 + Math.random() * 40;
        const pos = p.clone().addScaledVector(normal, side * dist);
        spots.push({ pos, scale: 0.7 + Math.random() * 0.9 });
      }
    }

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, spots.length);
    trunks.castShadow = true;
    leaves.castShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    spots.forEach((s, idx) => {
      const sc = s.scale;
      m.compose(new THREE.Vector3(s.pos.x, 1.5 * sc, s.pos.z), q, new THREE.Vector3(sc, sc, sc));
      trunks.setMatrixAt(idx, m);
      m.compose(new THREE.Vector3(s.pos.x, 5.5 * sc, s.pos.z), q, new THREE.Vector3(sc, sc, sc));
      leaves.setMatrixAt(idx, m);
    });
    trunks.instanceMatrix.needsUpdate = true;
    leaves.instanceMatrix.needsUpdate = true;
    this.scene.add(trunks, leaves);
  }

  getGridSlot(slot) {
    const back = 6 + slot * 7;
    const lateral = (slot % 2 === 0 ? 1 : -1) * 4;
    const t = this.startTangent.clone().normalize();
    const normal = new THREE.Vector3(-t.z, 0, t.x).normalize();
    const pos = this.startPoint
      .clone()
      .addScaledVector(t, -back)
      .addScaledVector(normal, lateral);
    return { position: new THREE.Vector3(pos.x, 1.2, pos.z), angle: this.startAngle };
  }

  nearestProgress(worldPos) {
    const n = this.points.length;
    let best = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < n; i++) {
      const dx = this.points[i].x - worldPos.x;
      const dz = this.points[i].z - worldPos.z;
      const d = dx * dx + dz * dz;
      if (d < best) {
        best = d;
        bestIdx = i;
      }
    }
    return bestIdx / n;
  }

  pointAt(u) {
    return this.curve.getPointAt(((u % 1) + 1) % 1);
  }

  tangentAt(u) {
    return this.curve.getTangentAt(((u % 1) + 1) % 1);
  }
}

function makeCheckerTexture() {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const cells = 8;
  const cell = size / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? "#ffffff" : "#111111";
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
