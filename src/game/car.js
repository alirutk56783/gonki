import * as THREE from "three";
import * as CANNON from "cannon-es";

const CHASSIS = { width: 1.8, height: 0.7, length: 4.0 };
const WHEEL_RADIUS = 0.5;

export class Car {
  constructor(scene, world, materials, options = {}) {
    this.scene = scene;
    this.world = world;
    this.color = options.color ?? 0xff2e4d;
    this.name = options.name ?? "CAR";
    this.isPlayer = options.isPlayer ?? false;

    // Tuning
    this.maxEngineForce = options.maxEngineForce ?? 2200;
    this.maxBrakeForce = 45;
    this.maxSteer = 0.55;

    this._buildMesh();
    this._buildVehicle(materials);

    // Race state
    this.lap = 0;
    this.progress = 0; // normalized [0,1)
    this.lastProgress = 0;
    this.rankProgress = 0; // lap + progress, for sorting
    this.finished = false;
    this.finishTime = null;
    this.lapTimes = [];
    this.lastLapStamp = 0;
    this.bestLap = null;
  }

  _buildMesh() {
    const g = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({ color: this.color, roughness: 0.35, metalness: 0.5 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.5, metalness: 0.3 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x3a4a5a, roughness: 0.1, metalness: 0.6 });

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(CHASSIS.width, CHASSIS.height, CHASSIS.length),
      bodyMat
    );
    body.castShadow = true;
    body.position.y = 0.1;
    g.add(body);

    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(CHASSIS.width * 0.85, 0.55, CHASSIS.length * 0.45),
      glassMat
    );
    cabin.position.set(0, 0.55, -0.15);
    cabin.castShadow = true;
    g.add(cabin);

    // Spoiler
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(CHASSIS.width, 0.08, 0.4), darkMat);
    spoiler.position.set(0, 0.5, -CHASSIS.length / 2 + 0.1);
    g.add(spoiler);
    for (const sx of [-1, 1]) {
      const stand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.1), darkMat);
      stand.position.set(sx * 0.7, 0.35, -CHASSIS.length / 2 + 0.1);
      g.add(stand);
    }

    // Headlights
    const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xfff2c0, emissiveIntensity: 1.2 });
    for (const sx of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.05), lightMat);
      hl.position.set(sx * 0.55, 0.1, CHASSIS.length / 2 - 0.02);
      g.add(hl);
    }

    this.mesh = g;
    this.scene.add(g);

    // Wheel meshes
    const wheelGeo = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.4, 18);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.8 });
    const hubMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.3, metalness: 0.8 });
    this.wheelMeshes = [];
    for (let i = 0; i < 4; i++) {
      const wg = new THREE.Group();
      const tire = new THREE.Mesh(wheelGeo, wheelMat);
      tire.castShadow = true;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.42, 10), hubMat);
      hub.rotateZ(Math.PI / 2);
      wg.add(tire, hub);
      this.scene.add(wg);
      this.wheelMeshes.push(wg);
    }
  }

  _buildVehicle(materials) {
    const chassisShape = new CANNON.Box(
      new CANNON.Vec3(CHASSIS.width / 2, CHASSIS.height / 2, CHASSIS.length / 2)
    );
    const body = new CANNON.Body({ mass: 250, material: materials.car });
    // Lower the center of mass for stability.
    body.addShape(chassisShape, new CANNON.Vec3(0, 0, 0));
    body.angularDamping = 0.4;
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
      suspensionStiffness: 32,
      suspensionRestLength: 0.35,
      frictionSlip: 2.2,
      dampingRelaxation: 2.4,
      dampingCompression: 4.6,
      maxSuspensionForce: 100000,
      rollInfluence: 0.02,
      axleLocal: new CANNON.Vec3(-1, 0, 0),
      chassisConnectionPointLocal: new CANNON.Vec3(),
      maxSuspensionTravel: 0.35,
      customSlidingRotationalSpeed: -30,
      useCustomSlidingRotationalSpeed: true,
    };

    const cw = CHASSIS.width / 2 + 0.05;
    const cf = CHASSIS.length / 2 - 0.6;
    const cy = -0.1;
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
  }

  placeAt(position, angle) {
    this.chassisBody.position.set(position.x, position.y, position.z);
    this.chassisBody.quaternion.setFromEuler(0, angle, 0);
    this.chassisBody.velocity.set(0, 0, 0);
    this.chassisBody.angularVelocity.set(0, 0, 0);
    this.chassisBody.initPosition.copy(this.chassisBody.position);
    this.chassisBody.initQuaternion.copy(this.chassisBody.quaternion);
  }

  // controls: { throttle: -1..1, steer: -1..1, brake: 0..1 }
  applyControls(controls) {
    const { throttle = 0, steer = 0, brake = 0 } = controls;
    const force = -throttle * this.maxEngineForce;
    // Rear-wheel drive (wheels 2 and 3)
    this.vehicle.applyEngineForce(force, 2);
    this.vehicle.applyEngineForce(force, 3);
    // Steering on front wheels (0 and 1)
    const steerVal = steer * this.maxSteer;
    this.vehicle.setSteeringValue(steerVal, 0);
    this.vehicle.setSteeringValue(steerVal, 1);
    // Braking on all wheels
    const b = brake * this.maxBrakeForce;
    for (let i = 0; i < 4; i++) this.vehicle.setBrake(b, i);
  }

  get speedKmh() {
    const v = this.chassisBody.velocity;
    return Math.sqrt(v.x * v.x + v.z * v.z) * 3.6;
  }

  get forwardDir() {
    const q = this.chassisBody.quaternion;
    const f = new CANNON.Vec3(0, 0, 1);
    const out = q.vmult(f);
    return new THREE.Vector3(out.x, out.y, out.z);
  }

  // Flip the car back upright if it has rolled over.
  resetUpright() {
    const p = this.chassisBody.position;
    this.chassisBody.quaternion.setFromEuler(0, this._lastYaw ?? 0, 0);
    this.chassisBody.position.set(p.x, p.y + 1.5, p.z);
    this.chassisBody.velocity.set(0, 0, 0);
    this.chassisBody.angularVelocity.set(0, 0, 0);
  }

  syncMesh() {
    const p = this.chassisBody.position;
    const q = this.chassisBody.quaternion;
    this.mesh.position.set(p.x, p.y, p.z);
    this.mesh.quaternion.set(q.x, q.y, q.z, q.w);

    // Track yaw for upright reset.
    const e = new THREE.Euler().setFromQuaternion(this.mesh.quaternion, "YXZ");
    this._lastYaw = e.y;

    for (let i = 0; i < this.wheelMeshes.length; i++) {
      this.vehicle.updateWheelTransform(i);
      const t = this.vehicle.wheelInfos[i].worldTransform;
      const wm = this.wheelMeshes[i];
      wm.position.set(t.position.x, t.position.y, t.position.z);
      wm.quaternion.set(t.quaternion.x, t.quaternion.y, t.quaternion.z, t.quaternion.w);
    }
  }
}
