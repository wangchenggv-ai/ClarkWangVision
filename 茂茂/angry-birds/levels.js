// 10 关卡 — 每关都是一座高楼，猪猪住在楼里
// 画布 2048（世界）× 576；地面 y≈540；弹弓在 x=170
// 楼靠右布置（x≈1350~1800），给飞行预留足够距离

const GROUND_SURF = 540;

// 构造一座高楼：左右墙 + 每层楼板 + 每层内 1 只猪 + 屋顶
// opts: { width, fh, mats:[按层循环的材质], pigHps:[每层猪血], boss:{r,hp} }
function tower(cx, floors, opts = {}) {
  const width = opts.width || 130;
  const fh = opts.fh || 82;
  const mats = opts.mats || ["wood"];
  const hps = opts.pigHps || [];
  const boss = opts.boss || null;
  const wallT = 14;
  const blocks = [], pigs = [];

  for (let i = 0; i < floors; i++) {
    const floorBottom = GROUND_SURF - i * fh;     // 本层底
    const floorTop = floorBottom - fh;             // 本层顶
    const cy = (floorBottom + floorTop) / 2;
    const mat = mats[i % mats.length];

    // 左右墙
    blocks.push({ x: cx - width/2, y: cy + 2, w: wallT, h: fh - 8, material: mat });
    blocks.push({ x: cx + width/2, y: cy + 2, w: wallT, h: fh - 8, material: mat });
    // 楼板（从第二层起）
    if (i > 0) {
      blocks.push({ x: cx, y: floorBottom - 5, w: width + wallT - 4, h: 10, material: mat });
    }
    // 住户猪
    pigs.push({ x: cx, y: floorBottom - 22, r: 18, hp: hps[i] || 1 });
  }

  // 屋顶
  const topY = GROUND_SURF - floors * fh;
  blocks.push({ x: cx, y: topY + 6, w: width + wallT + 12, h: 14, material: "stone" });

  // BOSS 站在屋顶
  if (boss) {
    pigs.push({ x: cx, y: topY - (boss.r || 50), r: boss.r, hp: boss.hp, isBoss: true });
  }

  return { blocks, pigs };
}

function L(id, birds, cx, floors, opts, terrain = []) {
  const t = tower(cx, floors, opts);
  return { id, birds, terrain, blocks: t.blocks, pigs: t.pigs };
}

const LEVELS = [
  // ========== 关 1：三层木楼 ==========
  L(1, ["blu", "chuck", "blu", "blues"], 1380, 3, {
    width: 115, fh: 80, mats: ["wood"], pigHps: [1, 1, 1]
  }),

  // ========== 关 2：冰木混搭 ==========
  L(2, ["blu", "chuck", "blues", "blu"], 1430, 3, {
    width: 125, fh: 82, mats: ["wood", "ice", "wood"], pigHps: [1, 1, 1]
  }, [
    { type: "hill", x: 1100, y: 520, w: 180, h: 40 }
  ]),

  // ========== 关 3：石墙四层 ==========
  L(3, ["blu", "chuck", "blues", "bomb"], 1500, 4, {
    width: 130, fh: 82, mats: ["stone", "wood", "wood", "stone"], pigHps: [2, 1, 1, 2]
  }),

  // ========== 关 4：蛋袭 ==========
  L(4, ["blu", "matilda", "chuck", "blues", "bomb"], 1500, 4, {
    width: 135, fh: 84, mats: ["wood", "ice", "stone", "wood"], pigHps: [1, 2, 1, 2]
  }, [
    { type: "slope", x: 900, y: 520, w: 200, h: 55, dir: 1 }
  ]),

  // ========== 关 5：中期 BOSS 楼顶 ==========
  L(5, ["blu", "bomb", "chuck", "matilda", "blues", "blues"], 1600, 5, {
    width: 140, fh: 84, mats: ["stone", "wood", "wood", "ice", "stone"],
    pigHps: [2, 1, 2, 1, 2],
    boss: { r: 50, hp: 24 }
  }),

  // ========== 关 6：五层石冰塔 ==========
  L(6, ["blu", "silver", "chuck", "bomb", "blues"], 1550, 5, {
    width: 130, fh: 82, mats: ["stone", "ice", "wood", "ice", "stone"],
    pigHps: [2, 1, 2, 1, 2]
  }, [
    { type: "platform", x: 1100, y: 390, w: 160, h: 12 }
  ]),

  // ========== 关 7：六层楼 ==========
  L(7, ["blu", "silver", "bomb", "chuck", "matilda", "blues"], 1600, 6, {
    width: 130, fh: 80, mats: ["stone", "wood", "stone", "ice", "wood", "stone"],
    pigHps: [2, 2, 1, 2, 1, 2]
  }),

  // ========== 关 8：石堡六层 ==========
  L(8, ["blu", "terence", "bomb", "chuck", "silver", "blues"], 1600, 6, {
    width: 140, fh: 82, mats: ["stone", "stone", "wood", "stone", "wood", "stone"],
    pigHps: [3, 2, 2, 2, 1, 2]
  }, [
    { type: "hill", x: 950, y: 520, w: 180, h: 50 }
  ]),

  // ========== 关 9：七层混构 ==========
  L(9, ["blu", "silver", "bomb", "chuck", "terence", "matilda", "blues"], 1650, 7, {
    width: 140, fh: 80, mats: ["stone", "wood", "ice", "stone", "ice", "wood", "stone"],
    pigHps: [3, 2, 2, 2, 2, 1, 2]
  }),

  // ========== 关 10：终极 BOSS 摩天楼 ==========
  L(10, ["blu", "terence", "bomb", "silver", "bomb", "chuck", "matilda", "blues"], 1700, 7, {
    width: 150, fh: 82, mats: ["stone", "stone", "wood", "stone", "ice", "stone", "stone"],
    pigHps: [3, 3, 2, 3, 2, 3, 3],
    boss: { r: 64, hp: 36 }
  }, [
    { type: "hill", x: 1000, y: 520, w: 200, h: 50 }
  ])
];
