// Whack-a-Bertha Game
// Assumes images: ms_bertha.png, character_21.png, character_27.png, character_31.png, character_37.png, hammer.png in same folder

const cfg = {
  rows: 2,
  cols: 4,
  doors: 8,
  doorW: Math.round(0.4 * 120), // 48
  doorH: Math.round(0.4 * 170), // 68
  doorPadX: 40,
  doorPadY: 30,
  gridPadTop: 60,
  gridPadSide: 40,
  gameTime: 30,
  rentGoal: 100,
  berthaPoints: 10,
  berthaAppearances: 11,
  strikeMax: 3,
  popMin: 700,
  popMax: 1200,
  decoyImgs: ["character_21.png","character_27.png","character_31.png","character_37.png"],
  doorImg: null, // will be loaded
  hammerImg: null,
  msBerthaImg: null,
  decoyImages: [],
  redXAlpha: 0.45,
};

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const dScore = document.getElementById("score");
const dGoal = document.getElementById("goal");
const dStrikes = document.getElementById("strikes");
const dTime = document.getElementById("time");
const btnStart = document.getElementById("btnStart");
const btnPause = document.getElementById("btnPause");
const btnReset = document.getElementById("btnReset");

let state = {
  running: false,
  paused: false,
  timeLeft: cfg.gameTime,
  score: 0,
  strikes: 0,
  berthaLeft: cfg.berthaAppearances,
  pops: [],
  redXTimer: 0,
  confetti: [],
  shake: 0,
  hammer: {x:0, y:0, down:false, anim:0},
  muted: false,
};

// ========== IMAGE LOADING ==========
const images = {};
function loadImage(name, src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = src;
    img.onload = () => {
      images[name] = img;
      console.log('Loaded image:', name, src);
      resolve(img);
    };
    img.onerror = () => {
      console.warn('Failed to load image:', name, src);
      resolve(null);
    };
  });
}

async function loadAssets() {
  await Promise.all([
    loadImage("msBertha", "ms_bertha.png"),
    loadImage("hammer", "hammer.png"),
    ...cfg.decoyImgs.map((fn, i) => loadImage("decoy"+i, fn)),
    loadImage("door", "door.png").catch(()=>null), // optional, fallback to rect
  ]);
  cfg.msBerthaImg = images.msBertha;
  cfg.hammerImg = images.hammer;
  cfg.doorImg = images.door || null;
  cfg.decoyImages = [images.decoy0, images.decoy1, images.decoy2, images.decoy3];
}

// ========== GAME SETUP ==========
function resetGame() {
  state = {
    running: false,
    paused: false,
    timeLeft: cfg.gameTime,
    score: 0,
    strikes: 0,
    berthaLeft: cfg.berthaAppearances,
    pops: [],
    redXTimer: 0,
    confetti: [],
    shake: 0,
    hammer: {x:0, y:0, down:false, anim:0},
    muted: false,
  };
  updateHUD();
  draw();
}

function startGame() {
  // Always start a new game when Start is pressed
  resetGame();
  state.running = true;
  state.paused = false;
  lastT = performance.now();
  loop(lastT);
}

function togglePause() {
  if (!state.running) return;
  state.paused = !state.paused;
  if (!state.paused) loop(performance.now());
}

// ========== GAME LOOP ==========
let lastT = 0;
function loop(t) {
  if (!state.running || state.paused) return;
  const dt = Math.min(0.04, (t - lastT) / 1000 || 0.016);
  lastT = t;
  state.timeLeft -= dt;
  if (state.timeLeft <= 0) {
    state.timeLeft = 0;
    endGame();
    draw();
    return;
  }
  updatePops(dt);
  updateConfetti(dt);
  updateHammer(dt);
  if (state.redXTimer > 0) state.redXTimer -= dt;
  if (state.shake > 0) state.shake *= 0.92;
  draw();
  requestAnimationFrame(loop);
}

function endGame() {
  state.running = false;
  state.paused = false;
}

// ========== POP LOGIC ==========
function updatePops(dt) {
  // Remove expired pops
  for (let i = state.pops.length - 1; i >= 0; i--) {
    const p = state.pops[i];
    p.time += dt * 1000;
    if (p.time > p.dur) state.pops.splice(i, 1);
  }
  // Spawn logic
  if (state.pops.length < 2 && state.berthaLeft + state.pops.filter(p=>p.type==="bertha").length > 0) {
    spawnPop();
  } else if (state.pops.length < 2 && Math.random() < 0.02) {
    spawnPop();
  }
}

