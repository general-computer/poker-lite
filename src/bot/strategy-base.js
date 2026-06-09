/**
 * Bot Strategy Base — shared utilities for all bot personalities.
 *
 * Provides hand strength evaluation (preflop and postflop), position
 * detection, pot odds calculation, and opponent modeling primitives.
 *
 * Each bot strategy extends this base or uses these utilities to
 * produce a pure function: game state → action.
 */

import { evaluate, HAND_CATEGORY, HAND_NAMES } from '../engine/index.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Minimum raise as a fraction of the pot (standard: 0.5× to 1× pot). */
const DEFAULT_BET_FRACTION = 0.66;

/** Sklansky-Chubukov hand strength rankings (simplified).
 *  Each key is a compact hand identifier: "AA", "AKs", "T9o", etc.
 *  Values are strength scores from 0 (weakest) to 1 (strongest). */
const PREFLOP_STRENGTH = buildPreflopChart();

/**
 * Build the preflop hand strength lookup.
 * Returns a Map keyed by compact hand string.
 */
function buildPreflopChart() {
  const chart = new Map();

  // Premium pairs (AA–JJ)
  setPairRange(chart, [14, 14], 0.98);  // AA
  setPairRange(chart, [13, 13], 0.95);  // KK
  setPairRange(chart, [12, 12], 0.92);  // QQ
  setPairRange(chart, [11, 11], 0.88);  // JJ

  // Strong pairs (TT–88)
  setPairRange(chart, [10, 10], 0.84);  // TT
  setPairRange(chart, [9, 9],   0.78);  // 99
  setPairRange(chart, [8, 8],   0.72);  // 88

  // Medium pairs (77–55)
  setPairRange(chart, [7, 7],   0.66);  // 77
  setPairRange(chart, [6, 6],   0.60);  // 66
  setPairRange(chart, [5, 5],   0.55);  // 55

  // Small pairs (44–22)
  setPairRange(chart, [4, 4],   0.50);  // 44
  setPairRange(chart, [3, 3],   0.46);  // 33
  setPairRange(chart, [2, 2],   0.42);  // 22

  // Premium unpaired
  setUnpaired(chart, 14, 13, true,  0.86);  // AKs
  setUnpaired(chart, 14, 13, false, 0.82);  // AKo
  setUnpaired(chart, 14, 12, true,  0.81);  // AQs
  setUnpaired(chart, 14, 11, true,  0.76);  // AJs
  setUnpaired(chart, 13, 12, true,  0.75);  // KQs
  setUnpaired(chart, 14, 12, false, 0.74);  // AQo
  setUnpaired(chart, 14, 10, true,  0.72);  // ATs
  setUnpaired(chart, 13, 11, true,  0.70);  // KJs
  setUnpaired(chart, 12, 11, true,  0.69);  // QJs
  setUnpaired(chart, 11, 10, true,  0.67);  // JTs
  setUnpaired(chart, 14, 11, false, 0.66);  // AJo

  // Strong unpaired
  setUnpaired(chart, 13, 12, false, 0.65);  // KQo
  setUnpaired(chart, 14, 9,  true,  0.64);  // A9s
  setUnpaired(chart, 13, 10, true,  0.63);  // KTs
  setUnpaired(chart, 12, 10, true,  0.61);  // QTs
  setUnpaired(chart, 10, 9,  true,  0.60);  // T9s
  setUnpaired(chart, 14, 10, false, 0.58);  // ATo
  setUnpaired(chart, 13, 11, false, 0.56);  // KJo

  // Medium unpaired (suited)
  setUnpaired(chart, 14, 8,  true,  0.55);  // A8s
  setUnpaired(chart, 14, 7,  true,  0.53);  // A7s
  setUnpaired(chart, 13, 9,  true,  0.52);  // K9s
  setUnpaired(chart, 12, 9,  true,  0.50);  // Q9s
  setUnpaired(chart, 11, 9,  true,  0.48);  // J9s
  setUnpaired(chart, 9, 8,   true,  0.47);  // 98s
  setUnpaired(chart, 8, 7,   true,  0.45);  // 87s
  setUnpaired(chart, 12, 11, false, 0.44);  // QJo
  setUnpaired(chart, 11, 10, false, 0.43);  // JTo
  setUnpaired(chart, 14, 6,  true,  0.42);  // A6s

  // Weak suited
  setUnpaired(chart, 14, 5,  true,  0.40);  // A5s
  setUnpaired(chart, 14, 4,  true,  0.39);  // A4s
  setUnpaired(chart, 14, 3,  true,  0.38);  // A3s
  setUnpaired(chart, 14, 2,  true,  0.37);  // A2s
  setUnpaired(chart, 13, 8,  true,  0.36);  // K8s
  setUnpaired(chart, 7, 6,   true,  0.35);  // 76s
  setUnpaired(chart, 6, 5,   true,  0.34);  // 65s
  setUnpaired(chart, 5, 4,   true,  0.33);  // 54s
  setUnpaired(chart, 10, 9,  false, 0.32);  // T9o
  setUnpaired(chart, 14, 9,  false, 0.30);  // A9o
  setUnpaired(chart, 13, 10, false, 0.29);  // KTo
  setUnpaired(chart, 12, 10, false, 0.28);  // QTo

  // Remaining hands get strength based on high card
  // (we compute dynamically for unlisted hands)

  return chart;
}

