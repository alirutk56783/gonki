import * as THREE from "three";
import * as CANNON from "cannon-es";

// Simple but capable racing AI: follows the track centerline using a lookahead
// target, eases off the throttle in corners, and recovers if flipped or stuck.
export class AIDriver {
  constructor(car, track, params = {}) {
    this.car = car;
    this.track = track;
    this.lookahead = params.lookahead ?? 0.025; // normalized track units
    this.speedFactor = params.speedFactor ?? 1.0; // per-bot skill
    this.aggression = params.aggression ?? 0.0; // random lateral wander
    this._flippedTime = 0;
    this._stuckTime = 0;
    this._wander = (Math.random() - 0.5) * 2;
    this._wanderTimer = 0;
  }

  update(dt) {
    const car = this.car;
    if (car.finished) {
      car.applyControls({ throttle: 0, steer: 0, brake: 0.6 });
      return;
    }

    // Recovery if flipped.
    const up = car.chassisBody.quaternion.vmult(new CANNON.Vec3(0, 1, 0));
    if (up.y < 0.3) {
      this._flippedTime += dt;
      if (this._flippedTime > 1.5) {
        car.resetUpright();
        this._flippedTime = 0;
      }
    } else {
      this._flippedTime = 0;
    }

    // Recovery if stuck (low speed for a while).
    if (car.speedKmh < 6) {
      this._stuckTime += dt;
    } else {
      this._stuckTime = 0;
    }

    // Wander target slightly for less robotic lines / overtakes.
    this._wanderTimer -= dt;
    if (this._wanderTimer <= 0) {
      this._wander = (Math.random() - 0.5) * 2;
      this._wanderTimer = 1 + Math.random() * 2;
    }

    const pos = new THREE.Vector3(
      car.chassisBody.position.x,
      0,
      car.chassisBody.position.z
    );

    // Target point ahead on the track, offset laterally by aggression*wander.
    const targetU = car.progress + this.lookahead;
    const target = this.track.pointAt(targetU).clone();
    const tang = this.track.tangentAt(targetU);
    const normal = new THREE.Vector3(-tang.z, 0, tang.x).normalize();
    target.addScaledVector(normal, this.aggression * this._wander * 4);

    const toTarget = target.clone().sub(pos);
    toTarget.y = 0;
    toTarget.normalize();

    const forward = car.forwardDir;
    forward.y = 0;
    forward.normalize();

    // Signed steering error via cross product (Y component).
    const cross = forward.x * toTarget.z - forward.z * toTarget.x;
    const dot = THREE.MathUtils.clamp(forward.dot(toTarget), -1, 1);
    const angle = Math.atan2(cross, dot); // [-pi, pi]
    let steer = THREE.MathUtils.clamp(-angle * 1.6, -1, 1);

    // Throttle: reduce in sharp turns and at high speed in corners.
    const turnSharpness = Math.abs(angle);
    const targetSpeed = THREE.MathUtils.lerp(150, 55, THREE.MathUtils.clamp(turnSharpness / 1.0, 0, 1)) * this.speedFactor;
    let throttle = car.speedKmh < targetSpeed ? 1 : 0;
    let brake = 0;
    if (car.speedKmh > targetSpeed + 25) brake = 0.5;

    // If stuck, reverse and turn out for a moment.
    if (this._stuckTime > 1.2) {
      throttle = -1;
      steer = -steer;
      brake = 0;
      if (this._stuckTime > 2.6) this._stuckTime = 0;
    }

    car.applyControls({ throttle, steer, brake });
  }
}
