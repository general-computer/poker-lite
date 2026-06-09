/**
 * Tests for Hand Evaluator module.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Card } from '../src/engine/card.js';
import {
  evaluate,
  evaluate5,
  showdown,
  describe as describeHand,
  HandRank,
  HAND_CATEGORY,
} from '../src/engine/hand-evaluator.js';

// Helper to create cards quickly from short strings like "As" (A♠), "Th" (T♥)
function c(str) {
  const rankMap = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
  const suitMap = { 's': 's', 'h': 'h', 'd': 'd', 'c': 'c' };
  const rank = rankMap[str[0]];
  const suit = suitMap[str[1]];
  if (rank === undefined || suit === undefined) throw new Error(`Invalid card string: ${str}`);
  return new Card(rank, suit);
}

// Helper: parse multiple cards
function cards(str) {
  return str.split(' ').map(c);
}

describe('HandRank', () => {
  it('should compare categories correctly (lower is better)', () => {
    const royal = new HandRank(HAND_CATEGORY.ROYAL_FLUSH, [14]);
    const highCard = new HandRank(HAND_CATEGORY.HIGH_CARD, [7]);
    assert.ok(royal.compareTo(highCard) < 0);
    assert.ok(highCard.compareTo(royal) > 0);
  });

  it('should tie-break on kickers', () => {
    const pairA = new HandRank(HAND_CATEGORY.ONE_PAIR, [14, 13, 12, 5]);
    const pairB = new HandRank(HAND_CATEGORY.ONE_PAIR, [14, 13, 11, 5]);
    // pairA has higher 3rd kicker
    assert.ok(pairA.compareTo(pairB) < 0);
  });

  it('should detect equal hands', () => {
    const a = new HandRank(HAND_CATEGORY.TWO_PAIR, [14, 13, 5]);
    const b = new HandRank(HAND_CATEGORY.TWO_PAIR, [14, 13, 5]);
    assert.equal(a.compareTo(b), 0);
  });

  it('should be immutable (frozen)', () => {
    const hr = new HandRank(HAND_CATEGORY.FLUSH, [14, 10, 8, 6, 4]);
    assert.throws(() => { hr.category = 0; }, TypeError);
    assert.throws(() => { hr.values.push(2); }, TypeError);
  });
});

describe('evaluate5', () => {
  it('should detect Royal Flush', () => {
    const hand = cards('As Ks Qs Js Ts');
    const result = evaluate5(hand);
    assert.equal(result.category, HAND_CATEGORY.ROYAL_FLUSH);
    assert.deepEqual([...result.values], [14]);
  });

  it('should detect Straight Flush', () => {
    const hand = cards('9h 8h 7h 6h 5h');
    const result = evaluate5(hand);
    assert.equal(result.category, HAND_CATEGORY.STRAIGHT_FLUSH);
    assert.deepEqual([...result.values], [9]);
  });

  it('should detect Steel Wheel (A-5 straight flush)', () => {
    const hand = cards('Ah 2h 3h 4h 5h');
    const result = evaluate5(hand);
    assert.equal(result.category, HAND_CATEGORY.STRAIGHT_FLUSH);
    assert.deepEqual([...result.values], [5]);
  });

  it('should detect Four of a Kind', () => {
    const hand = cards('As Ac Ah Ad Kh');
    const result = evaluate5(hand);
    assert.equal(result.category, HAND_CATEGORY.FOUR_OF_A_KIND);
    assert.deepEqual([...result.values], [14, 13]);
  });

  it('should detect Full House (trips > pair)', () => {
    const hand = cards('As Ac Ah Kd Kh');
    const result = evaluate5(hand);
    assert.equal(result.category, HAND_CATEGORY.FULL_HOUSE);
    assert.deepEqual([...result.values], [14, 13]);
  });

  it('should detect Flush', () => {
    const hand = cards('As Ks Ts 7s 3s');
    const result = evaluate5(hand);
    assert.equal(result.category, HAND_CATEGORY.FLUSH);
    assert.deepEqual([...result.values], [14, 13, 10, 7, 3]);
  });

  it('should detect Straight', () => {
    const hand = cards('9s 8h 7d 6c 5s');
    const result = evaluate5(hand);
    assert.equal(result.category, HAND_CATEGORY.STRAIGHT);
    assert.deepEqual([...result.values], [9]);
  });

  it('should detect Wheel straight (A-5)', () => {
    const hand = cards('As 2h 3d 4c 5s');
    const result = evaluate5(hand);
    assert.equal(result.category, HAND_CATEGORY.STRAIGHT);
    assert.deepEqual([...result.values], [5]);
  });

  it('should detect Three of a Kind', () => {
    const hand = cards('As Ac Ah Kd Qh');
    const result = evaluate5(hand);
    assert.equal(result.category, HAND_CATEGORY.THREE_OF_A_KIND);
    assert.deepEqual([...result.values], [14, 13, 12]);
  });

  it('should detect Two Pair', () => {
    const hand = cards('As Ac Kh Kd Qs');
    const result = evaluate5(hand);
    assert.equal(result.category, HAND_CATEGORY.TWO_PAIR);
    assert.deepEqual([...result.values], [14, 13, 12]);
  });

  it('should detect One Pair', () => {
    const hand = cards('As Ac Kh Qd Js');
    const result = evaluate5(hand);
    assert.equal(result.category, HAND_CATEGORY.ONE_PAIR);
    assert.deepEqual([...result.values], [14, 13, 12, 11]);
  });

  it('should detect High Card', () => {
    const hand = cards('As Kh Td 7c 3s');
    const result = evaluate5(hand);
    assert.equal(result.category, HAND_CATEGORY.HIGH_CARD);
    assert.deepEqual([...result.values], [14, 13, 10, 7, 3]);
  });

  it('should reject wrong number of cards', () => {
    assert.throws(() => evaluate5(cards('As Kh Td 7c')), RangeError);
    assert.throws(() => evaluate5(cards('As Kh Td 7c 3s 2h')), RangeError);
  });
});

describe('evaluate (7 cards)', () => {
  it('should find the best 5-card hand from 7', () => {
    // Hand: Ad Kd Qd Jd Td (royal flush in diamonds) + 2c 3s
    const seven = cards('Ad Kd Qd Jd Td 2c 3s');
    const result = evaluate(seven);
    assert.equal(result.category, HAND_CATEGORY.ROYAL_FLUSH);
  });

  it('should find flush over straight', () => {
    // 7 cards with both a flush and a straight possible
    const seven = cards('Ah Kh Qh Jh 9h 8d 7d');
    const result = evaluate(seven);
    // Should be a flush (Ah Kh Qh Jh 9h), not a straight (higher category)
    assert.equal(result.category, HAND_CATEGORY.FLUSH);
  });

  it('should find full house over flush', () => {
    // Board: As Ac Kh Kd Qh. Hole: Ad Kc (giving AAAKK full house, but also hearts flush possible if we add hearts)
    const seven = cards('As Ac Ad Kh Kd Qh 2c');
    const result = evaluate(seven);
    assert.equal(result.category, HAND_CATEGORY.FULL_HOUSE);
    assert.deepEqual([...result.values], [14, 13]);
  });

  it('should handle 5 cards (pass-through)', () => {
    const five = cards('As Ks Qs Js Ts');
    const result = evaluate(five);
    assert.equal(result.category, HAND_CATEGORY.ROYAL_FLUSH);
  });

  it('should handle 6 cards', () => {
    const six = cards('As Ac Kh Kd Qs Jd');
    const result = evaluate(six);
    assert.equal(result.category, HAND_CATEGORY.TWO_PAIR);
    assert.deepEqual([...result.values], [14, 13, 12]);
  });
});

describe('evaluate — hand comparison', () => {
  it('should rank Royal Flush above Straight Flush', () => {
    const royal = evaluate(cards('As Ks Qs Js Ts 2c 3d'));
    const straightFlush = evaluate(cards('Kh Qh Jh Th 9h 2c 3d'));
    assert.ok(royal.compareTo(straightFlush) < 0);
  });

  it('should rank Straight Flush above Four of a Kind', () => {
    const sf = evaluate(cards('9h 8h 7h 6h 5h 2c 3d'));
    const quads = evaluate(cards('As Ac Ah Ad Kh 2c 3d'));
    assert.ok(sf.compareTo(quads) < 0);
  });

  it('should rank Four of a Kind above Full House', () => {
    const quads = evaluate(cards('As Ac Ah Ad Kh 2c 3d'));
    const boat = evaluate(cards('Ks Kc Kh Qd Qh 2c 3d'));
    assert.ok(quads.compareTo(boat) < 0);
  });

  it('should rank Full House above Flush', () => {
    const boat = evaluate(cards('Ks Kc Kh Qd Qh 2c 3d'));
    const flush = evaluate(cards('As Ks Ts 7s 3s 2c 3d'));
    assert.ok(boat.compareTo(flush) < 0);
  });

  it('should rank Flush above Straight', () => {
    const flush = evaluate(cards('As Ks Ts 7s 3s 2c 3d'));
    const straight = evaluate(cards('9s 8h 7d 6c 5s 2c 3d'));
    assert.ok(flush.compareTo(straight) < 0);
  });

  it('should rank Straight above Three of a Kind', () => {
    const straight = evaluate(cards('9s 8h 7d 6c 5s 2c 3d'));
    const trips = evaluate(cards('As Ac Ah Kd Qh 2c 3d'));
    assert.ok(straight.compareTo(trips) < 0);
  });

  it('should rank Three of a Kind above Two Pair', () => {
    const trips = evaluate(cards('As Ac Ah Kd Qh 2c 3d'));
    const twoPair = evaluate(cards('As Ac Kh Kd Qh 2c 3d'));
    assert.ok(trips.compareTo(twoPair) < 0);
  });

  it('should rank Two Pair above One Pair', () => {
    const twoPair = evaluate(cards('As Ac Kh Kd Qh 2c 3d'));
    const onePair = evaluate(cards('As Ac Kh Qd Jh 2c 3d'));
    assert.ok(twoPair.compareTo(onePair) < 0);
  });

  it('should rank One Pair above High Card', () => {
    const onePair = evaluate(cards('As Ac Kh Qd Jh 2c 3d'));
    const highCard = evaluate(cards('As Kh Qd Jh 9c 2c 3d'));
    assert.ok(onePair.compareTo(highCard) < 0);
  });
});

describe('evaluate — kicker tie-breaking', () => {
  it('should break pair ties with kickers', () => {
    const hand1 = evaluate(cards('As Ah Kh Qd Js 2c 3d')); // AA KQJ
    const hand2 = evaluate(cards('As Ah Kh Qd Ts 2c 3d')); // AA KQT
    assert.ok(hand1.compareTo(hand2) < 0); // hand1 wins with J kicker
  });

  it('should break two-pair ties with kickers', () => {
    const hand1 = evaluate(cards('As Ah Kh Kd Qs 2c 3d')); // AAKKQ
    const hand2 = evaluate(cards('As Ah Kh Kd Js 2c 3d')); // AAKKJ
    assert.ok(hand1.compareTo(hand2) < 0);
  });

  it('should detect split pot (identical hands)', () => {
    const hand1 = evaluate(cards('As Kh Qd Js 9c 2c 3d'));
    const hand2 = evaluate(cards('Ad Ks Qh Jd 9h 2c 3d'));
    assert.equal(hand1.compareTo(hand2), 0);
  });

  it('should handle kickers on high-card hands', () => {
    // Best 5 for hand1: A-K-Q-J-7
    const hand1 = evaluate(cards('As Kh Qd Js 7c 3d 2c'));
    // Best 5 for hand2: A-K-Q-J-8
    const hand2 = evaluate(cards('Ad Ks Qh Jd 8h 3d 2c'));
    // hand2 wins with 8 as 5th kicker vs 7
    assert.ok(hand2.compareTo(hand1) < 0, 'hand2 (8 kicker) should beat hand1 (7 kicker)');
  });
});

describe('showdown', () => {
  it('should determine single winner', () => {
    const result = showdown([
      { player: { id: 'a', name: 'Alice' }, cards: cards('As Ah Kh Qd Js 2c 3d') },
      { player: { id: 'b', name: 'Bob' }, cards: cards('Ks Kc Kh Qd Jh 2c 3d') },
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0].player.name, 'Bob'); // trips beat pair
  });

  it('should detect ties (split pot)', () => {
    const result = showdown([
      { player: { id: 'a', name: 'Alice' }, cards: cards('As Ah Kh Qd Js 2c 3d') },
      { player: { id: 'b', name: 'Bob' }, cards: cards('Ad Ac Ks Qh Jd 2c 3d') },
    ]);
    assert.equal(result.length, 2);
  });

  it('should handle 3-way showdown', () => {
    const result = showdown([
      { player: { id: 'a', name: 'Alice' }, cards: cards('As Ah Kh Qd Js 2c 3d') },
      { player: { id: 'b', name: 'Bob' }, cards: cards('Ks Kc Kh Qd Jh 2c 3d') },
      { player: { id: 'c', name: 'Carol' }, cards: cards('Qs Qc Qh Jd Th 2c 3d') },
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0].player.name, 'Bob'); // KKK > QQQ > AA
  });
});

describe('describeHand', () => {
  it('should describe Royal Flush', () => {
    const hand = evaluate5(cards('As Ks Qs Js Ts'));
    assert.equal(describeHand(hand), 'Royal Flush');
  });

  it('should describe Full House', () => {
    const hand = evaluate5(cards('As Ac Ah Kd Kh'));
    assert.equal(describeHand(hand), 'Full House, aces over kings');
  });

  it('should describe Two Pair', () => {
    const hand = evaluate5(cards('As Ac Kh Kd Qs'));
    assert.equal(describeHand(hand), 'Two Pair, aces and kings');
  });

  it('should describe One Pair', () => {
    const hand = evaluate5(cards('As Ac Kh Qd Js'));
    assert.equal(describeHand(hand), 'One Pair, aces');
  });
});
