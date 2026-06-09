/**
 * Hand Evaluator for Texas Hold'em.
 *
 * Evaluates the best 5-card hand from up to 7 cards (2 hole + 5 community).
 * Returns comparable hand-strength objects with kicker tie-breaking.
 */

// ── Hand categories (lower number = stronger hand) ────────────────────────────

export const HAND_CATEGORY = Object.freeze({
  ROYAL_FLUSH:      0,
  STRAIGHT_FLUSH:   1,
  FOUR_OF_A_KIND:   2,
  FULL_HOUSE:       3,
  FLUSH:            4,
  STRAIGHT:         5,
  THREE_OF_A_KIND:  6,
  TWO_PAIR:         7,
  ONE_PAIR:         8,
  HIGH_CARD:        9,
});

export const HAND_NAMES = Object.freeze({
  0: 'Royal Flush',
  1: 'Straight Flush',
  2: 'Four of a Kind',
  3: 'Full House',
  4: 'Flush',
  5: 'Straight',
  6: 'Three of a Kind',
  7: 'Two Pair',
  8: 'One Pair',
  9: 'High Card',
});

// ── Combinatorics helper ──────────────────────────────────────────────────────

/**
 * Generate all combinations of `k` items from `arr`.
 * @template T
 * @param {T[]} arr
 * @param {number} k
 * @returns {T[][]}
 */
