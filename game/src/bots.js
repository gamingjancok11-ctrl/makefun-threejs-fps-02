// The bots. Seven of them: three on the player's team, four against. A bot is a
// body that slides through the same physics as the player, a brain that thinks
// four times a second, and a low-poly soldier mesh the player can shoot.
//
// The brain is a small state machine. Attackers walk a route to their site
// (A-long, mid or B-long), the carrier plants the charge, and everyone defends
// the planted bomb. Defenders hold a site, rotate on the plant, and defuse.
// Any bot that sees an enemy engages: it strafes, fires in bursts, and its
// hit chance falls with distance, target speed and its own movement, so a
// still, aimed player beats a running bot. Gunfire is heard within 25 m:
// a holding bot turns toward it and may go and look.
import * as THREE from 'three';
import { slideMove, hasLineOfSight } from './physics.js';
import { findPath, nearestWaypoint, WAYPOINTS, SITES } from './world.js';
import { WEAPONS } from './weapons.js';
import { PALETTE } from './palette.js';
import { range, pick } from './rng.js';

const BOT_SPEED = 4.6;
const BOT_RADIUS = 0.38;
const BOT_HEIGHT = 1.8;
const EYE = 1.5;
const THINK_EVERY = 0.12;

const NAMES = {
  vanguard: ['Rook', 'Fable', 'Sable'],
  ember: ['Havoc', 'Mira', 'Onyx', 'Dusk'],
};
const TEAM_COLOR = { vanguard: PALETTE.vanguard, ember: PALETTE.ember };

function buildSoldier(team) {
  const group = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: TEAM_COLOR[team], roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: '#1c2027', roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: '#c9a184', roughness: 0.8 });
  const metal = new THREE.MeshStandardMaterial({ color: '#2a2f38', roughness: 0.5, metalness: 0.5 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.72, 0.3), cloth);
  torso.position.y = 1.16;
  torso.userData.part = 'body';
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), skin);
  head.position.y = 1.68;
  head.userData.part = 'head';
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 0.32), dark);
  visor.position.y = 1.7;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.8, 0.2), dark);
  legL.position.set(-0.14, 0.4, 0);
  const legR = legL.clone();
  legR.position.x = 0.14;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.62), metal);
  gun.position.set(0.18, 1.28, -0.35);
  group.add(torso, head, visor, legL, legR, gun);
  group.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.userData.botPart = child.userData.part ?? 'body';
    }
  });
  return { group, head, torso };
}

export function createBots(scene, random) {
  const bots = [];
  for (const team of ['vanguard', 'ember']) {
    for (const name of NAMES[team]) {
      const { group, head, torso } = buildSoldier(team);
      scene.add(group);
      const bot = {
        id: `${team}-${name}`,
        name,
        team,
        skill: range(random, 0.55, 0.85),
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        height: BOT_HEIGHT,
        onGround: true,
        yaw: 0,
        health: 100,
        armor: 0,
        alive: true,
        weapon: 'pistol',
        role: 'defend',
        route: 'A',
        holdNode: 'hA1',
        state: 'hold',
        path: [],
        pathTarget: null,
        target: null,
        targetSeenAt: 0,
        nextShotAt: 0,
        burstLeft: 0,
        burstEndAt: 0,
        strafeDir: 1,
        strafeUntil: 0,
        thinkAt: random() * THINK_EVERY,
        channel: null,
        channelEndAt: 0,
        channelSite: null,
        investigate: null,
        hasBomb: false,
        group,
        headMesh: head,
        torsoMesh: torso,
        deathAt: 0,
      };
      group.userData.bot = bot;
      bots.push(bot);
    }
  }
  return bots;
}

function botWeaponFor(round, index) {
  if (round <= 1) return 'pistol';
  if (round === 2) return 'smg';
  if (round >= 4 && index === 0) return 'sniper';
  return 'rifle';
}

