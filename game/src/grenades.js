// Frag grenades: a thrown sphere with gravity, a bounce off the world's boxes,
// and a fuse. On detonation it hurts everyone in 9 metres through line of sight,
// hardest at the centre, and leaves a flash and a ring of light. The player
// throws with G; bots do not get grenades.
import * as THREE from 'three';
import { overlaps, hasLineOfSight } from './physics.js';

const FUSE = 1.8;
const BLAST_RADIUS = 9;
const MAX_DAMAGE = 120;

export function createGrenades(scene) {
  return { scene, live: [], flashes: [] };
}

const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
const grenadeMat = new THREE.MeshStandardMaterial({ color: '#2e4033', roughness: 0.5, metalness: 0.6 });

export function throwGrenade(state, from, direction, thrower) {
  const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
  mesh.position.copy(from);
  state.scene.add(mesh);
  state.live.push({
    mesh,
    thrower,
    velocity: new THREE.Vector3(
      direction.x * 13 + thrower.velocity.x * 0.4,
      direction.y * 13 + 3.2,
      direction.z * 13 + thrower.velocity.z * 0.4,
    ),
    fuse: FUSE,
  });
}

const scratch = new THREE.Vector3();
function bounce(colliders, grenade, dt) {
  const pos = grenade.mesh.position;
  const vel = grenade.velocity;
  vel.y -= 20 * dt;
  pos.x += vel.x * dt;
  if (overlaps(colliders, pos.x, pos.y - 0.09, pos.z, 0.09, 0.18, 0)) {
    pos.x -= vel.x * dt;
    vel.x *= -0.45;
  }
  pos.z += vel.z * dt;
  if (overlaps(colliders, pos.x, pos.y - 0.09, pos.z, 0.09, 0.18, 0)) {
    pos.z -= vel.z * dt;
    vel.z *= -0.45;
  }
  pos.y += vel.y * dt;
  if (pos.y < 0.09) {
    pos.y = 0.09;
    vel.y = Math.abs(vel.y) * 0.45;
    vel.x *= 0.7;
    vel.z *= 0.7;
  } else if (overlaps(colliders, pos.x, pos.y - 0.09, pos.z, 0.09, 0.18, 0) && vel.y < 0) {
    pos.y -= vel.y * dt;
    vel.y = Math.abs(vel.y) * 0.45;
  }
}

// Steps every live grenade; returns explosion events for the main loop to apply.
export function updateGrenades(state, dt, colliders, fighters) {
  const events = [];
  for (let i = state.live.length - 1; i >= 0; i -= 1) {
    const grenade = state.live[i];
    bounce(colliders, grenade, dt);
    grenade.fuse -= dt;
    if (grenade.fuse > 0) continue;
    state.scene.remove(grenade.mesh);
    state.live.splice(i, 1);
    const at = grenade.mesh.position.clone();
    const victims = [];
    for (const fighter of fighters) {
      if (!fighter.alive) continue;
      scratch.set(fighter.position.x, fighter.position.y + 1.2, fighter.position.z);
      const dist = at.distanceTo(scratch);
      if (dist > BLAST_RADIUS) continue;
      if (!hasLineOfSight(colliders, at, scratch)) continue;
      const damage = MAX_DAMAGE * (1 - dist / BLAST_RADIUS) + 10;
      victims.push({ fighter, damage });
    }
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: '#ffcf6e', transparent: true, opacity: 0.9 }),
    );
    flash.position.copy(at);
    const light = new THREE.PointLight('#ffb36b', 60, 18, 1.8);
    light.position.copy(at);
    state.scene.add(flash, light);
    state.flashes.push({ mesh: flash, light, age: 0 });
    events.push({ type: 'explode', position: at, victims, thrower: grenade.thrower });
  }
  for (let i = state.flashes.length - 1; i >= 0; i -= 1) {
    const flash = state.flashes[i];
    flash.age += dt;
    const t = flash.age / 0.35;
    flash.mesh.scale.setScalar(1 + t * 5);
    flash.mesh.material.opacity = Math.max(0, 0.9 - t);
    flash.light.intensity = Math.max(0, 60 * (1 - t));
    if (t >= 1) {
      state.scene.remove(flash.mesh, flash.light);
      state.flashes.splice(i, 1);
    }
  }
  return events;
}