function spawnPop() {
  // Find free door
  const used = state.pops.map(p => p.door);
  const free = [];
  for (let i = 0; i < cfg.doors; ++i) if (!used.includes(i)) free.push(i);
  if (!free.length) return;
  const door = free[Math.floor(Math.random() * free.length)];
  // Count current Berthas on screen
  const currentBerthas = state.pops.filter(p => p.type === "bertha").length;
  // Only spawn Bertha if berthaLeft > 0 and total spawned < 11
  let type, img, decoyIdx;
  if (state.berthaLeft > 0 && (Math.random() < 0.5 || state.berthaLeft + currentBerthas >= cfg.berthaAppearances)) {
    type = "bertha";
    img = cfg.msBerthaImg;
    state.berthaLeft--;
  } else {
    type = "decoy";
    decoyIdx = Math.floor(Math.random() * cfg.decoyImages.length);
    img = cfg.decoyImages[decoyIdx];
  }
  const dur = Math.random() * (cfg.popMax - cfg.popMin) + cfg.popMin;
  state.pops.push({ type, img, door, time: 0, dur, decoyIdx });
}

// ========== INPUT ==========
// Hide the default mouse cursor on the canvas and use hammer.png as the custom cursor
canvas.style.cursor = 'none';

canvas.addEventListener("pointerdown", e => {
  if (!state.running) { startGame(); return; }
  const { x, y } = toLocal(e);
  whackAt(x, y);
  state.hammer.down = true;
  state.hammer.anim = 0.18;
});
canvas.addEventListener("pointerup", () => {
  state.hammer.down = false;
});
// Ensure hammer position follows mouse at all times
canvas.addEventListener("pointermove", e => {
  const { x, y } = toLocal(e);
  state.hammer.x = x;
  state.hammer.y = y;
});
window.addEventListener("keydown", e => {
  const k = e.key.toLowerCase();
  if (k === " ") { e.preventDefault(); togglePause(); }
  if (k === "r") resetGame();
});
btnStart.addEventListener("click", startGame);
btnPause.addEventListener("click", togglePause);
btnReset.addEventListener("click", resetGame);

// ========== WHACK LOGIC ==========
function whackAt(px, py) {
  // Topmost pop under pointer
  for (let i = state.pops.length - 1; i >= 0; i--) {
    const p = state.pops[i];
    const { x, y, w, h } = doorRect(p.door);
    if (px >= x && px <= x + w && py >= y && py <= y + h) {
      if (p.type === "bertha") {
        onHitBertha(p);
      } else {
        onHitDecoy(p);
      }
      state.pops.splice(i, 1);
      return;
    }
  }
}

function onHitBertha(p) {
  state.score += cfg.berthaPoints;
  state.shake = 18;
  spawnConfetti(p.door);
  playCelebrationSound();
  updateHUD();
  if (state.score >= cfg.rentGoal) {
    endGame();
  }
}

function onHitDecoy(p) {
  state.strikes++;
  state.redXTimer = 0.7;
  playLoseSound();
  updateHUD();
  if (state.strikes >= cfg.strikeMax) {
    endGame();
  }
}

// ========== CONFETTI ==========
function spawnConfetti(doorIdx) {
  const { x, y, w } = doorRect(doorIdx);
  for (let i = 0; i < 32; ++i) {
    const a = Math.random() * Math.PI * 2;
    const s = 180 + Math.random() * 120;
    state.confetti.push({
      x: x + w / 2, y: y + 10,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - 120,
      ay: 420,
      life: 0.8 + Math.random() * 0.5,
      color: randomConfettiColor(),
    });
  }
}
function updateConfetti(dt) {
  for (let i = state.confetti.length - 1; i >= 0; --i) {
    const p = state.confetti[i];
    p.vy += p.ay * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) state.confetti.splice(i, 1);
  }
}
function randomConfettiColor() {
  const palette = ["#7cc3ff", "#72ffa6", "#ffd166", "#ff82c9", "#9afff1"];
  return palette[Math.floor(Math.random() * palette.length)];
}

