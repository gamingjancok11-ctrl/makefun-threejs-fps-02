// BREAKLINE — the entry point. This file owns the loop and nothing else: a fixed
// 60 Hz simulation step (movement, bots, grenades, the bomb, the round clock)
// decoupled from rendering, one state object per concern, and the wiring between
// them. The rules live in their modules; this file only calls them in order.
//
// ?shot=start|play|buy|end&seed=N stages a deterministic frame for screenshots
// and sets window.__shotReady after two renders, with the simulation frozen.
import * as THREE from 'three';
import { mulberry32, range, pick } from './rng.js';
import { buildWorld, SITES, SPAWNS } from './world.js';
import { createPlayer, updatePlayer, updateCamera, addRecoil, eyePosition, aimDirection } from './player.js';
import { WEAPONS, createLoadout, currentWeapon, currentSpread, switchTo, createViewModel } from './weapons.js';
import { createBots, setupRound, updateBots, hearShot, killBot } from './bots.js';
import { createBomb, carryBomb, dropBomb, plantBomb, resetBomb, updateBomb, PLANT_TIME, DEFUSE_TIME } from './bomb.js';
import { createGrenades, throwGrenade, updateGrenades } from './grenades.js';
import { createEconomy, roundReward, killReward, buy } from './economy.js';
import {
  createMatch, attackTeam, defendTeam, startRound, startLive,
  endRound, nextRound, matchWinner, reasonText,
} from './rounds.js';
import {
  createSound, ensureSound, playShot, playReload, playHit, playKill, playDry,
  playExplosion, playBeep, playPlant, playDefuse, playRoundEnd, playBuy, playClick,
} from './sound.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';

const STEP = 1 / 60;
const BASE_FOV = 74;
const SCOPED_FOV = 30;
const PLAYER_TEAM = 'vanguard';

const params = new URLSearchParams(window.location.search);
const shotMode = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

// --- boot -----------------------------------------------------------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.05, 200);
scene.add(camera);

const world = buildWorld(scene);
const sound = createSound();
const hud = createHud();
const input = createInput(canvas);

const player = createPlayer(SPAWNS.attack[0]);
player.team = PLAYER_TEAM;
player.name = 'You';
player.isPlayer = true;
const bots = createBots(scene, random);
const bomb = createBomb(scene);
const grenades = createGrenades(scene);
const loadout = createLoadout();
const economy = createEconomy();
const match = createMatch();
const viewModel = createViewModel(camera);

const vanguardFighters = [player, ...bots.filter((b) => b.team === 'vanguard')];
const emberFighters = bots.filter((b) => b.team === 'ember');
const allFighters = [...vanguardFighters, ...emberFighters];
const shootTargets = [...bots.map((b) => b.group), ...world.solids];

let now = 0;
let playing = false;
let buyOpen = false;
let frozenShot = false;
let channel = null;
let channelProgress = 0;
let trauma = 0;
let prevMouseDown = false;
let nextGrenadeAt = 0;
let framesRendered = 0;

const raycaster = new THREE.Raycaster();
const eye = new THREE.Vector3();
const aim = new THREE.Vector3();
const spreadDir = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3();
const tracers = [];

// --- rounds ---------------------------------------------------------------
function setupRoundForMatch() {
  const attack = attackTeam(match);
  setupRound(bots, attack, match.round, random, SPAWNS);
  // The player spawns with their side and faces the fight.
  const role = attack === PLAYER_TEAM ? 'attack' : 'defend';
  const spawn = SPAWNS[role][0];
  player.position.set(spawn[0], 0, spawn[1]);
  player.velocity.set(0, 0, 0);
  player.yaw = role === 'attack' ? 0 : Math.PI;
  player.pitch = 0;
  player.recoil = 0;
  player.health = 100;
  player.alive = true;
  player.crouched = false;
  loadout.nextShotAt = 0;
  loadout.reloading = null;
  loadout.scoped = false;
  loadout.bloom = 0;
  resetBomb(bomb);
  if (attack === PLAYER_TEAM) {
    carryBomb(bomb, player);
  } else {
    const carrier = pick(random, bots.filter((b) => b.team === attack));
    carryBomb(bomb, carrier);
    carrier.hasBomb = true;
  }
  for (const grenade of grenades.live) scene.remove(grenade.mesh);
  grenades.live.length = 0;
  channel = null;
  hud.setDead(false);
  hud.hideBanner();
  hud.setChannel(null, 0);
  buyOpen = false;
  hud.setBuy(false, economy.money);
}

