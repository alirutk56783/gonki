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

    // Closed Catmull-Rom curve through the control points.
    this.curve = new THREE.CatmullRomCurve3(
      CONTROL_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      true,
      "catmullrom",
      0.5
    );

    this.samples = 800;
    this.points = this.curve.getSpacedPoints(this.samples); // length = samples + 1
    // Drop the duplicated closing point so indices map cleanly to [0, samples).
    this.points.pop();

    this._buildGround();
    this._buildRoad();
    this._buildBarriers();
    this._buildStartLine();
    this._buildDecor();
  }

  _buildGround() {
    const geo = new THREE.PlaneGeometry(2000, 2000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x2f5d34, roughness: 1 });
    const ground = new THREE.Mesh(geo, mat);
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Physics ground
    const body = new CANNON.Body({ mass: 0, material: this.materials.ground });
    body.addShape(new CANNON.Plane());
    body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(body);
  }

  // Returns left/right edge offset for a centerline point given its tangent.
  _edge(point, tangent, halfWidth) {
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    return {
      left: point.clone().addScaledVector(normal, halfWidth),
      right: point.clone().addScaledVector(normal, -halfWidth),
      normal,
    };
  }

  _buildRoad() {
    const half = ROAD_WIDTH / 2;
    const n = this.points.length;
    const positions = [];
    const indices = [];
    const stripePos = [];
    const stripeIdx = [];

    for (let i = 0; i <= n; i++) {
      const idx = i % n;
      const p = this.points[idx];
      const t = this.curve.getTangentAt((i % n) / n);
      const { left, right } = this._edge(p, t, half);
      positions.push(left.x, 0.01, left.z, right.x, 0.01, right.z);
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = i * 2 + 2;
      const d = i * 2 + 3;
      indices.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.85, metalness: 0.05 });
    const road = new THREE.Mesh(geo, mat);
    road.receiveShadow = true;
    this.scene.add(road);

    // Painted edge stripes (thin ribbons just inside each edge).
    this._buildEdgeStripes(half - 0.5);
    // Dashed center line.
    this._buildCenterLine();
  }

  _buildEdgeStripes(offset) {
    const n = this.points.length;
    for (const side of [1, -1]) {
      const positions = [];
      const indices = [];
      const w = 0.35;
      for (let i = 0; i <= n; i++) {
        const idx = i % n;
        const p = this.points[idx];
        const t = this.curve.getTangentAt((i % n) / n);
        const normal = new THREE.Vector3(-t.z, 0, t.x).normalize();
        const c = p.clone().addScaledVector(normal, side * offset);
        const a = c.clone().addScaledVector(normal, w);
        const b = c.clone().addScaledVector(normal, -w);
        positions.push(a.x, 0.02, a.z, b.x, 0.02, b.z);
      }
      for (let i = 0; i < n; i++) {
        const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
        indices.push(a, c, b, b, c, d);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });
      this.scene.add(new THREE.Mesh(geo, mat));
    }
  }

  _buildCenterLine() {
    const n = this.points.length;
    const dashMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.6 });
    for (let i = 0; i < n; i += 10) {
      const p = this.points[i];
      const t = this.curve.getTangentAt(i / n);
      const geo = new THREE.PlaneGeometry(0.5, 3);
      geo.rotateX(-Math.PI / 2);
      const dash = new THREE.Mesh(geo, dashMat);
      dash.position.set(p.x, 0.03, p.z);
      dash.rotation.y = Math.atan2(t.x, t.z);
      this.scene.add(dash);
    }
  }

  _buildBarriers() {
    const half = ROAD_WIDTH / 2 + 1.2;
    const n = this.points.length;
    const step = 6; // place a barrier segment every `step` samples
    const barrierMat = new THREE.MeshStandardMaterial({ color: 0xd92b3a, roughness: 0.7 });
    const barrierMatWhite = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.7 });

    for (const side of [1, -1]) {
      for (let i = 0; i < n; i += step) {
        const p = this.points[i];
        const next = this.points[(i + step) % n];
        const t = this.curve.getTangentAt(i / n);
        const normal = new THREE.Vector3(-t.z, 0, t.x).normalize();
        const center = p.clone().addScaledVector(normal, side * half);
        const segLen = p.distanceTo(next) + 0.5;
        const height = 1.2;
        const thickness = 0.6;

        // Visual mesh
        const geo = new THREE.BoxGeometry(thickness, height, segLen);
        const mesh = new THREE.Mesh(geo, (i / step) % 2 === 0 ? barrierMat : barrierMatWhite);
        mesh.position.set(center.x, height / 2, center.z);
        mesh.rotation.y = Math.atan2(t.x, t.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);

        // Physics body (static)
        const body = new CANNON.Body({ mass: 0, material: this.materials.barrier });
        body.addShape(new CANNON.Box(new CANNON.Vec3(thickness / 2, height / 2, segLen / 2)));
        body.position.set(center.x, height / 2, center.z);
        body.quaternion.setFromEuler(0, Math.atan2(t.x, t.z), 0);
        this.world.addBody(body);
      }
    }
  }

  _buildStartLine() {
    // Start/finish is at sample index 0.
    const p = this.points[0];
    const t = this.curve.getTangentAt(0);
    const angle = Math.atan2(t.x, t.z);

    // Checkered band across the road.
    const tex = makeCheckerTexture();
    const geo = new THREE.PlaneGeometry(ROAD_WIDTH, 4);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    const line = new THREE.Mesh(geo, mat);
    line.position.set(p.x, 0.04, p.z);
    line.rotation.y = angle;
    this.scene.add(line);

    this.startPoint = p.clone();
    this.startAngle = angle;
    this.startTangent = t.clone();
  }

  _buildDecor() {
    // Scatter simple low-poly trees outside the track for a sense of speed.
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4422, roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 1 });
    const n = this.points.length;
    for (let i = 0; i < n; i += 18) {
      const p = this.points[i];
      const t = this.curve.getTangentAt(i / n);
      const normal = new THREE.Vector3(-t.z, 0, t.x).normalize();
      for (const side of [1, -1]) {
        const dist = ROAD_WIDTH / 2 + 12 + Math.random() * 30;
        const pos = p.clone().addScaledVector(normal, side * dist);
        const g = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 3, 6), trunkMat);
        trunk.position.y = 1.5;
        const leaves = new THREE.Mesh(new THREE.ConeGeometry(2.6, 6, 7), leafMat);
        leaves.position.y = 5.5;
        trunk.castShadow = true;
        leaves.castShadow = true;
        g.add(trunk, leaves);
        g.position.set(pos.x, 0, pos.z);
        g.scale.setScalar(0.7 + Math.random() * 0.8);
        this.scene.add(g);
      }
    }
  }

  // Returns the grid spawn transform for a given slot (0 = pole).
  getGridSlot(slot) {
    const back = 6 + slot * 7; // meters behind start line along track (reversed tangent)
    const lateral = (slot % 2 === 0 ? 1 : -1) * 4;
    const t = this.startTangent.clone().normalize();
    const normal = new THREE.Vector3(-t.z, 0, t.x).normalize();
    const pos = this.startPoint
      .clone()
      .addScaledVector(t, -back)
      .addScaledVector(normal, lateral);
    return { position: new THREE.Vector3(pos.x, 1.2, pos.z), angle: this.startAngle };
  }

  // Normalized progress [0,1) of a world position around the track, plus a
  // lookahead point used by the AI to steer.
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
