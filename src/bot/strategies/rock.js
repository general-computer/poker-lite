/**
 * Tight-Passive (Rock) Bot Strategy.
 *
 * Only plays premium hands (~8%), folds most everything else. When they
 * do play, they're rarely bluffing. Predictable — opponents can steal
 * their blinds relentlessly.
 *
 * Strategy profile:
 *   VPIP: ~8%   PFR: ~5%   Aggression: very low
 */

import {
  preflopStrength,
  postflopStrength,
  estimatedEquity,
  getPosition,
  betSize,
} from '../strategy-base.js';

// ── Thresholds ────────────────────────────────────────────────────────────────

/** Only plays premium hands. */
const PREFLOP_PLAY = {
  early:  0.82,   // JJ+, AK
  middle: 0.78,   // TT+, AQs+
  late:   0.72,   // 88+, ATs+, KQs
  blinds: 0.50,   // wide-ish blind defense with strong hands
};

/** Raises only with the best. */
const PREFLOP_RAISE = {
  early:  0.88,   // QQ+, AKs
  middle: 0.84,   // JJ+, AK
  late:   0.78,   // TT+, AQ+
  blinds: 0.82,
};

/** Postflop: only continue with strong equity. */
const CONTINUE_EQUITY = 0.55;
const BET_EQUITY = 0.78;

export class RockStrategy {
  /** @type {string} */
  name = 'Tight-Passive (Rock)';

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
      // Fold anything below premium
      return { action: 'fold' };
    }

    // Facing a bet: 3-bet premiums, otherwise just call
    if (toCall > 0) {
      if (strength >= minRaise) {
        const raiseTo = state.currentBet * 3;
        if (raiseTo >= player.stack) {
          return { action: 'raise', amount: player.stack + toCall };
        }
        return { action: 'raise', amount: Math.min(raiseTo, player.stack + toCall) };
      }
      // Call with playable premium hands
      if (toCall <= player.stack * 0.08) {
        return { action: 'call' };
      }
      return { action: 'fold' };
    }

    // First in: raise premiums, limp playable
    if (strength >= minRaise) {
      const openSize = Math.floor(state.bigBlind * 3);
      return { action: 'bet', amount: Math.min(openSize, player.stack) };
    }
    // Limp with the lower end of playable
    if (toCall === 0) {
      return { action: 'check' };
    }

    return { action: 'fold' };
  }

  #decidePostflop(game, playerIdx, pos) {
    const state = game.getState();
    const player = state.players[playerIdx];
    const strength = postflopStrength(player.holeCards, state.communityCards);
    const oppCount = state.players.filter(p => !p.folded && p.seatIndex !== playerIdx).length;
    const equity = estimatedEquity(strength, oppCount);
    const toCall = state.currentBet;

    // Strong made hand: bet/raise
    if (equity >= BET_EQUITY) {
      if (toCall > 0) {
        const raiseTo = state.currentBet * 2.5;
        return { action: 'raise', amount: Math.min(raiseTo, player.stack + toCall) };
      }
      const betAmt = betSize(state.pot, 0.6, player.stack, state.bigBlind);
      return { action: 'bet', amount: Math.min(betAmt, player.stack) };
    }

    // Decent hand: call moderate bets, otherwise check
    if (toCall > 0) {
      if (equity >= CONTINUE_EQUITY && toCall <= player.stack * 0.1) {
        return { action: 'call' };
      }
      return { action: 'fold' };
    }

    // No bet: check it down, rock doesn't bluff
    return { action: 'check' };
  }
}