function setPairRange(chart, [rank], strength) {
  const key = handKey(rank, rank, false);
  chart.set(key, strength);
}

function setUnpaired(chart, hi, lo, suited, strength) {
  const key = handKey(hi, lo, suited);
  chart.set(key, strength);
}

/**
 * Compact hand key: "AKs", "T9o", "AA", etc.
 */
function handKey(hi, lo, suited) {
  const R = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const suffix = hi === lo ? '' : (suited ? 's' : 'o');
  return `${R[hi - 2]}${R[lo - 2]}${suffix}`;
}

// ── Position helpers ──────────────────────────────────────────────────────────

/**
 * Categorize position for a player at `playerIdx` given `playerCount` and
 * `dealerIdx`. Returns 'early', 'middle', 'late', or 'blinds'.
 *
 * Early = first third after blinds, Middle = second third,
 * Late = last third (CO/BTN), Blinds = SB/BB.
 */
export function getPosition(playerIdx, playerCount, dealerIdx) {
  // Normalize: offset from dealer (1 = SB, 2 = BB, etc.)
  const offset = (playerIdx - dealerIdx + playerCount) % playerCount;

  // Heads-up: both players are in the blinds
  if (playerCount === 2) {
    return 'blinds';
  }

  // Dealer button is always late position
  if (offset === 0) return 'late';

  // SB and BB are always blinds
  if (offset === 1) return 'blinds';
  if (offset === 2) return 'blinds';

  // Remaining positions: split the field evenly
  // offset=3 is UTG (earliest), offset=playerCount-1 is CO (latest)
  const nonBlindCount = playerCount - 3; // exclude BTN, SB, BB
  if (nonBlindCount <= 0) return 'late'; // 3-handed: everyone else is late

  // Position rank from UTG: 1 = UTG, nonBlindCount = last before BTN
  const posFromUTG = offset - 2; // offset 3 → 1 (UTG)
  const earlyCutoff = Math.ceil(nonBlindCount / 3);
  const lateStart = nonBlindCount - Math.ceil(nonBlindCount / 3) + 1;

  if (posFromUTG <= earlyCutoff) return 'early';
  if (posFromUTG >= lateStart) return 'late';
  return 'middle';
}

// ── Hand strength evaluation ──────────────────────────────────────────────────

/**
 * Preflop hand strength (0–1). Uses the lookup table, falling back to a
 * high-card heuristic for unlisted hands.
 *
 * @param {import('../engine/card.js').Card[]} holeCards  exactly 2 cards
 * @returns {number}  strength 0 (weakest) to 1 (strongest)
 */
