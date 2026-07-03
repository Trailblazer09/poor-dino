/* ==========================================================================
   Poor Dino  —  a richer take on the Chrome dino runner.
   Signature mechanic: the dino pops a parachute for the brief moment it lands.
   Everything is drawn procedurally on a canvas — no external image assets.
   ========================================================================== */
(() => {
  "use strict";

  // ----- Canvas & responsive world -----------------------------------------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const wrap = document.getElementById("game-wrap");

  const WORLD_H = 320;         // fixed logical height; width flexes with screen
  const GROUND_OFFSET = 66;    // ground line distance from bottom
  const view = { scale: 1, w: 1200, h: WORLD_H };
  let groundY = WORLD_H - GROUND_OFFSET;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = wrap.clientWidth;
    const cssH = wrap.clientHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    // Height drives the scale, but guarantee a minimum visible world width so
    // tall/portrait phones aren't zoomed in so far you can't see obstacles.
    // The ground is then anchored to the bottom and the sky fills upward.
    const MIN_VIEW_W = 470;
    let scale = canvas.height / WORLD_H;
    if (canvas.width / scale < MIN_VIEW_W) scale = canvas.width / MIN_VIEW_W;
    view.scale = scale;
    view.w = canvas.width / scale;
    view.h = canvas.height / scale;
    // On tall/portrait screens raise the ground off the very bottom so the
    // action sits higher (≈⅔ down) with textured foreground below it.
    let gOff = GROUND_OFFSET;
    if (view.h > WORLD_H * 1.25) gOff = view.h * 0.34;
    groundY = view.h - gOff;
    if (dino.onGround) dino.y = groundY;   // keep feet planted across resizes
  }
  window.addEventListener("resize", resize);

  // ----- Sound (tiny WebAudio blips) ---------------------------------------
  const sound = {
    ctx: null,
    muted: localStorage.getItem("bd_muted") === "1",
    ensure() {
      if (!this.ctx) {
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (e) { /* no audio */ }
      }
      if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    },
    blip(freq, dur, type = "sine", vol = 0.16, slide = 0) {
      if (this.muted || !this.ctx) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ctx.destination);
      o.start(t);
      o.stop(t + dur);
    },
    jump() { this.blip(520, 0.16, "square", 0.12, 260); },
    land() { this.blip(300, 0.22, "sine", 0.14, -140); this.blip(180, 0.18, "triangle", 0.08); },
    point() { this.blip(880, 0.09, "square", 0.09); },
    hit() { this.blip(160, 0.5, "sawtooth", 0.2, -110); },
    double() { this.blip(660, 0.12, "square", 0.12, 240); this.blip(1000, 0.16, "square", 0.1, 180); },
    pickup() { this.blip(660, 0.1, "sine", 0.14, 220); this.blip(880, 0.12, "sine", 0.12, 220); this.blip(1180, 0.14, "sine", 0.1); },
    whistle() { this.blip(1400, 0.55, "sine", 0.1, -1100); },
    boom() {
      if (this.muted || !this.ctx) return;
      const t = this.ctx.currentTime;
      const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuffer(1.2);
      const f = this.ctx.createBiquadFilter(); f.type = "lowpass";
      f.frequency.setValueAtTime(700, t); f.frequency.exponentialRampToValueAtTime(70, t + 0.9);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.6, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      src.connect(f).connect(g).connect(this.ctx.destination);
      src.start(t); src.stop(t + 1.2);
      this.blip(120, 0.4, "sawtooth", 0.28, -70);
    },

    // --- storm ---
    rainNodes: null,
    noiseBuffer(sec) {
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * sec, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    },
    startRain() {
      if (!this.ctx) return;
      this.stopRain(true);
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer(2); src.loop = true;
      const f = this.ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1500;
      const g = this.ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(this.ctx.destination);
      src.start();
      this.rainNodes = { src, g };
    },
    setRainVolume(v) {
      if (this.rainNodes) this.rainNodes.g.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.2);
    },
    stopRain(immediate) {
      if (!this.rainNodes) return;
      const n = this.rainNodes; this.rainNodes = null;
      try {
        n.g.gain.setTargetAtTime(0, this.ctx.currentTime, immediate ? 0.05 : 0.4);
        const stopAt = this.ctx.currentTime + (immediate ? 0.1 : 1);
        n.src.stop(stopAt);
      } catch (e) { /* already stopped */ }
    },
    thunder() {
      if (this.muted || !this.ctx) return;
      const t = this.ctx.currentTime;
      // low rolling rumble
      const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuffer(1.4);
      const f = this.ctx.createBiquadFilter(); f.type = "lowpass";
      f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(90, t + 1.1);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.55, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
      src.connect(f).connect(g).connect(this.ctx.destination);
      src.start(t); src.stop(t + 1.4);
      // sharp crack on top
      this.blip(140, 0.35, "sawtooth", 0.28, -80);
    },
  };

  const muteBtn = document.getElementById("mute-btn");
  function refreshMute() {
    muteBtn.textContent = sound.muted ? "🔇" : "🔊";
    muteBtn.classList.toggle("off", sound.muted);
  }
  muteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    sound.muted = !sound.muted;
    localStorage.setItem("bd_muted", sound.muted ? "1" : "0");
    refreshMute();
    muteBtn.blur();   // so Space still jumps, not re-toggles mute
  });
  refreshMute();

  // ----- Game state ---------------------------------------------------------
  const STATE = { READY: 0, RUNNING: 1, OVER: 2 };
  let state = STATE.READY;

  const dino = {
    x: 130, y: groundY, vy: 0, w: 46, h: 52,
    onGround: true, duck: false,
    runPhase: 0,
    parachute: 0,      // 0..1 canopy openness
    inflate: 0,        // 0..1 how full of air the canopy is (billow)
    squeeze: 0,        // 0..1 collapsing/pinch as it nears the ground
    swingPhase: 0,     // pendulum rocking while hanging under the chute
    usedDouble: false, // spent the air double-jump this flight?
    landHold: 0,
    blink: 0,
    invuln: 0,         // frames of invulnerability after a hit
  };

  const MAX_LIVES = 3;
  let lives = MAX_LIVES;

  let speed = 6;
  const BASE_SPEED = 6;
  const MAX_SPEED = 14;
  const GRAVITY = 0.62;
  const JUMP_V = 13.6;

  let score = 0;
  let hi = parseInt(localStorage.getItem("bd_hi") || "0", 10);
  let obstacles = [];
  let clouds = [];
  let hills = [];
  let particles = [];
  let distanceToNext = 0;
  let dayTime = 0.15;         // 0..1 through day/night cycle
  let worldScroll = 0;        // for ground texture
  let shake = 0;

  // Opening storm
  const RAIN_FRAMES = 60 * 6.5;   // heavy rain lasts ~6.5s at the start
  let rainT = 0;                  // frames of storm remaining
  let rain = [];                  // raindrops
  let flash = 0;                  // lightning flash 0..1
  let thunderTimer = 0;           // frames until next thunder

  // Sarcastic quips + double-jump power vessel
  const QUIP_LINES = [
    "Dinosaurs are extinct — what are you doing here, Mr. Lonely Wolf?",
    "Running from the meteor... 66 million years too late.",
    "Nice parachute. Real dinos just accepted their fate.",
    "You do know there's no finish line, right?",
    "Cardio won't save you from extinction, buddy.",
    "A jumping lizard with a parachute. Very scientific.",
    "Keep going! The museum has a display spot ready for you.",
    "Still alive? Evolution is genuinely confused.",
    "That cactus has more purpose than you right now.",
    "Legend says the dino is still running to this day...",
    "Bold of you to out-jog a mass extinction event.",
  ];
  const FIRST_QUIP_SEC = 15;      // first taunt after 15s of gameplay
  const POWER_FILL_SEC = 20;      // vessel fills to full in 20s
  let playTime = 0;               // seconds of active gameplay
  let quips = [];                 // floating taunt banners
  let quipTimer = 0;              // seconds until next quip
  let power = 0;                  // 0..1 double-jump charge

  // Meteor event
  const FIRST_METEOR_SEC = 22;
  let meteor = null;              // { phase, t, tx, mx, my, vx, vy }
  let meteorTimer = 0;            // seconds until next meteor

  // Health-heart pickups (only appear once a life has been lost)
  let pickups = [];               // floating hearts
  let heartTimer = 0;            // seconds until next heart is eligible to spawn

  // Game-over flavor (fully client-side / serverless)
  const EPITAPHS = [
    "Gone, but still technically extinct.",
    "Died as he lived: in complete denial.",
    "He ran from a meteor and lost to a cactus.",
    "The parachute worked. The judgment did not.",
    "66 million years of evolution for THIS.",
    "He coped. He ran. He fumbled.",
    "Natural selection finally caught up.",
    "Here lies a dino too stubborn to stay a fossil.",
  ];
  function rankFor(s) {
    if (s < 150) return "Certified Fossil";
    if (s < 400) return "Extinction Denier";
    if (s < 800) return "Cardio Cryptid";
    if (s < 1400) return "Meteor Dodger";
    if (s < 2200) return "Apex Coper";
    return "Immortal Lizard of Denial";
  }
  let lastShareText = "";
  let lastCardURL = "";

  // ----- Helpers ------------------------------------------------------------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const pad5 = (n) => String(Math.floor(n)).padStart(5, "0");

  function mixColor(c1, c2, t) {
    return [
      Math.round(lerp(c1[0], c2[0], t)),
      Math.round(lerp(c1[1], c2[1], t)),
      Math.round(lerp(c1[2], c2[2], t)),
    ];
  }
  const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

  function reset() {
    dino.y = groundY; dino.vy = 0; dino.onGround = true; dino.duck = false;
    dino.parachute = 0; dino.inflate = 0; dino.squeeze = 0;
    dino.swingPhase = 0; dino.usedDouble = false;
    dino.landHold = 0; dino.runPhase = 0; dino.invuln = 0;
    lives = MAX_LIVES;
    speed = BASE_SPEED;
    score = 0;
    obstacles = [];
    particles = [];
    playTime = 0;
    quips = [];
    quipTimer = FIRST_QUIP_SEC;
    power = 0;
    meteor = null;
    meteorTimer = FIRST_METEOR_SEC;
    pickups = [];
    heartTimer = rand(7, 11);
    updatePowerUI();
    distanceToNext = 340;
    dayTime = rand(0, 1);
    shake = 0;
    // storm
    rainT = RAIN_FRAMES;
    flash = 0;
    thunderTimer = 8;           // first thunderclap almost immediately
    seedRain();
    seedScenery();
    updateHearts();
  }

  function seedRain() {
    rain = [];
    const n = Math.round(view.w / 4);   // dense
    for (let i = 0; i < n; i++) {
      rain.push({
        x: rand(-40, view.w + 40),
        y: rand(-view.h, groundY),
        len: rand(10, 20),
        sp: rand(11, 16),
      });
    }
  }

  function seedScenery() {
    clouds = [];
    for (let i = 0; i < 6; i++) {
      clouds.push({ x: rand(0, view.w + 400), y: rand(24, 120), s: rand(0.5, 1.2), spd: rand(0.15, 0.45) });
    }
    hills = [];
    for (let i = 0; i < 5; i++) {
      hills.push({ x: i * 320 + rand(-40, 40), r: rand(120, 220), h: rand(50, 95) });
    }
  }

  // ----- Spawning -----------------------------------------------------------
  function spawnObstacle() {
    const roll = Math.random();
    if (roll < 0.62) {
      // Cactus cluster
      const count = Math.random() < 0.35 ? 2 : 1;
      const groups = [];
      let gx = 0;
      for (let i = 0; i < count; i++) {
        const h = rand(38, 62);
        groups.push({ dx: gx, w: rand(16, 24), h });
        gx += rand(18, 26);
      }
      const totalW = gx + 22;
      obstacles.push({ type: "cactus", x: view.w + 40, w: totalW, h: 62, groups });
    } else {
      // Pterodactyl at low (jump) or high (duck) altitude
      const high = Math.random() < 0.5;
      const cy = high ? groundY - 78 : groundY - 30;
      obstacles.push({ type: "bird", x: view.w + 40, y: cy, w: 46, h: 30, wing: 0 });
    }
  }

  // ----- Input --------------------------------------------------------------
  function jump() {
    if (state !== STATE.RUNNING) return;
    if (dino.onGround) {
      dino.vy = -JUMP_V;
      dino.onGround = false;
      dino.duck = false;
      dino.usedDouble = false;
      dino.parachute = 0.3;      // pop open the instant the feet leave the ground
      dino.inflate = 0.25;
      dino.squeeze = 0;
      sound.jump();
      puff(dino.x - 6, groundY, 6, "#d9cbb2");
    } else if (power >= 1 && !dino.usedDouble) {
      // Mid-air double-jump — only when the power vessel is full. Spends it.
      dino.vy = -JUMP_V * 0.92;
      dino.usedDouble = true;
      power = 0;
      dino.parachute = 0.35;     // canopy re-billows on the new ascent
      dino.inflate = 0.3;
      dino.squeeze = 0;
      sound.double();
      puff(dino.x, dino.y - 8, 14, "#8fd3f0");
      updatePowerUI();
    }
  }
  function setDuck(on) {
    if (state !== STATE.RUNNING) return;
    dino.duck = on && dino.onGround ? true : (on ? dino.duck : false);
    dino.duck = on;
    if (on && !dino.onGround && dino.vy < 0) dino.vy += 0.6; // fast-fall feel
  }

  function primaryAction() {
    sound.ensure();
    if (state === STATE.READY) startGame();
    else if (state === STATE.OVER) startGame();
    else jump();
  }

  window.addEventListener("keydown", (e) => {
    if (["Space", "ArrowUp", "ArrowDown", "KeyW", "KeyS"].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") primaryAction();
    if (e.code === "ArrowDown" || e.code === "KeyS") setDuck(true);
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "ArrowDown" || e.code === "KeyS") setDuck(false);
  });

  // Touch / mouse: a tap ANYWHERE jumps; dragging downward (swipe) ducks.
  let touchActive = false, touchStartY = 0, touchDucking = false;
  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    sound.ensure();
    if (state !== STATE.RUNNING) { primaryAction(); return; }   // start / restart
    touchActive = true; touchDucking = false; touchStartY = e.clientY;
  });
  window.addEventListener("pointermove", (e) => {
    if (!touchActive) return;
    if (e.clientY - touchStartY > 26 && !touchDucking) { setDuck(true); touchDucking = true; }
  });
  function endTouch() {
    if (!touchActive) return;
    touchActive = false;
    if (touchDucking) { setDuck(false); touchDucking = false; }
    else jump();                              // released without swiping down → jump
  }
  window.addEventListener("pointerup", endTouch);
  window.addEventListener("pointercancel", endTouch);

  // ----- UI wiring ----------------------------------------------------------
  const overlay = document.getElementById("overlay");
  const gameover = document.getElementById("gameover");
  const scoreEl = document.getElementById("score");
  const hiEl = document.getElementById("hi-score");
  const finalScoreEl = document.getElementById("final-score");
  const bestLineEl = document.getElementById("best-line");
  document.getElementById("start-btn").addEventListener("click", (e) => { e.stopPropagation(); sound.ensure(); startGame(); });
  document.getElementById("restart-btn").addEventListener("click", (e) => { e.stopPropagation(); sound.ensure(); startGame(); });

  const rankEl = document.getElementById("rank-line");
  const epitaphEl = document.getElementById("epitaph-line");
  const shareCardImg = document.getElementById("share-card");
  const saveCardLink = document.getElementById("save-card");
  const copyBtn = document.getElementById("copy-btn");
  const shareBtn = document.getElementById("share-btn");

  function flashCopied() {
    if (!copyBtn) return;
    const old = copyBtn.textContent;
    copyBtn.textContent = "✅ Copied!";
    copyBtn.classList.add("copied");
    setTimeout(() => { copyBtn.textContent = old; copyBtn.classList.remove("copied"); }, 1500);
  }
  function copyCope() {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(lastShareText).then(flashCopied).catch(flashCopied);
    } else { flashCopied(); }
  }
  if (copyBtn) copyBtn.addEventListener("click", (e) => { e.stopPropagation(); copyCope(); });

  // Convert a data: URL to a Blob without any network request (serverless).
  function dataURLtoBlob(dataURL) {
    const [head, b64] = dataURL.split(",");
    const mime = (head.match(/:(.*?);/) || [null, "image/png"])[1];
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  if (shareBtn) shareBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const url = (typeof location !== "undefined" && location.href) ? location.href : "";
    const payload = { title: "Poor Dino — Cope & Run", text: lastShareText, url };
    try {
      // Prefer sharing the score-card image itself where supported.
      if (lastCardURL && navigator.canShare && typeof File !== "undefined") {
        const file = new File([dataURLtoBlob(lastCardURL)], "poor-dino.png", { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ ...payload, files: [file] });
          return;
        }
      }
      if (navigator.share) { await navigator.share(payload); return; }
      copyCope();
    } catch (_) { /* user dismissed the share sheet */ }
  });
  if (saveCardLink) saveCardLink.addEventListener("click", (e) => e.stopPropagation());

  // Build a shareable score card image (data URL) — no network, all client-side.
  function buildShareCard(s, rank, epitaph) {
    try {
      const W = 600, H = 315;
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const g = c.getContext("2d");
      const grd = g.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, "#3a3f6e"); grd.addColorStop(1, "#8fd3f0");
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
      g.fillStyle = "#7b8b5a"; g.fillRect(0, H - 64, W, 64);
      g.fillStyle = "rgba(0,0,0,0.15)"; g.fillRect(0, H - 64, W, 3);
      // title
      g.textAlign = "left"; g.textBaseline = "alphabetic";
      g.fillStyle = "#ffffff"; g.font = "700 32px Fredoka, system-ui, sans-serif";
      g.fillText("🦕 Poor Dino", 30, 54);
      g.fillStyle = "#ffd166"; g.font = "600 19px Fredoka, system-ui, sans-serif";
      g.fillText("Cope & Run", 34, 80);
      // big dino
      g.font = "92px system-ui, sans-serif"; g.fillText("🦖", 40, 220);
      // score + rank
      g.textAlign = "right"; g.fillStyle = "#ffffff";
      g.font = "700 74px Fredoka, system-ui, sans-serif"; g.fillText(s + " m", W - 30, 150);
      g.fillStyle = "#ffd166"; g.font = "600 26px Fredoka, system-ui, sans-serif";
      g.fillText(rank, W - 30, 186);
      // epitaph + footer
      g.textAlign = "left"; g.fillStyle = "rgba(255,255,255,0.95)";
      g.font = "italic 500 18px Fredoka, system-ui, sans-serif";
      g.fillText("“" + epitaph + "”", 30, H - 82);
      g.fillStyle = "rgba(255,255,255,0.85)"; g.font = "500 15px Fredoka, system-ui, sans-serif";
      g.fillText("Can you out-cope this dinosaur?", 30, H - 24);
      return c.toDataURL("image/png");
    } catch (e) { return ""; }
  }

  const livesEl = document.getElementById("lives");
  function updateHearts() {
    if (!livesEl) return;
    let h = "";
    for (let i = 0; i < MAX_LIVES; i++) h += i < lives ? "❤️" : "🤍";
    livesEl.textContent = h;
  }

  const powerWrapEl = document.getElementById("power");
  const powerFillEl = document.getElementById("power-fill");
  const powerLabelEl = document.getElementById("power-label");
  function updatePowerUI() {
    if (!powerFillEl) return;
    powerFillEl.style.height = Math.round(clamp(power, 0, 1) * 100) + "%";
    const ready = power >= 1;
    if (powerWrapEl) powerWrapEl.classList.toggle("ready", ready);
    if (powerLabelEl) powerLabelEl.textContent = ready ? "READY!" : "2x\nJUMP";
  }

  function spawnQuip() {
    const text = QUIP_LINES[Math.floor(Math.random() * QUIP_LINES.length)];
    quips.push({ text, x: view.w + 30, yo: rand(16, 38), vx: 2.3, life: 0, w: 0 });
  }

  function collectHeart(hp) {
    lives = Math.min(MAX_LIVES, lives + 1);
    updateHearts();
    pickups = pickups.filter((p) => p !== hp);
    sound.pickup();
    for (let i = 0; i < 14; i++) {
      particles.push({
        x: hp.x, y: hp.y, vx: rand(-2.5, 2.5), vy: rand(-3.5, -0.5),
        life: 1, r: rand(2, 4), color: i % 2 ? "#ff6b6b" : "#ffd166",
      });
    }
  }

  function updateMeteor(dtf) {
    if (!meteor) {
      meteorTimer -= dtf / 60;
      if (meteorTimer <= 0) {
        const tx = clamp(dino.x + rand(300, 430), 120, view.w - 60);
        meteor = { phase: "warn", t: 1.4, tx, trail: [] };
      }
      return;
    }
    if (meteor.phase === "warn") {
      meteor.t -= dtf / 60;
      if (meteor.t <= 0) {
        meteor.mx = meteor.tx + 200;     // launch from up and to the right
        meteor.my = -60;
        const frames = 32;
        meteor.vx = (meteor.tx - meteor.mx) / frames;
        meteor.vy = (groundY - meteor.my) / frames;
        meteor.phase = "fall";
        sound.whistle();
      }
    } else if (meteor.phase === "fall") {
      meteor.trail.push({ x: meteor.mx, y: meteor.my, life: 1 });
      if (meteor.trail.length > 12) meteor.trail.shift();
      for (const tr of meteor.trail) tr.life -= 0.09 * dtf;
      meteor.mx += meteor.vx * dtf;
      meteor.my += meteor.vy * dtf;
      if (meteor.my >= groundY) {
        shake = 18;
        sound.boom();
        for (let i = 0; i < 22; i++) {
          particles.push({
            x: meteor.tx, y: groundY,
            vx: rand(-4, 4) - speed * 0.1, vy: rand(-5, -0.5),
            life: 1, r: rand(2, 6), color: i % 2 ? "#ff8a3d" : "#ffd166",
          });
        }
        obstacles.push({ type: "rock", x: meteor.tx - 22, w: 44, h: 42, glow: 1 });
        meteor = null;
        meteorTimer = rand(20, 32);
      }
    }
  }

  function startGame() {
    // Drop focus from the Play/Play-Again button so pressing Space to jump
    // doesn't re-activate the button (which would instantly restart the run).
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    reset();
    state = STATE.RUNNING;
    overlay.classList.add("hidden");
    gameover.classList.add("hidden");
    sound.startRain();
  }

  function loseLife(o) {
    lives--;
    updateHearts();
    o.x = -9999;                 // clear the obstacle we collided with
    sound.hit();
    shake = 12;
    puff(dino.x, dino.y - 24, 12, "#ffd166");
    if (lives <= 0) { endGame(); return; }
    dino.invuln = 96;            // ~1.6s of mercy blinking
  }

  function endGame() {
    state = STATE.OVER;
    shake = 16;
    sound.stopRain();
    const s = Math.floor(score);
    if (s > hi) { hi = s; localStorage.setItem("bd_hi", String(hi)); }
    const rank = rankFor(s);
    const epitaph = EPITAPHS[Math.floor(Math.random() * EPITAPHS.length)];
    if (finalScoreEl) finalScoreEl.textContent = "You coped for " + s + " m";
    if (rankEl) rankEl.textContent = rank;
    if (epitaphEl) epitaphEl.textContent = "“" + epitaph + "”";
    if (bestLineEl) bestLineEl.textContent = "Best: " + hi + " m";
    const url = (typeof location !== "undefined" && location.href) ? location.href : "";
    lastShareText = `🦕 I coped for ${s} m in Poor Dino — Cope & Run before accepting extinction. Rank: ${rank}. Out-cope me → ${url}`;
    const card = buildShareCard(s, rank, epitaph);
    lastCardURL = card;
    if (card) {
      if (shareCardImg) shareCardImg.src = card;
      if (saveCardLink) saveCardLink.href = card;
    }
    gameover.classList.remove("hidden");
  }

  // ----- Particles ----------------------------------------------------------
  function puff(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      particles.push({
        x, y, vx: rand(-1.4, -0.2) - speed * 0.15, vy: rand(-1.6, -0.2),
        life: 1, r: rand(2, 5), color,
      });
    }
  }

  // ----- Update -------------------------------------------------------------
  function update(dtf) {
    worldScroll = (worldScroll + speed * dtf) % 1e7;
    dayTime = (dayTime + 0.00035 * dtf) % 1;

    if (state === STATE.RUNNING) {
      speed = Math.min(MAX_SPEED, BASE_SPEED + score * 0.0016);
      const before = Math.floor(score / 100);
      score += speed * dtf * 0.14;
      if (Math.floor(score / 100) > before) sound.point();

      // Dino physics
      dino.vy += GRAVITY * dtf;

      const heightAbove = groundY - dino.y;    // 0 at ground, grows as it rises
      const descending = dino.vy > 0;
      const approaching = !dino.onGround && descending && heightAbove < 50;

      // Parachute life-cycle:
      //  - pops open the instant the feet leave the ground and fills with air
      //  - stays billowed while airborne (floaty descent)
      //  - squeezes/pinches shut and vanishes as it approaches the ground
      if (!dino.onGround) {
        if (approaching) {
          dino.squeeze = clamp(dino.squeeze + 0.13 * dtf, 0, 1);
          dino.parachute = clamp(dino.parachute - 0.05 * dtf, 0, 1);
          dino.inflate = clamp(dino.inflate - 0.09 * dtf, 0, 1);
        } else {
          dino.parachute = clamp(dino.parachute + 0.22 * dtf, 0, 1);
          dino.inflate = clamp(dino.inflate + 0.13 * dtf, 0, 1);
          dino.squeeze = clamp(dino.squeeze - 0.15 * dtf, 0, 1);
          if (descending) dino.vy *= 0.9;      // canopy catches air — floaty fall
        }
      } else {
        dino.parachute = clamp(dino.parachute - 0.35 * dtf, 0, 1);
        dino.inflate = clamp(dino.inflate - 0.3 * dtf, 0, 1);
        dino.squeeze = 0;
      }

      dino.y += dino.vy * dtf;

      if (dino.y >= groundY) {
        if (!dino.onGround) {
          sound.land();
          puff(dino.x - 4, groundY, 8, "#e8dcc0");
        }
        dino.y = groundY;
        dino.vy = 0;
        dino.onGround = true;
      }

      dino.runPhase += (dino.onGround ? 0.32 : 0.06) * dtf * (speed / BASE_SPEED);
      // rock the parachute pendulum while airborne; settle once grounded
      if (!dino.onGround) dino.swingPhase += 0.12 * dtf;
      else dino.swingPhase = 0;
      dino.blink = (dino.blink + dtf) % 220;

      // Running dust
      if (dino.onGround && Math.random() < 0.25) puff(dino.x - 12, groundY, 1, "#e2d6bd");

      // Obstacles
      distanceToNext -= speed * dtf;
      if (distanceToNext <= 0) {
        spawnObstacle();
        // Spacing must scale with how far the dino travels during a jump, or at
        // high speed obstacles get bunched closer than a jump can clear.
        const airFrames = (2 * JUMP_V) / GRAVITY;   // ~44 frames airborne
        const jumpDist = speed * airFrames;         // horizontal reach of a jump
        const minGap = jumpDist * 1.15 + 90;        // land safely before the next one
        distanceToNext = rand(minGap, minGap + 240);
      }
      for (const o of obstacles) {
        o.x -= speed * dtf;
        if (o.type === "bird") o.wing += 0.25 * dtf;
        else if (o.type === "rock" && o.glow > 0) o.glow = Math.max(0, o.glow - 0.02 * dtf);
      }
      obstacles = obstacles.filter((o) => o.x + o.w > -20);

      // Invulnerability countdown + collision (costs a life, not instant death)
      if (dino.invuln > 0) dino.invuln -= dtf;
      if (dino.invuln <= 0) {
        const box = dinoBox();
        for (const o of obstacles) {
          if (hit(box, o)) { loseLife(o); break; }
        }
      }

      // Storm: opening rain + thunder
      if (rainT > 0) {
        rainT -= dtf;
        thunderTimer -= dtf;
        if (thunderTimer <= 0) {
          sound.thunder();
          flash = 1;
          thunderTimer = rand(80, 150);
        }
        sound.setRainVolume(0.13 * clamp(rainT / 90, 0, 1));
        if (rainT <= 0) sound.stopRain();
      }

      // Time, double-jump power vessel, and sarcastic quips
      playTime += dtf / 60;
      if (power < 1) { power = clamp(power + (dtf / 60) / POWER_FILL_SEC, 0, 1); updatePowerUI(); }
      quipTimer -= dtf / 60;
      if (quipTimer <= 0) { spawnQuip(); quipTimer = rand(11, 17); }
      for (const q of quips) { q.x -= q.vx * dtf; q.life += dtf; }
      quips = quips.filter((q) => q.x + (q.w || 520) > -20);

      // Meteor event: telegraphed warning, then a flaming rock crashes down
      // and leaves a boulder to hurdle.
      updateMeteor(dtf);

      // Health hearts — only offered while the dino is down a life
      if (lives < MAX_LIVES) {
        heartTimer -= dtf / 60;
        if (heartTimer <= 0 && pickups.length === 0) {
          pickups.push({ x: view.w + 30, y: rand(groundY - 104, groundY - 48), bob: rand(0, 6.28) });
          heartTimer = rand(9, 15);
        }
      }
      for (const hp of pickups) { hp.x -= speed * dtf; hp.bob += 0.08 * dtf; }
      pickups = pickups.filter((hp) => hp.x + 20 > -20);
      if (pickups.length) {
        const box = dinoBox();
        for (const hp of pickups) {
          const hy = hp.y + Math.sin(hp.bob) * 6;
          if (box.x < hp.x + 16 && box.x + box.w > hp.x - 16 && box.y < hy + 16 && box.y + box.h > hy - 16) {
            collectHeart(hp);
            break;
          }
        }
      }
    }

    // Scenery drift
    for (const c of clouds) {
      c.x -= (c.spd + speed * 0.06) * dtf;
      if (c.x < -120) { c.x = view.w + rand(20, 200); c.y = rand(24, 120); c.s = rand(0.5, 1.2); }
    }
    for (const h of hills) {
      h.x -= speed * 0.28 * dtf;
      if (h.x < -h.r) h.x += (hills.length) * 320 + rand(0, 60);
    }

    // Lightning flash decay + raindrop motion
    if (flash > 0) flash = Math.max(0, flash - 0.06 * dtf);
    if (rainT > 0) {
      const wind = 2.4;
      for (const d of rain) {
        d.y += d.sp * dtf;
        d.x -= wind * dtf;
        if (d.y > groundY) { d.y = rand(-70, -4); d.x = rand(-40, view.w + 60); }
        if (d.x < -50) d.x = view.w + rand(0, 50);
      }
    }

    // Particles
    for (const p of particles) {
      p.x += p.vx * dtf; p.y += p.vy * dtf; p.vy += 0.05 * dtf; p.life -= 0.03 * dtf;
    }
    particles = particles.filter((p) => p.life > 0);

    if (shake > 0) shake = Math.max(0, shake - 0.8 * dtf);
  }

  function dinoBox() {
    const h = dino.duck ? 30 : dino.h;
    const w = dino.duck ? 58 : dino.w;
    return { x: dino.x - w / 2 + 6, y: dino.y - h + 4, w: w - 12, h: h - 6 };
  }

  function hit(b, o) {
    let ox, oy, ow, oh;
    if (o.type === "bird") { ox = o.x + 5; oy = o.y - o.h / 2 + 3; ow = o.w - 12; oh = o.h - 8; }
    else { ox = o.x + 2; oy = groundY - o.h; ow = o.w - 6; oh = o.h; }   // cactus & rock (ground)
    return b.x < ox + ow && b.x + b.w > ox && b.y < oy + oh && b.y + b.h > oy;
  }

  // ----- Palette (day/night) -----------------------------------------------
  function palette() {
    // dayTime: 0 dawn -> 0.25 day -> 0.5 dusk -> 0.75 night -> 1 dawn
    const stops = [
      { t: 0.0,  top: [255, 183, 160], bot: [255, 224, 178], sun: [255, 214, 140], grd: [214, 196, 150], night: 0 },
      { t: 0.25, top: [125, 206, 240], bot: [200, 240, 255], sun: [255, 244, 200], grd: [201, 213, 150], night: 0 },
      { t: 0.5,  top: [255, 150, 120], bot: [255, 205, 150], sun: [255, 160, 110], grd: [190, 175, 130], night: 0.15 },
      { t: 0.75, top: [26, 32, 66],    bot: [58, 62, 110],   sun: [225, 230, 245], grd: [70, 78, 96],    night: 1 },
      { t: 1.0,  top: [255, 183, 160], bot: [255, 224, 178], sun: [255, 214, 140], grd: [214, 196, 150], night: 0 },
    ];
    let a = stops[0], b = stops[1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (dayTime >= stops[i].t && dayTime <= stops[i + 1].t) { a = stops[i]; b = stops[i + 1]; break; }
    }
    const lt = (dayTime - a.t) / (b.t - a.t || 1);
    return {
      top: mixColor(a.top, b.top, lt),
      bot: mixColor(a.bot, b.bot, lt),
      sun: mixColor(a.sun, b.sun, lt),
      grd: mixColor(a.grd, b.grd, lt),
      night: lerp(a.night, b.night, lt),
    };
  }

  // ----- Rendering ----------------------------------------------------------
  function render() {
    const pal = palette();
    ctx.setTransform(view.scale, 0, 0, view.scale, 0, 0);

    let sx = 0, sy = 0;
    if (shake > 0) { sx = rand(-shake, shake) * 0.4; sy = rand(-shake, shake) * 0.4; }
    ctx.save();
    ctx.translate(sx, sy);

    drawSky(pal);
    drawCelestial(pal);
    drawStars(pal);
    drawClouds(pal);
    drawHills(pal);
    drawGround(pal);
    drawStormGloom();
    for (const o of obstacles) {
      if (o.type === "cactus") drawCactus(o, pal);
      else if (o.type === "bird") drawBird(o, pal);
      else drawRock(o, pal);
    }
    drawPickups();
    drawParticles();
    drawDino(pal);
    drawRain();
    drawMeteor(pal);
    drawQuips();
    drawFlash();

    ctx.restore();

    scoreEl.textContent = pad5(score);
    hiEl.textContent = pad5(hi);
  }

  function stormAmount() { return clamp(rainT / 60, 0, 1); }

  function drawStormGloom() {
    const s = stormAmount();
    if (s <= 0) return;
    ctx.fillStyle = `rgba(30,38,58,${0.45 * s})`;
    ctx.fillRect(-20, -20, view.w + 40, view.h + 40);
  }

  function drawRain() {
    const s = stormAmount();
    if (s <= 0) return;
    ctx.save();
    ctx.strokeStyle = `rgba(190,214,255,${0.55 * s})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (const d of rain) {
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - d.len * 0.3, d.y + d.len);
    }
    ctx.stroke();
    // splashes near the ground
    ctx.strokeStyle = `rgba(200,220,255,${0.4 * s})`;
    for (const d of rain) {
      if (d.y > groundY - 6 && d.y < groundY + 4) {
        ctx.beginPath();
        ctx.arc(d.x, groundY, 2.5, Math.PI, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawFlash() {
    if (flash <= 0) return;
    ctx.fillStyle = `rgba(240,245,255,${0.6 * flash})`;
    ctx.fillRect(-20, -20, view.w + 40, view.h + 40);
  }

  function drawRock(o, pal) {
    const x = o.x, w = o.w, h = o.h;
    const cx = x + w / 2, topY = groundY - h;
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.beginPath(); ctx.ellipse(cx, groundY + 2, w * 0.6, 4, 0, 0, Math.PI * 2); ctx.fill();
    if (o.glow > 0) {
      const gl = ctx.createRadialGradient(cx, groundY - h * 0.4, 4, cx, groundY - h * 0.4, w);
      gl.addColorStop(0, `rgba(255,140,60,${0.5 * o.glow})`);
      gl.addColorStop(1, "rgba(255,140,60,0)");
      ctx.fillStyle = gl;
      ctx.beginPath(); ctx.arc(cx, groundY - h * 0.4, w, 0, Math.PI * 2); ctx.fill();
    }
    const base = mixColor([92, 86, 96], [42, 44, 62], pal.night * 0.5);
    ctx.fillStyle = rgb(base);
    ctx.beginPath();
    ctx.moveTo(x + 3, groundY);
    ctx.lineTo(x + 6, topY + h * 0.35);
    ctx.lineTo(cx - 4, topY + 2);
    ctx.lineTo(cx + 6, topY);
    ctx.lineTo(x + w - 5, topY + h * 0.4);
    ctx.lineTo(x + w - 2, groundY);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgb(mixColor(base, [255, 255, 255], 0.16));
    ctx.beginPath();
    ctx.moveTo(cx - 4, topY + 2); ctx.lineTo(cx + 6, topY);
    ctx.lineTo(cx + 2, topY + h * 0.5); ctx.lineTo(cx - 6, topY + h * 0.45);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = o.glow > 0.1 ? `rgba(255,120,40,${0.4 + 0.6 * o.glow})` : "rgba(0,0,0,0.28)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx, topY + 4); ctx.lineTo(cx - 3, topY + h * 0.5); ctx.lineTo(cx + 4, groundY - 4);
    ctx.moveTo(cx - 3, topY + h * 0.5); ctx.lineTo(x + 8, topY + h * 0.6);
    ctx.stroke();
  }

  function drawHeartShape(cx, cy, r, color) {
    const top = cy - r * 0.3;
    ctx.beginPath();
    ctx.moveTo(cx, cy + r * 0.9);
    ctx.bezierCurveTo(cx - r * 1.3, cy - r * 0.2, cx - r * 0.6, top - r, cx, top);
    ctx.bezierCurveTo(cx + r * 0.6, top - r, cx + r * 1.3, cy - r * 0.2, cx, cy + r * 0.9);
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
  }

  function drawPickups() {
    for (const hp of pickups) {
      const hy = hp.y + Math.sin(hp.bob) * 6;
      const pulse = 0.85 + 0.15 * Math.sin(hp.bob * 2);
      const gl = ctx.createRadialGradient(hp.x, hy, 2, hp.x, hy, 28);
      gl.addColorStop(0, "rgba(255,120,150,0.65)");
      gl.addColorStop(1, "rgba(255,120,150,0)");
      ctx.fillStyle = gl;
      ctx.beginPath(); ctx.arc(hp.x, hy, 28, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.translate(hp.x, hy); ctx.scale(pulse, pulse); ctx.translate(-hp.x, -hy);
      drawHeartShape(hp.x, hy, 13, "#ff4d6a");
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath(); ctx.arc(hp.x - 4, hy - 5, 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  function drawMeteor(pal) {
    if (!meteor) return;
    const pulse = 0.5 + 0.5 * Math.sin(worldScroll * 0.25);
    // target marker on the ground
    ctx.save();
    ctx.strokeStyle = `rgba(255,70,60,${0.5 + 0.5 * pulse})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(meteor.tx, groundY, 16 + pulse * 5, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "rgba(255,70,60,0.9)";
    ctx.beginPath(); ctx.arc(meteor.tx, groundY, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    if (meteor.phase === "warn") {
      ctx.save();
      ctx.globalAlpha = 0.6 + 0.4 * pulse;
      ctx.font = "700 24px Fredoka, system-ui, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const label = "☄️  METEOR INCOMING!";
      const w = ctx.measureText(label).width;
      const bx = view.w / 2, by = 46;
      ctx.fillStyle = "rgba(120,20,20,0.85)";
      roundRect(bx - w / 2 - 16, by - 20, w + 32, 40, 12); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(label, bx, by + 1);
      ctx.restore();
    } else if (meteor.phase === "fall") {
      for (const tr of meteor.trail) {
        if (tr.life <= 0) continue;
        ctx.globalAlpha = clamp(tr.life, 0, 1) * 0.7;
        ctx.fillStyle = "#ff9a3d";
        ctx.beginPath(); ctx.arc(tr.x, tr.y, 6 * tr.life, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      const mx = meteor.mx, my = meteor.my;
      const glow = ctx.createRadialGradient(mx, my, 2, mx, my, 22);
      glow.addColorStop(0, "rgba(255,220,120,0.9)");
      glow.addColorStop(1, "rgba(255,120,40,0)");
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(mx, my, 22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#5a4a44";
      ctx.beginPath(); ctx.arc(mx, my, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffcf6b";
      ctx.beginPath(); ctx.arc(mx - 2, my - 2, 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawQuips() {
    if (quips.length === 0) return;
    ctx.save();
    ctx.font = "600 19px Fredoka, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    for (const q of quips) {
      const w = ctx.measureText(q.text).width; q.w = w;
      const padX = 15, h = 28, r = 14;
      const qy = groundY + (q.yo || 26);       // sit just below the earth's surface
      const rightEdge = q.x + w;
      // fade in as it enters from the right, fade out as it slides off the left
      const a = clamp(q.life / 20, 0, 1)
        * clamp((rightEdge + 40) / 90, 0, 1)
        * clamp((view.w + 40 - q.x) / 60, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = "rgba(18,22,30,0.8)";    // carved-into-the-dirt look
      roundRect(q.x - padX, qy - h / 2, w + padX * 2, h, r); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.14)"; ctx.lineWidth = 1.5;
      roundRect(q.x - padX, qy - h / 2, w + padX * 2, h, r); ctx.stroke();
      ctx.fillStyle = "#ffd166";
      ctx.beginPath(); ctx.arc(q.x - padX + 7, qy - h / 2 + 7, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#f4ead2";
      ctx.fillText(q.text, q.x, qy + 1);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawSky(pal) {
    const g = ctx.createLinearGradient(0, 0, 0, groundY);
    g.addColorStop(0, rgb(pal.top));
    g.addColorStop(1, rgb(pal.bot));
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, view.w + 40, view.h + 40);
  }

  function drawCelestial(pal) {
    // Sun/moon arcs across the sky based on dayTime
    const angle = dayTime * Math.PI * 2 - Math.PI / 2;
    const cx = view.w * 0.5 + Math.cos(angle) * view.w * 0.42;
    const cy = groundY * 0.55 + Math.sin(angle) * groundY * 0.6;
    ctx.save();
    // glow
    const glow = ctx.createRadialGradient(cx, cy, 4, cx, cy, 60);
    glow.addColorStop(0, `rgba(${pal.sun[0]},${pal.sun[1]},${pal.sun[2]},0.55)`);
    glow.addColorStop(1, `rgba(${pal.sun[0]},${pal.sun[1]},${pal.sun[2]},0)`);
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy, 60, 0, Math.PI * 2); ctx.fill();
    // disc
    ctx.fillStyle = rgb(pal.sun);
    ctx.beginPath(); ctx.arc(cx, cy, 22, 0, Math.PI * 2); ctx.fill();
    if (pal.night > 0.5) {
      // moon craters
      ctx.fillStyle = "rgba(180,190,210,0.5)";
      ctx.beginPath(); ctx.arc(cx - 6, cy - 5, 4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 7, cy + 3, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 2, cy - 9, 2.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawStars(pal) {
    if (pal.night < 0.2) return;
    ctx.save();
    ctx.globalAlpha = pal.night;
    ctx.fillStyle = "#fff";
    for (let i = 0; i < 40; i++) {
      const x = (i * 137.5 + 40) % view.w;
      const y = (i * 61.3) % (groundY * 0.7);
      const tw = 0.6 + 0.4 * Math.sin(worldScroll * 0.02 + i);
      ctx.globalAlpha = pal.night * tw;
      ctx.fillRect(x, y, 1.6, 1.6);
    }
    ctx.restore();
  }

  function drawClouds(pal) {
    ctx.save();
    for (const c of clouds) {
      const alpha = lerp(0.9, 0.35, pal.night);
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      puffCloud(c.x, c.y, c.s);
    }
    ctx.restore();
  }
  function puffCloud(x, y, s) {
    // Each lobe gets its own subpath (moveTo before arc) so the connecting
    // chords don't carve a hole out of the middle of the cloud.
    const lobes = [
      [x, y, 16 * s],
      [x + 18 * s, y + 4 * s, 20 * s],
      [x + 40 * s, y, 15 * s],
      [x + 20 * s, y - 8 * s, 16 * s],
    ];
    ctx.beginPath();
    for (const [lx, ly, lr] of lobes) {
      ctx.moveTo(lx + lr, ly);
      ctx.arc(lx, ly, lr, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  function drawHills(pal) {
    const c = mixColor(pal.grd, [90, 130, 90], 0.5);
    const far = mixColor(c, pal.bot, 0.45);
    ctx.fillStyle = rgb(far);
    for (const h of hills) {
      ctx.beginPath();
      ctx.moveTo(h.x - h.r, groundY);
      ctx.quadraticCurveTo(h.x, groundY - h.h, h.x + h.r, groundY);
      ctx.fill();
    }
  }

  function drawGround(pal) {
    // ground band
    const g = ctx.createLinearGradient(0, groundY, 0, view.h);
    g.addColorStop(0, rgb(pal.grd));
    g.addColorStop(1, rgb(mixColor(pal.grd, [60, 50, 40], 0.4)));
    ctx.fillStyle = g;
    ctx.fillRect(-20, groundY, view.w + 40, view.h - groundY + 20);

    // top line
    ctx.strokeStyle = rgb(mixColor(pal.grd, [40, 40, 40], 0.4));
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-20, groundY); ctx.lineTo(view.w + 20, groundY); ctx.stroke();

    // dashes + pebbles scrolling
    const off = worldScroll % 42;
    ctx.strokeStyle = `rgba(0,0,0,0.14)`;
    ctx.lineWidth = 2;
    for (let x = -off; x < view.w + 20; x += 42) {
      const y = groundY + 12 + ((Math.floor(x / 42) % 3) * 8);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 10, y); ctx.stroke();
    }
    ctx.fillStyle = "rgba(0,0,0,0.10)";
    const poff = worldScroll % 90;
    for (let x = -poff; x < view.w + 20; x += 90) {
      ctx.beginPath();
      ctx.arc(x + 20, groundY + 30, 2.4, 0, Math.PI * 2);
      ctx.arc(x + 55, groundY + 44, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life, 0, 1) * 0.8;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ----- Cactus -------------------------------------------------------------
  function drawCactus(o, pal) {
    const shade = pal.night;
    const body = rgb(mixColor([46, 139, 87], [20, 40, 60], shade * 0.6));
    const dark = rgb(mixColor([30, 100, 62], [15, 30, 45], shade * 0.6));
    ctx.save();
    for (const g of o.groups) {
      const x = o.x + g.dx + 10;
      const topY = groundY - g.h;
      // shadow
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.beginPath();
      ctx.ellipse(x + g.w / 2, groundY + 2, g.w * 0.7, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      // trunk
      ctx.fillStyle = body;
      roundRect(x, topY, g.w, g.h, g.w / 2);
      ctx.fill();
      // arms
      ctx.beginPath();
      const armY = topY + g.h * 0.4;
      roundRect(x - g.w * 0.55, armY, g.w * 0.5, g.h * 0.32, g.w * 0.25); ctx.fill();
      roundRect(x - g.w * 0.55, armY - g.h * 0.18, g.w * 0.42, g.h * 0.24, g.w * 0.2); ctx.fill();
      roundRect(x + g.w * 1.05, armY - g.h * 0.05, g.w * 0.5, g.h * 0.3, g.w * 0.25); ctx.fill();
      roundRect(x + g.w * 1.05, armY - g.h * 0.25, g.w * 0.42, g.h * 0.24, g.w * 0.2); ctx.fill();
      // ridge highlight
      ctx.strokeStyle = dark;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + g.w * 0.5, topY + 4); ctx.lineTo(x + g.w * 0.5, topY + g.h - 4); ctx.stroke();
    }
    ctx.restore();
  }

  // ----- Bird / pterodactyl -------------------------------------------------
  function drawBird(o, pal) {
    const flap = Math.sin(o.wing);
    const col = rgb(mixColor([90, 90, 110], [40, 45, 70], pal.night * 0.5));
    const beak = "#ffb454";
    ctx.save();
    ctx.translate(o.x + o.w / 2, o.y);
    // body
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.ellipse(0, 0, 14, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    // head
    ctx.beginPath();
    ctx.arc(11, -3, 6, 0, Math.PI * 2);
    ctx.fill();
    // crest
    ctx.beginPath();
    ctx.moveTo(13, -8); ctx.lineTo(20, -14); ctx.lineTo(15, -4); ctx.closePath(); ctx.fill();
    // beak
    ctx.fillStyle = beak;
    ctx.beginPath();
    ctx.moveTo(16, -2); ctx.lineTo(26, 0); ctx.lineTo(16, 3); ctx.closePath(); ctx.fill();
    // eye
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(12, -4, 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#222"; ctx.beginPath(); ctx.arc(12.5, -4, 1, 0, Math.PI * 2); ctx.fill();
    // wings
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(-2, 0);
    ctx.quadraticCurveTo(-18, flap * 16 - 4, -30, flap * 8);
    ctx.quadraticCurveTo(-16, flap * 4 + 2, -2, 4);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // ----- The star: a proper T-Rex + parachute ------------------------------
  function drawDino(pal) {
    const nightTint = pal.night * 0.4;
    const cLight = mixColor([126, 182, 100], [48, 80, 66], nightTint);
    const cMid   = mixColor([94, 152, 78],  [38, 66, 56], nightTint);
    const cDark  = mixColor([62, 110, 56],  [26, 50, 46], nightTint);
    const cBelly = mixColor([210, 216, 150], [110, 132, 112], nightTint);

    const duck = dino.duck && dino.onGround;
    const bodyH = 60;                 // head-top height (for parachute anchor)
    const feetY = dino.y;
    const cx = dino.x;
    const topY = feetY - bodyH;

    // ground shadow (shrinks as it rises)
    const air = clamp((groundY - dino.y) / 140, 0, 1);
    ctx.fillStyle = `rgba(0,0,0,${0.18 * (1 - air * 0.7)})`;
    ctx.beginPath();
    ctx.ellipse(cx, groundY + 3, 30 * (1 - air * 0.5), 5.5 * (1 - air * 0.4), 0, 0, Math.PI * 2);
    ctx.fill();

    // Pendulum swing: while hanging under the canopy the whole dino rocks
    // left/right and tilts — a gentle free-fall on the parachute that eases
    // off as the chute deflates just before touchdown.
    const swinging = !dino.onGround && dino.parachute > 0.05;
    const swayAngle = swinging ? Math.sin(dino.swingPhase) * 0.22 * dino.parachute : 0;
    ctx.save();
    if (swayAngle !== 0) {
      const pivotY = topY - 22;              // pivot up near the canopy/harness
      ctx.translate(cx, pivotY); ctx.rotate(swayAngle); ctx.translate(-cx, -pivotY);
    }

    // parachute (behind/above the dino) — swings together with the dino
    if (dino.parachute > 0.02) drawParachute(cx, topY, dino.parachute, pal);

    ctx.save();
    ctx.translate(cx, feetY);
    if (dino.invuln > 0) ctx.globalAlpha = (Math.floor(dino.invuln / 5) % 2 === 0) ? 0.35 : 0.9;

    // ---- helpers (limbs as thick round-capped strokes) ----
    function limb(x1, y1, x2, y2, w, color) {
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    function clawedFoot(x, y, color) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x - 3, y - 2.5); ctx.lineTo(x + 12, y - 0.5);
      ctx.lineTo(x + 12, y + 2.5); ctx.lineTo(x - 3, y + 2.5);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();                       // three toe claws
      for (const t of [3, 7, 11]) { ctx.moveTo(x + t, y + 2.5); ctx.lineTo(x + t + 2.5, y + 5); ctx.lineTo(x + t - 1, y + 2.5); }
      ctx.fill();
    }
    function raptorLeg(hipX, swing, lift, mainCol) {
      const hipY = -25;
      const kneeX = hipX + 7 + swing * 2, kneeY = -13;
      const footX = hipX + swing * 11, footY = -1 - lift * 9;
      limb(hipX, hipY, kneeX, kneeY, 12, mainCol);      // thigh
      limb(kneeX, kneeY, footX, footY, 8, mainCol);     // shin
      clawedFoot(footX, footY, rgb(cDark));
    }

    // ================= LEGS (behind the body) =================
    // Animate only while running on the ground; hold a mid-stride pose in the air.
    if (duck) {
      limb(-8, -11, -2, -1, 10, rgb(cDark));  clawedFoot(-2, -1, rgb(cDark));
      limb(11, -11, 17, -1, 10, rgb(cMid));   clawedFoot(17, -1, rgb(cDark));
    } else {
      const p = dino.runPhase * Math.PI;
      const moving = dino.onGround;
      const s1 = moving ? Math.sin(p) : 0.35;
      const s2 = moving ? Math.sin(p + Math.PI) : -0.35;
      raptorLeg(-3, s2, moving ? Math.max(0, Math.sin(p + Math.PI)) : 0, rgb(cDark));  // far leg
      raptorLeg(7, s1, moving ? Math.max(0, Math.sin(p)) : 0, rgb(cMid));               // near leg
    }

    // ================= BODY GROUP (bobs while running; squashes when ducking) =================
    const bob = (dino.onGround && !duck) ? Math.abs(Math.sin(dino.runPhase * Math.PI)) * 1.6 : 0;
    ctx.save();
    ctx.translate(0, -bob);
    if (duck) ctx.scale(1.22, 0.56);

    // body + neck + head + tail silhouette
    const grad = ctx.createLinearGradient(0, -62, 0, 0);
    grad.addColorStop(0, rgb(cLight));
    grad.addColorStop(1, rgb(cDark));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-46, -16);                       // tail tip
    ctx.quadraticCurveTo(-44, -30, -22, -40);   // tail top -> lower back
    ctx.quadraticCurveTo(-6, -48, 2, -46);      // back
    ctx.quadraticCurveTo(8, -58, 22, -60);      // neck rises to head
    ctx.quadraticCurveTo(36, -62, 46, -55);     // head top
    ctx.quadraticCurveTo(54, -50, 56, -46);     // snout upper
    ctx.lineTo(56, -42);                        // snout tip
    ctx.quadraticCurveTo(48, -41, 40, -43);     // upper lip
    ctx.quadraticCurveTo(28, -44, 22, -36);     // jaw -> throat
    ctx.quadraticCurveTo(18, -27, 18, -19);     // chest
    ctx.quadraticCurveTo(18, -8, 11, -3);       // belly -> near leg
    ctx.quadraticCurveTo(0, 0, -14, -4);        // under-belly
    ctx.quadraticCurveTo(-32, -8, -42, -12);    // tail underside
    ctx.quadraticCurveTo(-46, -14, -46, -16);
    ctx.closePath();
    ctx.fill();

    // belly plate
    ctx.fillStyle = rgb(cBelly);
    ctx.beginPath();
    ctx.moveTo(18, -18);
    ctx.quadraticCurveTo(16, -6, 8, -3);
    ctx.quadraticCurveTo(0, -1, -9, -4);
    ctx.quadraticCurveTo(2, -10, 9, -14);
    ctx.quadraticCurveTo(15, -16, 18, -18);
    ctx.closePath(); ctx.fill();
    // belly scute lines
    ctx.strokeStyle = "rgba(0,0,0,0.10)"; ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const yy = -14 + i * 4;
      ctx.beginPath(); ctx.moveTo(2, yy); ctx.lineTo(13, yy - 1); ctx.stroke();
    }

    // back spikes / osteoderms
    ctx.fillStyle = rgb(cDark);
    const back = [[-38, -28], [-27, -37], [-15, -44], [-3, -47], [8, -50], [18, -56]];
    for (const [bx, by] of back) {
      ctx.beginPath();
      ctx.moveTo(bx - 4, by + 2); ctx.lineTo(bx, by - 7); ctx.lineTo(bx + 4, by + 2);
      ctx.closePath(); ctx.fill();
    }

    // scale speckles for texture
    ctx.fillStyle = "rgba(0,0,0,0.07)";
    for (const [sx, sy] of [[-30, -22], [-18, -30], [-6, -34], [4, -30], [-24, -14], [-8, -18]]) {
      ctx.beginPath(); ctx.arc(sx, sy, 1.6, 0, Math.PI * 2); ctx.fill();
    }

    // tiny T-Rex arm with claws
    limb(20, -30, 28, -25, 4.5, rgb(cDark));
    limb(28, -25, 32, -27, 3.5, rgb(cDark));
    ctx.strokeStyle = rgb(cDark); ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(32, -27); ctx.lineTo(35, -25);
    ctx.moveTo(32, -26); ctx.lineTo(35, -23);
    ctx.stroke();

    // ---- head detailing ----
    // toothy mouth
    ctx.strokeStyle = rgb(mixColor(cDark, [20, 30, 25], 0.5)); ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(56, -43); ctx.quadraticCurveTo(44, -41.5, 30, -43.5); ctx.stroke();
    ctx.fillStyle = "#fff";                    // upper fangs
    for (const tx of [51, 45, 39]) {
      ctx.beginPath(); ctx.moveTo(tx, -43); ctx.lineTo(tx + 2.4, -43); ctx.lineTo(tx + 1.1, -39.5); ctx.closePath(); ctx.fill();
    }

    // brow ridge (fierce look)
    ctx.strokeStyle = rgb(cDark); ctx.lineWidth = 2.6; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(35, -56); ctx.lineTo(45, -54); ctx.stroke();

    // eye
    const eyeX = 41, eyeY = -51;
    const blinking = dino.blink > 210;
    if (!blinking) {
      ctx.fillStyle = "#fff5e0";
      ctx.beginPath(); ctx.arc(eyeX, eyeY, 3.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#1c2b1a";
      ctx.beginPath(); ctx.arc(eyeX + 1, eyeY, 1.9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath(); ctx.arc(eyeX + 0.2, eyeY - 1, 0.7, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.strokeStyle = "#1c2b1a"; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(eyeX - 3.5, eyeY); ctx.lineTo(eyeX + 3.5, eyeY); ctx.stroke();
    }

    // nostril
    ctx.fillStyle = rgb(cDark);
    ctx.beginPath(); ctx.arc(52, -47, 1.3, 0, Math.PI * 2); ctx.fill();

    ctx.restore();  // body group
    ctx.restore();  // dino transform
    ctx.restore();  // swing pivot
  }

  function drawParachute(cx, dinoTopY, open, pal) {
    const inflate = dino.inflate;   // 0..1 fullness of air
    const squeeze = dino.squeeze;   // 0..1 collapsing near the ground
    const breathe = 1 + 0.05 * Math.sin(worldScroll * 0.12);
    // Shape morph: broad & domed when full of air; pinched & narrow when squeezing shut.
    const morphW = (0.5 + 0.5 * inflate) * (1 - 0.62 * squeeze) * breathe;
    const morphH = (0.7 + 0.3 * inflate) * (1 + 0.3 * squeeze);
    const sway = Math.sin(worldScroll * 0.03) * 4 * open;
    const canopyW = 82 * open * morphW;
    const canopyH = 42 * open * morphH;
    const cyTop = dinoTopY - (46 * open + 10 * inflate);   // canopy sits above the dino
    const pcx = cx + sway * 0.4;

    // strings
    ctx.strokeStyle = `rgba(60,60,70,${0.6 * open})`;
    ctx.lineWidth = 1;
    const anchors = [-canopyW * 0.45, -canopyW * 0.18, canopyW * 0.18, canopyW * 0.45];
    ctx.beginPath();
    for (const a of anchors) {
      ctx.moveTo(pcx + a, cyTop + canopyH * 0.5);
      ctx.lineTo(cx + a * 0.25, dinoTopY + 6);
    }
    ctx.stroke();

    // canopy panels
    const panels = ["#ff6b6b", "#ffffff", "#4ecdc4", "#ffd166", "#ff6b6b", "#4ecdc4"];
    const n = panels.length;
    ctx.save();
    ctx.globalAlpha = clamp(open, 0, 1);
    for (let i = 0; i < n; i++) {
      const a0 = Math.PI + (i / n) * Math.PI;
      const a1 = Math.PI + ((i + 1) / n) * Math.PI;
      ctx.fillStyle = panels[i];
      ctx.beginPath();
      ctx.moveTo(pcx, cyTop + canopyH);
      ctx.ellipse(pcx, cyTop + canopyH, canopyW / 2, canopyH, 0, a0, a1);
      ctx.closePath();
      ctx.fill();
    }
    // scalloped rim
    ctx.fillStyle = "rgba(0,0,0,0.08)";
    const scallops = 6;
    for (let i = 0; i < scallops; i++) {
      const t = i / (scallops - 1);
      const x = pcx - canopyW / 2 + t * canopyW;
      const y = cyTop + canopyH - Math.sin(t * Math.PI) * canopyH * 0.05;
      ctx.beginPath(); ctx.arc(x, y, 3 * open, 0, Math.PI); ctx.fill();
    }
    // top highlight
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 2 * open;
    ctx.beginPath();
    ctx.ellipse(pcx, cyTop + canopyH, canopyW / 2, canopyH, 0, Math.PI + 0.2, Math.PI * 2 - 0.2);
    ctx.stroke();
    ctx.restore();
  }

  // ----- Rounded-rect helper -----------------------------------------------
  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ----- Main loop ----------------------------------------------------------
  let last = performance.now();
  function loop(now) {
    let dt = now - last;
    last = now;
    dt = Math.min(dt, 50);                 // clamp long frames (tab switch)
    const dtf = dt / (1000 / 60);          // 1.0 == 60fps step
    update(dtf);
    render();
    requestAnimationFrame(loop);
  }

  resize();
  reset();
  seedScenery();
  requestAnimationFrame(loop);
})();
