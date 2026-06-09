/**
 * Tight-Aggressive (TAG) Bot Strategy.
 *
 * Plays ~15% of hands, bets/raises hard when in. Strong preflop discipline
 * combined with aggressive postflop play. Default "solid" opponent.
 *
 * Strategy profile:
 *   VPIP: ~15%   PFR: ~12%   Aggression: high
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

/** Minimum preflop hand strength to voluntarily play (by position). */
const PREFLOP_PLAY = {
  early:  0.75,   // UTG: only premium
  middle: 0.62,   // MP: good hands
  late:   0.48,   // CO/BTN: playable hands
  blinds: 0.40,   // BB can defend wide
};

/** Minimum preflop strength to 3-bet / raise first-in. */
const PREFLOP_RAISE = {
  early:  0.82,
  middle: 0.72,
  late:   0.58,
  blinds: 0.65,
};

/** Postflop: fold if equity below this threshold (vs pot odds). */
const FOLD_EQUITY_THRESHOLD = 0.35;

/** Postflop: bet/raise with equity above this. */
const AGGRESSION_EQUITY_THRESHOLD = 0.65;

/** SPR zone thresholds for commitment decisions. */
const COMMIT_SPR = 3;

// ── TAGStrategy ───────────────────────────────────────────────────────────────

export class TAGStrategy {
  /** @type {string} */
  name = 'Tight-Aggressive (TAG)';

  /**
   * Decide what action to take.
   *
   * @param {import('../../engine/game-state.js').GameState} game
   * @param {number} playerIdx  this bot's seat index
   * @returns {{ action: string, amount?: number }}
   */
  decide(game, playerIdx) {
    const state = game.getState();
    const player = state.players[playerIdx];
    const pos = getPosition(playerIdx, state.players.length, state.dealerIdx);

    // Preflop
    if (state.communityCards.length === 0) {
      return this.#decidePreflop(game, playerIdx, pos);
    }

    // Postflop
    return this.#decidePostflop(game, playerIdx, pos);
  }

  // ── Preflop ────────────────────────────────────────────────────────────────

  /**
   * @param {import('../../engine/game-state.js').GameState} game
   * @param {number} playerIdx
   * @param {string} pos
   * @returns {{ action: string, amount?: number }}
   */
  #decidePreflop(game, playerIdx, pos) {
    const state = game.getState();
    const player = state.players[playerIdx];
    const strength = preflopStrength(player.holeCards);
    const minPlay = PREFLOP_PLAY[pos];
    const minRaise = PREFLOP_RAISE[pos];
    const toCall = this.#computeToCall(game, playerIdx);

    // Can't afford to play
    if (strength < minPlay) {
      if (toCall === 0) return { action: 'fold' }; // shouldn't happen preflop normally
      return { action: 'fold' };
    }

    // Facing a bet
    if (toCall > 0) {
      // Strong enough to 3-bet
      if (strength >= minRaise) {
        const raiseAmt = this.#size3Bet(game, playerIdx);
        if (raiseAmt >= player.stack) {
          return { action: 'raise', amount: player.stack + toCall };
        }
        return { action: 'raise', amount: raiseAmt };
      }
      // Just call
      if (toCall >= player.stack) {
        return { action: 'call' }; // all-in call
      }
      // Don't call more than 5% of stack with marginal hands
      if (toCall > player.stack * 0.05 && strength < 0.7) {
        return { action: 'fold' };
      }
      return { action: 'call' };
    }

    // First in: raise with strong hands, limp with medium
    if (strength >= minRaise) {
      const openSize = this.#sizeOpen(game, pos);
      if (openSize >= player.stack) {
        return { action: 'bet', amount: player.stack };
      }
      return { action: 'bet', amount: openSize };
    }

    // Limp with playable but not raising hands in late position
    if (pos === 'late' && toCall === 0 && strength >= 0.55) {
      const limpSize = state.bigBlind;
      return { action: 'bet', amount: Math.min(limpSize, player.stack) };
    }

