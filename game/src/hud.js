// The HUD: one module owns every DOM element, so main.js never touches the
// document except through here. Health and armour bottom-left, money above
// them, ammo bottom-right, the round timer and score top-centre, the kill feed
// top-right, and a crosshair whose gap opens with the weapon's spread.
export function createHud() {
  const el = (id) => document.getElementById(id);
  const hud = {
    root: el('hud'),
    crosshair: el('crosshair'),
    scope: el('scope-overlay'),
    hitmarker: el('hitmarker'),
    vignette: el('damage-vignette'),
    healthNum: el('health-num'),
    healthBar: el('health-bar'),
    armorNum: el('armor-num'),
    money: el('money'),
    ammoMag: el('ammo-mag'),
    ammoReserve: el('ammo-reserve'),
    weaponName: el('weapon-name'),
    grenades: el('grenades'),
    timer: el('timer'),
    scoreV: el('score-v'),
    scoreE: el('score-e'),
    aliveV: el('alive-v'),
    aliveE: el('alive-e'),
    roundNum: el('round-num'),
    sideLabel: el('side-label'),
    killfeed: el('killfeed'),
    prompt: el('prompt'),
    banner: el('banner'),
    bannerTitle: el('banner-title'),
    bannerSub: el('banner-sub'),
    bombStatus: el('bomb-status'),
    buyMenu: el('buy-menu'),
    buyMessage: el('buy-message'),
    channel: el('channel'),
    channelLabel: el('channel-label'),
    channelFill: el('channel-fill'),
    deathOverlay: el('death-overlay'),
    endOverlay: el('end-overlay'),
    endTitle: el('end-title'),
    endScore: el('end-score'),
    startOverlay: el('start-overlay'),
    playButton: el('play-button'),
    lockHint: el('lock-hint'),
  };

  return {
    setHealth(health, armor) {
      hud.healthNum.textContent = Math.max(0, Math.ceil(health));
      hud.healthBar.style.width = `${Math.max(0, health)}%`;
      hud.healthBar.classList.toggle('low', health <= 30);
      hud.armorNum.textContent = Math.max(0, Math.ceil(armor));
    },
    setMoney(money) {
      hud.money.textContent = `$${money.toLocaleString('en-US')}`;
    },
    setAmmo(mag, reserve, name, grenadeCount) {
      hud.ammoMag.textContent = mag;
      hud.ammoReserve.textContent = reserve;
      hud.weaponName.textContent = name;
      hud.grenades.textContent = `◉ × ${grenadeCount}`;
    },
    setScore(v, e, round, side, aliveV, aliveE) {
      hud.scoreV.textContent = v;
      hud.scoreE.textContent = e;
      hud.roundNum.textContent = `ROUND ${round} / 13`;
      hud.sideLabel.textContent = side === 'attack' ? 'YOU ATTACK — PLANT THE CHARGE' : 'YOU DEFEND — HOLD THE SITES';
      hud.aliveV.textContent = aliveV;
      hud.aliveE.textContent = aliveE;
    },
    setTimer(seconds, phase) {
      const s = Math.max(0, Math.ceil(seconds));
      hud.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      hud.timer.classList.toggle('urgent', phase === 'live' && seconds <= 10);
      hud.timer.classList.toggle('buy', phase === 'buy');
    },
    setBomb(state, site, secondsLeft) {
      if (state === 'planted') {
        hud.bombStatus.classList.remove('hidden');
        hud.bombStatus.textContent = `CHARGE AT ${site} — ${Math.ceil(secondsLeft)}s`;
        hud.bombStatus.classList.toggle('urgent', secondsLeft <= 10);
      } else {
        hud.bombStatus.classList.add('hidden');
      }
    },
    setPrompt(text) {
      if (text) {
        hud.prompt.textContent = text;
        hud.prompt.classList.remove('hidden');
      } else {
        hud.prompt.classList.add('hidden');
      }
    },
    addKill(killer, victim, head, killerTeam, victimTeam) {
      const line = document.createElement('div');
      line.className = 'kill-line';
      const k = document.createElement('span');
      k.className = killerTeam === 'vanguard' ? 'team-v' : 'team-e';
      k.textContent = killer;
      const weapon = document.createElement('span');
      weapon.className = 'kill-weapon';
      weapon.textContent = head ? ' ◉ ' : ' ✕ ';
      const v = document.createElement('span');
      v.className = victimTeam === 'vanguard' ? 'team-v' : 'team-e';
      v.textContent = victim;
      line.append(k, weapon, v);
      hud.killfeed.prepend(line);
      while (hud.killfeed.children.length > 5) hud.killfeed.lastChild.remove();
      // In screenshot staging the lines must outlive the render wait.
      const ttl = new URLSearchParams(window.location.search).has('shot') ? 60000 : 6000;
      setTimeout(() => line.remove(), ttl);
    },
    showBanner(title, sub, won) {
      hud.bannerTitle.textContent = title;
      hud.bannerSub.textContent = sub;
      hud.banner.classList.remove('hidden', 'won', 'lost');
      hud.banner.classList.add(won ? 'won' : 'lost');
    },
    hideBanner() {
      hud.banner.classList.add('hidden');
    },
    setBuy(open, money) {
      hud.buyMenu.classList.toggle('hidden', !open);
      if (open) this.setMoney(money);
    },
    setBuyMessage(text) {
      hud.buyMessage.textContent = text;
    },
    setChannel(label, frac) {
      if (label === null) {
        hud.channel.classList.add('hidden');
        return;
      }
      hud.channel.classList.remove('hidden');
      hud.channelLabel.textContent = label;
      hud.channelFill.style.width = `${Math.round(frac * 100)}%`;
    },
    setCrosshair(spreadPx, scoped) {
      hud.crosshair.style.setProperty('--gap', `${spreadPx.toFixed(1)}px`);
      hud.crosshair.classList.toggle('hidden', scoped);
      hud.scope.classList.toggle('hidden', !scoped);
    },
    hitmarker(head) {
      hud.hitmarker.classList.remove('head');
      void hud.hitmarker.offsetWidth;
      if (head) hud.hitmarker.classList.add('head');
      hud.hitmarker.classList.add('show');
      setTimeout(() => hud.hitmarker.classList.remove('show'), 120);
    },
    damageFlash() {
      hud.vignette.classList.add('show');
      setTimeout(() => hud.vignette.classList.remove('show'), 250);
    },
    setDead(dead) {
      hud.deathOverlay.classList.toggle('hidden', !dead);
    },
    showEnd(title, score) {
      hud.endTitle.textContent = title;
      hud.endScore.textContent = score;
      hud.endOverlay.classList.remove('hidden');
    },
    showStart() {
      hud.startOverlay.classList.remove('hidden');
    },
    hideStart() {
      hud.startOverlay.classList.add('hidden');
    },
    setLockHint(show) {
      hud.lockHint.classList.toggle('hidden', !show);
    },
    onPlay(callback) {
      hud.playButton.addEventListener('click', callback);
    },
    onRestart(callback) {
      el('restart-button').addEventListener('click', callback);
    },
  };
}