function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  const withFirst = combinations(rest, k - 1).map(c => [first, ...c]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

// ── Rank counting helpers ─────────────────────────────────────────────────────

/**
 * Build a frequency map of ranks from an array of cards.
 * Returns: { groups: Map<rank, count>, pairs: number[], trips: number[], quads: number[] }
 */
function rankCounts(cards) {
  const counts = new Map();
  for (const c of cards) {
    counts.set(c.rank, (counts.get(c.rank) || 0) + 1);
  }
  const pairs = [];
  const trips = [];
  const quads = [];
  for (const [rank, count] of counts) {
    if (count === 2) pairs.push(rank);
    else if (count === 3) trips.push(rank);
    else if (count === 4) quads.push(rank);
  }
  // Sort descending within each group
  pairs.sort((a, b) => b - a);
  trips.sort((a, b) => b - a);
  quads.sort((a, b) => b - a);
  return { counts, pairs, trips, quads };
}

/**
 * Detect a straight from sorted unique ranks (descending).
 * Ace-low straights (A-2-3-4-5) are handled: if ranks include 14, we also try
 * treating Ace as 1.
 *
 * Returns the high-card rank of the straight, or null.
 */
function detectStraight(uniqueRanks) {
  // Ace-low straight check: if [14,5,4,3,2] is present
  const hasAce = uniqueRanks.includes(14);
  const wheel = hasAce ? [5, 4, 3, 2] : null;

  if (wheel && wheel.every(r => uniqueRanks.includes(r))) {
    return 5; // 5-high straight (wheel)
  }

  // Standard straight: 5 consecutive descending ranks
  for (let i = 0; i <= uniqueRanks.length - 5; i++) {
    if (uniqueRanks[i] - uniqueRanks[i + 4] === 4) {
      return uniqueRanks[i]; // high card of straight
    }
  }
  return null;
}

/**
 * Get sorted kickers — all ranks sorted desc, excluding specified ranks.
 */
function kickers(ranks, exclude = []) {
  const ex = new Set(exclude);
  return [...ranks].filter(r => !ex.has(r)).sort((a, b) => b - a);
}

// ── Five-card evaluation ──────────────────────────────────────────────────────

/**
 * Evaluate exactly 5 cards and return a HandRank.
 *
 * @param {import('./card.js').Card[]} cards  exactly 5 cards
 * @returns {HandRank}
 */
export function evaluate5(cards) {
  if (cards.length !== 5) {
    throw new RangeError(`evaluate5 requires exactly 5 cards, got ${cards.length}`);
  }

  const ranks = cards.map(c => c.rank).sort((a, b) => b - a); // desc
  const suits = cards.map(c => c.suit);
  const isFlush = new Set(suits).size === 1;
  const isStraight = detectStraight([...new Set(ranks)].sort((a, b) => b - a));
  const { pairs, trips, quads } = rankCounts(cards);

  // Royal Flush / Straight Flush
  if (isFlush && isStraight !== null) {
    // For a wheel straight flush, high card is 5
    const high = isStraight;
    if (high === 14) {
      return new HandRank(HAND_CATEGORY.ROYAL_FLUSH, [14]);
    }
    return new HandRank(HAND_CATEGORY.STRAIGHT_FLUSH, [high]);
  }

  // Four of a Kind
  if (quads.length === 1) {
    const kicker = ranks.find(r => r !== quads[0]);
    return new HandRank(HAND_CATEGORY.FOUR_OF_A_KIND, [quads[0], kicker]);
  }

  // Full House
  if (trips.length === 1 && pairs.length === 1) {
    return new HandRank(HAND_CATEGORY.FULL_HOUSE, [trips[0], pairs[0]]);
  }

  // Flush
  if (isFlush) {
    return new HandRank(HAND_CATEGORY.FLUSH, ranks);
  }

  // Straight
  if (isStraight !== null) {
    return new HandRank(HAND_CATEGORY.STRAIGHT, [isStraight]);
  }

  // Three of a Kind
  if (trips.length === 1) {
    const k = kickers(ranks, [trips[0]]);
    return new HandRank(HAND_CATEGORY.THREE_OF_A_KIND, [trips[0], ...k]);
  }

  // Two Pair
  if (pairs.length === 2) {
    const k = kickers(ranks, pairs);
    return new HandRank(HAND_CATEGORY.TWO_PAIR, [...pairs, ...k]);
  }

  // One Pair
  if (pairs.length === 1) {
    const k = kickers(ranks, [pairs[0]]);
    return new HandRank(HAND_CATEGORY.ONE_PAIR, [pairs[0], ...k]);
  }

  // High Card
  return new HandRank(HAND_CATEGORY.HIGH_CARD, ranks);
}

// ── Seven-card evaluation ─────────────────────────────────────────────────────

/**
 * Evaluate the best 5-card hand from up to 7 cards.
 *
 * Standard Texas Hold'em uses exactly 7 cards (2 hole + 5 community), but
 * this function accepts 5-7 cards for flexibility during partial streets.
 *
 * @param {import('./card.js').Card[]} cards  5-7 cards
 * @returns {HandRank}
 */
export function evaluate(cards) {
  if (cards.length < 5 || cards.length > 7) {
    throw new RangeError(`evaluate requires 5-7 cards, got ${cards.length}`);
  }

  if (cards.length === 5) {
    return evaluate5(cards);
  }

  // Enumerate all 5-card subsets, pick the best
  const all5 = combinations(cards, 5);
  let best = evaluate5(all5[0]);
  for (let i = 1; i < all5.length; i++) {
    const candidate = evaluate5(all5[i]);
    if (candidate.compareTo(best) < 0) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Compare two hands and return the winner from an array of {player, cards}.
 *
 * Returns an array of winners (in case of ties).
 *
 * @param {Array<{player: any, cards: import('./card.js').Card[]}>} entries
 * @returns {Array<{player: any, hand: HandRank, description: string}>}
 */
export function showdown(entries) {
  let best = null;
  const results = [];

  for (const { player, cards } of entries) {
    const hand = evaluate(cards);
    const desc = describe(hand);
    results.push({ player, hand, description: desc });
    if (best === null || hand.compareTo(best) < 0) {
      best = hand;
    }
  }

  const winners = results.filter(r => r.hand.compareTo(best) === 0);
  return winners;
}

// ── HandRank ──────────────────────────────────────────────────────────────────

/**
 * Comparable hand-strength object.
 *
 * Natural comparison: negative if `this` is STRONGER than `other` (lower
 * category number wins, then higher value ranks win).
 */
export class HandRank {
  /** @type {number} HAND_CATEGORY value (0-9) */
  category;

  /**
   * Rank values for comparison within the category, sorted by importance.
   * First element is always the primary rank (pair/trip/quad rank, straight
   * high, etc.), followed by kickers in descending order.
   * @type {number[]}
   */
  values;

  /**
   * @param {number} category   HAND_CATEGORY value
   * @param {number[]} values   comparison ranks (primary first, then kickers)
   */
  constructor(category, values) {
    this.category = category;
    this.values = Object.freeze([...values]);
    Object.freeze(this);
  }

  /**
   * Descriptive name, e.g. "Full House, Aces over Kings".
   */
  toString() {
    return HAND_NAMES[this.category];
  }

  /**
   * Compare this hand to another.
   * @param {HandRank} other
   * @returns {number}  negative if this wins, positive if other wins, 0 if tie
   */
  compareTo(other) {
    if (this.category !== other.category) {
      return this.category - other.category;
    }
    for (let i = 0; i < Math.max(this.values.length, other.values.length); i++) {
      const a = this.values[i] || 0;
      const b = other.values[i] || 0;
      if (a !== b) return b - a; // higher rank wins
    }
    return 0;
  }
}

// ── Description ───────────────────────────────────────────────────────────────

/**
 * Human-readable description of a hand.
 *
 * @param {HandRank} hand
 * @returns {string}
 */
export function describe(hand) {
  const { category, values } = hand;
  const rankName = (r) => RANK_NAMES[r] || String(r);

  switch (category) {
    case HAND_CATEGORY.ROYAL_FLUSH:
      return 'Royal Flush';

    case HAND_CATEGORY.STRAIGHT_FLUSH:
      return `Straight Flush, ${rankName(values[0])} high`;

    case HAND_CATEGORY.FOUR_OF_A_KIND:
      return `Four of a Kind, ${rankName(values[0])}s`;

    case HAND_CATEGORY.FULL_HOUSE:
      return `Full House, ${rankName(values[0])}s over ${rankName(values[1])}s`;

    case HAND_CATEGORY.FLUSH:
      return `Flush, ${rankName(values[0])} high`;

    case HAND_CATEGORY.STRAIGHT:
      return `Straight, ${rankName(values[0])} high`;

    case HAND_CATEGORY.THREE_OF_A_KIND:
      return `Three of a Kind, ${rankName(values[0])}s`;

    case HAND_CATEGORY.TWO_PAIR:
      return `Two Pair, ${rankName(values[0])}s and ${rankName(values[1])}s`;

    case HAND_CATEGORY.ONE_PAIR:
      return `One Pair, ${rankName(values[0])}s`;

    case HAND_CATEGORY.HIGH_CARD:
      return `High Card, ${rankName(values[0])}`;

    default:
      return 'Unknown hand';
  }
}

// Import here to avoid circular dependency issues
import { RANK_NAMES } from './card.js';
