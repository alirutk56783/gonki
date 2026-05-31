import * as THREE from "three";
import * as CANNON from "cannon-es";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Track, TOTAL_LAPS } from "./track.js";
import { Car } from "./car.js";
import { AIDriver } from "./ai.js";
import { Controls } from "./controls.js";
import { HUD } from "./hud.js";

const BOT_CONFIG = [
  { name: "VIPER", color: 0x00e5ff, speedFactor: 1.0, aggression: 0.35, lookahead: 0.024 },
  { name: "BLAZE", color: 0xffd23f, speedFactor: 0.96, aggression: 0.5, lookahead: 0.022 },
  { name: "GHOST", color: 0xb066ff, speedFactor: 1.03, aggression: 0.2, lookahead: 0.026 },
];

const CAMERA_MODES = ["chase", "far", "hood"];

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.cameraMode = 0;
    this.state = "menu"; // menu | countdown | racing | finished
    this._initRenderer();
    this._initScene();
    this._initPhysics();

    this.controls = new Controls();
    this.clock = new THREE.Clock();
    this._tmpVec = new THREE.Vector3();
    this._camTarget = new THREE.Vector3();
    this._camPos = new THREE.Vector3();

    window.addEventListener("resize", () => this._onResize());
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: "high-performance",
    });

    // Detect software / very weak GPUs and scale quality down so the game
    // stays playable. Real GPUs keep full resolution, shadows and reflections.
    this.lowPerf = detectLowPerf(this.renderer);
    this._pixelRatio = this.lowPerf ? 0.6 : Math.min(window.devicePixelRatio, 2);

    this.renderer.setPixelRatio(this._pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = !this.lowPerf;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = makeSkyTexture();
    this.scene.fog = new THREE.Fog(0xaecbe6, 280, 760);

    // Image-based lighting for realistic metal/glass reflections on the cars.
    // Skipped on low-perf devices (extra per-fragment cost on software renderers).
    if (!this.lowPerf) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    }

    this.camera = new THREE.PerspectiveCamera(
      62,
      window.innerWidth / window.innerHeight,
      0.1,
      2000
    );
    this.camera.position.set(0, 20, -40);

    const hemi = new THREE.HemisphereLight(0xbdd7ff, 0x44502f, 0.9);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff4e0, 2.0);
    sun.position.set(180, 280, 140);
    sun.castShadow = !this.lowPerf;
    sun.shadow.mapSize.set(2048, 2048);
    // Fixed shadow frustum covering the whole circuit → no per-frame churn.
    const d = 260;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 800;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.target.position.set(0, 0, 0);
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
  }

  _initPhysics() {
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -16, 0) });
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.defaultContactMaterial.friction = 0;

    const materials = {
      ground: new CANNON.Material("ground"),
      car: new CANNON.Material("car"),
      barrier: new CANNON.Material("barrier"),
    };

    // Wheels use raycast friction; the chassis-ground contact should be slick
    // so it doesn't fight the vehicle model.
    world.addContactMaterial(
      new CANNON.ContactMaterial(materials.ground, materials.car, {
        friction: 0.2,
        restitution: 0,
      })
    );
    // Car-vs-car: bouncy, grippy ramming.
    world.addContactMaterial(
      new CANNON.ContactMaterial(materials.car, materials.car, {
        friction: 0.4,
        restitution: 0.35,
      })
    );
    // Car-vs-barrier: solid wall with a little bounce.
    world.addContactMaterial(
      new CANNON.ContactMaterial(materials.car, materials.barrier, {
        friction: 0.2,
        restitution: 0.2,
      })
    );

    this.world = world;
    this.materials = materials;
  }

  build() {
    this.track = new Track(this.scene, this.world, this.materials);

    // Player + bots.
    this.cars = [];
    this.player = new Car(this.scene, this.world, this.materials, {
      color: 0xff2e4d,
      name: "ВЫ",
      isPlayer: true,
    });
    this.cars.push(this.player);

    this.ais = [];
    BOT_CONFIG.forEach((cfg) => {
      const car = new Car(this.scene, this.world, this.materials, {
        color: cfg.color,
        name: cfg.name,
      });
      this.cars.push(car);
      this.ais.push(
        new AIDriver(car, this.track, {
          speedFactor: cfg.speedFactor,
          aggression: cfg.aggression,
          lookahead: cfg.lookahead,
        })
      );
    });

    this._placeOnGrid();

    this.hud = new HUD(this.track, this.player);
    this.hud.setTotalCars(this.cars.length);
    this.elapsed = 0;

    document.getElementById("loading").classList.add("hidden");

    // Start the render loop immediately so the track is visible behind the menu.
    this.clock.start();
    this._animate();
  }

  _placeOnGrid() {
    this.cars.forEach((car, i) => {
      const slot = this.track.getGridSlot(i);
      car.placeAt(slot.position, slot.angle);
      car.lap = 0;
      car.progress = this.track.nearestProgress(slot.position);
      car.lastProgress = car.progress;
      car.passedHalf = false;
      car.finished = false;
      car.finishTime = null;
      car.bestLap = null;
      car.lapTimes = [];
      car.syncMesh();
    });
  }

  reset() {
    this._placeOnGrid();
    this.state = "menu";
    this.elapsed = 0;
    this.hud.hideMessage();
  }

  startRace() {
    this._placeOnGrid();
    this.elapsed = 0;
    this.lapStartTimes = this.cars.map(() => 0);
    this.state = "countdown";
    this.countdown = 3.999;
    this._finishTimer = 0;
    document.getElementById("hud").classList.remove("hidden");
    document.getElementById("start-screen").classList.add("hidden");
    document.getElementById("finish-screen").classList.add("hidden");
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this._pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  _updateRaceLogic(dt) {
    for (const car of this.cars) {
      const pos = car.chassisBody.position;
      this._tmpVec.set(pos.x, 0, pos.z);
      const p = this.track.nearestProgress(this._tmpVec);
      const prev = car.progress;
      const d = p - prev;

      // Only arm a lap once the car has reached the far side of the circuit.
      // The grid sits just behind the line (progress ~0.97), so a plain
      // "p > 0.5" check would arm immediately and miscount the first crossing.
      if (p > 0.4 && p < 0.65) car.passedHalf = true;

      // Forward wrap (crossed start line going the right way).
      if (d < -0.5 && car.passedHalf && !car.finished) {
        car.lap += 1;
        car.passedHalf = false;
        const lapTime = this.elapsed - this.lapStartTimes[this.cars.indexOf(car)];
        car.lapTimes.push(lapTime);
        if (car.bestLap == null || lapTime < car.bestLap) car.bestLap = lapTime;
        this.lapStartTimes[this.cars.indexOf(car)] = this.elapsed;

        if (car.lap >= TOTAL_LAPS) {
          car.finished = true;
          car.finishTime = this.elapsed;
        }
      }

      car.lastProgress = prev;
      car.progress = p;
      car.rankProgress = car.lap + p;
    }
  }

  _computeStandings() {
    const sorted = [...this.cars].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.rankProgress - a.rankProgress;
    });
    return sorted;
  }

  _updateCamera(dt) {
    const car = this.player;
    const pos = car.mesh.position;
    const fwd = car.forwardDir;
    fwd.y = 0;
    fwd.normalize();

    let desired = new THREE.Vector3();
    let look = new THREE.Vector3();

    if (CAMERA_MODES[this.cameraMode] === "chase") {
      desired.copy(pos).addScaledVector(fwd, -9).add(new THREE.Vector3(0, 4.5, 0));
      look.copy(pos).addScaledVector(fwd, 6).add(new THREE.Vector3(0, 1.2, 0));
    } else if (CAMERA_MODES[this.cameraMode] === "far") {
      desired.copy(pos).addScaledVector(fwd, -16).add(new THREE.Vector3(0, 9, 0));
      look.copy(pos).addScaledVector(fwd, 4);
    } else {
      // hood
      desired.copy(pos).addScaledVector(fwd, 0.5).add(new THREE.Vector3(0, 1.6, 0));
      look.copy(pos).addScaledVector(fwd, 20).add(new THREE.Vector3(0, 1.2, 0));
    }

    // Critically-damped follow keeps the camera smooth without jitter.
    const posLerp = 1 - Math.pow(0.0001, dt);
    const lookLerp = 1 - Math.pow(0.00001, dt);
    this.camera.position.lerp(desired, Math.min(posLerp, 1));
    this._camTarget.lerp(look, Math.min(lookLerp, 1));
    this.camera.lookAt(this._camTarget);
  }

  _showFinish() {
    this.state = "finished";
    const standings = this._computeStandings();
    const playerPlace = standings.indexOf(this.player) + 1;

    const title = document.getElementById("finish-title");
    title.textContent =
      playerPlace === 1 ? "ПОБЕДА!" : `${playerPlace} МЕСТО`;

    const resultsEl = document.getElementById("results");
    resultsEl.innerHTML = "";
    standings.forEach((car, i) => {
      const row = document.createElement("div");
      row.className = "row" + (car.isPlayer ? " me" : "");
      const time = car.finishTime != null ? HUD.formatTime(car.finishTime) : "—";
      row.innerHTML =
        `<span class="place">${i + 1}.</span>` +
        `<span class="name">${car.name}</span>` +
        `<span class="rtime">${time}</span>`;
      resultsEl.appendChild(row);
    });

    document.getElementById("finish-screen").classList.remove("hidden");
    this.hud.hideMessage();
  }

  _step(dt) {
    // ----- Countdown -----
    if (this.state === "countdown") {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown - 1);
      if (this.countdown <= 1) {
        this.hud.showMessage("GO!");
        if (this.countdown <= 0.3) this.hud.hideMessage();
        if (this.countdown <= 0) {
          this.state = "racing";
          this.elapsed = 0;
          this.lapStartTimes = this.cars.map(() => 0);
        }
      } else {
        this.hud.showMessage(String(Math.min(n, 3)));
      }
      // Hold cars with brakes during countdown.
      for (const car of this.cars) car.applyControls({ throttle: 0, steer: 0, brake: 1 });
    }

    // ----- Racing input -----
    if (this.state === "racing") {
      this.elapsed += dt;

      // Player controls
      if (this.player.finished) {
        this.player.applyControls({ throttle: 0, steer: 0, brake: 0.5 });
      } else {
        this.player.applyControls(this.controls.getState());
      }
      if (this.controls.consumeReset()) this.player.resetUpright();

      // AI
      for (const ai of this.ais) ai.update(dt);
    }

    if (this.controls.consumeCamera()) {
      this.cameraMode = (this.cameraMode + 1) % CAMERA_MODES.length;
    }

    // ----- Physics -----
    this.world.step(1 / 60, dt, 3);
    for (const car of this.cars) car.syncMesh();

    // ----- Race bookkeeping -----
    if (this.state === "racing") {
      this._updateRaceLogic(dt);
      const standings = this._computeStandings();
      const position = standings.indexOf(this.player) + 1;
      this.hud.update({
        position,
        totalCars: this.cars.length,
        elapsed: this.elapsed,
        cars: this.cars,
      });

      if (this.player.finished) {
        this._finishTimer = (this._finishTimer ?? 0) + dt;
        if (this._finishTimer > 1.2) {
          this._finishTimer = 0;
          this._showFinish();
        }
      }
    } else {
      // Keep HUD gauges alive on menu/countdown.
      this.hud.update({
        position: 1,
        totalCars: this.cars.length,
        elapsed: this.elapsed ?? 0,
        cars: this.cars,
      });
    }
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    let dt = this.clock.getDelta();
    dt = Math.min(dt, 0.05); // clamp to avoid physics blowups on tab switch
    if (dt > 0) this._step(dt);
    this._updateCamera(Math.max(dt, 0.0001));
    this.renderer.render(this.scene, this.camera);
    this._adaptQuality(dt);
  }

  // One-shot safety net: if the first couple seconds run poorly on a device we
  // didn't flag as low-perf, drop resolution and shadows so it's still smooth.
  _adaptQuality(dt) {
    if (this._qualityChecked) return;
    this._fpsFrames = (this._fpsFrames || 0) + 1;
    this._fpsAccum = (this._fpsAccum || 0) + dt;
    if (this._fpsAccum < 2.5) return;
    const fps = this._fpsFrames / this._fpsAccum;
    if (fps < 24 && this._pixelRatio > 0.6) {
      this._pixelRatio = 0.6;
      this.renderer.setPixelRatio(0.6);
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.shadowMap.enabled = false;
      this.sun.castShadow = false;
    }
    this._qualityChecked = true;
  }
}

function detectLowPerf(renderer) {
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
    return /swiftshader|llvmpipe|software|basic render/i.test(name);
  } catch (e) {
    return false;
  }
}

// Vertical gradient sky used as the scene background.
function makeSkyTexture() {
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 256;
  const ctx = c.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, "#2a6cc4");
  grad.addColorStop(0.45, "#6fa8dc");
  grad.addColorStop(0.75, "#bcd6ee");
  grad.addColorStop(1.0, "#dfeaf5");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
