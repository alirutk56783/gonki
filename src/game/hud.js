import { TOTAL_LAPS } from "./track.js";

export class HUD {
  constructor(track, player) {
    this.track = track;
    this.player = player;

    this.posCurrent = document.getElementById("pos-current");
    this.posTotal = document.getElementById("pos-total");
    this.lapCurrent = document.getElementById("lap-current");
    this.lapTotal = document.getElementById("lap-total");
    this.timeValue = document.getElementById("time-value");
    this.bestValue = document.getElementById("best-value");
    this.centerMsg = document.getElementById("center-message");

    this.speedo = document.getElementById("speedo-canvas");
    this.speedoCtx = this.speedo.getContext("2d");
    this.minimap = document.getElementById("minimap-canvas");
    this.minimapCtx = this.minimap.getContext("2d");

    this.lapTotal.textContent = TOTAL_LAPS;
    this._computeMinimapTransform();
  }

  _computeMinimapTransform() {
    const pts = this.track.points;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const pad = 18;
    const w = this.minimap.width - pad * 2;
    const h = this.minimap.height - pad * 2;
    const scale = Math.min(w / (maxX - minX), h / (maxZ - minZ));
    this._mm = { minX, minZ, maxX, maxZ, scale, pad };
  }

  _mapPoint(x, z) {
    const { minX, minZ, maxX, maxZ, scale, pad } = this._mm;
    const cx = (maxX + minX) / 2;
    const cz = (maxZ + minZ) / 2;
    return {
      x: this.minimap.width / 2 + (x - cx) * scale,
      y: this.minimap.height / 2 + (z - cz) * scale,
    };
  }

  setTotalCars(n) {
    this.posTotal.textContent = n;
  }

  showMessage(text) {
    this.centerMsg.textContent = text;
    this.centerMsg.classList.remove("hidden");
  }

  hideMessage() {
    this.centerMsg.classList.add("hidden");
  }

  static formatTime(seconds) {
    if (seconds == null || !isFinite(seconds)) return "--:--.--";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const cs = Math.floor((seconds * 100) % 100);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  }

  update(state) {
    // state: { position, totalCars, elapsed, cars }
    this.posCurrent.textContent = state.position;
    this.posTotal.textContent = state.totalCars;
    this.lapCurrent.textContent = Math.min(this.player.lap + 1, TOTAL_LAPS);
    this.timeValue.textContent = HUD.formatTime(state.elapsed);
    this.bestValue.textContent = HUD.formatTime(this.player.bestLap);

    this._drawSpeedo(this.player.speedKmh);
    this._drawMinimap(state.cars);
  }

  _drawSpeedo(speed) {
    const ctx = this.speedoCtx;
    const W = this.speedo.width;
    const H = this.speedo.height;
    const cx = W / 2;
    const cy = H / 2;
    const r = 95;
    const maxSpeed = 240;
    const start = Math.PI * 0.75;
    const end = Math.PI * 2.25;

    ctx.clearRect(0, 0, W, H);

    // Dial background
    ctx.beginPath();
    ctx.arc(cx, cy, r + 12, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(8,12,20,0.7)";
    ctx.fill();

    // Arc track
    ctx.lineWidth = 10;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, end);
    ctx.stroke();

    // Filled arc up to current speed
    const frac = Math.min(speed / maxSpeed, 1);
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, "#00e5ff");
    grad.addColorStop(0.6, "#ffd23f");
    grad.addColorStop(1, "#ff2e4d");
    ctx.strokeStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, start + (end - start) * frac);
    ctx.stroke();

    // Ticks
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 2;
    for (let i = 0; i <= maxSpeed; i += 40) {
      const a = start + (end - start) * (i / maxSpeed);
      const x1 = cx + Math.cos(a) * (r - 14);
      const y1 = cy + Math.sin(a) * (r - 14);
      const x2 = cx + Math.cos(a) * (r - 4);
      const y2 = cy + Math.sin(a) * (r - 4);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Needle
    const a = start + (end - start) * frac;
    ctx.strokeStyle = "#ff2e4d";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * (r - 8), cy + Math.sin(a) * (r - 8));
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#ff2e4d";
    ctx.fill();

    // Digital readout
    ctx.fillStyle = "#fff";
    ctx.font = "bold 34px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(Math.round(speed), cx, cy + 44);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "11px 'Segoe UI', sans-serif";
    ctx.fillText("KM/H", cx, cy + 60);
  }

  _drawMinimap(cars) {
    const ctx = this.minimapCtx;
    const W = this.minimap.width;
    const H = this.minimap.height;
    ctx.clearRect(0, 0, W, H);

    // Track ribbon
    const pts = this.track.points;
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i <= pts.length; i++) {
      const p = pts[i % pts.length];
      const m = this._mapPoint(p.x, p.z);
      if (i === 0) ctx.moveTo(m.x, m.y);
      else ctx.lineTo(m.x, m.y);
    }
    ctx.stroke();

    // Start line marker
    const sp = this._mapPoint(this.track.startPoint.x, this.track.startPoint.z);
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 4, 0, Math.PI * 2);
    ctx.fill();

    // Cars
    for (const car of cars) {
      const m = this._mapPoint(car.chassisBody.position.x, car.chassisBody.position.z);
      ctx.beginPath();
      ctx.arc(m.x, m.y, car.isPlayer ? 5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = car.isPlayer ? "#ff2e4d" : "#" + car.color.toString(16).padStart(6, "0");
      ctx.fill();
      if (car.isPlayer) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }
}
