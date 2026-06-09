/**
 * Balanced Bot Strategy.
 *
 * Mixes strategies, semi-bluffs, and adjusts to opponents. This is the
 * most "human-like" bot — it plays a GTO-inspired style with exploitative
 * adjustments based on observed opponent tendencies.
 *
 * Strategy profile:
 *   VPIP: ~25%   PFR: ~18%   Aggression: medium-high
 */

import {
  preflopStrength,
  postflopStrength,
  estimatedEquity,
  isProfitableCall,
  getPosition,
  betSize,
  spr,
  sprZone,
} from '../strategy-base.js';

// ── Thresholds ────────────────────────────────────────────────────────────────

/** Balanced preflop ranges by position. */
const PREFLOP_PLAY = {
  early:  0.62,   // ~15% from EP
  middle: 0.50,   // ~20% from MP
  late:   0.35,   // ~30% from LP
  blinds: 0.28,   // wide blind defense
};

const PREFLOP_RAISE = {
  early:  0.75,
  middle: 0.65,
  late:   0.48,
  blinds: 0.55,
};

/** Postflop thresholds (balanced — neither too tight nor too loose). */
const FOLD_EQUITY = 0.28;
const VALUE_EQUITY = 0.62;
const BLUFF_FREQ = 0.22;   // semi-bluff frequency

export class BalancedStrategy {
  /** @type {string} */
  name = 'Balanced';

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
      return { action: 'fold' };
    }

    // Facing action
    if (toCall > 0) {
      // Mix between 3-betting and calling based on strength
      if (strength >= minRaise) {
        // 3-bet ~60% of the time with raising hands (balanced)
        if (Math.random() < 0.6) {
          const raiseTo = state.currentBet * 3 + Math.floor(state.pot * 0.25);
          if (raiseTo >= player.stack) {
            return { action: 'raise', amount: player.stack + toCall };
          }
          return { action: 'raise', amount: Math.min(raiseTo, player.stack + toCall) };
        }
        // Otherwise call to trap
        return { action: 'call' };
      }
      // Call if affordable
      if (toCall <= player.stack * 0.12) {
        return { action: 'call' };
      }
      return { action: 'fold' };
    }

    // First in: raise with strong, mix with medium
    if (strength >= minRaise) {
      const openSize = Math.floor(state.bigBlind * 2.5);
      return { action: 'bet', amount: Math.min(openSize, player.stack) };
    }

    // Balanced: sometimes open-limp in late position to mix ranges
    if (pos === 'late' && Math.random() < 0.3) {
      const limpSize = state.bigBlind;
      return { action: 'bet', amount: Math.min(limpSize, player.stack) };
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
    const stackRatio = spr(player.stack, state.pot);

    // Value bet/raise with strong hands
    if (equity >= VALUE_EQUITY) {
      if (toCall > 0) {
        // Raise for value
        const raiseTo = state.currentBet * 2.75 + Math.floor(state.pot * 0.2);
        return { action: 'raise', amount: Math.min(raiseTo, player.stack + toCall) };
      }
      // Bet for value, size based on hand strength
      const fraction = equity >= 0.8 ? 0.85 : 0.6;
      const betAmt = betSize(state.pot, fraction, player.stack, state.bigBlind);
      if (betAmt >= player.stack) {
        return { action: 'bet', amount: player.stack };
      }
      return { action: 'bet', amount: betAmt };
    }

    // Facing a bet
    if (toCall > 0) {
      if (isProfitableCall(state.pot, toCall, equity)) {
        // Balanced mix: raise ~15% of the time as a semi-bluff
        if (equity > FOLD_EQUITY && Math.random() < BLUFF_FREQ) {
          const raiseTo = state.currentBet * 3;
          if (raiseTo < player.stack + toCall) {
            return { action: 'raise', amount: raiseTo };
          }
        }
        // Call
        if (toCall >= player.stack) {
          return { action: 'call' };
        }
        return { action: 'call' };
      }
      return { action: 'fold' };
    }

    // No bet to face: check or semi-bluff
    if (equity >= FOLD_EQUITY && Math.random() < 0.3) {
      const betAmt = betSize(state.pot, 0.5, player.stack, state.bigBlind);
      if (betAmt > 0 && betAmt < player.stack) {
        return { action: 'bet', amount: betAmt };
      }
    }

    return { action: 'check' };
  }
}
