// Keyboard input handler. Tracks held keys and exposes a normalized control
// state plus one-shot edge events (reset, camera toggle).
export class Controls {
  constructor() {
    this.keys = new Set();
    this._resetEdge = false;
    this._cameraEdge = false;

    this._onDown = (e) => {
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) {
        e.preventDefault();
      }
      if (!this.keys.has(k)) {
        if (k === "r") this._resetEdge = true;
        if (k === "c") this._cameraEdge = true;
      }
      this.keys.add(k);
    };
    this._onUp = (e) => this.keys.delete(e.key.toLowerCase());

    window.addEventListener("keydown", this._onDown);
    window.addEventListener("keyup", this._onUp);
  }

  has(...names) {
    return names.some((n) => this.keys.has(n));
  }

  getState() {
    let throttle = 0;
    let steer = 0;
    let brake = 0;

    const forward = this.has("w", "arrowup");
    const backward = this.has("s", "arrowdown");
    const left = this.has("a", "arrowleft");
    const right = this.has("d", "arrowright");

    if (forward) throttle += 1;
    if (backward) throttle -= 1;
    if (left) steer += 1;
    if (right) steer -= 1;
    if (this.has(" ")) brake = 1; // handbrake

    return { throttle, steer, brake };
  }

  consumeReset() {
    const v = this._resetEdge;
    this._resetEdge = false;
    return v;
  }

  consumeCamera() {
    const v = this._cameraEdge;
    this._cameraEdge = false;
    return v;
  }

  dispose() {
    window.removeEventListener("keydown", this._onDown);
    window.removeEventListener("keyup", this._onUp);
  }
}