function finishRound(winner, reason) {
  if (match.phase !== 'live') return;
  const over = endRound(match, winner, reason, now);
  const playerWon = winner === PLAYER_TEAM;
  const reward = roundReward(economy, playerWon);
  hud.showBanner(
    playerWon ? 'ROUND WON' : 'ROUND LOST',
    `${reasonText(reason)}  ·  ${playerWon ? '+' : ''}$${reward.toLocaleString('en-US')}`,
    playerWon,
  );
  playRoundEnd(sound, playerWon);
  buyOpen = false;
  hud.setBuy(false, economy.money);
  hud.setChannel(null, 0);
  channel = null;
  if (over) {
    // The end overlay appears when the end banner's time is up.
  }
}

function checkElimination() {
  if (match.phase !== 'live') return;
  const vAlive = vanguardFighters.some((f) => f.alive);
  const eAlive = emberFighters.some((f) => f.alive);
  if (bomb.state === 'planted') {
    // With the charge planted, the round only ends early when the defenders
    // are all down — nobody left to defuse. Dead attackers just wait it out.
    const defendersAlive = defendTeam(match) === 'vanguard' ? vAlive : eAlive;
    if (!defendersAlive) finishRound(attackTeam(match), 'elimination');
    return;
  }
  if (!vAlive) finishRound('ember', 'elimination');
  else if (!eAlive) finishRound('vanguard', 'elimination');
}

// --- damage ---------------------------------------------------------------
function applyDamage(victim, amount, attacker, head) {
  if (!victim.alive || match.phase !== 'live') return;
  const absorbed = Math.min(victim.armor, amount * 0.5);
  victim.armor -= absorbed;
  victim.health -= (amount - absorbed);
  if (victim.isPlayer) {
    hud.damageFlash();
    trauma = Math.min(1, trauma + 0.25);
  }
  if (victim.health > 0) return;
  victim.health = 0;
  victim.alive = false;
  if (victim.isPlayer) {
    hud.setDead(true);
    loadout.scoped = false;
    if (bomb.carrier === player) dropBomb(bomb, player.position);
  } else {
    killBot(victim, now);
    if (victim.hasBomb) {
      victim.hasBomb = false;
      dropBomb(bomb, victim.position);
    }
  }
  hud.addKill(attacker.name, victim.name, head, attacker.team, victim.team);
  if (attacker.isPlayer) {
    killReward(economy);
    playKill(sound);
  }
  checkElimination();
}

// --- player combat --------------------------------------------------------
function spawnTracer(from, to) {
  let tracer = tracers.find((t) => t.age >= 0.09);
  if (!tracer) {
    if (tracers.length >= 10) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({
      color: '#ffcf6e', transparent: true, opacity: 0.7,
    }));
    scene.add(line);
    tracer = { line, age: 0 };
    tracers.push(tracer);
  }
  const pos = tracer.line.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  tracer.age = 0;
  tracer.line.visible = true;
}

