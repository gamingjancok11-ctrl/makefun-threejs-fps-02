// The first-person body: WASD movement with acceleration and friction, jump,
// crouch, a slow accurate walk on Shift, and the camera that rides on it.
// Movement runs through physics.slideMove, the same slide every bot uses.
// Recoil lives here too: shots kick the view up, and it settles back on its own.
import * as THREE from 'three';
import { slideMove } from './physics.js';

const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.5;
const SLOW_SPEED = 3.1;
const JUMP_SPEED = 8;
const EYE_STAND = 1.62;
const EYE_CROUCH = 1.12;
const BODY_HEIGHT = 1.8;
const BODY_RADIUS = 0.38;

export function createPlayer(spawn) {
  return {
    position: new THREE.Vector3(spawn[0], 0, spawn[1]),
    velocity: new THREE.Vector3(),
    height: BODY_HEIGHT,
    onGround: true,
    yaw: 0,
    pitch: 0,
    recoil: 0,
    crouched: false,
    eyeHeight: EYE_STAND,
    bobPhase: 0,
    bobAmount: 0,
    health: 100,
    armor: 0,
    alive: true,
    speed: 0,
  };
}

const wish = new THREE.Vector3();
export function updatePlayer(player, input, dt, colliders, frozen) {
  // Look first: mouse deltas turn the view; recoil decays on its own.
  player.yaw -= input.lookDX * 0.0022;
  player.pitch = THREE.MathUtils.clamp(player.pitch - input.lookDY * 0.0022, -1.45, 1.45);
  player.recoil = Math.max(0, player.recoil - dt * 2.4);

  player.crouched = input.keys.has('ControlLeft') || input.keys.has('KeyC');
  const targetEye = player.crouched ? EYE_CROUCH : EYE_STAND;
  player.eyeHeight += (targetEye - player.eyeHeight) * Math.min(1, dt * 12);

  let forward = 0;
  let strafe = 0;
  if (!frozen && player.alive) {
    if (input.keys.has('KeyW')) forward += 1;
    if (input.keys.has('KeyS')) forward -= 1;
    if (input.keys.has('KeyD')) strafe += 1;
    if (input.keys.has('KeyA')) strafe -= 1;
  }
  const slow = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight');
  const speed = player.crouched ? CROUCH_SPEED : slow ? SLOW_SPEED : WALK_SPEED;
  const sin = Math.sin(player.yaw);
  const cos = Math.cos(player.yaw);
  wish.set(0, 0, 0);
  if (forward !== 0 || strafe !== 0) {
    const inv = 1 / Math.hypot(forward, strafe);
    wish.x = (-sin * forward + cos * strafe) * inv * speed;
    wish.z = (-cos * forward - sin * strafe) * inv * speed;
  }
  slideMove(colliders, player, wish, dt, BODY_RADIUS, 12, 9);
  player.speed = Math.hypot(player.velocity.x, player.velocity.z);

  if (!frozen && player.alive && player.onGround && input.keys.has('Space')) {
    player.velocity.y = JUMP_SPEED;
    player.onGround = false;
  }

  // View bob follows ground speed; it is cosmetic, never part of the sim.
  const targetBob = player.onGround && player.speed > 0.5 ? Math.min(1, player.speed / WALK_SPEED) : 0;
  player.bobAmount += (targetBob - player.bobAmount) * Math.min(1, dt * 8);
  player.bobPhase += dt * player.speed * 1.6;
}

export function addRecoil(player, kick) {
  player.recoil = Math.min(0.12, player.recoil + kick);
}

export function eyePosition(player, out) {
  return out.set(player.position.x, player.position.y + player.eyeHeight, player.position.z);
}

export function aimDirection(player, out) {
  const pitch = player.pitch + player.recoil;
  return out.set(
    -Math.sin(player.yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(player.yaw) * Math.cos(pitch),
  );
}

export function updateCamera(player, camera) {
  const bobY = Math.sin(player.bobPhase * 2) * 0.022 * player.bobAmount;
  const bobX = Math.cos(player.bobPhase) * 0.014 * player.bobAmount;
  camera.position.set(
    player.position.x + bobX * Math.cos(player.yaw),
    player.position.y + player.eyeHeight + bobY,
    player.position.z - bobX * Math.sin(player.yaw),
  );
  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch + player.recoil;
  camera.rotation.z = 0;
}
