(() => {
  // ===== GAME CONFIG =====
  const cfg = {
    rows: 2,
    cols: 4,
    gridPadding: 40,
    doorW: 120,
    doorH: 180,
    popBase: 1000,      // ms visible early
    popMin: 550,        // ms visible late
    spawnBase: 650,     // ms between spawns early
    spawnMin: 320,      // ms late
    maxConcurrentBase: 2,
    maxConcurrentLate: 4,
    gameTime: 30,       // seconds
    scores: { bertha: 10 },
    strikeOnExpireBertha: 1,
    strikeOnWrong: 1,
    strikeMax: 3,
    rentGoal: 100,
    berthaPops: 11, // Ms Bertha appears 11 times
    hitConfetti: 30,
    worldShakeOnMiss: 6
  };

  // Character image mapping
  const characterImages = {
    bertha: 'ms bertha.png',
    character21: 'character 21.png',
    character27: 'character 27.png',
    character31: 'character 31.png',
    character37: 'character 37.png',
  };

  // Preload images
  const images = {};
  for (const [key, src] of Object.entries(characterImages)) {
    if (src) {
      const img = new window.Image();
      img.src = src;
      images[key] = img;
    }
  }
  // Hammer image
  const hammerImg = new window.Image();
  hammerImg.src = 'hammer.png';

  // ===== DOM =====
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const dScore  = document.getElementById("score");
  const dBest   = document.getElementById("best");
  const dStrk   = document.getElementById("strikes");
  const dTime   = document.getElementById("time");
  const dStreak = document.getElementById("streak");
  const dGoalNow= document.getElementById("goalNow");
  const dGoalMax= document.getElementById("goalMax");
  const dGoalFill= document.getElementById("goalFill");
  const btnStart= document.getElementById("btnStart");
  const btnPause= document.getElementById("btnPause");
  const btnReset= document.getElementById("btnReset");
  const btnMute = document.getElementById("btnMute");
  const strikeX = document.getElementById("strikeX");

  dGoalMax.textContent = cfg.rentGoal;
  let best = Number(localStorage.getItem("berthaknockout_best")||0);
  dBest.textContent = best;

  // ===== STATE =====
  const state = {
    running:false, paused:false,
    lastT:0, timeLeft:cfg.gameTime, worldShake:0,
    score:0, goal:0, strikes:0, streak:0,
    grid: [], pops: [], particles: [],
    nextSpawn: 0.6, spawnTimer: 0,
    muted:false,
    mouse: {x:0, y:0, down:false, anim:0},
    berthaPopCount: 0,
    berthaPopSchedule: [],
  };

  // ===== AUDIO (WebAudio, no files) =====
  const AudioKit = (() => {
    const ACtx = window.AudioContext || window.webkitAudioContext;
    const ac = new ACtx();
    const out = ac.createGain(); out.gain.value = 0.25; out.connect(ac.destination);
    const beep = (f=440,d=0.08,type="sine",v=0.35) => {
      if (state.muted) return;
      const o = ac.createOscillator(); const g = ac.createGain();
      o.type = type; o.frequency.value = f; g.gain.value = v;
      o.connect(g); g.connect(out);
      const t = ac.currentTime; o.start(t);
      g.gain.exponentialRampToValueAtTime(0.0001, t+d);
      o.stop(t+d+0.05);
    };
    return { ac, beep };
  })();

  // ===== INPUT =====
  canvas.addEventListener("pointerdown", e => {
    state.mouse.down = true;
    state.mouse.anim = 1;
    if (!state.running) { startGame(); return; }
    const {x,y} = toLocal(e);
    whackAt(x,y);
  });
  canvas.addEventListener("pointerup", e => {
    state.mouse.down = false;
  });
  canvas.addEventListener("pointermove", e => {
    const {x, y} = toLocal(e);
    state.mouse.x = x;
    state.mouse.y = y;
    e.preventDefault();
  }, {passive:false});

  window.addEventListener("keydown", e=>{
    const k = e.key.toLowerCase();
    if (k===" ") { e.preventDefault(); togglePause(); }
    if (k==="r") resetGame();
    if (k==="m") toggleMute();
  });

  btnStart.addEventListener("click", startGame);
  btnPause.addEventListener("click", togglePause);
  btnReset.addEventListener("click", resetGame);
  btnMute.addEventListener("click", toggleMute);

  function toggleMute(){
    state.muted = !state.muted;
    btnMute.textContent = state.muted ? "🔇 Sound: Off" : "🔊 Sound: On";
    if (!state.muted) AudioKit.beep(720,.05,"triangle",0.22);
  }

  // ===== WORLD SETUP =====
  function resetGame(){
    state.running = false; state.paused=false;
    state.lastT = 0; state.timeLeft = cfg.gameTime; state.worldShake = 0;
    state.score = 0; state.goal = 0; state.strikes = 0; state.streak = 0;
    state.pops = []; state.particles = [];
    state.spawnTimer = 0; state.nextSpawn = 0.6;
    state.berthaPopCount = 0;
    state.berthaPopSchedule = generateBerthaPopSchedule(cfg.berthaPops, cfg.gameTime);
    buildGrid();
    updateHUD();
    draw(0);
  }
  function startGame(){
    if (state.running) return;
    state.running = true; state.paused = false;
    state.lastT = performance.now();
    requestAnimationFrame(loop);
  }
  function togglePause(){
    if (!state.running) return;
    state.paused = !state.paused;
    if (!state.paused) { state.lastT = performance.now(); requestAnimationFrame(loop); }
  }

  function buildGrid(){
    const W = canvas.width, H = canvas.height;
    const pad = cfg.gridPadding;
    const usableW = W - pad*2;
    // Reduce vertical spacing between rows for closer doors
    const usableH = H - pad*2 - 40; // was -80, now -40 for closer rows
    const cellW = usableW / cfg.cols;
    const cellH = usableH / cfg.rows;

    state.grid = [];
    for (let r=0;r<cfg.rows;r++){
      for (let c=0;c<cfg.cols;c++){
        const cx = pad + c*cellW + cellW/2;
        const cy = pad + 60 + r*cellH + cellH/2; // was +100, now +60 for closer rows
        state.grid.push({cx,cy,w:cfg.doorW,h:cfg.doorH, idx:r*cfg.cols+c});
      }
    }
  }

  // ===== GAME LOOP =====
  function loop(t){
    if (!state.running || state.paused) return;
    const dt = Math.min(0.025, Math.max(0, (t - state.lastT)/1000));
    state.lastT = t;

    state.timeLeft = Math.max(0, state.timeLeft - dt);
    if (state.timeLeft === 0){
      endRound();
      draw(dt);
      return;
    }

    spawnLogic(dt);
    updatePops(dt);
    updateParticles(dt);

    state.worldShake *= 0.9;
    if (state.mouse.anim > 0) state.mouse.anim -= dt * 6;
    draw(dt);

    requestAnimationFrame(loop);
  }

  // ===== SPAWNING / DIFFICULTY =====
  function generateBerthaPopSchedule(count, duration) {
    // Spread 11 pops randomly but evenly over the game duration
    const slots = Array.from({length: count}, (_, i) => (i + Math.random()) * (duration / count));
    return slots.sort((a, b) => a - b);
  }

  function activeWeights(){
    // Only non-Bertha characters for random spawns
    return {
      character21: 1,
      character27: 1,
      character31: 1,
      character37: 1,
    };
  }
  function currentSpawnInterval(){
    return 700;
  }
  function currentPopDuration(){
    return 900;
  }
  function currentMaxConcurrent(){
    return 3;
  }

  function spawnLogic(dt){
    state.spawnTimer += dt*1000;
    // Ms Bertha scheduled pops
    const elapsed = cfg.gameTime - state.timeLeft;
    while (state.berthaPopSchedule.length && elapsed >= state.berthaPopSchedule[0] && state.berthaPopCount < cfg.berthaPops) {
      // Find a free hole
      const free = state.grid.filter(h => !state.pops.some(p => p.hole.idx===h.idx));
      if (free.length) {
        const hole = free[Math.floor(Math.random()*free.length)];
        state.pops.push({
          hole, type: 'bertha', born: performance.now(), dur: currentPopDuration(),
          hit:false, yOffset: 0, excuse: randomExcuse()
        });
        state.berthaPopCount++;
      }
      state.berthaPopSchedule.shift();
    }
    // Other characters
    const want = currentMaxConcurrent();
    if (state.pops.length < want && state.spawnTimer >= currentSpawnInterval()){
      state.spawnTimer = 0;
      // choose a free hole
      const free = state.grid.filter(h => !state.pops.some(p => p.hole.idx===h.idx));
      if (free.length){
        const hole = free[Math.floor(Math.random()*free.length)];
        const t = weightedPick(activeWeights());
        state.pops.push({
          hole, type: t, born: performance.now(), dur: currentPopDuration(),
          hit:false, yOffset: 0, excuse: ''
        });
      }
    }
  }

  // ===== POP UPDATE =====
  function updatePops(dt){
    const now = performance.now();
    for (let i=state.pops.length-1;i>=0;i--){
      const p = state.pops[i];
      const life = now - p.born;
      // simple ease animation for appearing/vanishing
      const t = life / p.dur;
      p.yOffset = Math.sin(Math.min(1,t) * Math.PI) * -16;

      if (life >= p.dur){
        // expired unharmed
        if (!p.hit && p.type === "bertha"){
          addStrikes(cfg.strikeOnExpireBertha);
          flash();
          AudioKit.beep(220,.06,"sine",0.18);
        }
        state.pops.splice(i,1);
      }
    }
  }

  // ===== CLICK / WHACK =====
  function whackAt(px, py){
    // find topmost active pop under pointer
    for (let i=state.pops.length-1;i>=0;i--){
      const p = state.pops[i];
      const h = p.hole;
      if (pointInDoor(px, py, h)){
        // whacked this pop
        if (!p.hit){
          p.hit = true;
          if (p.type === "bertha"){
            onHitBertha(p);
          } else {
            onWrong(p);
          }
        }
        return;
      }
    }
    // clicked empty: no penalty
  }

  function showStrikeX() {
    strikeX.innerHTML = '<svg width="100%" height="100%" viewBox="0 0 400 400" style="position:absolute;top:0;left:0;"><line x1="40" y1="40" x2="360" y2="360" stroke="#ff2222" stroke-width="60" stroke-linecap="round" opacity="0.35"/><line x1="360" y1="40" x2="40" y2="360" stroke="#ff2222" stroke-width="60" stroke-linecap="round" opacity="0.35"/></svg>';
    strikeX.style.display = 'block';
    setTimeout(() => { strikeX.style.display = 'none'; }, 600);
  }

  function onHitBertha(p){
    const gain = cfg.scores.bertha;
    state.score += gain;
    state.goal  += gain;
    state.streak += 1;
    if (state.score > best){ best = state.score; localStorage.setItem("berthaknockout_best", String(best)); dBest.textContent = best; }
    // Celebration sound: two-tone + confetti burst
    AudioKit.beep(720,.09,"triangle",0.32);
    setTimeout(()=>AudioKit.beep(1040,.13,"square",0.28),60);
    setTimeout(()=>AudioKit.beep(540,.07,"triangle",0.18),120);
    spawnConfetti(p.hole.cx, p.hole.cy- p.h/2, cfg.hitConfetti+20);
    textPop(p.hole.cx, p.hole.cy- p.h/2 - 24, p.excuse, "#72ffa6");
    state.worldShake += 18; // Add strong screen shake
    // remove pop immediately after hit
    removePop(p);
    updateHUD();
    if (state.goal >= cfg.rentGoal){ endRound(); }
  }

  function onWrong(p){
    addStrikes(cfg.strikeOnWrong);
    state.streak = 0;
    flash();
    // Losing sound: low buzzer
    AudioKit.beep(120,.18,"sawtooth",0.32);
    setTimeout(()=>AudioKit.beep(80,.12,"sine",0.22),80);
    showStrikeX();
    textPop(p.hole.cx, p.hole.cy- p.h/2 - 24, "Oops!", "#ff6b6b");
    removePop(p);
    updateHUD();
  }

  function addStrikes(n){
    state.strikes += n;
    state.worldShake += cfg.worldShakeOnMiss;
    if (state.strikes >= cfg.strikeMax){
      state.strikes = cfg.strikeMax;
      endRound();
    }
  }

  function removePop(pop){
    const idx = state.pops.indexOf(pop);
    if (idx>=0) state.pops.splice(idx,1);
  }

  // ===== PARTICLES / TEXT =====
  function spawnConfetti(x,y,n=60){
    for (let i=0;i<n;i++){
      const a = Math.random()*Math.PI*2;
      const s = 220 + Math.random()*320;
      state.particles.push({
        x, y,
        vx: Math.cos(a)*s,
        vy: Math.sin(a)*s - 180,
        ax: 0, ay: 980,
        life: 0.8 + Math.random()*0.6,
        size: 2 + Math.random()*3,
        color: randomConfetti()
      });
    }
  }
  function textPop(x,y, txt, color="#fff"){
    state.particles.push({
      x, y, vx:0, vy:-40, ax:0, ay:0,
      life: 0.9, text: txt, color, size:0
    });
  }
  function updateParticles(dt){
    for (let i=state.particles.length-1;i>=0;i--){
      const p = state.particles[i];
      p.vx += (p.ax||0)*dt; p.vy += (p.ay||0)*dt;
      p.x += p.vx*dt; p.y += p.vy*dt;
      p.life -= dt;
      if (p.life <= 0) state.particles.splice(i,1);
    }
  }

  // ===== END ROUND =====
  function endRound(){
    state.running = false; state.paused = false;
    const win = state.goal >= cfg.rentGoal && state.strikes < cfg.strikeMax;
    for (let i=0;i<(win?160:60);i++){
      state.particles.push({
        x: canvas.width/2, y: canvas.height*0.25,
        vx: (Math.random()*2-1)*(win?320:160),
        vy: (Math.random()*2-1)*(win?320:120),
        ax: 0, ay: 980,
        life: .9+Math.random()*.8,
        size: 2+Math.random()*3,
        color: win ? randomConfetti() : "#ff6b6b"
      });
    }
    draw(0);
  }

  // ===== RENDER =====
  function draw(){
    const shakeX = (Math.random()*2-1)*state.worldShake;
    const shakeY = (Math.random()*2-1)*state.worldShake;

    ctx.save();
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.translate(shakeX,shakeY);

    drawBackdrop();
    drawBanner();
    drawGrid();
    drawPops();
    drawParticles();
    drawHammer();

    if (!state.running){
      drawOverlay();
    } else if (state.paused){
      drawPause();
    }

    ctx.restore();
  }

  function drawBackdrop(){
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#2e2e2e';
    ctx.fillRect(0,0,W,H);
    // Whack-a-mole style holes
    for (const d of state.grid) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(d.cx, d.cy+cfg.doorH/4, cfg.doorW/2.2, 18, 0, 0, Math.PI*2);
      ctx.fillStyle = '#181818';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 16;
      ctx.fill();
      ctx.restore();
    }
  }

  function drawBanner(){
    const cx = canvas.width/2, y = 60;
    ctx.fillStyle = "#2a2f57"; roundRect(ctx, cx-170, y-28, 340, 46, 12, true, false);
    ctx.strokeStyle = "#4152a0"; ctx.lineWidth = 2; roundRect(ctx, cx-170, y-28, 340, 46, 12, false, true);
    ctx.font = "bold 18px ui-sans-serif"; ctx.fillStyle = "#e8eefc"; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText("Bertha's Hallway — Whack her with excuses!", cx, y-6);
    ctx.font = "24px system-ui, apple color emoji, segoe ui emoji";
    ctx.fillText("🔨", cx+144, y-6);
  }

  function drawGrid(){
    for (const d of state.grid){
      ctx.save();
      const x = d.cx - cfg.doorW/2, y = d.cy - cfg.doorH/2;
      // Draw door frame
      ctx.fillStyle = "#5a3e1b";
      roundRect(ctx, x-8, y-8, cfg.doorW+16, cfg.doorH+16, 18, true, false);
      // Draw door panel (wood)
      const g = ctx.createLinearGradient(x, y, x, y+cfg.doorH);
      g.addColorStop(0,"#b88c4a"); g.addColorStop(1,"#7a5523");
      ctx.fillStyle = g;
      roundRect(ctx, x, y, cfg.doorW, cfg.doorH, 14, true, false);
      ctx.strokeStyle = "#e2c28b"; ctx.lineWidth = 3;
      roundRect(ctx, x, y, cfg.doorW, cfg.doorH, 14, false, true);
      // Door knob
      ctx.beginPath();
      ctx.arc(x+cfg.doorW-18, y+cfg.doorH/2, 8, 0, Math.PI*2);
      ctx.fillStyle = "#e2c28b";
      ctx.fill();
      // Apt number
      ctx.font="bold 16px ui-sans-serif"; ctx.fillStyle="#fffbe6"; ctx.textAlign="center";
      ctx.fillText("Apt "+(d.idx+1), d.cx, y+22);
      ctx.restore();
    }
  }

  function drawPops(){
    const now = performance.now();
    for (const p of state.pops){
      const h = p.hole;
      const life = (now - p.born) / p.dur;
      const t = Math.min(1, life);
      const y = h.cy - cfg.doorH/2 + 18 + p.yOffset;
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.75*Math.sin(t*Math.PI);
      // Draw character image
      let img = images[p.type];
      if (img && img.complete) {
        ctx.drawImage(img, h.cx-cfg.doorW/2+12, y, cfg.doorW-24, cfg.doorH/2+18);
      } else {
        // fallback: colored circle
        ctx.beginPath();
        ctx.arc(h.cx, y+40, 32, 0, Math.PI*2);
        ctx.fillStyle = '#fff';
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawParticles(){
    for (const p of state.particles){
      if (p.text){
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.font = "bold 16px ui-sans-serif";
        ctx.textAlign="center"; ctx.textBaseline="middle";
        ctx.fillText(p.text, p.x, p.y);
        ctx.globalAlpha = 1;
      } else {
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size*1.6);
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawHammer(){
    if (!hammerImg.complete) return;
    const {x, y, down, anim} = state.mouse;
    const size = 64;
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.translate(x, y);
    ctx.rotate(down || anim > 0.2 ? Math.PI/5 : -Math.PI/12);
    ctx.drawImage(hammerImg, -size/2, -size/2, size, size);
    ctx.restore();
  }

  function drawOverlay(){
    const W = canvas.width, H = canvas.height;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.45)";
    ctx.fillRect(0,0,W,H);
    ctx.fillStyle = "#e8eefc"; ctx.textAlign="center";
    ctx.font = "bold 28px ui-sans-serif";
    const win = state.goal >= cfg.rentGoal && state.strikes < cfg.strikeMax;
    ctx.fillText(!state.lastT ? "Bertha Knockout" : (win ? "🏆 Rent Paid!" : "Game Over"), W/2, H*0.35);
    ctx.font = "18px ui-sans-serif";
    const msg = !state.lastT
      ? "Tap/click the doors when Ms. Bertha pops out to whack her with the hammer! Hitting any other character is a strike. Reach 100 points before 30 seconds runs out!"
      : (win ? "You paid the rent!" : "Too many strikes or time ran out.");
    ctx.fillText(msg, W/2, H*0.35 + 34);
    ctx.font = "bold 16px ui-sans-serif"; ctx.fillStyle="#a7b5dd";
    ctx.fillText("Press ▶ Start • Space to Pause • R to Reset", W/2, H*0.35 + 62);
    ctx.restore();
  }

  function drawPause(){
    const W = canvas.width, H = canvas.height;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(0,0,W,H);
    ctx.fillStyle = "#e8eefc"; ctx.textAlign="center";
    ctx.font = "bold 26px ui-sans-serif";
    ctx.fillText("Paused", W/2, H*0.42);
    ctx.font = "16px ui-sans-serif"; ctx.fillStyle="#a7b5dd";
    ctx.fillText("Press Space to Resume", W/2, H*0.42 + 26);
    ctx.restore();
  }

  // ===== UTIL DRAW =====
  function roundRect(ctx, x, y, w, h, r, fill=false, stroke=true){
    if (w < 2*r) r = w/2; if (h < 2*r) r = h/2;
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y,   x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x,   y+h, r);
    ctx.arcTo(x,   y+h, x,   y,   r);
    ctx.arcTo(x,   y,   x+w, y,   r);
    if (fill) ctx.fill(); if (stroke) ctx.stroke();
  }

  function pointInDoor(px, py, door){
    const x = door.cx - cfg.doorW/2, y = door.cy - cfg.doorH/2;
    return (px >= x && px <= x+cfg.doorW && py >= y && py <= y+cfg.doorH);
  }

  function toLocal(e){
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * canvas.width;
    const y = (e.clientY - rect.top)  / rect.height * canvas.height;
    return {x,y};
  }

  function randomConfetti(){
    const palette = ["#7cc3ff","#72ffa6","#ffd166","#ff82c9","#9afff1"];
    return palette[Math.floor(Math.random()*palette.length)];
  }
  function weightedPick(weights){
    let total = 0; for (const k in weights) total += weights[k];
    let r = Math.random()*total;
    for (const k in weights){ r -= weights[k]; if (r<=0) return k; }
    return Object.keys(weights)[0];
  }
  function randomExcuse(){
    const list = [
      "Cookies!", "Flowers!", "Receipt!", "Plumber!", "Not home!",
      "Car trouble!", "Paycheck soon!", "Bank error!"
    ];
    return list[Math.floor(Math.random()*list.length)];
  }

  function flash(){ state.worldShake += cfg.worldShakeOnMiss; }

  // ===== HUD / RESIZE =====
  function updateHUD(){
    dScore.textContent = state.score;
    dGoalNow.textContent = state.goal;
    dStreak.textContent = state.streak;
    dStrk.textContent = state.strikes;
    dTime.textContent = Math.ceil(state.timeLeft);
    const pct = Math.max(0, Math.min(100, (state.goal/cfg.rentGoal)*100));
    dGoalFill.style.width = pct + "%";
  }

  function resize(){
    const targetW = Math.min(820, Math.floor(window.innerWidth - 28));
    const targetH = Math.floor(targetW * (4/3)); // 3:4 aspect
    const ratio = window.devicePixelRatio || 1;
    canvas.style.width = targetW + "px";
    canvas.style.height = targetH + "px";
    canvas.width = Math.floor(targetW * ratio);
    canvas.height = Math.floor(targetH * ratio);
    ctx.setTransform(ratio,0,0,ratio,0,0);
    buildGrid();
    draw(0);
  }
  window.addEventListener("resize", resize);

  // ===== STARTUP =====
  resetGame();
  resize();

})();