// Places every bot for a new round: role, route, hold spot, weapon, spawn.
// Attackers push a site; defenders hold one. The bomb carrier is chosen by the
// caller afterwards (the player carries on attack rounds; a bot otherwise).
export function setupRound(bots, attackTeam, round, random, spawns) {
  const attackers = bots.filter((b) => b.team === attackTeam);
  const defenders = bots.filter((b) => b.team !== attackTeam);
  const attackRoutes = ['A', 'mid', 'B', 'A'];
  const defendHolds = { A: ['hA1', 'hA2'], B: ['hB1', 'hB2'], mid: ['mw2', 'me2'] };
  let ai = 0;
  let di = 0;
  for (const bot of bots) {
    bot.alive = true;
    bot.health = 100;
    bot.armor = round >= 3 ? 50 : 0;
    bot.target = null;
    bot.path = [];
    bot.channel = null;
    bot.investigate = null;
    bot.hasBomb = false;
    bot.burstLeft = 0;
    bot.group.visible = true;
    bot.group.rotation.set(0, 0, 0);
    bot.group.position.y = 0;
    if (bot.team === attackTeam) {
      const i = ai;
      ai += 1;
      bot.role = 'attack';
      bot.route = attackRoutes[i % attackRoutes.length];
      bot.weapon = botWeaponFor(round, i);
      const spawn = spawns.attack[(i + 1) % spawns.attack.length];
      bot.position.set(spawn[0], 0, spawn[1]);
      bot.yaw = 0;
      bot.state = 'move';
      bot.pathTarget = bot.route === 'mid' ? 'm5' : bot.route === 'A' ? 'sA1' : 'sB1';
      bot.path = findPath(nearestWaypoint(spawn[0], spawn[1]), bot.pathTarget);
    } else {
      const i = di;
      di += 1;
      bot.role = 'defend';
      bot.weapon = botWeaponFor(round, i);
      const site = i % 2 === 0 ? 'A' : 'B';
      bot.holdNode = defendHolds[site][Math.floor(i / 2) % 2];
      const spawn = spawns.defend[(i + 1) % spawns.defend.length];
      bot.position.set(spawn[0], 0, spawn[1]);
      bot.yaw = Math.PI;
      bot.state = 'move';
      bot.pathTarget = bot.holdNode;
      bot.path = findPath(nearestWaypoint(spawn[0], spawn[1]), bot.pathTarget);
    }
    bot.group.position.copy(bot.position);
    bot.group.rotation.y = bot.yaw;
  }
}

const eye = new THREE.Vector3();
const chest = new THREE.Vector3();
const toTarget = new THREE.Vector3();

function canSee(colliders, bot, enemy) {
  eye.set(bot.position.x, bot.position.y + EYE, bot.position.z);
  chest.set(enemy.position.x, enemy.position.y + 1.2, enemy.position.z);
  const dist = eye.distanceTo(chest);
  if (dist > 55) return false;
  toTarget.subVectors(chest, eye).normalize();
  const facing = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
  // A bot sees 100 degrees ahead; a target it already fights stays visible.
  if (bot.target !== enemy && facing.dot(toTarget) < Math.cos(1.75)) return false;
  return hasLineOfSight(colliders, eye, chest);
}

function visibleEnemy(bot, enemies, colliders) {
  let best = null;
  let bestD = Infinity;
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    const d = bot.position.distanceToSquared(enemy.position);
    if (d >= bestD) continue;
    if (canSee(colliders, bot, enemy)) {
      best = enemy;
      bestD = d;
    }
  }
  return best;
}

function setPath(bot, targetNode) {
  bot.pathTarget = targetNode;
  bot.path = findPath(nearestWaypoint(bot.position.x, bot.position.z), targetNode);
}

function moveAlongPath(bot, colliders, dt, speed) {
  if (bot.path.length === 0) return true;
  const [wx, wz] = WAYPOINTS[bot.path[0]];
  const dx = wx - bot.position.x;
  const dz = wz - bot.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.7) {
    bot.path.shift();
    return bot.path.length === 0;
  }
  const wish = { x: (dx / dist) * speed, z: (dz / dist) * speed };
  slideMove(colliders, bot, wish, dt, BOT_RADIUS, 10, 8);
  const wantYaw = Math.atan2(-dx, -dz);
  bot.yaw += shortestAngle(wantYaw - bot.yaw) * Math.min(1, dt * 8);
  return false;
}

function shortestAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function inSite(position, site) {
  const zone = SITES[site].zone;
  return position.x >= zone.minX && position.x <= zone.maxX
    && position.z >= zone.minZ && position.z <= zone.maxZ;
}

