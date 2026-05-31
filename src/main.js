import "./style.css";
import { Game } from "./game/game.js";

const canvas = document.getElementById("game-canvas");
const game = new Game(canvas);
game.build();

document.getElementById("start-btn").addEventListener("click", () => {
  game.startRace();
});

document.getElementById("restart-btn").addEventListener("click", () => {
  game.startRace();
});