// ========== SOUNDS ==========
function playCelebrationSound() {
  beep(540, 0.09, "square", 0.32);
  setTimeout(() => beep(820, 0.13, "triangle", 0.22), 60);
  setTimeout(() => beep(660, 0.09, "square", 0.22), 140);
  setTimeout(() => beep(1000, 0.11, "triangle", 0.18), 220);
}
function playLoseSound() {
  beep(180, 0.13, "sine", 0.22);
}
function beep(f = 440, d = 0.08, type = "sine", v = 0.35) {
  if (state.muted) return;
  if (!window.AudioContext && !window.webkitAudioContext) return;
  const ACtx = window.AudioContext || window.webkitAudioContext;
  const ac = beep._ac || (beep._ac = new ACtx());
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type; o.frequency.value = f; g.gain.value = v;
  o.connect(g); g.connect(ac.destination);
  const t = ac.currentTime; o.start(t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.stop(t + d + 0.05);
}

// ========== DRAWING ==========
function draw() {
  ctx.save();
  // Screen shake
  if (state.shake > 0) {
    ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
  }
  // Backdrop
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();
  drawPops();
  drawConfetti();
  if (state.redXTimer > 0) drawRedX();
  ctx.restore();
  drawHammer();
  if (!state.running) drawOverlay();
  else if (state.paused) drawPause();
}

function drawGrid() {
  for (let i = 0; i < cfg.doors; ++i) {
    const { x, y, w, h } = doorRect(i);
    // Draw a wooden door with panels and a knob
    ctx.save();
    // Door base (wood color)
    const woodGrad = ctx.createLinearGradient(x, y, x + w, y + h);
    woodGrad.addColorStop(0, '#a97c50');
    woodGrad.addColorStop(0.5, '#c9a06c');
    woodGrad.addColorStop(1, '#7a5432');
    ctx.fillStyle = woodGrad;
    roundRect(ctx, x, y, w, h, 16, true, false);
    // Door border
    ctx.strokeStyle = '#5a3a1a';
    ctx.lineWidth = 3;
    roundRect(ctx, x, y, w, h, 16, false, true);
    // Door panels
    ctx.strokeStyle = '#d2b48c';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 18, y + 18, w - 36, 38);
    ctx.strokeRect(x + 18, y + h - 18 - 38, w - 36, 38);
    // Door knob
    ctx.beginPath();
    ctx.arc(x + w - 22, y + h / 2, 7, 0, 2 * Math.PI);
    ctx.fillStyle = '#e2c16b';
    ctx.shadowColor = '#bfa23a';
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.shadowBlur = 0;
    // Apartment number
    ctx.font = 'bold 15px ui-sans-serif';
    ctx.fillStyle = '#fffbe6';
    ctx.textAlign = 'center';
    ctx.fillText('Apt ' + (i + 1), x + w / 2, y + 32);
    ctx.restore();
  }
}

function drawPops() {
  for (const p of state.pops) {
    const { x, y, w, h } = doorRect(p.door);
    // Pop up animation: only up to the top of the door
    const t = Math.min(1, p.time / 180);
    // Instead of popping above, only pop from bottom to top edge
    const popY = y + h - h * t;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    ctx.rect(x, y, w, h); // Clip to door area
    ctx.clip();
    if (p.img && p.img.complete && p.img.naturalWidth > 0) {
      ctx.drawImage(p.img, x + 4, popY, w - 8, h * 0.7);
    } else {
      ctx.fillStyle = p.type === 'bertha' ? '#ff6b6b' : '#7cc3ff';
      ctx.fillRect(x + 4, popY, w - 8, h * 0.7);
    }
    ctx.restore();
  }
}

function drawConfetti() {
  for (const p of state.confetti) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, 3, 7);
    ctx.globalAlpha = 1;
  }
}

function drawRedX() {
  ctx.save();
  ctx.globalAlpha = cfg.redXAlpha;
  ctx.strokeStyle = "#ff2222";
  ctx.lineWidth = 22;
  ctx.beginPath();
  ctx.moveTo(60, 60);
  ctx.lineTo(canvas.width - 60, canvas.height - 60);
  ctx.moveTo(canvas.width - 60, 60);
  ctx.lineTo(60, canvas.height - 60);
  ctx.stroke();
  ctx.restore();
}