    return { action: 'fold' };
  }

  // ── Postflop ───────────────────────────────────────────────────────────────

  /**
   * @param {import('../../engine/game-state.js').GameState} game
   * @param {number} playerIdx
   * @param {string} pos
   * @returns {{ action: string, amount?: number }}
   */
  #decidePostflop(game, playerIdx, pos) {
    const state = game.getState();
    const player = state.players[playerIdx];
    const strength = postflopStrength(player.holeCards, state.communityCards);
    const oppCount = state.players.filter(p => !p.folded && p.seatIndex !== playerIdx).length;
    const equity = estimatedEquity(strength, oppCount);
    const toCall = this.#computeToCall(game, playerIdx);
    const stackRatio = spr(player.stack, state.pot);
    const zone = sprZone(stackRatio);

    // Very strong hand — bet or raise
    if (equity >= AGGRESSION_EQUITY_THRESHOLD) {
      if (toCall > 0) {
        // Facing a bet: raise
        const raiseAmt = this.#sizePostflopRaise(game, playerIdx);
        return { action: 'raise', amount: Math.min(raiseAmt, player.stack + toCall) };
      }
      // No bet to face: bet out
      const betAmt = betSize(state.pot, 0.75, player.stack, state.bigBlind);
      if (betAmt >= player.stack) {
        return { action: 'bet', amount: player.stack };
      }
      return { action: 'bet', amount: betAmt };
    }

    // Decent hand facing a bet — call if odds justify
    if (toCall > 0) {
      if (isProfitableCall(state.pot, toCall, equity)) {
        // Low SPR + decent equity = jam
        if (zone === 'low' && equity > 0.45) {
          return { action: 'raise', amount: player.stack + toCall };
        }
        if (toCall >= player.stack) {
          return { action: 'call' };
        }
        return { action: 'call' };
      }
      return { action: 'fold' };
    }

    // No bet to face
    if (toCall === 0) {
      // Medium strength: sometimes bet as a semi-bluff from late position
      if (equity >= FOLD_EQUITY_THRESHOLD && pos === 'late' && Math.random() < 0.4) {
        const betAmt = betSize(state.pot, 0.5, player.stack, state.bigBlind);
        if (betAmt > 0 && betAmt < player.stack) {
          return { action: 'bet', amount: betAmt };
        }
      }
      // Check
      return { action: 'check' };
    }

    return { action: 'fold' };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Estimate the amount this player needs to call.
   *
   * Since the engine doesn't expose per-player round bets publicly, we
   * approximate: if the player has totalBet > 0, some of it may be from
   * this round. We use a conservative estimate.
   *
   * @param {import('../../engine/game-state.js').GameState} game
   * @param {number} playerIdx
   * @returns {number}
   */
  #computeToCall(game, playerIdx) {
    const state = game.getState();
    const currentBet = state.currentBet;
    if (currentBet === 0) return 0;

    // Estimate: assume player hasn't contributed to this round yet
    // This may overestimate toCall, making the bot slightly more
    // conservative (prefers folding to calling incorrectly).
    return currentBet;
  }

  /**
   * Standard open-raise sizing (2.5×–3× BB, larger from early position).
   */
  #sizeOpen(game, pos) {
    const bb = game.bigBlind;
    const mult = pos === 'early' ? 3.0 : pos === 'middle' ? 2.75 : 2.5;
    return Math.floor(bb * mult);
  }

  /**
   * 3-bet sizing: ~3× the raise + dead money.
   */
  #size3Bet(game, playerIdx) {
    const currentBet = game.currentBet;
    const pot = game.pot;
    return currentBet * 3 + Math.floor(pot * 0.3);
  }

  /**
   * Postflop raise sizing: ~2.5× current bet + pot sweetener.
   */
  #sizePostflopRaise(game, playerIdx) {
    const currentBet = game.currentBet;
    const pot = game.pot;
    return currentBet * 2.5 + Math.floor(pot * 0.2);
  }
}