const hitPoint = new THREE.Vector3();
function playerShoot() {
  const def = currentWeapon(loadout);
  const ammo = loadout.ammo[loadout.current];
  if (now < loadout.nextShotAt || loadout.reloading) return;
  if (ammo.mag <= 0) {
    playDry(sound);
    startReload();
    return;
  }
  ammo.mag -= 1;
  loadout.nextShotAt = now + def.fireGap;
  loadout.bloom = Math.min(0.03, loadout.bloom + def.bloom);
  addRecoil(player, def.recoil);
  viewModel.onShot(now);
  playShot(sound, def.id, 0);
  hearShot(bots, player.position.x, player.position.z, PLAYER_TEAM, random);

  eyePosition(player, eye);
  aimDirection(player, aim);
  const moving = player.speed > 0.5;
  const spread = currentSpread(def, player, loadout, moving, !player.onGround);
  right.set(1, 0, 0).cross(aim).normalize();
  if (right.lengthSq() < 0.01) right.set(0, 0, 1);
  up.crossVectors(right, aim).normalize();
  spreadDir.copy(aim)
    .addScaledVector(right, (random() * 2 - 1) * spread)
    .addScaledVector(up, (random() * 2 - 1) * spread)
    .normalize();
  raycaster.set(eye, spreadDir);
  raycaster.far = def.range;
  const hits = raycaster.intersectObjects(shootTargets, true);
  let end = hitPoint.copy(eye).addScaledVector(spreadDir, def.range);
  for (const hit of hits) {
    let node = hit.object;
    let bot = null;
    while (node) {
      if (node.userData.bot) { bot = node.userData.bot; break; }
      node = node.parent;
    }
    if (bot) {
      if (!bot.alive) continue;
      const head = hit.object.userData.botPart === 'head';
      const falloff = Math.max(0.55, 1 - hit.distance / (def.range * 2));
      const damage = def.damage * (head ? def.headMult : 1) * falloff;
      applyDamage(bot, damage, player, head);
      hud.hitmarker(head);
      playHit(sound, head);
      end = hit.point;
      break;
    }
    end = hit.point;
    break;
  }
  spawnTracer(eye, end);
}

function startReload() {
  const def = currentWeapon(loadout);
  const ammo = loadout.ammo[loadout.current];
  if (loadout.reloading || ammo.mag >= def.mag || ammo.reserve <= 0) return;
  loadout.reloading = loadout.current;
  loadout.reloadEndAt = now + def.reloadTime;
  viewModel.reloadDip = 1;
  playReload(sound);
}

function finishReload() {
  const def = WEAPONS[loadout.reloading];
  const ammo = loadout.ammo[loadout.reloading];
  const needed = def.mag - ammo.mag;
  const taken = Math.min(needed, ammo.reserve);
  ammo.mag += taken;
  ammo.reserve -= taken;
  loadout.reloading = null;
  viewModel.reloadDip = 0;
}

function throwPlayerGrenade() {
  if (loadout.grenades <= 0 || now < nextGrenadeAt) return;
  loadout.grenades -= 1;
  nextGrenadeAt = now + 0.8;
  eyePosition(player, eye);
  aimDirection(player, aim);
  throwGrenade(grenades, eye, aim, player);
  playClick(sound);
}

// --- bomb channels --------------------------------------------------------
function inSite(position, site) {
  const zone = SITES[site].zone;
  return position.x >= zone.minX && position.x <= zone.maxX
    && position.z >= zone.minZ && position.z <= zone.maxZ;
}

function playerSite() {
  if (inSite(player.position, 'A')) return 'A';
  if (inSite(player.position, 'B')) return 'B';
  return null;
}

function updateChannel(dt) {
  const wantPlant = bomb.carrier === player && playerSite() !== null;
  const wantDefuse = bomb.state === 'planted' && defendTeam(match) === PLAYER_TEAM
    && player.position.distanceTo(bomb.position) < 1.8;
  const holding = input.keys.has('KeyE');
  const want = holding && player.alive && match.phase === 'live'
    ? wantPlant ? 'plant' : wantDefuse ? 'defuse' : null
    : null;
  if (want !== channel) {
    channel = want;
    channelProgress = 0;
  }
  if (!channel) {
    hud.setChannel(null, 0);
    return;
  }
  const duration = channel === 'plant' ? PLANT_TIME : DEFUSE_TIME;
  channelProgress += dt;
  hud.setChannel(
    channel === 'plant' ? `PLANTING AT SITE ${playerSite()}` : 'DEFUSING THE CHARGE',
    channelProgress / duration,
  );
  if (channelProgress >= duration) {
    if (channel === 'plant') {
      plantBomb(bomb, playerSite(), player.position, now);
      playPlant(sound);
    } else {
      bomb.state = 'defused';
      playDefuse(sound);
      finishRound(PLAYER_TEAM, 'defuse');
    }
    channel = null;
    channelProgress = 0;
    hud.setChannel(null, 0);
  }
}

