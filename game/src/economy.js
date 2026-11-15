// Money, the reason a round lost is not a round wasted. A kill pays $300, a
// round win $3,250, a round loss $1,400 plus $500 for each consecutive loss
// before it (capped at $3,400), so a team on a losing streak can always buy
// back in. The wallet caps at $16,000. Buying is exact: a primary replaces the
// one carried, a grenade stacks to two, kevlar tops armour up to 100.
import { WEAPONS, GRENADE, ARMOR } from './weapons.js';

export const START_MONEY = 800;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_BASE = 1400;
export const LOSS_STREAK_BONUS = 500;
export const LOSS_CAP = 3400;
export const MAX_MONEY = 16000;

export function createEconomy() {
  return { money: START_MONEY, lossStreak: 0, kills: 0 };
}

export function roundReward(economy, won) {
  if (won) {
    economy.lossStreak = 0;
    economy.money = Math.min(MAX_MONEY, economy.money + WIN_REWARD);
    return WIN_REWARD;
  }
  const reward = Math.min(LOSS_CAP, LOSS_BASE + economy.lossStreak * LOSS_STREAK_BONUS);
  economy.lossStreak += 1;
  economy.money = Math.min(MAX_MONEY, economy.money + reward);
  return reward;
}

export function killReward(economy) {
  economy.kills += 1;
  economy.money = Math.min(MAX_MONEY, economy.money + KILL_REWARD);
}

// Buys by menu key: 1 SMG, 2 rifle, 3 sniper, 4 grenade, 5 kevlar.
// Returns a one-line result for the buy menu to show.
export function buy(economy, loadout, player, key) {
  const item = {
    1: WEAPONS.smg, 2: WEAPONS.rifle, 3: WEAPONS.sniper, 4: GRENADE, 5: ARMOR,
  }[key];
  if (!item) return { ok: false, message: '' };
  if (economy.money < item.price) return { ok: false, message: 'Not enough money' };
  if (item.id === 'grenade') {
    if (loadout.grenades >= GRENADE.max) return { ok: false, message: 'Grenades full' };
    economy.money -= item.price;
    loadout.grenades += 1;
    return { ok: true, message: `Bought ${item.name}` };
  }
  if (item.id === 'armor') {
    if (player.armor >= 100) return { ok: false, message: 'Armour already full' };
    economy.money -= item.price;
    player.armor = 100;
    return { ok: true, message: `Bought ${item.name}` };
  }
  if (loadout.primary === item.id) return { ok: false, message: 'Already carrying it' };
  economy.money -= item.price;
  loadout.primary = item.id;
  loadout.ammo[item.id] = { mag: item.mag, reserve: item.reserve };
  loadout.current = item.id;
  loadout.reloading = null;
  return { ok: true, message: `Bought ${item.name}` };
}