function drawHammer() {
  // Always draw hammer at mouse position, even if not clicking, even if game not running
  const { x, y, down } = state.hammer;
  ctx.save();
  ctx.globalAlpha = 0.98;
  ctx.translate(x, y);
  ctx.rotate(down ? 0.5 : 0);
  if (cfg.hammerImg && cfg.hammerImg.complete && cfg.hammerImg.naturalWidth > 0) {
    ctx.drawImage(cfg.hammerImg, -36, -36, 72, 72);
  } else {
    // Draw placeholder hammer
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(-24, -24, 48, 48);
    ctx.strokeStyle = '#222';
    ctx.strokeRect(-24, -24, 48, 48);
  }
  ctx.restore();
}

function drawOverlay() {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.45)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#e8eefc"; ctx.textAlign = "center";
  ctx.font = "bold 32px ui-sans-serif";
  ctx.fillText("Whack-a-Bertha", canvas.width / 2, canvas.height * 0.35);
  ctx.font = "18px ui-sans-serif";
  ctx.fillText("Tap a door when Ms. Bertha pops out!", canvas.width / 2, canvas.height * 0.35 + 34);
  ctx.font = "bold 16px ui-sans-serif"; ctx.fillStyle = "#a7b5dd";
  ctx.fillText("Press ▶ Start • Space to Pause • R to Reset", canvas.width / 2, canvas.height * 0.35 + 62);
  ctx.restore();
}

function drawPause() {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#e8eefc"; ctx.textAlign = "center";
  ctx.font = "bold 26px ui-sans-serif";
  ctx.fillText("Paused", canvas.width / 2, canvas.height * 0.42);
  ctx.font = "16px ui-sans-serif"; ctx.fillStyle = "#a7b5dd";
  ctx.fillText("Press Space to Resume", canvas.width / 2, canvas.height * 0.42 + 26);
  ctx.restore();
}

function updateHUD() {
  dScore.textContent = state.score;
  dGoal.textContent = cfg.rentGoal;
  dStrikes.textContent = state.strikes;
  dTime.textContent = Math.ceil(state.timeLeft);
}

function updateHammer(dt) {
  if (state.hammer.down) {
    state.hammer.anim -= dt;
    if (state.hammer.anim <= 0) state.hammer.down = false;
  }
}

// ========== UTILS ==========
// Guarantee all 8 doors are visible by scaling door size to fit canvas
function doorRect(idx) {
  const W = canvas.width, H = canvas.height;
  const cols = cfg.cols, rows = cfg.rows;
  const pad = 22, margin = 0;
  // Compute max door size to fit grid exactly edge-to-edge
  const doorW = (W - pad * (cols - 1)) / cols;
  const doorH = (H - pad * (rows - 1)) / rows;
  const row = Math.floor(idx / cols);
  const col = idx % cols;
  const x = col * (doorW + pad);
  const y = row * (doorH + pad);
  return { x, y, w: doorW, h: doorH };
}
function toLocal(e) {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width * canvas.width;
  const y = (e.clientY - rect.top) / rect.height * canvas.height;
  return { x, y };
}
function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  if (w < 2 * r) r = w / 2; if (h < 2 * r) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  if (fill) ctx.fill(); if (stroke) ctx.stroke();
}

// ========== RESIZE ==========
// Responsive canvas sizing: always fill container, max 900x560, always fit all doors
function resize() {
  // Set canvas CSS width to 100% of parent, max 900px
  canvas.style.width = '100%';
  canvas.style.height = 'auto';
  // Wait for browser to apply CSS, then get actual rendered size
  setTimeout(() => {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
  }, 0);
}
window.addEventListener("resize", resize);
document.addEventListener("DOMContentLoaded", resize);

// ========== INIT ==========
(async function init() {
  await loadAssets();
  resetGame();
  resize();
})();

// Add mute button logic
const btnMute = document.getElementById("btnMute");
if (btnMute) {
  btnMute.addEventListener("click", toggleMute);
}
function toggleMute() {
  state.muted = !state.muted;
  if (btnMute) btnMute.textContent = state.muted ? "🔇 Sound: Off" : "🔊 Sound: On";
  if (!state.muted) beep(720, .05, "triangle", 0.22);
}
