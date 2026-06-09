/**
 * Simple bot AI for Texas Hold'em.
 *
 * Implements three personality types:
 * - aggressive: bets/raises frequently, bluffs
 * - passive: calls more, rarely raises
 * - random: unpredictable, wild decisions
 *
 * Mixed mode assigns random personalities to bots.
 */

import { ACTION, HAND_CATEGORY } from '../engine/index.js';

// ── Personality types ──────────────────────────────────────────────────────────

export const BOT_PERSONALITY = Object.freeze({
  AGGRESSIVE: 'aggressive',
  PASSIVE:    'passive',
  RANDOM:     'random',
});

const PERSONALITIES = Object.values(BOT_PERSONALITY);

/**
 * Assign a personality to a bot. In mixed mode, cycles through all types.
 */
export function assignPersonality(botIndex, mode) {
  if (mode === 'mixed') {
    return PERSONALITIES[botIndex % PERSONALITIES.length];
  }
  return mode; // aggressive, passive, or random
}

// ── Hand strength estimators ───────────────────────────────────────────────────

/**
 * Rough preflop hand strength (0-1).
 * Pairs, high cards, and suited connectors score higher.
 */
function preflopStrength(holeCards) {
  const [c1, c2] = holeCards;
  if (!c1 || !c2) return 0;
  const high = Math.max(c1.rank, c2.rank);
  const low = Math.min(c1.rank, c2.rank);
  const pair = c1.rank === c2.rank;
  const suited = c1.suit === c2.suit;
  const gap = high - low;

  if (pair) {
    // Pairs: score based on rank
    return 0.5 + (high / 14) * 0.45;
  }

  let score = (high / 14) * 0.4 + (low / 14) * 0.2;
  if (suited) score += 0.08;
  if (gap <= 2) score += 0.06; // connected
  if (gap <= 1) score += 0.04; // very connected
  if (high >= 12) score += 0.05; // face card bonus
  return Math.min(score, 0.95);
}

/**
 * Evaluate hand strength from available cards using the engine.
 * Returns 0-1 where 1 = nuts.
 */
export function handStrength(evaluateFn, holeCards, communityCards) {
  const allCards = [...holeCards, ...communityCards];
  if (allCards.length < 5) {
    // Partial street — use preflop estimator or adjust
    if (communityCards.length === 0) return preflopStrength(holeCards);
    // With some community cards but <5 total, use preflop heuristic
    return preflopStrength(holeCards) * 0.7 + 0.15;
  }

  const result = evaluateFn(allCards);
  // Normalize: category 0 (royal) = 1.0, category 9 (high card) = 0.1
  const categoryScore = 1.0 - (result.category / 10);
  // Boost with value quality
  const valueBonus = result.values[0] / 14 * 0.05;
  return Math.min(categoryScore + valueBonus, 1.0);
}

// ── Decision engine ────────────────────────────────────────────────────────────

/**
 * Bot decides what action to take.
 *
 * @param {Object} params
 * @param {string} params.personality - BOT_PERSONALITY value
 * @param {number} params.strength - hand strength 0-1
 * @param {number} params.toCall - amount to call (0 if can check)
 * @param {number} params.currentBet - current bet level
 * @param {number} params.minRaise - minimum raise amount
 * @param {number} params.stack - bot's remaining stack
 * @param {number} params.pot - current pot size
 * @param {boolean} params.canCheck - true if facing no bet
 * @returns {{ action: string, amount?: number }}
 */
export function botDecide({ personality, strength, toCall, currentBet, minRaise, stack, pot, canCheck }) {
  // Random personality uses pure randomness
  if (personality === BOT_PERSONALITY.RANDOM) {
    return randomDecision({ toCall, minRaise, stack, canCheck });
  }

  // Adjust threshold based on personality
  const agg = personality === BOT_PERSONALITY.AGGRESSIVE;

  // Pot odds calculation for calling decisions
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;

  if (canCheck) {
    // No bet facing us — check or bet
    if (strength > (agg ? 0.3 : 0.6)) {
      // Bet/raise for value
      const betSize = selectBetSize(strength, pot, currentBet, minRaise, stack, agg);
      if (betSize >= stack) {
        return { action: ACTION.BET, amount: stack }; // all-in
      }
      return { action: ACTION.BET, amount: betSize };
    }
    // Check
    return { action: ACTION.CHECK };
  }

  // Facing a bet — fold, call, or raise
  const shouldFold = strength < potOdds * (agg ? 1.5 : 1.0);

  if (shouldFold) {
    return { action: ACTION.FOLD };
  }

  if (strength > (agg ? 0.5 : 0.75)) {
    // Strong hand — raise
    const raiseSize = selectBetSize(strength, pot, currentBet, minRaise, stack, agg);
    const raiseTo = Math.min(currentBet + raiseSize, stack + toCall);
    if (raiseTo <= toCall) {
      // Can't raise meaningfully, just call
      return toCall >= stack
        ? { action: ACTION.CALL, amount: stack }
        : { action: ACTION.CALL };
    }
    return { action: ACTION.RAISE, amount: raiseTo };
  }

  // Medium strength — call
  if (toCall >= stack) {
    return { action: ACTION.CALL, amount: stack }; // all-in call
  }
  return { action: ACTION.CALL };
}

/**
 * Choose a bet/raise size based on hand strength.
 */
function selectBetSize(strength, pot, currentBet, minRaise, stack, aggressive) {
  let multiplier;
  if (strength > 0.85) {
    multiplier = aggressive ? 1.0 : 0.75; // pot-sized bet with monsters
  } else if (strength > 0.6) {
    multiplier = aggressive ? 0.75 : 0.5;
  } else {
    multiplier = aggressive ? 0.5 : 0.33;
  }

  const potSized = Math.floor(pot * multiplier);
  const minBet = currentBet + minRaise;

  return Math.max(minBet, Math.min(potSized, stack));
}

/**
 * Pure random decisions (wild bot).
 */
function randomDecision({ toCall, minRaise, stack, canCheck }) {
  const roll = Math.random();

  if (canCheck) {
    if (roll < 0.3) return { action: ACTION.CHECK };
    if (roll < 0.8) {
      const amt = Math.floor(Math.random() * Math.min(stack, 100)) + minRaise;
      return { action: ACTION.BET, amount: Math.min(amt, stack) };
    }
    return { action: ACTION.CHECK };
  }

  if (roll < 0.2) return { action: ACTION.FOLD };
  if (roll < 0.7) {
    if (toCall >= stack) return { action: ACTION.CALL, amount: stack };
    return { action: ACTION.CALL };
  }
  // Random raise
  const raiseTo = Math.floor(Math.random() * (stack - toCall)) + toCall + minRaise;
  return { action: ACTION.RAISE, amount: Math.min(raiseTo, stack + toCall) };
}
