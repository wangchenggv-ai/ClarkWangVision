// 7 种小鸟 — 全部使用真实鸟类 emoji
// passive：被动效果（碰到特定材质即破坏）
// skill(body, ctx)：主动技能

const BIRDS = {
  blu: {
    id: "blu", name: "布鲁", emoji: "🦜", color: "#3498db",
    mass: 0.6, radius: 11,
    skillDesc: "向前强力推进",
    skill(body) {
      const v = body.velocity;
      const mag = Math.hypot(v.x, v.y) || 1;
      Matter.Body.applyForce(body, body.position, {
        x: (v.x / mag) * 0.15,
        y: (v.y / mag) * 0.15
      });
      const k = 1.8;
      Matter.Body.setVelocity(body, { x: v.x * k, y: v.y * k });
    }
  },
  chuck: {
    id: "chuck", name: "飞镖黄", emoji: "🐤", color: "#f1c40f",
    mass: 0.35, radius: 10,
    passive: "breakWood",
    skillDesc: "碰木即破 · 技能：加速",
    skill(body) {
      const v = body.velocity;
      const mag = Math.hypot(v.x, v.y) || 1;
      Matter.Body.setVelocity(body, { x: (v.x / mag) * 28, y: (v.y / mag) * 28 });
    }
  },
  blues: {
    id: "blues", name: "蓝弟弟", emoji: "🐦", color: "#5dade2",
    mass: 0.3, radius: 8,
    passive: "breakIce",
    skillDesc: "碰冰即破 · 技能：分裂成 3 只",
    skill(body, ctx) {
      const v = body.velocity;
      const angle = Math.atan2(v.y, v.x);
      const speed = Math.hypot(v.x, v.y);
      const spread = 0.35; // 约 ±20°
      const px = body.position.x, py = body.position.y;
      // 删除本体
      ctx.removeBody(body);
      // 生成 3 只
      const offs = [-spread, 0, spread];
      const newBirds = [];
      for (let i = 0; i < 3; i++) {
        const a = angle + offs[i];
        const nb = Matter.Bodies.circle(px + Math.cos(a) * 14, py + Math.sin(a) * 14, 7, {
          density: 0.002, restitution: 0.5, friction: 0.4
        });
        nb.isBird = true;
        nb.def = BIRDS.blues;
        nb.skillUsed = true;     // 分裂出来的不能再分裂
        nb.passive = "breakIce";
        nb.isSplit = true;
        Matter.Body.setVelocity(nb, { x: Math.cos(a) * speed, y: Math.sin(a) * speed });
        Matter.World.add(ctx.world, nb);
        ctx.extras.push(nb);
        newBirds.push(nb);
      }
      // 让第一只成为新的"当前鸟"跟踪
      ctx.setCurrent(newBirds[0]);
    }
  },
  matilda: {
    id: "matilda", name: "白公主", emoji: "🕊️", color: "#ecf0f1",
    mass: 0.5, radius: 10,
    skillDesc: "下蛋（重力炸弹）",
    skill(body, ctx) {
      const egg = Matter.Bodies.circle(body.position.x, body.position.y + 32, 11, {
        density: 0.005, restitution: 0.2, label: "egg"
      });
      egg.isEgg = true; egg.damage = 3;
      Matter.World.add(ctx.world, egg);
      ctx.extras.push(egg);
      Matter.Body.setVelocity(body, { x: body.velocity.x * 0.5, y: -9 });
    }
  },
  silver: {
    id: "silver", name: "炫舞银", emoji: "🦢", color: "#bdc3c7",
    mass: 0.55, radius: 11,
    skillDesc: "空中绕圈 → 垂直高速俯冲",
    skill(body, ctx) {
      // 启动 loop-dive 状态机，由 game.js 每帧推进
      body._loopDive = {
        phase: "loop",   // loop -> dive
        t: 0,
        cx: body.position.x,
        cy: body.position.y - 60,
        r: 60,
        angle: Math.PI    // 从左侧开始画圈
      };
      body._diveDamage = true;  // 伤害加倍标记
    }
  },
  terence: {
    id: "terence", name: "大红", emoji: "🦅", color: "#922b21",
    mass: 2.0, radius: 17,
    skillDesc: "吨位极高（无主动技能）"
    // 无 skill 方法
  },
  bomb: {
    id: "bomb", name: "炸弹黑", emoji: "🦉", color: "#2c3e50",
    mass: 1.15, radius: 12,
    skillDesc: "爆炸：范围冲击+伤害",
    skill(body, ctx) {
      const cx = body.position.x, cy = body.position.y, R = 150;
      const all = [...ctx.pigs, ...ctx.blocks];
      for (const b of all) {
        const dx = b.position.x - cx, dy = b.position.y - cy;
        const d = Math.hypot(dx, dy);
        if (d < R && d > 0) {
          const f = 0.1 * (1 - d / R);
          Matter.Body.applyForce(b, b.position, { x: (dx / d) * f, y: (dy / d) * f - 0.03 });
          if (b.isPig) b.hp -= 3;
          if (b.isBlock) b.hp = (b.hp || 2) - 2;
        }
      }
      ctx.addEffect({ type: "explode", x: cx, y: cy, r: R, t: 25 });
      ctx.removeBody(body);
    }
  }
};