// One think tick per bot, staggered: pick a target or a job, then act on it.
// Returns events for the main loop: shots, plants, defuses, pickups.
function think(bot, ctx, now) {
  const events = [];
  if (bot.target && !bot.target.alive) bot.target = null;
  const enemies = bot.team === 'vanguard' ? ctx.ember : ctx.vanguard;
  const seen = visibleEnemy(bot, enemies, ctx.colliders);
  if (seen) {
    if (bot.target !== seen) {
      bot.target = seen;
      // Reaction time: better bots react faster.
      bot.targetSeenAt = now + range(ctx.random, 0.35, 0.7) * (1.15 - bot.skill);
      bot.channel = null;
    }
  } else if (bot.target && !canSee(ctx.colliders, bot, bot.target)) {
    bot.target = null;
  }

  if (bot.target && bot.target.alive) {
    bot.state = 'engage';
    if (bot.channel) bot.channel = null;
    return events.concat(engage(bot, ctx, now));
  }

  // No target: do the job.
  if (bot.role === 'attack') {
    if (ctx.bomb.planted) {
      // Guard the planted bomb from a hold spot near its site.
      const node = ctx.bomb.site === 'A' ? 'sA2' : 'sB2';
      if (bot.pathTarget !== node) setPath(bot, node);
      bot.state = bot.path.length === 0 ? 'hold' : 'move';
    } else if (bot.hasBomb && (inSite(bot.position, 'A') || inSite(bot.position, 'B'))) {
      const site = inSite(bot.position, 'A') ? 'A' : 'B';
      if (!bot.channel) {
        bot.channel = 'plant';
        bot.channelSite = site;
        bot.channelEndAt = now + 3.5;
        bot.state = 'plant';
        events.push({ type: 'plant-start', bot, site });
      } else if (now >= bot.channelEndAt) {
        bot.channel = null;
        bot.hasBomb = false;
        events.push({ type: 'plant', bot, site: bot.channelSite });
      }
    } else if (ctx.bomb.dropped && !ctx.bomb.carrier) {
      // The bomb is on the ground: the nearest attacker goes and gets it.
      const node = nearestWaypoint(ctx.bomb.position.x, ctx.bomb.position.z);
      if (bot.pathTarget !== node) setPath(bot, node);
      bot.state = 'move';
      if (bot.position.distanceTo(ctx.bomb.position) < 1.2) {
        events.push({ type: 'pickup', bot });
      }
    } else if (bot.path.length === 0) {
      // Arrived at the site: the carrier plants, the rest hold the entrances.
      if (bot.hasBomb) {
        const site = bot.route === 'B' ? 'B' : 'A';
        const node = site === 'A' ? 'sA2' : 'sB2';
        if (bot.pathTarget !== node) setPath(bot, node);
        bot.state = 'move';
      } else {
        bot.state = 'hold';
      }
    } else {
      bot.state = 'move';
    }
  } else if (ctx.bomb.planted) {
    // Defenders rotate to the planted site and defuse.
    const dx = bot.position.x - ctx.bomb.position.x;
    const dz = bot.position.z - ctx.bomb.position.z;
    if (Math.hypot(dx, dz) < 1.6) {
      if (!bot.channel) {
        bot.channel = 'defuse';
        bot.channelEndAt = now + 7;
        bot.state = 'defuse';
        events.push({ type: 'defuse-start', bot });
      } else if (now >= bot.channelEndAt) {
        bot.channel = null;
        events.push({ type: 'defuse', bot });
      }
    } else {
      const node = ctx.bomb.site === 'A' ? 'sA2' : 'sB2';
      if (bot.pathTarget !== node) setPath(bot, node);
      bot.state = 'move';
    }
  } else if (bot.investigate) {
    const node = nearestWaypoint(bot.investigate.x, bot.investigate.z);
    if (bot.pathTarget !== node) setPath(bot, node);
    bot.state = 'move';
    if (bot.path.length === 0) bot.investigate = null;
  } else if (bot.path.length === 0) {
    bot.state = 'hold';
  } else {
    bot.state = 'move';
  }
  return events;
}