function updatePrompt() {
  if (!player.alive || match.phase !== 'live') {
    hud.setPrompt(null);
    return;
  }
  if (bomb.carrier === player) {
    hud.setPrompt(playerSite() ? 'Hold E to plant the charge' : 'You carry the charge — take it to site A or B');
    return;
  }
  if (bomb.state === 'dropped' && attackTeam(match) === PLAYER_TEAM
    && player.position.distanceTo(bomb.position) < 3) {
    hud.setPrompt('Walk over the charge to pick it up');
    return;
  }
  if (bomb.state === 'planted' && defendTeam(match) === PLAYER_TEAM
    && player.position.distanceTo(bomb.position) < 3) {
    hud.setPrompt('Hold E to defuse the charge');
    return;
  }
  hud.setPrompt(null);
}

// --- bot events -----------------------------------------------------------
function handleBotEvents(events) {
  for (const event of events) {
    if (event.type === 'shot') {
      const dist = event.bot.position.distanceTo(player.position);
      playShot(sound, event.bot.weapon, dist);
      hearShot(bots, event.bot.position.x, event.bot.position.z, event.bot.team, random);
      if (event.hit) applyDamage(event.target, event.damage, event.bot, event.head);
    } else if (event.type === 'plant') {
      plantBomb(bomb, event.site, event.bot.position, now);
      playPlant(sound);
    } else if (event.type === 'defuse') {
      bomb.state = 'defused';
      playDefuse(sound);
      finishRound(defendTeam(match), 'defuse');
    } else if (event.type === 'pickup') {
      carryBomb(bomb, event.bot);
      event.bot.hasBomb = true;
    }
  }
}