export function preflopStrength(holeCards) {
  if (holeCards.length !== 2) {
    throw new RangeError('preflopStrength requires exactly 2 hole cards');
  }

  const [c1, c2] = holeCards;
  const hi = Math.max(c1.rank, c2.rank);
  const lo = Math.min(c1.rank, c2.rank);
  const suited = c1.suit === c2.suit;
  const key = handKey(hi, lo, suited);

  if (PREFLOP_STRENGTH.has(key)) {
    return PREFLOP_STRENGTH.get(key);
  }

  // Fallback heuristic for unlisted hands
  const highCardBonus = (hi - 2) / 12 * 0.15;          // up to 0.15 for Ace
  const lowCardBonus = (lo - 2) / 12 * 0.05;            // up to 0.05
  const suitedBonus = suited ? 0.04 : 0;
  const connectedBonus = (hi - lo <= 2 && hi !== lo) ? 0.03 : 0;
  const gapPenalty = (hi - lo > 3 && hi !== lo) ? -0.05 : 0;

  return Math.max(0, Math.min(1, 0.18 + highCardBonus + lowCardBonus + suitedBonus + connectedBonus + gapPenalty));
}

/**
 * Postflop hand strength from the engine's evaluator, normalized to 0–1.
 *
 * Uses the engine's evaluate() on holeCards + communityCards to get the
 * best 5-card hand. Returns a normalized score where 1.0 = nuts (best
 * possible hand given the board) and near-0 = worst possible.
 *
 * @param {import('../engine/card.js').Card[]} holeCards
 * @param {import('../engine/card.js').Card[]} communityCards
 * @returns {number}  normalized strength 0–1
 */
export function postflopStrength(holeCards, communityCards) {
  if (communityCards.length === 0) {
    return preflopStrength(holeCards);
  }

  if (communityCards.length < 3) {
    // Not enough for a made hand; blend preflop with board texture
    return preflopStrength(holeCards);
  }

  const allCards = [...holeCards, ...communityCards];
  const hand = evaluate(allCards);

  // Weighted normalization: each hand category maps to a strength tier.
  // We use a non-linear scale so that made hands (sets, straights, flushes)
  // score meaningfully higher than draws and high-card hands.
  const categoryWeights = [
    1.0,   // 0: Royal Flush
    0.95,  // 1: Straight Flush
    0.90,  // 2: Four of a Kind
    0.82,  // 3: Full House
    0.72,  // 4: Flush
    0.62,  // 5: Straight
    0.55,  // 6: Three of a Kind
    0.42,  // 7: Two Pair
    0.30,  // 8: One Pair
    0.10,  // 9: High Card
  ];

  const baseScore = categoryWeights[hand.category] || 0;

  // Within-category granularity from primary kicker
  const primaryRank = hand.values[0] || 6;
  const kickerBonus = (primaryRank - 2) / 12 * 0.04;

  return Math.min(1, baseScore + kickerBonus);
}

/**
 * Estimate the player's equity against N opponents (simplified).
 *
 * Uses a rough mapping from hand strength to equity. More precise equity
 * would require Monte Carlo simulation against opponent ranges.
 *
 * @param {number} strength  0–1 hand strength
 * @param {number} opponentCount  number of active opponents
 * @returns {number}  estimated equity 0–1
 */
export function estimatedEquity(strength, opponentCount) {
  // Simplified model: strength ^ (1 + opponentCount * 0.3) approximates
  // chance of beating all opponents
  return Math.pow(strength, 1 + opponentCount * 0.3);
}

// ── Pot odds ──────────────────────────────────────────────────────────────────

/**
 * Compute the pot odds as a fraction.
 *
 * @param {number} pot  current pot size
 * @param {number} toCall  amount player must call
 * @returns {{ odds: number, ratio: string }}  pot odds
 */
export function potOdds(pot, toCall) {
  if (toCall === 0) return { odds: Infinity, ratio: '∞:1' };
  const odds = pot / toCall;
  const ratio = `${odds >= 1 ? Math.round(odds) : '1/' + Math.round(1 / odds)}:1`;
  return { odds, ratio };
}

/**
 * Determine if calling is profitable based on pot odds and estimated equity.
 *
 * @param {number} pot        current pot size
 * @param {number} toCall     amount to call
 * @param {number} equity     estimated win probability 0–1
 * @returns {boolean}
 */
export function isProfitableCall(pot, toCall, equity) {
  if (toCall === 0) return true;
  // Break-even: equity * (pot + toCall) > toCall
  // → equity > toCall / (pot + toCall)
  const required = toCall / (pot + toCall);
  return equity >= required;
}

