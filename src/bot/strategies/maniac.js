/**
 * Maniac Bot Strategy.
 *
 * Hyper-aggressive, bluffs constantly, raises preflop with almost anything.
 * Applies maximum pressure — opponents fold or stack off.
 *
 * Strategy profile:
 *   VPIP: ~60%   PFR: ~45%   Aggression: extreme
 */

import {
  preflopStrength,
  postflopStrength,
  estimatedEquity,
  getPosition,
  betSize,
  raiseSize,
} from '../strategy-base.js';

// ── Thresholds ────────────────────────────────────────────────────────────────

/** The maniac plays almost everything. */
const PREFLOP_PLAY = {
  early:  0.20,
  middle: 0.15,
  late:   0.08,
  blinds: 0.05,
};

/** Raises with a very wide range. */
const PREFLOP_RAISE = {
  early:  0.45,
  middle: 0.38,
  late:   0.25,
  blinds: 0.22,
};

/** Maniac barrels relentlessly postflop. */
const BARREL_EQUITY = 0.20;   // bet with almost any equity
const STACKOFF_EQUITY = 0.55; // happy to get it in with decent equity

export class ManiacStrategy {
  /** @type {string} */
  name = 'Maniac';

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

    // Fold only absolute trash
    if (strength < minPlay) {
      if (toCall === 0) return { action: 'fold' };
      return { action: 'fold' };
    }

    // Facing a raise: 3-bet or call
    if (toCall > 0) {
      if (strength >= minRaise || Math.random() < 0.4) {
        // 3-bet! Overbet to apply pressure
        const raiseTo = Math.max(
          state.currentBet * 3 + Math.floor(state.pot * 0.5),
          state.currentBet * 4,
        );
        const totalNeeded = raiseTo; // new total bet
        if (totalNeeded >= player.stack + toCall) {
          return { action: 'raise', amount: player.stack + toCall };
        }
        return { action: 'raise', amount: Math.min(totalNeeded, player.stack + toCall) };
      }
      // Call to see a flop
      if (toCall <= player.stack * 0.25) {
        return { action: 'call' };
      }
      return { action: 'fold' };
    }

    // First in: always raise
    const openSize = Math.floor(state.bigBlind * (3 + Math.random() * 3)); // 3-6x BB
    if (openSize >= player.stack) {
      return { action: 'bet', amount: player.stack };
    }
    return { action: 'bet', amount: openSize };
  }

  #decidePostflop(game, playerIdx, pos) {
    const state = game.getState();
    const player = state.players[playerIdx];
    const strength = postflopStrength(player.holeCards, state.communityCards);
    const oppCount = state.players.filter(p => !p.folded && p.seatIndex !== playerIdx).length;
    const equity = estimatedEquity(strength, oppCount);
    const toCall = state.currentBet;

    // Stack off with decent equity
    if (equity >= STACKOFF_EQUITY) {
      if (toCall > 0) {
        // Jam!
        return { action: 'raise', amount: player.stack + toCall };
      }
      // Overbet pot
      const overbet = Math.floor(state.pot * 1.5);
      return { action: 'bet', amount: Math.min(overbet, player.stack) };
    }

    // Barrel with almost any equity
    if (equity >= BARREL_EQUITY) {
      if (toCall > 0) {
        // Re-raise sometimes
        if (Math.random() < 0.5) {
          const raiseTo = state.currentBet * 3;
          return { action: 'raise', amount: Math.min(raiseTo, player.stack + toCall) };
        }
        // Otherwise call
        if (toCall <= player.stack * 0.4) {
          return { action: 'call' };
        }
      }
      // Fire a bet
      const betAmt = betSize(state.pot, 0.8 + Math.random() * 0.7, player.stack, state.bigBlind);
      if (betAmt > 0 && betAmt <= player.stack) {
        return { action: 'bet', amount: betAmt };
      }
      return { action: 'check' };
    }

    // Even with nothing, barrel sometimes (pure bluff)
    if (Math.random() < 0.35 && toCall === 0) {
      const bluffSize = betSize(state.pot, 0.6, player.stack, state.bigBlind);
      if (bluffSize > 0 && bluffSize < player.stack) {
        return { action: 'bet', amount: bluffSize };
      }
    }

    if (toCall > 0 && toCall <= player.stack * 0.15) {
      return { action: 'call' }; // gamble
    }

    return { action: 'check' };
  }
}
