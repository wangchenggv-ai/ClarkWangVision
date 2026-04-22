// 主游戏：Matter.js + Canvas
(() => {
  const W = 1024, H = 576;           // 画布视窗
  const W_WORLD = 2048;              // 世界宽度（2 倍地图）
  const SLING = { x: 170, y: 430 };
  const GROUND_Y = 556;
  const MAX_PULL = 170;
  const LAUNCH_K = 0.38;
  let cameraX = 0;                   // 相机横向偏移（世界坐标 - 屏幕坐标）

  const cv = document.getElementById("cv");
  const ctx2d = cv.getContext("2d");
  const ui = {
    lvl: document.getElementById("lvl"),
    left: document.getElementById("left"),
    cur: document.getElementById("cur"),
    skill: document.getElementById("skill"),
    overlay: document.getElementById("overlay"),
    msg: document.getElementById("msg"),
    btn: document.getElementById("btn")
  };

  const { Engine, World, Bodies, Body, Events, Vertices } = Matter;
  let engine, world;
  let state = "AIMING";
  let levelIdx = 0;
  let queue = [];
  let currentBird = null;
  let currentDef = null;
  let pigs = [], blocks = [], extras = [], terrainBodies = [], terrainData = [];
  let aim = { dragging: false, x: SLING.x, y: SLING.y };
  let effects = [];

  // 背景动画状态
  const clouds = [
    { x: 150, y: 80, s: 1.2, v: 0.15 },
    { x: 450, y: 50, s: 0.9, v: 0.1 },
    { x: 720, y: 110, s: 1.4, v: 0.2 },
    { x: 900, y: 60, s: 1.0, v: 0.12 },
    { x: 1200, y: 90, s: 1.1, v: 0.13 },
    { x: 1500, y: 55, s: 1.3, v: 0.18 },
    { x: 1800, y: 100, s: 0.95, v: 0.11 }
  ];

  const ctx = {
    get world() { return world; },
    get engine() { return engine; },
    get pigs() { return pigs; },
    get blocks() { return blocks; },
    get extras() { return extras; },
    addBody: (b) => { World.add(world, b); extras.push(b); },
    removeBody: (b) => removeBody(b),
    addEffect: (ef) => effects.push(ef),
    setCurrent: (b) => { currentBird = b; }
  };

  // ---------- 引擎 ----------
  function initEngine() {
    engine = Engine.create();
    world = engine.world;
    engine.gravity.y = 2.0;
    engine.positionIterations = 10;
    engine.velocityIterations = 8;
    engine.constraintIterations = 4;
    const opts = { isStatic: true, friction: 0.7, restitution: 0.15 };
    World.add(world, [
      Bodies.rectangle(W_WORLD/2, GROUND_Y + 20, W_WORLD, 40, { ...opts, label: "ground" }),
      Bodies.rectangle(-20, H/2, 40, H, opts),
      Bodies.rectangle(W_WORLD + 20, H/2, 40, H, opts),
      Bodies.rectangle(W_WORLD/2, -20, W_WORLD, 40, opts)
    ]);
    Events.on(engine, "collisionStart", (ev) => {
      for (const pair of ev.pairs) handleCollision(pair.bodyA, pair.bodyB);
    });
  }

  function handleCollision(a, b) {
    const speed = Math.max(a.speed || 0, b.speed || 0);
    const impact = speed * 0.9;
    // 鸟碰到任何物体后进入"撞击"状态，不能再放技能
    for (const x of [a, b]) {
      if (x.isBird && speed > 0.8) x.hitSomething = true;
    }
    for (const [x, y] of [[a, b], [b, a]]) {
      // 被动：碰到即破
      if (x.isBird && x.def && x.def.passive === "breakWood" && y.isBlock && y.material === "wood") {
        effects.push({ type: "pop", x: y.position.x, y: y.position.y, r: 20, t: 18 });
        removeBody(y);
      }
      if (x.isBird && x.def && x.def.passive === "breakIce" && y.isBlock && y.material === "ice") {
        effects.push({ type: "pop", x: y.position.x, y: y.position.y, r: 20, t: 18 });
        removeBody(y);
      }
      // 普通伤害
      if (x.isPig && impact > 3) {
        let dmg = Math.ceil(impact / 3);
        if (y.isBird && y._diveDamage) dmg *= 3;   // 炫舞银俯冲伤害加倍
        if (y.isBird && y.def && y.def.id === "terence") dmg *= 2; // 大红碾压
        x.hp -= dmg;
      }
      if (x.isBlock && impact > 4) {
        let dmg = 1;
        if (y.isBird && y.def && y.def.id === "terence") dmg = 3;
        if (y.isBird && y._diveDamage) dmg = 3;
        x.hp = (x.hp || 2) - dmg;
      }
      if (x.isBird && y.isPig && impact > 2) y.hp -= 2;
      if (x.isEgg && (y.isPig || y.isBlock) && !x.used) {
        x.used = true;
        if (y.isPig) y.hp -= 4;
        if (y.isBlock) y.hp = (y.hp || 2) - 2;
        effects.push({ type: "pop", x: x.position.x, y: x.position.y, r: 30, t: 22 });
        removeBody(x);
      }
    }
  }

  // ---------- 加载关卡 ----------
  function loadLevel(idx) {
    if (engine) World.clear(world, false);
    pigs = []; blocks = []; extras = []; terrainBodies = []; terrainData = [];
    effects = [];
    initEngine();

    const lv = LEVELS[idx];

    // 地形
    for (const t of (lv.terrain || [])) {
      terrainData.push(t);
      if (t.type === "hill") {
        // 半椭圆山丘：用多边形近似
        const verts = [];
        const steps = 14;
        for (let i = 0; i <= steps; i++) {
          const a = Math.PI - (i / steps) * Math.PI;
          verts.push({ x: t.x + Math.cos(a) * t.w / 2, y: t.y - Math.sin(a) * t.h });
        }
        verts.push({ x: t.x + t.w / 2, y: t.y + 20 });
        verts.push({ x: t.x - t.w / 2, y: t.y + 20 });
        const body = Bodies.fromVertices(t.x, t.y - t.h / 2,
          [verts], { isStatic: true, friction: 1.0, frictionStatic: 2.0, restitution: 0.05, label: "terrain_hill" }, true);
        if (body) { body.terrainMeta = t; World.add(world, body); terrainBodies.push(body); }
      } else if (t.type === "slope") {
        // 斜坡三角形
        const dir = t.dir || 1;
        const verts = dir > 0
          ? [{x: t.x - t.w/2, y: t.y}, {x: t.x + t.w/2, y: t.y - t.h}, {x: t.x + t.w/2, y: t.y}]
          : [{x: t.x - t.w/2, y: t.y - t.h}, {x: t.x + t.w/2, y: t.y}, {x: t.x - t.w/2, y: t.y}];
        const body = Bodies.fromVertices(t.x, t.y - t.h / 3,
          [verts], { isStatic: true, friction: 1.0, frictionStatic: 2.0, restitution: 0.05, label: "terrain_slope" }, true);
        if (body) { body.terrainMeta = t; World.add(world, body); terrainBodies.push(body); }
      } else if (t.type === "platform") {
        const body = Bodies.rectangle(t.x, t.y, t.w, t.h,
          { isStatic: true, friction: 1.0, frictionStatic: 2.0, restitution: 0.05, label: "terrain_platform" });
        body.terrainMeta = t;
        World.add(world, body);
        terrainBodies.push(body);
      }
    }

    // 猪：若初始位置在地形内，向上抬到地形之上，避免被压死
    for (const p of lv.pigs) {
      let px = p.x, py = p.y;
      for (let tries = 0; tries < 30; tries++) {
        const hit = Matter.Query.point(terrainBodies, { x: px, y: py });
        if (hit.length === 0) break;
        py -= 6;
      }
      py = Math.min(py, GROUND_Y - p.r - 1);
      const body = Bodies.circle(px, py, p.r, { density: 0.002, restitution: 0.2, friction: 0.9, frictionStatic: 1.5 });
      body.isPig = true; body.hp = p.hp; body.maxHp = p.hp;
      body.isBoss = !!p.isBoss; body.r = p.r;
      pigs.push(body); World.add(world, body);
    }
    // 方块
    for (const bl of lv.blocks) {
      const isStone = bl.material === "stone";
      const isIce = bl.material === "ice";
      const body = Bodies.rectangle(bl.x, bl.y, bl.w, bl.h, {
        density: isStone ? 0.006 : (isIce ? 0.002 : 0.003),
        friction: isIce ? 0.1 : 0.9,
        frictionStatic: isIce ? 0.3 : 1.5,
        restitution: isIce ? 0.25 : 0.05,
        slop: 0.02
      });
      body.isBlock = true; body.material = bl.material;
      body.hp = isStone ? 4 : (isIce ? 2 : 2);
      body.w = bl.w; body.h = bl.h;
      blocks.push(body); World.add(world, body);
    }

    queue = [...lv.birds];
    state = "AIMING";
    hideOverlay();
    nextBird();
    updateHUD();
  }

  function nextBird() {
    if (queue.length === 0) {
      if (pigs.length === 0) endLevel(true); else endLevel(false);
      return;
    }
    const id = queue.shift();
    const def = BIRDS[id];
    currentDef = def;
    currentBird = Bodies.circle(SLING.x, SLING.y, def.radius, {
      density: def.mass * 0.003, restitution: 0.45, friction: 0.5
    });
    currentBird.isBird = true;
    currentBird.def = def;
    currentBird.skillUsed = !def.skill;
    currentBird.passive = def.passive;
    Body.setStatic(currentBird, true);
    World.add(world, currentBird);
    aim.x = SLING.x; aim.y = SLING.y;
    cameraX = 0;
    state = "AIMING";
    updateHUD();
  }

  function removeBody(b) {
    if (!b || b.removed) return;
    b.removed = true;
    try { World.remove(world, b); } catch(e) {}
    pigs = pigs.filter(x => x !== b);
    blocks = blocks.filter(x => x !== b);
    extras = extras.filter(x => x !== b);
  }

  // ---------- 输入 ----------
  cv.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const [mx, my] = getMouse(e);
    if (state === "AIMING" && currentBird) {
      aim.dragging = true;
      // 立刻把鸟拉到鼠标位置（限制在最大拉距内）
      let dx = mx - SLING.x, dy = my - SLING.y;
      const d = Math.hypot(dx, dy);
      if (d > MAX_PULL) { dx = dx / d * MAX_PULL; dy = dy / d * MAX_PULL; }
      aim.x = SLING.x + dx; aim.y = SLING.y + dy;
      Matter.Body.setPosition(currentBird, { x: aim.x, y: aim.y });
    } else if ((state === "FLYING" || state === "SPLIT") && currentBird && !currentBird.skillUsed && !currentBird.hitSomething && currentDef.skill) {
      currentBird.skillUsed = true;
      currentDef.skill(currentBird, ctx);
      effects.push({ type: "skill", x: currentBird.position.x, y: currentBird.position.y, r: 40, t: 15 });
      updateHUD();
    }
  });
  cv.addEventListener("mousemove", (e) => {
    if (!aim.dragging) return;
    const [mx, my] = getMouse(e);
    let dx = mx - SLING.x, dy = my - SLING.y;
    const d = Math.hypot(dx, dy);
    if (d > MAX_PULL) { dx = dx/d * MAX_PULL; dy = dy/d * MAX_PULL; }
    aim.x = SLING.x + dx; aim.y = SLING.y + dy;
    if (currentBird) Body.setPosition(currentBird, { x: aim.x, y: aim.y });
  });
  cv.addEventListener("mouseup", (e) => {
    if (e.button !== 0 || !aim.dragging) return;
    aim.dragging = false;
    if (!currentBird) return;
    const dx = SLING.x - aim.x, dy = SLING.y - aim.y;
    if (Math.hypot(dx, dy) < 10) return;
    Body.setStatic(currentBird, false);
    Body.setVelocity(currentBird, { x: dx * LAUNCH_K, y: dy * LAUNCH_K });
    // 起飞推力：头 25 帧给额外向前+反重力冲量
    currentBird._thrust = { t: 25, fx: Math.sign(dx) * 0.002, fy: -0.002 };
    state = "FLYING";
    updateHUD();
  });
  function getMouse(e) {
    const r = cv.getBoundingClientRect();
    const sx = (e.clientX - r.left) * (cv.width / r.width);
    const sy = (e.clientY - r.top) * (cv.height / r.height);
    return [sx + cameraX, sy];  // 转为世界坐标
  }

  // ---------- 每帧更新 ----------
  function update() {
    Engine.update(engine, 1000 / 60);

    // 相机：飞行时跟随当前鸟，其它时间回到 0
    let targetCam = 0;
    if (currentBird && (state === "FLYING")) {
      targetCam = currentBird.position.x - W * 0.4;
    }
    targetCam = Math.max(0, Math.min(W_WORLD - W, targetCam));
    cameraX += (targetCam - cameraX) * 0.12;

    // 云动
    for (const c of clouds) { c.x += c.v; if (c.x > W_WORLD + 120) c.x = -120; }

    // 起飞推力（前 N 帧持续轻推）
    if (currentBird && currentBird._thrust && currentBird._thrust.t > 0 && !currentBird.hitSomething) {
      const th = currentBird._thrust;
      Body.applyForce(currentBird, currentBird.position,
        { x: th.fx * currentBird.mass, y: th.fy * currentBird.mass });
      th.t--;
    }

    // 炫舞银绕圈俯冲状态机
    if (currentBird && currentBird._loopDive) {
      const ld = currentBird._loopDive;
      if (ld.phase === "loop") {
        ld.t++;
        ld.angle += 0.12;
        const nx = ld.cx + Math.cos(ld.angle) * ld.r;
        const ny = ld.cy + Math.sin(ld.angle) * ld.r;
        Body.setPosition(currentBird, { x: nx, y: ny });
        Body.setVelocity(currentBird, { x: 0, y: 0 });
        if (ld.t >= 52) {  // 大约绕一圈
          ld.phase = "dive";
          Body.setVelocity(currentBird, { x: 0, y: 24 });
          effects.push({ type: "skill", x: nx, y: ny, r: 50, t: 18 });
        }
      }
      // dive 阶段交给物理引擎，伤害加倍由 _diveDamage 控制
    }

    // 清理死物
    for (const p of [...pigs]) if (p.hp <= 0 || p.position.y > 700) {
      effects.push({ type: "pop", x: p.position.x, y: p.position.y, r: p.r, t: 22 });
      removeBody(p);
    }
    for (const bl of [...blocks]) if (bl.hp <= 0 || bl.position.y > 700) removeBody(bl);
    for (const ex of [...extras]) if (ex.position.y > 700) removeBody(ex);

    // 结算当前鸟
    if ((state === "FLYING") && currentBird) {
      const b = currentBird;
      const v = Math.hypot(b.velocity.x, b.velocity.y);
      b._restT = v < 0.5 ? (b._restT || 0) + 1 : 0;
      const dead = b.position.x > W + 50 || b.position.y > H + 80 || b.removed;
      if (dead || b._restT > 90) {
        removeBody(b);
        currentBird = null;
        if (pigs.length === 0) { endLevel(true); return; }
        // 若有分裂出的额外鸟还活着，切到最靠右的那只作为焦点
        const splitAlive = extras.filter(x => x.isBird && !x.removed);
        if (splitAlive.length > 0) {
          splitAlive.sort((a, b) => b.position.x - a.position.x);
          currentBird = splitAlive[0];
          currentDef = currentBird.def;
          state = "FLYING";
        } else {
          setTimeout(nextBird, 400);
          state = "SETTLED";
        }
      }
    }

    if (pigs.length === 0 && state !== "WIN" && state !== "LOSE") endLevel(true);
    effects = effects.filter(e => --e.t > 0);
  }

  // ---------- 渲染 ----------
  function render() {
    // 天空（屏幕空间，不跟相机动）
    const grad = ctx2d.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#fce8c2");
    grad.addColorStop(0.35, "#a9d5f5");
    grad.addColorStop(0.75, "#cde9b3");
    grad.addColorStop(1, "#8bc34a");
    ctx2d.fillStyle = grad;
    ctx2d.fillRect(0, 0, W, H);

    // 视差背景：远山 0.3x，云 0.5x，背景树 0.8x
    ctx2d.save(); ctx2d.translate(-cameraX * 0.3, 0); drawMountains(); ctx2d.restore();
    ctx2d.save(); ctx2d.translate(-cameraX * 0.5, 0); drawClouds(); ctx2d.restore();
    ctx2d.save(); ctx2d.translate(-cameraX * 0.8, 0); drawBackTrees(); ctx2d.restore();

    // 世界空间：跟随相机
    ctx2d.save();
    ctx2d.translate(-cameraX, 0);

    drawGround();
    for (const t of terrainData) drawTerrain(t);
    drawSling();

    if (state === "AIMING" && aim.dragging) {
      drawTrajectory();
      ctx2d.strokeStyle = "#5d2d0c";
      ctx2d.lineWidth = 5;
      ctx2d.beginPath();
      ctx2d.moveTo(SLING.x - 10, SLING.y - 14);
      ctx2d.lineTo(aim.x, aim.y);
      ctx2d.lineTo(SLING.x + 10, SLING.y - 14);
      ctx2d.stroke();
    }

    for (const b of blocks) drawBlock(b);
    for (const e of extras) e.isBird ? drawBird(e) : drawExtra(e);
    for (const p of pigs) drawPig(p);
    if (currentBird && !currentBird.removed) drawBird(currentBird);
    for (const ef of effects) drawEffect(ef);

    drawFrontTrees();
    drawGrassTufts();

    ctx2d.restore();

    // UI（屏幕空间）
    drawQueuePreview();
    drawMinimap();
  }

  function drawMinimap() {
    const mw = 200, mh = 30, mx = W - mw - 16, my = 12;
    ctx2d.fillStyle = "rgba(0,0,0,.35)";
    ctx2d.fillRect(mx, my, mw, mh);
    ctx2d.strokeStyle = "#fff"; ctx2d.lineWidth = 1;
    ctx2d.strokeRect(mx, my, mw, mh);
    // 视窗
    const vx = mx + (cameraX / W_WORLD) * mw;
    const vw = (W / W_WORLD) * mw;
    ctx2d.fillStyle = "rgba(255,255,255,.35)";
    ctx2d.fillRect(vx, my, vw, mh);
    // 猪
    for (const p of pigs) {
      ctx2d.fillStyle = p.isBoss ? "#e056fd" : "#7ac74f";
      ctx2d.beginPath();
      ctx2d.arc(mx + (p.position.x / W_WORLD) * mw, my + mh / 2, p.isBoss ? 4 : 2, 0, Math.PI * 2);
      ctx2d.fill();
    }
    // 当前鸟
    if (currentBird && !currentBird.removed) {
      ctx2d.fillStyle = "#f1c40f";
      ctx2d.beginPath();
      ctx2d.arc(mx + (currentBird.position.x / W_WORLD) * mw, my + mh / 2, 3, 0, Math.PI * 2);
      ctx2d.fill();
    }
  }

  function drawMountains() {
    // 3 层远山
    const layers = [
      { y: 280, h: 120, color: "rgba(90,110,140,.55)" },
      { y: 320, h: 110, color: "rgba(110,140,160,.65)" },
      { y: 360, h: 100, color: "rgba(140,170,180,.75)" }
    ];
    for (const L of layers) {
      ctx2d.fillStyle = L.color;
      ctx2d.beginPath();
      ctx2d.moveTo(0, L.y + L.h);
      let x = 0;
      while (x < W_WORLD + 40) {
        const peak = 30 + (Math.sin(x * 0.02 + L.y) + 1) * 30;
        ctx2d.lineTo(x, L.y + L.h - peak);
        x += 80;
      }
      ctx2d.lineTo(W_WORLD, L.y + L.h);
      ctx2d.closePath();
      ctx2d.fill();
    }
  }
  function drawClouds() {
    ctx2d.fillStyle = "rgba(255,255,255,.85)";
    for (const c of clouds) {
      const s = c.s;
      ctx2d.beginPath();
      ctx2d.ellipse(c.x, c.y, 40*s, 18*s, 0, 0, Math.PI*2);
      ctx2d.ellipse(c.x + 28*s, c.y + 4*s, 32*s, 16*s, 0, 0, Math.PI*2);
      ctx2d.ellipse(c.x - 26*s, c.y + 6*s, 28*s, 14*s, 0, 0, Math.PI*2);
      ctx2d.fill();
    }
  }
  function drawBackTrees() {
    // 背景树林（远景小树）
    for (let i = 0; i < 28; i++) {
      const x = 30 + i * 75;
      const y = 420;
      ctx2d.fillStyle = "#5d3618";
      ctx2d.fillRect(x - 2, y, 4, 16);
      ctx2d.fillStyle = "rgba(60,120,60,.8)";
      ctx2d.beginPath();
      ctx2d.arc(x, y - 4, 14, 0, Math.PI * 2);
      ctx2d.fill();
    }
  }
  function drawGround() {
    // 起伏草地
    ctx2d.fillStyle = "#6ab04c";
    ctx2d.beginPath();
    ctx2d.moveTo(0, H);
    ctx2d.lineTo(0, GROUND_Y);
    let x = 0;
    while (x <= W_WORLD) {
      ctx2d.lineTo(x, GROUND_Y + Math.sin(x * 0.03) * 3);
      x += 10;
    }
    ctx2d.lineTo(W_WORLD, H);
    ctx2d.closePath();
    ctx2d.fill();
    ctx2d.fillStyle = "#7bc257";
    ctx2d.fillRect(0, GROUND_Y, W_WORLD, 4);
    ctx2d.fillStyle = "#6b3d1e";
    ctx2d.fillRect(0, GROUND_Y + 15, W_WORLD, H - GROUND_Y - 15);
  }
  function drawGrassTufts() {
    ctx2d.strokeStyle = "#3d7d1f";
    ctx2d.lineWidth = 1.5;
    for (let x = 20; x < W_WORLD; x += 40) {
      const gy = GROUND_Y + Math.sin(x * 0.03) * 3;
      ctx2d.beginPath();
      ctx2d.moveTo(x, gy); ctx2d.lineTo(x - 3, gy - 8); ctx2d.moveTo(x, gy); ctx2d.lineTo(x, gy - 10); ctx2d.moveTo(x, gy); ctx2d.lineTo(x + 3, gy - 8);
      ctx2d.stroke();
    }
  }
  function drawFrontTrees() {
    // 前景大树
    for (const tx of [70, 990, 1400, 1960]) {
      ctx2d.fillStyle = "#4a2818";
      ctx2d.fillRect(tx - 6, GROUND_Y - 60, 12, 60);
      ctx2d.fillStyle = "#2e7d32";
      ctx2d.beginPath();
      ctx2d.arc(tx, GROUND_Y - 70, 26, 0, Math.PI * 2);
      ctx2d.arc(tx - 18, GROUND_Y - 60, 22, 0, Math.PI * 2);
      ctx2d.arc(tx + 18, GROUND_Y - 60, 22, 0, Math.PI * 2);
      ctx2d.arc(tx, GROUND_Y - 88, 22, 0, Math.PI * 2);
      ctx2d.fill();
    }
  }
  function drawTerrain(t) {
    ctx2d.save();
    if (t.type === "hill") {
      // 绘制山丘（棕色主体 + 绿顶）
      ctx2d.fillStyle = "#8b5a2b";
      ctx2d.beginPath();
      ctx2d.ellipse(t.x, t.y, t.w / 2, t.h, 0, Math.PI, 0);
      ctx2d.lineTo(t.x + t.w / 2, t.y + 18);
      ctx2d.lineTo(t.x - t.w / 2, t.y + 18);
      ctx2d.closePath();
      ctx2d.fill();
      ctx2d.fillStyle = "#6ab04c";
      ctx2d.beginPath();
      ctx2d.ellipse(t.x, t.y, t.w / 2, t.h, 0, Math.PI, 0);
      ctx2d.lineTo(t.x + t.w / 2, t.y - 4);
      ctx2d.lineTo(t.x - t.w / 2, t.y - 4);
      ctx2d.closePath();
      ctx2d.fill();
    } else if (t.type === "slope") {
      const dir = t.dir || 1;
      ctx2d.fillStyle = "#8b5a2b";
      ctx2d.beginPath();
      if (dir > 0) {
        ctx2d.moveTo(t.x - t.w/2, t.y);
        ctx2d.lineTo(t.x + t.w/2, t.y - t.h);
        ctx2d.lineTo(t.x + t.w/2, t.y + 18);
        ctx2d.lineTo(t.x - t.w/2, t.y + 18);
      } else {
        ctx2d.moveTo(t.x - t.w/2, t.y - t.h);
        ctx2d.lineTo(t.x + t.w/2, t.y);
        ctx2d.lineTo(t.x + t.w/2, t.y + 18);
        ctx2d.lineTo(t.x - t.w/2, t.y + 18);
      }
      ctx2d.closePath();
      ctx2d.fill();
      // 绿边
      ctx2d.strokeStyle = "#6ab04c";
      ctx2d.lineWidth = 6;
      ctx2d.beginPath();
      if (dir > 0) { ctx2d.moveTo(t.x - t.w/2, t.y); ctx2d.lineTo(t.x + t.w/2, t.y - t.h); }
      else { ctx2d.moveTo(t.x - t.w/2, t.y - t.h); ctx2d.lineTo(t.x + t.w/2, t.y); }
      ctx2d.stroke();
    } else if (t.type === "platform") {
      ctx2d.fillStyle = "#a0743a";
      ctx2d.fillRect(t.x - t.w/2, t.y - t.h/2, t.w, t.h);
      ctx2d.strokeStyle = "#5d3618";
      ctx2d.lineWidth = 2;
      ctx2d.strokeRect(t.x - t.w/2, t.y - t.h/2, t.w, t.h);
      ctx2d.fillStyle = "#7bc257";
      ctx2d.fillRect(t.x - t.w/2, t.y - t.h/2 - 2, t.w, 3);
    }
    ctx2d.restore();
  }
  function drawSling() {
    ctx2d.fillStyle = "#5d2d0c";
    ctx2d.fillRect(SLING.x - 6, SLING.y - 14, 12, 110);
    ctx2d.fillRect(SLING.x - 18, SLING.y - 20, 36, 12);
  }
  function drawTrajectory() {
    const dx = (SLING.x - aim.x) * LAUNCH_K;
    const dy = (SLING.y - aim.y) * LAUNCH_K;
    ctx2d.fillStyle = "rgba(255,255,255,.7)";
    for (let t = 0; t < 50; t += 2) {
      const x = SLING.x + dx * t;
      const y = SLING.y + dy * t + 0.5 * 2.0 * t * t * 0.5;
      if (y > GROUND_Y) break;
      ctx2d.beginPath(); ctx2d.arc(x, y, 2.5, 0, Math.PI * 2); ctx2d.fill();
    }
  }
  // —— 按参考图手绘每种鸟 ——
  function drawBird(b) {
    const d = b.def;
    const r = (b.circleRadius || d.radius) * 1.15;  // 画面稍放大
    ctx2d.save();
    ctx2d.translate(b.position.x, b.position.y);
    ctx2d.rotate(b.angle);
    const fn = BIRD_ART[d.id] || BIRD_ART._default;
    fn(r, b);
    if (b.hitSomething) {
      ctx2d.font = `${r * 0.8}px serif`;
      ctx2d.textAlign = "center"; ctx2d.textBaseline = "middle";
      ctx2d.fillText("💫", r * 0.9, -r * 0.9);
    }
    ctx2d.restore();
  }

  // —— 共用部件 ——
  function bodyCircle(r, fillColor, bellyColor) {
    // 主体
    ctx2d.fillStyle = fillColor;
    ctx2d.strokeStyle = "#111";
    ctx2d.lineWidth = Math.max(1.5, r * 0.08);
    ctx2d.beginPath(); ctx2d.arc(0, 0, r, 0, Math.PI * 2); ctx2d.fill(); ctx2d.stroke();
    if (bellyColor) {
      ctx2d.fillStyle = bellyColor;
      ctx2d.beginPath();
      ctx2d.ellipse(0, r * 0.3, r * 0.55, r * 0.4, 0, 0, Math.PI * 2);
      ctx2d.fill();
    }
    // 高光
    ctx2d.fillStyle = "rgba(255,255,255,.18)";
    ctx2d.beginPath();
    ctx2d.ellipse(-r * 0.35, -r * 0.45, r * 0.3, r * 0.18, -0.4, 0, Math.PI * 2);
    ctx2d.fill();
  }
  function eyesPair(r, offsetX = 0.32, offsetY = -0.2, eyeR = 0.22, pupilSide = "center") {
    const ex = r * offsetX, ey = r * offsetY, er = r * eyeR;
    // 白眼
    ctx2d.fillStyle = "#fff";
    ctx2d.strokeStyle = "#111";
    ctx2d.lineWidth = Math.max(1, r * 0.06);
    [-ex, ex].forEach(x => {
      ctx2d.beginPath(); ctx2d.arc(x, ey, er, 0, Math.PI * 2); ctx2d.fill(); ctx2d.stroke();
    });
    // 瞳孔
    ctx2d.fillStyle = "#111";
    const px = pupilSide === "right" ? er * 0.4 : (pupilSide === "left" ? -er * 0.4 : 0);
    [-ex, ex].forEach(x => {
      ctx2d.beginPath(); ctx2d.arc(x + px, ey, er * 0.45, 0, Math.PI * 2); ctx2d.fill();
    });
  }
  function angryBrows(r, color = "#d35400", thick = 0.32, tiltUp = true) {
    // 粗橙色倾斜眉毛（像官方图）
    ctx2d.fillStyle = color;
    ctx2d.strokeStyle = "#111";
    ctx2d.lineWidth = Math.max(1, r * 0.05);
    const bw = r * 0.6, bh = r * thick;
    const y = -r * 0.5;
    // 左
    ctx2d.save();
    ctx2d.translate(-r * 0.35, y);
    ctx2d.rotate(tiltUp ? -0.25 : 0.25);
    ctx2d.beginPath();
    ctx2d.moveTo(-bw * 0.5, -bh * 0.5);
    ctx2d.lineTo(bw * 0.5, 0);
    ctx2d.lineTo(bw * 0.5, bh * 0.6);
    ctx2d.lineTo(-bw * 0.5, bh * 0.5);
    ctx2d.closePath();
    ctx2d.fill(); ctx2d.stroke();
    ctx2d.restore();
    // 右
    ctx2d.save();
    ctx2d.translate(r * 0.35, y);
    ctx2d.rotate(tiltUp ? 0.25 : -0.25);
    ctx2d.beginPath();
    ctx2d.moveTo(bw * 0.5, -bh * 0.5);
    ctx2d.lineTo(-bw * 0.5, 0);
    ctx2d.lineTo(-bw * 0.5, bh * 0.6);
    ctx2d.lineTo(bw * 0.5, bh * 0.5);
    ctx2d.closePath();
    ctx2d.fill(); ctx2d.stroke();
    ctx2d.restore();
  }
  function beak(r, size = 0.4, y = 0.1, orange = "#f39c12") {
    // 尖尖橙喙（菱形/三角）
    ctx2d.fillStyle = orange;
    ctx2d.strokeStyle = "#111";
    ctx2d.lineWidth = Math.max(1, r * 0.06);
    const s = r * size;
    ctx2d.beginPath();
    ctx2d.moveTo(-s * 0.7, y * r);
    ctx2d.lineTo(s * 0.95, y * r - s * 0.25);
    ctx2d.lineTo(s * 0.95, y * r + s * 0.25);
    ctx2d.closePath();
    ctx2d.fill(); ctx2d.stroke();
    // 嘴缝
    ctx2d.strokeStyle = "#111";
    ctx2d.beginPath();
    ctx2d.moveTo(-s * 0.6, y * r);
    ctx2d.lineTo(s * 0.9, y * r);
    ctx2d.stroke();
  }
  function topTuft(r, count = 3, color = "#111") {
    // 头顶尖尖小毛
    ctx2d.strokeStyle = color;
    ctx2d.fillStyle = color;
    ctx2d.lineWidth = Math.max(1, r * 0.1);
    ctx2d.lineCap = "round";
    const baseY = -r * 0.95;
    for (let i = 0; i < count; i++) {
      const t = (i - (count - 1) / 2) * 0.25;
      const x = Math.sin(t) * r * 0.3;
      ctx2d.beginPath();
      ctx2d.moveTo(x, baseY);
      ctx2d.lineTo(x + Math.sin(t) * r * 0.4, baseY - r * 0.5);
      ctx2d.stroke();
    }
  }
  function tailFeathers(r) {
    // 屁股小尾毛（左下）
    ctx2d.strokeStyle = "#111";
    ctx2d.lineWidth = Math.max(1, r * 0.1);
    ctx2d.lineCap = "round";
    [-0.1, 0.1].forEach(off => {
      ctx2d.beginPath();
      ctx2d.moveTo(-r * 0.9, r * 0.2 + off * r);
      ctx2d.lineTo(-r * 1.35, r * 0.1 + off * r);
      ctx2d.stroke();
    });
  }

  // —— 每种鸟的画法 ——
  const BIRD_ART = {
    // 布鲁：亮蓝圆鸟（类 Jay）
    blu(r) {
      bodyCircle(r, "#5dade2", "#d6eaf8");
      tailFeathers(r);
      topTuft(r, 3);
      eyesPair(r, 0.28, -0.2, 0.22);
      angryBrows(r, "#111", 0.3);
      beak(r, 0.42, 0.15);
    },
    // 飞镖黄：黄色三角形身体
    chuck(r) {
      // 三角形身体
      ctx2d.fillStyle = "#f1c40f";
      ctx2d.strokeStyle = "#111";
      ctx2d.lineWidth = Math.max(1.5, r * 0.08);
      ctx2d.beginPath();
      ctx2d.moveTo(0, -r * 1.1);
      ctx2d.lineTo(r * 1.05, r * 0.85);
      ctx2d.lineTo(-r * 1.05, r * 0.85);
      ctx2d.closePath();
      ctx2d.fill(); ctx2d.stroke();
      // 白腹
      ctx2d.fillStyle = "#fff8c4";
      ctx2d.beginPath();
      ctx2d.moveTo(-r * 0.5, r * 0.85);
      ctx2d.lineTo(r * 0.5, r * 0.85);
      ctx2d.lineTo(0, r * 0.2);
      ctx2d.closePath();
      ctx2d.fill();
      // 头顶小毛
      ctx2d.strokeStyle = "#111";
      ctx2d.lineWidth = Math.max(1, r * 0.12);
      ctx2d.beginPath();
      ctx2d.moveTo(0, -r * 1.1);
      ctx2d.lineTo(r * 0.15, -r * 1.6);
      ctx2d.moveTo(-r * 0.1, -r * 1.05);
      ctx2d.lineTo(-r * 0.2, -r * 1.5);
      ctx2d.stroke();
      // 眼睛偏下（因为是三角形）
      eyesPair(r, 0.28, 0.05, 0.2);
      angryBrows(r, "#d35400", 0.3);
      // 喙贴在三角尖
      ctx2d.save(); ctx2d.translate(0, r * 0.35);
      beak(r, 0.35, 0);
      ctx2d.restore();
    },
    // 蓝弟弟：小蓝鸟（Jay 风格）
    blues(r) {
      bodyCircle(r, "#7fb7df", "#e8f3fa");
      topTuft(r, 2);
      eyesPair(r, 0.3, -0.15, 0.24);
      angryBrows(r, "#111", 0.28);
      beak(r, 0.42, 0.2);
    },
    // 白公主：白色蛋型
    matilda(r) {
      // 蛋型身体
      ctx2d.fillStyle = "#fdfefe";
      ctx2d.strokeStyle = "#111";
      ctx2d.lineWidth = Math.max(1.5, r * 0.08);
      ctx2d.beginPath();
      ctx2d.ellipse(0, r * 0.1, r * 0.95, r * 1.05, 0, 0, Math.PI * 2);
      ctx2d.fill(); ctx2d.stroke();
      // 略带阴影
      ctx2d.fillStyle = "#fff8e7";
      ctx2d.beginPath();
      ctx2d.ellipse(0, r * 0.4, r * 0.55, r * 0.45, 0, 0, Math.PI * 2);
      ctx2d.fill();
      topTuft(r, 3);
      eyesPair(r, 0.22, -0.2, 0.22, "center");
      angryBrows(r, "#111", 0.24);
      beak(r, 0.45, 0.1);
    },
    // 炫舞银：银灰（近白）
    silver(r) {
      bodyCircle(r, "#d0d6d9", "#ecf0f1");
      topTuft(r, 2);
      eyesPair(r, 0.3, -0.2, 0.22);
      angryBrows(r, "#111", 0.28);
      beak(r, 0.42, 0.15);
    },
    // 大红：深红大胖鸟
    terence(r) {
      bodyCircle(r, "#922b21", "#f5cba7");
      // 斑点
      ctx2d.fillStyle = "rgba(0,0,0,.25)";
      [[-0.4, 0.1], [0.3, -0.3], [0.5, 0.35]].forEach(([x, y]) => {
        ctx2d.beginPath(); ctx2d.arc(r * x, r * y, r * 0.08, 0, Math.PI * 2); ctx2d.fill();
      });
      tailFeathers(r);
      topTuft(r, 3);
      eyesPair(r, 0.26, -0.15, 0.2);
      angryBrows(r, "#111", 0.3);
      beak(r, 0.4, 0.2);
    },
    // 炸弹黑：黑身白腹带引信
    bomb(r) {
      bodyCircle(r, "#2c3e50", "#ecf0f1");
      // 引信
      ctx2d.strokeStyle = "#b6b6b6";
      ctx2d.lineWidth = Math.max(1.5, r * 0.1);
      ctx2d.lineCap = "round";
      ctx2d.beginPath();
      ctx2d.moveTo(0, -r * 0.95);
      ctx2d.quadraticCurveTo(r * 0.2, -r * 1.3, r * 0.1, -r * 1.55);
      ctx2d.stroke();
      // 火花
      ctx2d.fillStyle = "#f1c40f";
      ctx2d.beginPath(); ctx2d.arc(r * 0.1, -r * 1.6, r * 0.18, 0, Math.PI * 2); ctx2d.fill();
      ctx2d.fillStyle = "#e67e22";
      ctx2d.beginPath(); ctx2d.arc(r * 0.1, -r * 1.6, r * 0.1, 0, Math.PI * 2); ctx2d.fill();
      tailFeathers(r);
      eyesPair(r, 0.3, -0.2, 0.22);
      angryBrows(r, "#d35400", 0.32);
      beak(r, 0.42, 0.15);
    },
    _default(r) {
      bodyCircle(r, "#aaa");
      eyesPair(r);
      angryBrows(r);
      beak(r);
    }
  };
  function drawPig(p) {
    ctx2d.save();
    ctx2d.translate(p.position.x, p.position.y);
    ctx2d.fillStyle = p.isBoss ? "#8e44ad" : "#7ac74f";
    ctx2d.beginPath(); ctx2d.arc(0, 0, p.r, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.strokeStyle = "#222"; ctx2d.lineWidth = 2; ctx2d.stroke();
    ctx2d.font = `${p.r * 1.4}px serif`;
    ctx2d.textAlign = "center"; ctx2d.textBaseline = "middle";
    ctx2d.fillText(p.isBoss ? "👹" : "🐷", 0, 2);
    if (p.maxHp > 1) {
      const w = p.r * 2, ratio = Math.max(0, p.hp / p.maxHp);
      ctx2d.fillStyle = "#333"; ctx2d.fillRect(-w/2, -p.r - 10, w, 5);
      ctx2d.fillStyle = "#e74c3c"; ctx2d.fillRect(-w/2, -p.r - 10, w * ratio, 5);
    }
    ctx2d.restore();
  }
  function drawBlock(b) {
    ctx2d.save();
    ctx2d.translate(b.position.x, b.position.y);
    ctx2d.rotate(b.angle);
    if (b.material === "stone") ctx2d.fillStyle = "#7f8c8d";
    else if (b.material === "ice") ctx2d.fillStyle = "#9ddef0";
    else ctx2d.fillStyle = "#c68a3a";
    ctx2d.fillRect(-b.w/2, -b.h/2, b.w, b.h);
    ctx2d.strokeStyle = b.material === "ice" ? "#4ea8c6" : "#333";
    ctx2d.lineWidth = 1.5;
    ctx2d.strokeRect(-b.w/2, -b.h/2, b.w, b.h);
    if (b.material === "ice") {
      ctx2d.fillStyle = "rgba(255,255,255,.4)";
      ctx2d.fillRect(-b.w/2 + 2, -b.h/2 + 2, b.w - 4, 2);
    }
    ctx2d.restore();
  }
  function drawExtra(e) {
    ctx2d.save();
    ctx2d.translate(e.position.x, e.position.y);
    ctx2d.fillStyle = "#fff";
    ctx2d.beginPath(); ctx2d.arc(0, 0, 11, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.strokeStyle = "#aaa"; ctx2d.stroke();
    ctx2d.font = "15px serif";
    ctx2d.textAlign = "center"; ctx2d.textBaseline = "middle";
    ctx2d.fillText("🥚", 0, 1);
    ctx2d.restore();
  }
  function drawEffect(ef) {
    const a = ef.t / 22;
    if (ef.type === "pop") {
      ctx2d.strokeStyle = `rgba(255,200,0,${a})`;
      ctx2d.lineWidth = 4;
      ctx2d.beginPath(); ctx2d.arc(ef.x, ef.y, ef.r * (1.4 - a), 0, Math.PI * 2); ctx2d.stroke();
    } else if (ef.type === "skill") {
      ctx2d.strokeStyle = `rgba(52,152,219,${a})`;
      ctx2d.lineWidth = 3;
      ctx2d.beginPath(); ctx2d.arc(ef.x, ef.y, ef.r * (1.6 - a), 0, Math.PI * 2); ctx2d.stroke();
    } else if (ef.type === "explode") {
      ctx2d.fillStyle = `rgba(255,120,30,${a * 0.7})`;
      ctx2d.beginPath(); ctx2d.arc(ef.x, ef.y, ef.r * (1.3 - a * 0.5), 0, Math.PI * 2); ctx2d.fill();
      ctx2d.strokeStyle = `rgba(255,60,0,${a})`;
      ctx2d.lineWidth = 5;
      ctx2d.beginPath(); ctx2d.arc(ef.x, ef.y, ef.r * (1.3 - a * 0.5), 0, Math.PI * 2); ctx2d.stroke();
    }
  }
  function drawQueuePreview() {
    ctx2d.save();
    const n = queue.length;
    ctx2d.fillStyle = "rgba(255,255,255,.85)";
    ctx2d.fillRect(20, 505, 34 * n + 12, 46);
    for (let i = 0; i < n; i++) {
      const d = BIRDS[queue[i]];
      ctx2d.font = "22px serif";
      ctx2d.textAlign = "center"; ctx2d.textBaseline = "middle";
      ctx2d.fillText(d.emoji, 40 + i * 34, 528);
    }
    ctx2d.restore();
  }

  // ---------- HUD / Overlay ----------
  function updateHUD() {
    ui.lvl.textContent = `关卡 ${levelIdx + 1} / ${LEVELS.length}`;
    ui.left.textContent = `剩余小鸟：${queue.length + (currentBird ? 1 : 0)}`;
    if (currentDef) {
      ui.cur.textContent = `当前：${currentDef.emoji} ${currentDef.name}`;
      const hit = currentBird && currentBird.hitSomething;
      const used = currentBird && currentBird.skillUsed && currentDef.skill;
      let suffix = "";
      if (hit) suffix = "（已撞击 · 技能不可用）";
      else if (used) suffix = "（已用）";
      ui.skill.textContent = `技能：${currentDef.skillDesc}${suffix}`;
    }
  }
  function endLevel(win) {
    state = win ? "WIN" : "LOSE";
    if (win) {
      if (levelIdx >= LEVELS.length - 1) {
        showOverlay("🎉 全部通关！Blu 拯救了世界！", "再玩一遍", () => { levelIdx = 0; loadLevel(0); });
      } else {
        showOverlay(`✨ 第 ${levelIdx + 1} 关通关！`, "下一关", () => { levelIdx++; loadLevel(levelIdx); });
      }
    } else {
      showOverlay("😢 鸟用完了，再来一次", "重试", () => loadLevel(levelIdx));
    }
  }
  function showOverlay(msg, btnText, cb) {
    ui.msg.textContent = msg;
    ui.btn.textContent = btnText;
    ui.overlay.style.display = "flex";
    ui.btn.onclick = () => { hideOverlay(); cb(); };
  }
  function hideOverlay() { ui.overlay.style.display = "none"; }

  function loop() { update(); render(); requestAnimationFrame(loop); }
  loadLevel(0);
  loop();
})();
