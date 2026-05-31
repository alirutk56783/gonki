import * as THREE from "three";
import * as CANNON from "cannon-es";

// Racing AI: follows the centerline via a lookahead target, eases off in
// corners, and has robust recovery from flips and wall snags.
export class AIDriver {
  constructor(car, track, params = {}) {
    this.car = car;
    this.track = track;
    this.lookahead = params.lookahead ?? 0.025;
    this.speedFactor = params.speedFactor ?? 1.0;
    this.aggression = params.aggression ?? 0.0;
    this._flippedTime = 0;
    this._stuckTime = 0;
    this._reverseTime = 0;
    this._wander = (Math.random() - 0.5) * 2;
    this._wanderTimer = 0;
  }

  update(dt) {
    const car = this.car;
    if (car.finished) {
      car.applyControls({ throttle: 0, steer: 0, brake: 0.6 });
      return;
    }

    // --- Recovery: flipped over ---
    const up = car.chassisBody.quaternion.vmult(new CANNON.Vec3(0, 1, 0));
    if (up.y < 0.3) {
      this._flippedTime += dt;
      if (this._flippedTime > 1.2) {
        car.resetUpright();
        this._flippedTime = 0;
      }
    } else {
      this._flippedTime = 0;
    }

    // Target point ahead on the track.
    const pos = new THREE.Vector3(car.chassisBody.position.x, 0, car.chassisBody.position.z);
    const targetU = car.progress + this.lookahead;

    // Wander laterally a little, but stay well inside the road (no wall hugging).
    this._wanderTimer -= dt;
    if (this._wanderTimer <= 0) {
      this._wander = (Math.random() - 0.5) * 2;
      this._wanderTimer = 1.5 + Math.random() * 2;
    }
    const target = this.track.pointAt(targetU).clone();
    const tang = this.track.tangentAt(targetU);
    const normal = new THREE.Vector3(-tang.z, 0, tang.x).normalize();
    const lateral = THREE.MathUtils.clamp(this.aggression * this._wander * 3, -5, 5);
    target.addScaledVector(normal, lateral);

    const toTarget = target.clone().sub(pos);
    toTarget.y = 0;
    toTarget.normalize();

    const forward = car.forwardDir;
    forward.y = 0;
    forward.normalize();

    const cross = forward.x * toTarget.z - forward.z * toTarget.x;
    const dot = THREE.MathUtils.clamp(forward.dot(toTarget), -1, 1);
    const angle = Math.atan2(cross, dot);

    // --- Recovery: stuck (low speed for a while) ---
    if (car.speedKmh < 5) this._stuckTime += dt;
    else this._stuckTime = 0;

    if (this._reverseTime > 0) {
      // Back away from the wall, steering so the nose ends up toward the target.
      this._reverseTime -= dt;
      car.applyControls({ throttle: -1, steer: THREE.MathUtils.clamp(angle * 1.4, -1, 1), brake: 0 });
      if (car.speedKmh > 22) this._reverseTime = 0; // backed up enough
      return;
    }
    if (this._stuckTime > 0.8) {
      this._stuckTime = 0;
      this._reverseTime = 1.0 + Math.random() * 0.6;
      return;
    }

    // --- Normal driving ---
    let steer = THREE.MathUtils.clamp(-angle * 1.7, -1, 1);

    const turnSharpness = Math.abs(angle);
    const targetSpeed =
      THREE.MathUtils.lerp(155, 60, THREE.MathUtils.clamp(turnSharpness / 1.0, 0, 1)) *
      this.speedFactor;
    let throttle = car.speedKmh < targetSpeed ? 1 : 0.2;
    let brake = 0;
    if (car.speedKmh > targetSpeed + 28) brake = 0.5;

    car.applyControls({ throttle, steer, brake });
  }
}
