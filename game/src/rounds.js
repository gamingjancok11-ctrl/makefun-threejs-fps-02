// The match: first to 7 rounds, at most 13. Rounds 1-6 Vanguard attacks and
// Ember defends; at half-time the sides swap. A round runs buy (10 s, frozen),
// live (100 s), then a short end banner before the next round. A round ends by
// elimination, by the bomb going off, by a defuse, or by the clock, and the
// winner is whoever the reason favours — the clock favours the defenders.
export const BUY_SECONDS = 10;
export const ROUND_SECONDS = 100;
export const END_SECONDS = 4.5;
export const WIN_ROUNDS = 7;
export const MAX_ROUNDS = 13;
export const HALF_ROUND = 7;

export function createMatch() {
  return {
    round: 1,
    score: { vanguard: 0, ember: 0 },
    phase: 'buy',
    phaseEndAt: 0,
    lastReason: '',
    lastWinner: null,
    over: false,
  };
}

export function attackTeam(match) {
  return match.round < HALF_ROUND ? 'vanguard' : 'ember';
}

export function defendTeam(match) {
  return attackTeam(match) === 'vanguard' ? 'ember' : 'vanguard';
}

export function startRound(match, now) {
  match.phase = 'buy';
  match.phaseEndAt = now + BUY_SECONDS;
}

export function startLive(match, now) {
  match.phase = 'live';
  match.phaseEndAt = now + ROUND_SECONDS;
}

export function roundWinnerFor(match, reason) {
  if (reason === 'bomb') return attackTeam(match);
  if (reason === 'time' || reason === 'defuse') return defendTeam(match);
  return null; // elimination: the surviving team, decided by the caller
}

export function endRound(match, winner, reason, now) {
  match.score[winner] += 1;
  match.lastWinner = winner;
  match.lastReason = reason;
  match.phase = 'end';
  match.phaseEndAt = now + END_SECONDS;
  if (match.score[winner] >= WIN_ROUNDS || match.round >= MAX_ROUNDS) {
    match.over = true;
  }
  return match.over;
}

export function nextRound(match) {
  match.round += 1;
  match.lastWinner = null;
  match.lastReason = '';
}

export function matchWinner(match) {
  if (!match.over) return null;
  if (match.score.vanguard === match.score.ember) return 'draw';
  return match.score.vanguard > match.score.ember ? 'vanguard' : 'ember';
}

export function reasonText(reason) {
  return {
    elimination: 'Team eliminated',
    bomb: 'Charge detonated',
    defuse: 'Charge defused',
    time: 'Time expired',
  }[reason] ?? reason;
}
