/**
 * Tests for Card and Deck module.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Card, Deck, mulberry32, SUIT, ALL_SUITS, ALL_RANKS, RANK_SHORT, SUIT_SYMBOLS } from '../src/engine/card.js';

describe('Card', () => {
  it('should create a valid card', () => {
    const card = new Card(14, SUIT.SPADES);
    assert.equal(card.rank, 14);
    assert.equal(card.suit, SUIT.SPADES);
  });

  it('should reject invalid rank', () => {
    assert.throws(() => new Card(1, SUIT.SPADES), RangeError);
    assert.throws(() => new Card(15, SUIT.SPADES), RangeError);
    assert.throws(() => new Card('A', SUIT.SPADES), RangeError);
  });

  it('should reject invalid suit', () => {
    assert.throws(() => new Card(10, 'x'), RangeError);
    assert.throws(() => new Card(10, ''), RangeError);
  });

  it('should create from numeric id', () => {
    assert.equal(Card.fromId(0).toString(), '2♠');
    assert.equal(Card.fromId(12).toString(), 'A♠');
    assert.equal(Card.fromId(13).toString(), '2♥');
    assert.equal(Card.fromId(25).toString(), 'A♥');
    assert.equal(Card.fromId(26).toString(), '2♦');
    assert.equal(Card.fromId(38).toString(), 'A♦');
    assert.equal(Card.fromId(39).toString(), '2♣');
    assert.equal(Card.fromId(51).toString(), 'A♣');
  });

  it('should reject invalid id', () => {
    assert.throws(() => Card.fromId(-1), RangeError);
    assert.throws(() => Card.fromId(52), RangeError);
    assert.throws(() => Card.fromId(5.5), RangeError);
  });

  it('should have correct numeric id', () => {
    assert.equal(new Card(2, SUIT.SPADES).id, 0);
    assert.equal(new Card(14, SUIT.SPADES).id, 12);
    assert.equal(new Card(2, SUIT.HEARTS).id, 13);
    assert.equal(new Card(14, SUIT.CLUBS).id, 51);
  });

  it('should convert to string', () => {
    assert.equal(new Card(14, SUIT.SPADES).toString(), 'A♠');
    assert.equal(new Card(10, SUIT.HEARTS).toString(), 'T♥');
    assert.equal(new Card(7, SUIT.DIAMONDS).toString(), '7♦');
    assert.equal(new Card(2, SUIT.CLUBS).toString(), '2♣');
  });

  it('should convert to long string', () => {
    assert.equal(new Card(14, SUIT.SPADES).toLongString(), 'ace of spades');
    assert.equal(new Card(13, SUIT.HEARTS).toLongString(), 'king of hearts');
  });

  it('should be immutable (frozen)', () => {
    const card = new Card(10, SUIT.CLUBS);
    assert.throws(() => { card.rank = 11; }, TypeError);
  });

  it('should work with valueOf for serialization', () => {
    const card = new Card(2, SUIT.SPADES);
    assert.equal(card.valueOf(), 0);
    assert.equal(+card, 0);
  });
});

describe('Deck', () => {
  it('should create a fresh deck with 52 cards', () => {
    const deck = new Deck();
    assert.equal(deck.remaining, 52);
  });

  it('should create a fresh deck in factory order', () => {
    const deck = new Deck();
    assert.equal(deck.cards[0].toString(), '2♠');
    assert.equal(deck.cards[51].toString(), 'A♣');
  });

  it('should shuffle with seed for reproducibility', () => {
    const deck1 = new Deck(42);
    deck1.shuffle();
    const cards1 = deck1.cards.map(c => c.toString());

    const deck2 = new Deck(42);
    deck2.shuffle();
    const cards2 = deck2.cards.map(c => c.toString());

    assert.deepEqual(cards1, cards2);
  });

  it('should produce different orders with different seeds', () => {
    const deck1 = new Deck(42);
    deck1.shuffle();

    const deck2 = new Deck(99);
    deck2.shuffle();

    const cards1 = deck1.cards.map(c => c.toString());
    const cards2 = deck2.cards.map(c => c.toString());

    assert.notDeepEqual(cards1, cards2);
  });

  it('should deal cards from the top', () => {
    const deck = new Deck(42);
    deck.shuffle();
    const cards = deck.deal(5);
    assert.equal(cards.length, 5);
    assert.equal(deck.remaining, 47);
  });

  it('should deal one card', () => {
    const deck = new Deck(42);
    deck.shuffle();
    const card = deck.dealOne();
    assert.ok(card instanceof Card);
    assert.equal(deck.remaining, 51);
  });

  it('should throw when dealing more cards than available', () => {
    const deck = new Deck();
    deck.deal(50);
    assert.throws(() => deck.deal(3), RangeError);
  });

  it('should throw when dealing from empty deck', () => {
    const deck = new Deck();
    deck.deal(52);
    assert.throws(() => deck.dealOne(), RangeError);
  });

  it('should deal hole cards', () => {
    const deck = new Deck(42);
    deck.shuffle();
    const holeCards = deck.dealHoleCards();
    assert.equal(holeCards.length, 2);
    assert.ok(holeCards[0] instanceof Card);
    assert.ok(holeCards[1] instanceof Card);
  });

  it('should deal community cards (flop)', () => {
    const deck = new Deck(42);
    deck.shuffle();
    const flop = deck.dealCommunity('flop');
    assert.equal(flop.length, 3);
  });

  it('should deal community cards (turn)', () => {
    const deck = new Deck(42);
    deck.shuffle();
    const turn = deck.dealCommunity('turn');
    assert.equal(turn.length, 1);
  });

  it('should deal community cards (river)', () => {
    const deck = new Deck(42);
    deck.shuffle();
    const river = deck.dealCommunity('river');
    assert.equal(river.length, 1);
  });

  it('should burn a card (discard without returning)', () => {
    const deck = new Deck(42);
    deck.shuffle();
    const before = deck.remaining;
    deck.burn();
    assert.equal(deck.remaining, before - 1);
  });

  it('should reset to full 52-card deck in factory order', () => {
    const deck = new Deck();
    deck.shuffle();
    deck.deal(10);
    deck.reset();
    assert.equal(deck.remaining, 52);
    assert.equal(deck.cards[0].toString(), '2♠');
  });

  it('should shuffle only remaining cards after partial deal', () => {
    const deck = new Deck(42);
    deck.shuffle();
    const dealt = deck.deal(10);
    deck.shuffle(); // shuffles remaining 42
    assert.equal(deck.remaining, 42);
  });

  it('should contain all 52 unique cards after reset', () => {
    const deck = new Deck();
    const ids = new Set(deck.cards.map(c => c.id));
    assert.equal(ids.size, 52);
    for (let i = 0; i < 52; i++) {
      assert.ok(ids.has(i), `Missing card id ${i}`);
    }
  });

  it('should contain all suits and ranks', () => {
    const deck = new Deck();
    const suits = new Set(deck.cards.map(c => c.suit));
    const ranks = new Set(deck.cards.map(c => c.rank));
    assert.equal(suits.size, 4);
    assert.equal(ranks.size, 13);
  });
});

describe('mulberry32', () => {
  it('should be deterministic with same seed', () => {
    const rng1 = mulberry32(123);
    const rng2 = mulberry32(123);
    for (let i = 0; i < 100; i++) {
      assert.equal(rng1(), rng2());
    }
  });

  it('should produce values in [0, 1)', () => {
    const rng = mulberry32(456);
    for (let i = 0; i < 1000; i++) {
      const val = rng();
      assert.ok(val >= 0 && val < 1, `Value ${val} out of range`);
    }
  });

  it('should produce different sequences for different seeds', () => {
    const rng1 = mulberry32(1);
    const rng2 = mulberry32(2);
    // First few values should differ
    const vals1 = Array.from({ length: 10 }, () => rng1());
    const vals2 = Array.from({ length: 10 }, () => rng2());
    assert.notDeepEqual(vals1, vals2);
  });
});
