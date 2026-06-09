/**
 * Loose-Passive (Calling Station) Bot Strategy.
 *
 * Plays many hands (~40%), rarely raises. Calls down light — "see a flop,
 * see a turn, see a river." Hard to bluff, but fails to extract value.
 *
 * Strategy profile:
 *   VPIP: ~40%   PFR: ~5%   Aggression: very low
 */

import {
  preflopStrength,
  postflopStrength,
  estimatedEquity,
  isProfitableCall,
  getPosition,
  betSize,
} from '../strategy-base.js';

// ── Thresholds ────────────────────────────────────────────────────────────────

const PREFLOP_PLAY = {
  early:  0.35,   // plays very wide from all positions
  middle: 0.30,
  late:   0.22,
  blinds: 0.18,
};

const PREFLOP_RAISE = {
  early:  0.88,   // only raises absolute premiums
  middle: 0.84,
  late:   0.78,
  blinds: 0.82,
};

/** Minimum equity to call postflop (very low — calls down light). */
const CALLOUT_EQUITY = 0.18;

/** Only bet/raise with near-nutted hands. */
const BET_EQUITY = 0.85;

export class LoosePassiveStrategy {
  /** @type {string} */
  name = 'Loose-Passive (Calling Station)';

  /**
   * @param {import('../../engine/game-state.js').GameState} game
   * @param {number} playerIdx
   * @returns {{ action: string, amount?: number }}
   */
  decide(game, playerIdx) {
    const state = game.getState();
    const player = state.players[playerIdx];
    const pos = getPosition(playerIdx, state.players.length, state.dealerIdx);

    if (state.communityCards.length === 0) {
      return this.#decidePreflop(game, playerIdx, pos);
    }
    return this.#decidePostflop(game, playerIdx, pos);
  }

  #decidePreflop(game, playerIdx, pos) {
    const state = game.getState();
    const player = state.players[playerIdx];
    const strength = preflopStrength(player.holeCards);
    const minPlay = PREFLOP_PLAY[pos];
    const minRaise = PREFLOP_RAISE[pos];
    const toCall = state.currentBet;

    if (strength < minPlay) {
      if (toCall === 0) return { action: 'fold' };
      return { action: 'fold' };
    }

    // Only raise with absolute premium hands
    if (strength >= minRaise) {
      if (toCall > 0) {
        // 3-bet premium
        const raiseTo = state.currentBet * 2.5 + Math.floor(state.pot * 0.2);
        return { action: 'raise', amount: Math.min(raiseTo, player.stack + toCall) };
      }
      // Open-raise
      const openSize = Math.floor(state.bigBlind * 2.5);
      return { action: 'bet', amount: Math.min(openSize, player.stack) };
    }

    // Play most hands by calling
    if (toCall > 0) {
      if (toCall <= player.stack * 0.1 || strength > 0.3) {
        return { action: 'call' };
      }
      return { action: 'fold' };
    }

    // First in: sometimes limp, otherwise call if facing raise
    return { action: 'check' };
  }

  #decidePostflop(game, playerIdx, pos) {
    const state = game.getState();
    const player = state.players[playerIdx];
    const strength = postflopStrength(player.holeCards, state.communityCards);
    const oppCount = state.players.filter(p => !p.folded && p.seatIndex !== playerIdx).length;
    const equity = estimatedEquity(strength, oppCount);
    const toCall = state.currentBet;

    // Strong made hand — finally bet/raise
    if (equity >= BET_EQUITY) {
      if (toCall > 0) {
        const raiseTo = state.currentBet * 2 + Math.floor(state.pot * 0.3);
        return { action: 'raise', amount: Math.min(raiseTo, player.stack + toCall) };
      }
      const betAmt = betSize(state.pot, 0.5, player.stack, state.bigBlind);
      return { action: 'bet', amount: Math.min(betAmt, player.stack) };
    }

    // Facing a bet — call if any hope
    if (toCall > 0) {
      if (equity >= CALLOUT_EQUITY && toCall <= player.stack * 0.3) {
        return { action: 'call' };
      }
      // Even with weak equity, call small bets
      if (toCall <= state.pot * 0.15) {
        return { action: 'call' };
      }
      return { action: 'fold' };
    }

    // No bet to face — check it down
    return { action: 'check' };
  }
}