// --- the fixed step -------------------------------------------------------
function step(dt) {
  now += dt;
  loadout.bloom = Math.max(0, loadout.bloom - dt * 0.05);

  if (match.phase === 'buy' && now >= match.phaseEndAt) {
    startLive(match, now);
    buyOpen = false;
    hud.setBuy(false, economy.money);
  } else if (match.phase === 'live' && now >= match.phaseEndAt && bomb.state !== 'planted') {
    finishRound(defendTeam(match), 'time');
  } else if (match.phase === 'end' && now >= match.phaseEndAt) {
    if (match.over) {
      const winner = matchWinner(match);
      hud.showEnd(
        winner === 'draw' ? 'DRAW' : winner === PLAYER_TEAM ? 'VANGUARD WINS THE MATCH' : 'EMBER WINS THE MATCH',
        `${match.score.vanguard} — ${match.score.ember}`,
      );
      input.exitLock();
      playing = false;
    } else {
      nextRound(match);
      setupRoundForMatch();
      startRound(match, now);
      buyOpen = true;
      hud.setBuy(true, economy.money);
      hud.setBuyMessage('Buy phase — 1-5 to buy, B to close');
    }
  }

  const live = match.phase === 'live';
  const frozen = match.phase !== 'live' || !player.alive;

  // Single-fire keys, consumed as they are handled.
  if (input.pressed.has('KeyR')) { input.pressed.delete('KeyR'); if (live) startReload(); }
  if (input.pressed.has('KeyG')) { input.pressed.delete('KeyG'); if (live && player.alive) throwPlayerGrenade(); }
  if (input.pressed.has('Digit1')) {
    input.pressed.delete('Digit1');
    if (!buyOpen && loadout.primary && switchTo(loadout, loadout.primary)) viewModel.setWeapon(loadout.current);
  }
  if (input.pressed.has('Digit2')) {
    input.pressed.delete('Digit2');
    if (!buyOpen && switchTo(loadout, loadout.sidearm)) viewModel.setWeapon(loadout.current);
  }
  if (input.pressed.has('KeyB')) {
    input.pressed.delete('KeyB');
    if (match.phase === 'buy') {
      buyOpen = !buyOpen;
      hud.setBuy(buyOpen, economy.money);
      if (buyOpen) hud.setBuyMessage('Buy phase — 1-5 to buy, B to close');
    }
  }
  if (input.pressed.has('Escape')) {
    input.pressed.delete('Escape');
    if (buyOpen) { buyOpen = false; hud.setBuy(false, economy.money); }
  }
  if (buyOpen) {
    for (const key of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5']) {
      if (input.pressed.has(key)) {
        input.pressed.delete(key);
        const result = buy(economy, loadout, player, Number(key.slice(-1)));
        hud.setBuyMessage(result.message);
        if (result.ok) {
          playBuy(sound);
          viewModel.setWeapon(loadout.current);
        }
      }
    }
  }

  if (loadout.reloading && now >= loadout.reloadEndAt) finishReload();

  updatePlayer(player, input, dt, world.colliders, frozen);
  if (live && player.alive) {
    const def = currentWeapon(loadout);
    const trigger = input.mouseDown && (def.auto || !prevMouseDown);
    if (trigger) playerShoot();
    loadout.scoped = input.mouseRightDown && loadout.current === 'sniper';
  } else {
    loadout.scoped = false;
  }
  prevMouseDown = input.mouseDown;

  if (live) {
    const events = updateBots(bots, {
      colliders: world.colliders,
      vanguard: vanguardFighters,
      ember: emberFighters,
      random,
      bomb: {
        planted: bomb.state === 'planted',
        dropped: bomb.state === 'dropped',
        carrier: bomb.carrier,
        position: bomb.position,
        site: bomb.site,
      },
    }, dt, now);
    handleBotEvents(events);

    const grenadeEvents = updateGrenades(grenades, dt, world.colliders, allFighters);
    for (const event of grenadeEvents) {
      const dist = event.position.distanceTo(player.position);
      playExplosion(sound, dist);
      if (dist < 12) trauma = Math.min(1, trauma + (1 - dist / 12) * 0.6);
      for (const { fighter, damage } of event.victims) {
        applyDamage(fighter, damage, event.thrower, false);
      }
    }

    const bombEvent = updateBomb(bomb, now);
    if (bombEvent === 'beep') playBeep(sound);
    if (bombEvent === 'exploded') {
      playExplosion(sound, bomb.position.distanceTo(player.position));
      trauma = Math.min(1, trauma + 0.8);
      finishRound(attackTeam(match), 'bomb');
    }

    if (bomb.state === 'dropped' && attackTeam(match) === PLAYER_TEAM
      && player.alive && player.position.distanceTo(bomb.position) < 1.2) {
      carryBomb(bomb, player);
    }
    updateChannel(dt);
  }
  updatePrompt();
}

// --- HUD refresh ----------------------------------------------------------
function refreshHud() {
  hud.setHealth(player.health, player.armor);
  hud.setMoney(economy.money);
  const def = currentWeapon(loadout);
  const ammo = loadout.ammo[loadout.current];
  hud.setAmmo(ammo.mag, ammo.reserve, def.name, loadout.grenades);
  const side = attackTeam(match) === PLAYER_TEAM ? 'attack' : 'defend';
  hud.setScore(
    match.score.vanguard, match.score.ember, match.round, side,
    vanguardFighters.filter((f) => f.alive).length,
    emberFighters.filter((f) => f.alive).length,
  );
  const timeLeft = match.phase === 'end' ? 0 : Math.max(0, match.phaseEndAt - now);
  hud.setTimer(timeLeft, match.phase);
  hud.setBomb(bomb.state, bomb.site, bomb.state === 'planted' ? bomb.fuseEndAt - now : 0);
  const moving = player.speed > 0.5;
  const spread = currentSpread(def, player, loadout, moving, !player.onGround);
  hud.setCrosshair(5 + spread * 1400, loadout.scoped);
}

