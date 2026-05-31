import * as THREE from "three";
import * as CANNON from "cannon-es";

const CHASSIS = { width: 1.9, height: 0.55, length: 4.2 };
const WHEEL_RADIUS = 0.5;
const WHEEL_WIDTH = 0.4;

const DIR_LOCAL = new THREE.Vector3(0, -1, 0);
const AXLE_LOCAL = new THREE.Vector3(-1, 0, 0);

export class Car {
  constructor(scene, world, materials, options = {}) {
    this.scene = scene;
    this.world = world;
    this.color = options.color ?? 0xff2e4d;
    this.name = options.name ?? "CAR";
    this.isPlayer = options.isPlayer ?? false;

    // Tuning
    this.maxEngineForce = options.maxEngineForce ?? 2600;
    this.maxBrakeForce = 60;
    this.maxSteer = 0.62;
    this.frontGrip = 3.2;
    this.rearGrip = 2.9;
    this.driftGrip = 0.45;

    this._buildVehicle(materials);
    this._buildMesh();

    // Race state
    this.lap = 0;
    this.progress = 0;
    this.lastProgress = 0;
    this.rankProgress = 0;
    this.finished = false;
    this.finishTime = null;
    this.lapTimes = [];
    this.bestLap = null;
  }

  _carMaterials() {
    return {
      paint: new THREE.MeshStandardMaterial({
        color: this.color,
        roughness: 0.3,
        metalness: 0.7,
        envMapIntensity: 1.2,
      }),
      dark: new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.5, metalness: 0.4 }),
      glass: new THREE.MeshStandardMaterial({
        color: 0x10141c,
        roughness: 0.08,
        metalness: 0.9,
        envMapIntensity: 1.6,
      }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xdfe6ee, roughness: 0.18, metalness: 1.0, envMapIntensity: 1.5 }),
      head: new THREE.MeshStandardMaterial({ color: 0xfff6d0, emissive: 0xfff0b0, emissiveIntensity: 1.4 }),
      tail: new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff1010, emissiveIntensity: 1.2 }),
    };
  }

  _buildMesh() {
    const g = new THREE.Group();
    const m = this._carMaterials();
    const W = CHASSIS.width;
    const L = CHASSIS.length;

    // Lower body (slightly tapered using a beveled box look via two stacked boxes).
    const lower = new THREE.Mesh(new THREE.BoxGeometry(W, 0.45, L), m.paint);
    lower.position.y = 0.0;
    lower.castShadow = true;
    g.add(lower);

    // Hood / trunk shaping with a thinner top layer.
    const mid = new THREE.Mesh(new THREE.BoxGeometry(W * 0.96, 0.3, L * 0.92), m.paint);
    mid.position.y = 0.34;
    mid.castShadow = true;
    g.add(mid);

    // Cabin (greenhouse) — narrower, set back, with glass.
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(W * 0.82, 0.5, L * 0.4), m.paint);
    cabin.position.set(0, 0.62, -0.25);
    cabin.castShadow = true;
    g.add(cabin);

    const windshield = new THREE.Mesh(new THREE.BoxGeometry(W * 0.78, 0.42, 0.12), m.glass);
    windshield.position.set(0, 0.66, L * 0.4 * 0.5 - 0.25);
    windshield.rotation.x = -0.5;
    g.add(windshield);

    const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(W * 0.78, 0.4, 0.12), m.glass);
    rearGlass.position.set(0, 0.66, -L * 0.4 * 0.5 - 0.25);
    rearGlass.rotation.x = 0.6;
    g.add(rearGlass);

    for (const sx of [-1, 1]) {
      const sideGlass = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.36, L * 0.34), m.glass);
      sideGlass.position.set(sx * W * 0.41, 0.66, -0.25);
      g.add(sideGlass);
    }

    // Rear wing
    const wing = new THREE.Mesh(new THREE.BoxGeometry(W * 0.95, 0.08, 0.45), m.dark);
    wing.position.set(0, 0.7, -L / 2 + 0.15);
    g.add(wing);
    for (const sx of [-1, 1]) {
      const stand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.28, 0.12), m.dark);
      stand.position.set(sx * W * 0.35, 0.52, -L / 2 + 0.15);
      g.add(stand);
    }

    // Front splitter + rear diffuser
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(W, 0.06, 0.4), m.dark);
    splitter.position.set(0, -0.2, L / 2 - 0.1);
    g.add(splitter);
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(W, 0.06, 0.4), m.dark);
    diffuser.position.set(0, -0.2, -L / 2 + 0.1);
    g.add(diffuser);

    // Side skirts
    for (const sx of [-1, 1]) {
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, L * 0.7), m.dark);
      skirt.position.set(sx * W * 0.5, -0.18, 0);
      g.add(skirt);
    }

    // Headlights & taillights
    for (const sx of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.18, 0.06), m.head);
      hl.position.set(sx * 0.5, 0.12, L / 2 - 0.02);
      g.add(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.06), m.tail);
      tl.position.set(sx * 0.45, 0.16, -L / 2 + 0.02);
      g.add(tl);
    }

    // Side mirrors
    for (const sx of [-1, 1]) {
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.1), m.dark);
      mirror.position.set(sx * (W * 0.5 + 0.05), 0.62, 0.5);
      g.add(mirror);
    }

    this.mesh = g;
    this.scene.add(g);

    // Wheels as children of the chassis group so they follow it perfectly
    // (smooth, no interpolation mismatch).
    const tireGeo = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 20);
    tireGeo.rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(WHEEL_RADIUS * 0.55, WHEEL_RADIUS * 0.55, WHEEL_WIDTH + 0.02, 12);
    rimGeo.rotateZ(Math.PI / 2);
    const spokeGeo = new THREE.BoxGeometry(WHEEL_WIDTH + 0.04, 0.08, WHEEL_RADIUS * 0.9);

    this.wheelMeshes = [];
    for (let i = 0; i < 4; i++) {
      const wg = new THREE.Group();
      const tire = new THREE.Mesh(tireGeo, m.dark);
      tire.castShadow = true;
      const rim = new THREE.Mesh(rimGeo, m.chrome);
      const spoke1 = new THREE.Mesh(spokeGeo, m.chrome);
      const spoke2 = spoke1.clone();
      spoke2.rotation.x = Math.PI / 2;
      wg.add(tire, rim, spoke1, spoke2);
      this.mesh.add(wg);
      this.wheelMeshes.push(wg);
    }
  }

  _buildVehicle(materials) {
    const chassisShape = new CANNON.Box(
      new CANNON.Vec3(CHASSIS.width / 2, CHASSIS.height / 2, CHASSIS.length / 2)
    );
    const body = new CANNON.Body({ mass: 230, material: materials.car });
    // Shape offset upward lowers the center of mass → less rollover, better grip.
    body.addShape(chassisShape, new CANNON.Vec3(0, 0.25, 0));
    body.angularDamping = 0.25;
    this.chassisBody = body;

    const vehicle = new CANNON.RaycastVehicle({
      chassisBody: body,
      indexRightAxis: 0,
      indexUpAxis: 1,
      indexForwardAxis: 2,
    });

    const opt = {
      radius: WHEEL_RADIUS,
      directionLocal: new CANNON.Vec3(0, -1, 0),
      suspensionStiffness: 34,
      suspensionRestLength: 0.32,
      frictionSlip: this.frontGrip,
      dampingRelaxation: 2.4,
      dampingCompression: 4.4,
      maxSuspensionForce: 100000,
      rollInfluence: 0.03,
      axleLocal: new CANNON.Vec3(-1, 0, 0),
      chassisConnectionPointLocal: new CANNON.Vec3(),
      maxSuspensionTravel: 0.3,
      customSlidingRotationalSpeed: -30,
      useCustomSlidingRotationalSpeed: true,
    };

    const cw = CHASSIS.width / 2 + 0.06;
    const cf = CHASSIS.length / 2 - 0.65;
    const cy = 0.0;
    const positions = [
      [cw, cy, cf], // 0 front-right
      [-cw, cy, cf], // 1 front-left
      [cw, cy, -cf], // 2 rear-right
      [-cw, cy, -cf], // 3 rear-left
    ];
    for (const [x, y, z] of positions) {
      opt.chassisConnectionPointLocal.set(x, y, z);
      vehicle.addWheel(opt);
    }

    vehicle.addToWorld(this.world);
    this.vehicle = vehicle;

    // Per-wheel grip (front a touch more than rear → eager turn-in, drift-friendly).
    vehicle.wheelInfos[0].frictionSlip = this.frontGrip;
    vehicle.wheelInfos[1].frictionSlip = this.frontGrip;
    vehicle.wheelInfos[2].frictionSlip = this.rearGrip;
    vehicle.wheelInfos[3].frictionSlip = this.rearGrip;
  }

  placeAt(position, angle) {
    const b = this.chassisBody;
    b.position.set(position.x, position.y, position.z);
    b.quaternion.setFromEuler(0, angle, 0);
    b.velocity.set(0, 0, 0);
    b.angularVelocity.set(0, 0, 0);
    b.initPosition.copy(b.position);
    b.initQuaternion.copy(b.quaternion);
    b.interpolatedPosition.copy(b.position);
    b.interpolatedQuaternion.copy(b.quaternion);
    this._lastYaw = angle;
  }

  // controls: { throttle: -1..1, steer: -1..1, brake: 0..1, handbrake: bool }
  applyControls(controls) {
    const { throttle = 0, steer = 0, brake = 0, handbrake = false } = controls;

    const force = -throttle * this.maxEngineForce;
    this.vehicle.applyEngineForce(force, 2);
    this.vehicle.applyEngineForce(force, 3);

    // Speed-sensitive steering: full lock at low speed, calmer at high speed.
    const speedFactor = THREE.MathUtils.clamp(this.speedKmh / 170, 0, 1);
    const steerLimit = this.maxSteer * THREE.MathUtils.lerp(1.0, 0.5, speedFactor);
    const steerVal = steer * steerLimit;
    this.vehicle.setSteeringValue(steerVal, 0);
    this.vehicle.setSteeringValue(steerVal, 1);

    // Foot brake on all wheels.
    const b = brake * this.maxBrakeForce;
    this.vehicle.setBrake(b, 0);
    this.vehicle.setBrake(b, 1);

    if (handbrake) {
      // Break rear traction → slides / drifts, with light rear braking.
      this.vehicle.wheelInfos[2].frictionSlip = this.driftGrip;
      this.vehicle.wheelInfos[3].frictionSlip = this.driftGrip;
      this.vehicle.setBrake(b + this.maxBrakeForce * 0.35, 2);
      this.vehicle.setBrake(b + this.maxBrakeForce * 0.35, 3);
    } else {
      this.vehicle.wheelInfos[2].frictionSlip = this.rearGrip;
      this.vehicle.wheelInfos[3].frictionSlip = this.rearGrip;
      this.vehicle.setBrake(b, 2);
      this.vehicle.setBrake(b, 3);
    }
  }

  get speedKmh() {
    const v = this.chassisBody.velocity;
    return Math.sqrt(v.x * v.x + v.z * v.z) * 3.6;
  }

  get forwardDir() {
    const out = this.chassisBody.quaternion.vmult(new CANNON.Vec3(0, 0, 1));
    return new THREE.Vector3(out.x, out.y, out.z);
  }

  resetUpright() {
    const p = this.chassisBody.position;
    this.chassisBody.quaternion.setFromEuler(0, this._lastYaw ?? 0, 0);
    this.chassisBody.position.set(p.x, p.y + 1.5, p.z);
    this.chassisBody.velocity.set(0, 0, 0);
    this.chassisBody.angularVelocity.set(0, 0, 0);
  }

  syncMesh() {
    // Use interpolated transform for smooth rendering between physics steps.
    const p = this.chassisBody.interpolatedPosition;
    const q = this.chassisBody.interpolatedQuaternion;
    this.mesh.position.set(p.x, p.y, p.z);
    this.mesh.quaternion.set(q.x, q.y, q.z, q.w);

    const e = new THREE.Euler().setFromQuaternion(this.mesh.quaternion, "YXZ");
    this._lastYaw = e.y;

    // Wheels are children of the chassis group: set their local transforms.
    for (let i = 0; i < this.wheelMeshes.length; i++) {
      const info = this.vehicle.wheelInfos[i];
      const cp = info.chassisConnectionPointLocal;
      const susp = info.suspensionLength ?? info.suspensionRestLength ?? 0.3;
      const wm = this.wheelMeshes[i];
      wm.position.set(cp.x, cp.y - susp, cp.z);

      const qSteer = new THREE.Quaternion().setFromAxisAngle(DIR_LOCAL, info.steering ?? 0);
      const qSpin = new THREE.Quaternion().setFromAxisAngle(AXLE_LOCAL, info.rotation ?? 0);
      wm.quaternion.copy(qSteer).multiply(qSpin);
    }
  }
}