function engage(bot, ctx, now) {
  const events = [];
  const enemy = bot.target;
  const dx = enemy.position.x - bot.position.x;
  const dz = enemy.position.z - bot.position.z;
  const dist = Math.hypot(dx, dz);
  // Face the enemy and strafe; a moving target is harder to hit.
  bot.yaw += shortestAngle(Math.atan2(-dx, -dz) - bot.yaw) * 0.5;
  if (now > bot.strafeUntil) {
    bot.strafeDir = Math.random() < 0.5 ? -1 : 1;
    bot.strafeUntil = now + range(ctx.random, 0.6, 1.4);
  }
  const strafeX = -dz / (dist || 1) * bot.strafeDir;
  const strafeZ = dx / (dist || 1) * bot.strafeDir;
  const wish = { x: strafeX * BOT_SPEED * 0.5, z: strafeZ * BOT_SPEED * 0.5 };
  slideMove(ctx.colliders, bot, wish, ctx.dt, BOT_RADIUS, 10, 8);

  if (now < bot.targetSeenAt || now < bot.nextShotAt) return events;
  const def = WEAPONS[bot.weapon];
  if (bot.burstLeft <= 0) {
    if (now < bot.burstEndAt) return events;
    bot.burstLeft = def.auto ? 3 + Math.floor(ctx.random() * 3) : 1;
  }
  bot.burstLeft -= 1;
  bot.nextShotAt = now + def.fireGap;
  if (bot.burstLeft <= 0) bot.burstEndAt = now + range(ctx.random, 0.4, 0.9);

  // Hit chance: skill, distance, target speed, own movement.
  const targetSpeed = Math.hypot(enemy.velocity.x, enemy.velocity.z);
  let chance = bot.skill * (1 - Math.min(0.45, dist / def.range * 0.45));
  if (targetSpeed > 3) chance *= 0.7;
  if (targetSpeed > 0.5 && targetSpeed <= 3) chance *= 0.9;
  chance *= 0.85; // the bot is strafing while it shoots
  const hit = ctx.random() < chance;
  const head = hit && ctx.random() < 0.12;
  const falloff = Math.max(0.55, 1 - dist / (def.range * 2));
  const damage = hit ? def.damage * (head ? def.headMult : 1) * falloff : 0;
  events.push({ type: 'shot', bot, target: enemy, hit, head, damage });
  return events;
}

// The per-frame bot update: think on a staggered clock, move on the fixed step.
// ctx: { colliders, vanguard, ember, random, dt, bomb, time } where vanguard and
// ember are the fighter lists (bots plus the player on their team).
export function updateBots(bots, ctx, dt, now) {
  const events = [];
  ctx.dt = dt;
  for (const bot of bots) {
    if (!bot.alive) continue;
    if (now >= bot.thinkAt) {
      bot.thinkAt = now + THINK_EVERY;
      events.push(...think(bot, ctx, now));
    }
    if (bot.state === 'move' || bot.state === 'hold') {
      if (bot.state === 'move') moveAlongPath(bot, ctx.colliders, dt, BOT_SPEED);
      else if (bot.state === 'hold') {
        // Holding bots sweep their view slowly, listening for the fight.
        bot.yaw += Math.sin(now * 0.5 + bot.skill * 10) * dt * 0.4;
        slideMove(ctx.colliders, bot, { x: 0, z: 0 }, dt, BOT_RADIUS, 10, 8);
      }
    } else if (bot.state === 'plant' || bot.state === 'defuse') {
      slideMove(ctx.colliders, bot, { x: 0, z: 0 }, dt, BOT_RADIUS, 10, 8);
    }
    bot.group.position.copy(bot.position);
    bot.group.rotation.y = bot.yaw;
  }
  return events;
}

// A gunshot at (x, z) on one team: enemy bots nearby turn toward it, and a
// holding defender may go and look. Hearing is what makes the bots react to
// a fight they cannot see.
export function hearShot(bots, x, z, team, random) {
  for (const bot of bots) {
    if (!bot.alive || bot.team === team || bot.target) continue;
    const dx = bot.position.x - x;
    const dz = bot.position.z - z;
    const dist = Math.hypot(dx, dz);
    if (dist > 25) continue;
    bot.yaw = Math.atan2(dx, dz);
    if (bot.state === 'hold' && random() < 0.5) {
      bot.investigate = { x, z };
    }
  }
}

export function killBot(bot, now) {
  bot.alive = false;
  bot.target = null;
  bot.channel = null;
  bot.deathAt = now;
  bot.group.rotation.x = -Math.PI / 2;
  bot.group.position.y = 0.25;
}