// --- the frame ------------------------------------------------------------
let last = performance.now();
let acc = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  const paused = playing && !input.locked && !shotMode && match.phase !== 'end';
  hud.setLockHint(paused);
  if (playing && !paused && !frozenShot) {
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 5) {
      step(STEP);
      acc -= STEP;
      steps += 1;
    }
    if (steps === 5) acc = 0;
  }

  updateCamera(player, camera);
  if (trauma > 0) {
    trauma = Math.max(0, trauma - dt * 1.6);
    const shake = trauma * trauma;
    camera.rotation.x += (random() * 2 - 1) * shake * 0.02;
    camera.rotation.y += (random() * 2 - 1) * shake * 0.02;
  }
  const targetFov = loadout.scoped ? SCOPED_FOV : BASE_FOV;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
    camera.updateProjectionMatrix();
  }
  viewModel.update(now, dt, player.speed > 0.5);
  for (const tracer of tracers) {
    if (!tracer.line.visible) continue;
    tracer.age += dt;
    if (tracer.age >= 0.09) tracer.line.visible = false;
    else tracer.line.material.opacity = 0.7 * (1 - tracer.age / 0.09);
  }
  renderer.render(scene, camera);
  if (playing) refreshHud();
  input.endFrame();

  framesRendered += 1;
  if (shotMode && framesRendered === 2) {
    window.__shotReady = true;
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- start ----------------------------------------------------------------
setupRoundForMatch();
startRound(match, now);

function beginPlay() {
  ensureSound(sound);
  playClick(sound);
  hud.hideStart();
  input.requestLock();
  playing = true;
  buyOpen = true;
  hud.setBuy(true, economy.money);
  hud.setBuyMessage('Buy phase — 1-5 to buy, B to close');
}

hud.onPlay(beginPlay);
hud.onRestart(() => window.location.reload());
canvas.addEventListener('click', () => {
  if (playing && !input.locked && !shotMode) input.requestLock();
});

// --- screenshot staging ---------------------------------------------------
function stageShot() {
  playing = true;
  frozenShot = true;
  hud.hideStart();
  hud.setLockHint(false);
  if (shotMode === 'start') {
    frozenShot = false;
    hud.showStart();
    playing = false;
    return;
  }
  if (shotMode === 'play') {
    match.round = 3;
    match.score.vanguard = 1;
    match.score.ember = 1;
    match.phase = 'live';
    match.phaseEndAt = now + 83;
    economy.money = 2350;
    player.health = 82;
    player.armor = 50;
    player.position.set(0, 0, -8);
    player.yaw = 0;
    player.pitch = 0.02;
    loadout.primary = 'rifle';
    loadout.ammo.rifle = { mag: 24, reserve: 90 };
    loadout.current = 'rifle';
    viewModel.setWeapon('rifle');
    const spots = {
      Havoc: [-8, -14, Math.PI], Mira: [8, -14, Math.PI], Onyx: [-2, -16, Math.PI], Dusk: [14, -12, Math.PI],
      Rook: [-4, -10, 0], Fable: [4, -11, 0], Sable: [-2, -5, 0],
    };
    for (const bot of bots) {
      const [x, z, yaw] = spots[bot.name];
      bot.position.set(x, 0, z);
      bot.yaw = yaw;
      bot.state = 'hold';
      bot.group.position.copy(bot.position);
      bot.group.rotation.y = yaw;
    }
    hud.addKill('You', 'Dusk', true, 'vanguard', 'ember');
    hud.addKill('Havoc', 'Rook', false, 'ember', 'vanguard');
  } else if (shotMode === 'buy') {
    match.round = 2;
    match.score.vanguard = 1;
    match.score.ember = 0;
    economy.money = 4700;
    buyOpen = true;
    hud.setBuy(true, economy.money);
    hud.setBuyMessage('Buy phase — 1-5 to buy, B to close');
  } else if (shotMode === 'end') {
    match.round = 11;
    match.score.vanguard = 7;
    match.score.ember = 4;
    match.over = true;
    match.phase = 'end';
    hud.showEnd('VANGUARD WINS THE MATCH', '7 — 4');
  }
  refreshHud();
}

if (shotMode) stageShot();
requestAnimationFrame(frame);