// ── Stack & SPR ───────────────────────────────────────────────────────────────

/**
 * Stack-to-Pot Ratio.
 *
 * @param {number} stack  player's remaining stack
 * @param {number} pot    current pot size
 * @returns {number} SPR
 */
export function spr(stack, pot) {
  if (pot === 0) return Infinity;
  return stack / pot;
}

/**
 * Classify SPR into zones for strategy decisions.
 *
 * @param {number} sprValue
 * @returns {'low'|'medium'|'high'}
 */
export function sprZone(sprValue) {
  if (sprValue <= 3) return 'low';     // committed
  if (sprValue <= 8) return 'medium';  // playable
  return 'high';                       // deep
}

// ── Opponent modeling ─────────────────────────────────────────────────────────

/**
 * Lightweight opponent model that tracks VPIP and PFR from observed actions.
 *
 * This is a simple frequency tracker — it doesn't do Bayesian updating or
 * range construction, but gives bots enough data to adjust their play.
 */
export class OpponentModel {
  /** @type {Map<string, { handsPlayed: number, handsRaised: number, actions: string[] }>} */
  #players;

  constructor() {
    this.#players = new Map();
  }

  /**
   * Register an observed action.
   */
  observe(playerId, playerName, action, isVoluntary) {
    if (!this.#players.has(playerId)) {
      this.#players.set(playerId, {
        id: playerId,
        name: playerName,
        handsPlayed: 0,
        handsRaised: 0,
        actions: [],
      });
    }
    const p = this.#players.get(playerId);
    p.actions.push(action);
    if (isVoluntary) {
      p.handsPlayed++;
      if (action === 'raise' || action === 'bet') {
        p.handsRaised++;
      }
    }
  }

  /**
   * VPIP (Voluntarily Put $ In Pot): % of hands player voluntarily enters.
   */
  vpip(playerId) {
    const p = this.#players.get(playerId);
    if (!p || p.handsPlayed === 0) return 0;
    return p.handsPlayed / Math.max(1, p.actions.length);
  }

  /**
   * PFR (Pre-Flop Raise): % of hands player raises preflop.
   */
  pfr(playerId) {
    const p = this.#players.get(playerId);
    if (!p || p.handsPlayed === 0) return 0;
    return p.handsRaised / p.handsPlayed;
  }

  /**
   * Rough classification of opponent style.
   */
  classify(playerId) {
    const v = this.vpip(playerId);
    const p = this.pfr(playerId);
    if (v > 0.4 && p < 0.1) return 'loose-passive';
    if (v > 0.35 && p > 0.2) return 'maniac';
    if (v < 0.15 && p < 0.05) return 'rock';
    if (v < 0.25 && p > 0.1) return 'tag';
    return 'balanced';
  }

  /** Reset tracking for a new session. */
  reset() {
    this.#players.clear();
  }
}

// ── Action helpers ────────────────────────────────────────────────────────────

/**
 * Build a bet-sizing suggestion based on pot fraction.
 *
 * @param {number} pot        current pot size
 * @param {number} fraction   fraction of pot to bet (e.g. 0.66 = 2/3 pot)
 * @param {number} stack      player's remaining stack
 * @param {number} minBet     minimum bet allowed
 * @returns {number}  suggested bet amount
 */
export function betSize(pot, fraction = DEFAULT_BET_FRACTION, stack, minBet = 0) {
  const size = Math.max(minBet, Math.floor(pot * fraction));
  return Math.min(size, stack);
}

/**
 * Suggested raise size (re-raise sizing).
 *
 * @param {number} currentBet  current bet to raise over
 * @param {number} pot         pot size
 * @param {number} multiplier  multiplier on current bet (2.5× = standard 3-bet)
 * @param {number} stack       remaining stack
 * @returns {number}  suggested raise-to amount
 */
export function raiseSize(currentBet, pot, multiplier = 2.5, stack) {
  const reRaise = Math.floor(currentBet * multiplier);
  const potSize = currentBet + Math.floor(pot * 0.5);
  return Math.min(stack + (currentBet > 0 ? 0 : currentBet), Math.max(reRaise, potSize));
}
