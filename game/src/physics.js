// Shared body physics: an axis-aligned box sliding against the world's colliders,
// one axis at a time, so a wall never swallows a body. The player and every bot
// move through here; only the wish direction differs. No allocations in the hot path:
// the probe box and the working vectors are module-level scratch.
import * as THREE from 'three';

const probe = new THREE.Box3();
const GRAVITY = 20;

export function overlaps(colliders, x, y, z, radius, height, lift) {
  probe.min.set(x - radius, y + lift, z - radius);
  probe.max.set(x + radius, y + height - lift, z + radius);
  for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
  return null;
}

// body: { position: Vector3, velocity: Vector3, height, onGround }.
// wish: { x, z } desired horizontal velocity. Returns nothing; mutates body.
export function slideMove(colliders, body, wish, dt, radius, accel, friction) {
  const blend = Math.min(1, (accel * dt) / Math.max(0.001, Math.hypot(wish.x, wish.z) || 1));
  body.velocity.x += (wish.x - body.velocity.x) * blend;
  body.velocity.z += (wish.z - body.velocity.z) * blend;
  if (body.onGround && wish.x === 0 && wish.z === 0) {
    const damp = Math.max(0, 1 - friction * dt);
    body.velocity.x *= damp;
    body.velocity.z *= damp;
  }
  body.velocity.y -= GRAVITY * dt;

  const nextX = body.position.x + body.velocity.x * dt;
  if (!overlaps(colliders, nextX, body.position.y, body.position.z, radius, body.height, 0.04)) {
    body.position.x = nextX;
  } else {
    body.velocity.x = 0;
  }
  const nextZ = body.position.z + body.velocity.z * dt;
  if (!overlaps(colliders, body.position.x, body.position.y, nextZ, radius, body.height, 0.04)) {
    body.position.z = nextZ;
  } else {
    body.velocity.z = 0;
  }

  body.position.y += body.velocity.y * dt;
  body.onGround = false;
  const hit = overlaps(colliders, body.position.x, body.position.y, body.position.z, radius, body.height, 0);
  if (hit && body.velocity.y <= 0) {
    body.position.y = hit.max.y;
    body.velocity.y = 0;
    body.onGround = true;
  } else if (hit) {
    body.position.y = hit.min.y - body.height;
    body.velocity.y = 0;
  }
  if (body.position.y < 0) {
    body.position.y = 0;
    body.velocity.y = 0;
    body.onGround = true;
  }
  body.velocity.y = Math.max(-30, body.velocity.y);
}

// Line of sight between two points, blocked by any collider the segment touches.
// Used by bot vision and by the damage check; a raycaster is heavier, so this
// samples the segment against the colliders' boxes directly.
const segmentBox = new THREE.Box3();
export function hasLineOfSight(colliders, from, to) {
  segmentBox.min.set(Math.min(from.x, to.x), Math.min(from.y, to.y), Math.min(from.z, to.z));
  segmentBox.max.set(Math.max(from.x, to.x), Math.max(from.y, to.y), Math.max(from.z, to.z));
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  for (const collider of colliders) {
    if (!segmentBox.intersectsBox(collider)) continue;
    // Slab test: does the segment cross this box?
    let tmin = 0;
    let tmax = 1;
    const axes = [
      [dx, from.x, collider.min.x, collider.max.x],
      [dy, from.y, collider.min.y, collider.max.y],
      [dz, from.z, collider.min.z, collider.max.z],
    ];
    let blocked = true;
    for (const [d, o, lo, hi] of axes) {
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) { blocked = false; break; }
      } else {
        let t1 = (lo - o) / d;
        let t2 = (hi - o) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) { blocked = false; break; }
      }
    }
    if (blocked && tmin <= 1 && tmax >= 0) return false;
  }
  return true;
}
