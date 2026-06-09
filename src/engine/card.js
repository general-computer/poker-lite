/**
 * Card and Deck module for Texas Hold'em Poker Engine.
 *
 * Suits: spades (♠), hearts (♥), diamonds (♦), clubs (♣)
 * Ranks: 2-14, where 14 = Ace
 *
 * Deck uses a seedable Mulberry32 PRNG so tests can be fully reproducible.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

export const SUIT = Object.freeze({
  SPADES:   's',
  HEARTS:   'h',
  DIAMONDS: 'd',
  CLUBS:    'c',
});

export const SUIT_SYMBOLS = Object.freeze({
  s: '♠',
  h: '♥',
  d: '♦',
  c: '♣',
});

export const SUIT_NAMES = Object.freeze({
  s: 'spades',
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs',
});

/** Numeric rank → short string (T = Ten). */
export const RANK_SHORT = Object.freeze({
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8',
  9: '9', 10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
});

/** Numeric rank → long name. */
export const RANK_NAMES = Object.freeze({
  2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven',
  8: 'eight', 9: 'nine', 10: 'ten', 11: 'jack', 12: 'queen',
  13: 'king', 14: 'ace',
});

export const ALL_SUITS = Object.freeze(Object.values(SUIT));
export const ALL_RANKS = Object.freeze([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);

/**
 * Create a Card.
 *
 * Immutable — cards are value objects. Use the static factory fromId() for
 * compact wire representations; the constructor takes rank and suit directly.
 */
export class Card {
  /** @type {number} 2-14 */
  rank;

  /** @type {string} one of SUIT values */
  suit;

  /**
   * @param {number} rank  2–14 (14 = Ace)
   * @param {string} suit  one of SUIT: 's','h','d','c'
   */
  constructor(rank, suit) {
    if (!Number.isInteger(rank) || rank < 2 || rank > 14) {
      throw new RangeError(`rank must be 2-14, got ${rank}`);
    }
    if (!SUIT_NAMES[suit]) {
      throw new RangeError(`suit must be s/h/d/c, got "${suit}"`);
    }
    this.rank = rank;
    this.suit = suit;
    Object.freeze(this);
  }

  /**
   * Create a Card from a compact numeric id (0-51).
   * id layout: 0-12 = ♠ 2-A, 13-25 = ♥ 2-A, 26-38 = ♦ 2-A, 39-51 = ♣ 2-A
   * @param {number} id  0-51
   * @returns {Card}
   */
  static fromId(id) {
    if (!Number.isInteger(id) || id < 0 || id > 51) {
      throw new RangeError(`card id must be 0-51, got ${id}`);
    }
    const suitIdx = Math.floor(id / 13);
    const suit = ALL_SUITS[suitIdx];
    const rank = (id % 13) + 2;
    return new Card(rank, suit);
  }

  /**
   * Numeric id 0-51 uniquely identifying this card.
   */
  get id() {
    const suitIdx = ALL_SUITS.indexOf(this.suit);
    return suitIdx * 13 + (this.rank - 2);
  }

  /**
   * Human-readable short string, e.g. "A♠" or "T♥".
   */
  toString() {
    return `${RANK_SHORT[this.rank]}${SUIT_SYMBOLS[this.suit]}`;
  }

  /**
   * Long name, e.g. "ace of spades".
   */
  toLongString() {
    return `${RANK_NAMES[this.rank]} of ${SUIT_NAMES[this.suit]}`;
  }

  /**
   * JavaScript valueOf returns the id for convenient serialization.
   */
  valueOf() {
    return this.id;
  }
}

// ── Seedable PRNG (Mulberry32) ────────────────────────────────────────────────

/**
 * Mulberry32 — fast, simple, seedable 32-bit PRNG.
 *
 * Returns a function that produces successive pseudo-random floats in [0, 1).
 *
 * @param {number} seed  32-bit integer seed
 * @returns {() => number}  PRNG returning float in [0, 1)
 */
export function mulberry32(seed) {
  // Force into 32-bit signed integer range
  let state = seed | 0;
  return function next() {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Deck ──────────────────────────────────────────────────────────────────────

/**
 * A standard 52-card deck.
 *
 * Usage:
 *   const deck = new Deck(42);           // seedable
 *   deck.shuffle();
 *   const cards = deck.deal(2);          // ["Ah", "Kc", ...]
 *   const card  = deck.dealOne();        // single card
 */
export class Deck {
  /** @type {Card[]} */
  #cards;

  /**
   * The PRNG function used by this deck (may be seeded).
   * @type {() => number}
   */
  #rng;

  /**
   * @param {number} [seed]  Optional 32-bit integer seed for reproducible shuffles
   */
  constructor(seed) {
    this.#cards = [];
    this.#rng = typeof seed === 'number' ? mulberry32(seed) : Math.random;
    this.reset();
  }

  // ── public API ──────────────────────────────────────────────────────────

  /** Number of cards remaining. */
  get remaining() {
    return this.#cards.length;
  }

  /** Immutable snapshot of the current draw pile (top = index 0). */
  get cards() {
    return Object.freeze([...this.#cards]);
  }

  /**
   * Rebuild the full 52-card deck in factory order (A♠ … 2♣) without shuffling.
   */
  reset() {
    this.#cards = Array.from({ length: 52 }, (_, i) => Card.fromId(i));
  }

  /**
   * Fisher-Yates shuffle using the deck's PRNG.
   *
   * Calling shuffle() on a partially-dealt deck shuffles only the remaining
   * cards. Call reset() first to get a fresh full deck.
   */
  shuffle() {
    const arr = this.#cards;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.#rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  /**
   * Deal `count` cards from the top (returns an array).
   * Throws if insufficient cards remain.
   *
   * @param {number} count  number of cards to deal
   * @returns {Card[]}
   */
  deal(count) {
    if (count > this.#cards.length) {
      throw new RangeError(
        `Cannot deal ${count} cards — only ${this.#cards.length} remaining`,
      );
    }
    return this.#cards.splice(0, count);
  }

  /**
   * Deal a single card from the top.
   * @returns {Card}
   */
  dealOne() {
    if (this.#cards.length === 0) {
      throw new RangeError('No cards remaining in deck');
    }
    return this.#cards.shift();
  }

  /**
   * Deal two hole cards (standard Hold'em starting hand).
   * Convenience: equivalent to `deck.deal(2)`.
   * @returns {[Card, Card]}
   */
  dealHoleCards() {
    return /** @type {[Card, Card]} */ (this.deal(2));
  }

  /**
   * Deal community cards for the given street.
   * - 'flop': 3 cards
   * - 'turn': 1 card
   * - 'river': 1 card
   *
   * @param {'flop'|'turn'|'river'} street
   * @returns {Card[]}
   */
  dealCommunity(street) {
    if (street === 'flop') return this.deal(3);
    if (street === 'turn') return this.deal(1);
    if (street === 'river') return this.deal(1);
    throw new RangeError(`Unknown street: "${street}". Expected flop/turn/river.`);
  }

  /**
   * Burn a card (discard from top without returning).
   * Standard poker practice burns one card before each community street.
   */
  burn() {
    this.dealOne(); // discard without returning
  }
}
