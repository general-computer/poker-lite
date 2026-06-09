/**
 * Tests for Betting and Pot Management module.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION,
  ROUND,
  BettingRound,
  validateAction,
  calculatePots,
  advanceDealer,
  blindPositions,
  createBlinds,
} from '../src/engine/betting.js';

describe('BettingRound', () => {
  it('should start with zero current bet', () => {
    const round = new BettingRound(10);
    assert.equal(round.currentBet, 0);
    assert.equal(round.minRaise, 10);
    assert.equal(round.lastRaiser, -1);
    assert.equal(round.raiseCount, 0);
  });

  it('should track player round bets', () => {
    const round = new BettingRound(10);
    round.recordBet(0, 10);
    round.recordBet(1, 20);
    assert.equal(round.playerRoundBet(0), 10);
    assert.equal(round.playerRoundBet(1), 20);
  });

  it('should calculate toCall correctly', () => {
    const round = new BettingRound(10);
    round.currentBet = 50;
    round.recordBet(0, 10);
    assert.equal(round.toCall(0), 40);
    assert.equal(round.toCall(1), 50);
  });

  it('should calculate raise range correctly', () => {
    const round = new BettingRound(10);
    round.currentBet = 20;
    round.recordBet(0, 10);
    // Player 0: toCall=10, minRaise=10, stack=100.
    // Old currentBet=20, min new total bet = currentBet + minRaise = 30.
    // Max new total bet = playerRoundBet(10) + stack = 10 + 100 = 110.
    const range = round.raiseRange(0, 100);
    assert.equal(range.min, 30);
    assert.equal(range.max, 110);
  });

  it('should cap raise range at player stack', () => {
    const round = new BettingRound(10);
    round.currentBet = 50;
    const range = round.raiseRange(0, 30);
    assert.equal(range.min, 30); // all-in
    assert.equal(range.max, 30);
  });

  it('should apply a raise and update state', () => {
    const round = new BettingRound(10);
    const { callAmount, raiseAmount } = round.applyRaise(0, 50);
    assert.equal(callAmount, 0);
    assert.equal(raiseAmount, 50);
    assert.equal(round.currentBet, 50);
    assert.equal(round.lastRaiser, 0);
    assert.equal(round.raiseCount, 1);
    assert.equal(round.playerRoundBet(0), 50);
  });

  it('should apply a call and match current bet', () => {
    const round = new BettingRound(10);
    round.currentBet = 30;
    const amount = round.applyCall(1);
    assert.equal(amount, 30);
    assert.equal(round.playerRoundBet(1), 30);
  });

  it('should reset between streets', () => {
    const round = new BettingRound(10);
    round.applyRaise(0, 40);
    round.applyCall(1);
    round.reset();
    assert.equal(round.currentBet, 0);
    assert.equal(round.lastRaiser, -1);
    assert.equal(round.raiseCount, 0);
    assert.equal(round.playerRoundBet(0), 0);
    assert.equal(round.playerRoundBet(1), 0);
  });

  it('should get all player bets', () => {
    const round = new BettingRound(10);
    round.recordBet(0, 10);
    round.recordBet(2, 15);
    const bets = round.getBets();
    assert.deepEqual(bets, { 0: 10, 2: 15 });
  });
});

describe('validateAction', () => {
  it('should allow fold', () => {
    const result = validateAction({
      action: ACTION.FOLD, playerIdx: 0, playerStack: 100,
      round: new BettingRound(10), canCheck: false,
    });
    assert.equal(result.valid, true);
  });

  it('should allow check when facing no bet', () => {
    const result = validateAction({
      action: ACTION.CHECK, playerIdx: 0, playerStack: 100,
      round: new BettingRound(10), canCheck: true,
    });
    assert.equal(result.valid, true);
  });

  it('should reject check when facing a bet', () => {
    const round = new BettingRound(10);
    round.currentBet = 20;
    const result = validateAction({
      action: ACTION.CHECK, playerIdx: 0, playerStack: 100,
      round, canCheck: false,
    });
    assert.equal(result.valid, false);
  });

  it('should allow call when facing a bet', () => {
    const round = new BettingRound(10);
    round.currentBet = 20;
    const result = validateAction({
      action: ACTION.CALL, playerIdx: 0, playerStack: 100,
      round, canCheck: false,
    });
    assert.equal(result.valid, true);
    assert.equal(result.details.amount, 20);
  });

  it('should reject call when nothing to call', () => {
    const result = validateAction({
      action: ACTION.CALL, playerIdx: 0, playerStack: 100,
      round: new BettingRound(10), canCheck: true,
    });
    assert.equal(result.valid, false);
  });

  it('should allow call all-in for less than full amount', () => {
    const round = new BettingRound(10);
    round.currentBet = 100;
    const result = validateAction({
      action: ACTION.CALL, playerIdx: 0, playerStack: 30,
      round, canCheck: false,
    });
    assert.equal(result.valid, true);
    assert.equal(result.details.amount, 30);
    assert.equal(result.details.isAllIn, true);
  });

  it('should allow valid bet', () => {
    const result = validateAction({
      action: ACTION.BET, amount: 20, playerIdx: 0, playerStack: 100,
      round: new BettingRound(10), canCheck: true,
    });
    assert.equal(result.valid, true);
    assert.equal(result.details.amount, 20);
  });

  it('should reject bet below minimum', () => {
    const result = validateAction({
      action: ACTION.BET, amount: 5, playerIdx: 0, playerStack: 100,
      round: new BettingRound(10), canCheck: true,
    });
    assert.equal(result.valid, false);
  });

  it('should reject bet exceeding stack', () => {
    const result = validateAction({
      action: ACTION.BET, amount: 200, playerIdx: 0, playerStack: 100,
      round: new BettingRound(10), canCheck: true,
    });
    assert.equal(result.valid, false);
  });

  it('should allow bet when facing a bet (should raise instead)', () => {
    const round = new BettingRound(10);
    round.currentBet = 20;
    const result = validateAction({
      action: ACTION.BET, amount: 30, playerIdx: 0, playerStack: 100,
      round, canCheck: false,
    });
    assert.equal(result.valid, false);
  });

  it('should allow valid raise', () => {
    const round = new BettingRound(10);
    round.currentBet = 20;
    const result = validateAction({
      action: ACTION.RAISE, amount: 40, playerIdx: 0, playerStack: 100,
      round, canCheck: false,
    });
    assert.equal(result.valid, true);
    assert.equal(result.details.amount, 40);
  });

  it('should reject raise below minimum', () => {
    const round = new BettingRound(10);
    round.currentBet = 20;
    const result = validateAction({
      action: ACTION.RAISE, amount: 25, playerIdx: 0, playerStack: 100,
      round, canCheck: false,
    });
    assert.equal(result.valid, false);
  });

  it('should allow all-in raise even if below minimum', () => {
    const round = new BettingRound(10);
    round.currentBet = 20;
    const result = validateAction({
      action: ACTION.RAISE, amount: 22, playerIdx: 0, playerStack: 22,
      round, canCheck: false,
    });
    assert.equal(result.valid, true);
    assert.equal(result.details.isAllIn, true);
  });
});

describe('calculatePots', () => {
  const basePlayer = { folded: false, allIn: false, isActive: true };

  it('should calculate single pot with equal contributions', () => {
    const players = [
      { ...basePlayer, stack: 90, totalBet: 10 },
      { ...basePlayer, stack: 90, totalBet: 10 },
      { ...basePlayer, stack: 90, totalBet: 10 },
    ];
    const pots = calculatePots(players);
    assert.equal(pots.length, 1);
    assert.equal(pots[0].amount, 30);
    assert.equal(pots[0].eligiblePlayers.size, 3);
  });

  it('should calculate main and side pots for all-in', () => {
    const players = [
      { ...basePlayer, stack: 0, totalBet: 50, allIn: true },   // all-in for $50
      { ...basePlayer, stack: 50, totalBet: 100 },               // bet $100
      { ...basePlayer, stack: 0, totalBet: 100 },                // bet $100
    ];
    const pots = calculatePots(players);
    // Main pot: 50 * 3 = 150 (all eligible)
    // Side pot: (100-50) * 2 = 100 (only players 1 and 2)
    assert.equal(pots.length, 2);
    assert.equal(pots[0].amount, 150);
    assert.equal(pots[0].eligiblePlayers.size, 3);
    assert.equal(pots[1].amount, 100);
    assert.equal(pots[1].eligiblePlayers.size, 2);
    assert.ok(!pots[1].eligiblePlayers.has(0));
  });

  it('should handle multiple all-in levels', () => {
    const players = [
      { ...basePlayer, stack: 0, totalBet: 25, allIn: true },
      { ...basePlayer, stack: 0, totalBet: 50, allIn: true },
      { ...basePlayer, stack: 0, totalBet: 100, allIn: true },
    ];
    const pots = calculatePots(players);
    assert.equal(pots.length, 3);
    assert.equal(pots[0].amount, 75);  // 25 * 3
    assert.equal(pots[1].amount, 50);  // (50-25) * 2
    assert.equal(pots[2].amount, 50);  // (100-50) * 1
  });

  it('should exclude folded players from pots', () => {
    const players = [
      { ...basePlayer, stack: 90, totalBet: 10, folded: false },
      { ...basePlayer, stack: 90, totalBet: 10, folded: true },
    ];
    const pots = calculatePots(players);
    // Only player 0 is eligible
    assert.equal(pots[0].eligiblePlayers.size, 1);
    assert.ok(pots[0].eligiblePlayers.has(0));
  });

  it('should return empty for no active players', () => {
    const players = [
      { ...basePlayer, stack: 90, totalBet: 10, folded: true },
    ];
    const pots = calculatePots(players);
    assert.equal(pots.length, 0);
  });

  it('should handle zero bets', () => {
    const players = [
      { ...basePlayer, stack: 100, totalBet: 0 },
      { ...basePlayer, stack: 100, totalBet: 0 },
    ];
    const pots = calculatePots(players);
    assert.equal(pots.length, 0);
  });
});

describe('advanceDealer', () => {
  it('should advance dealer by one', () => {
    assert.equal(advanceDealer(0, 6), 1);
    assert.equal(advanceDealer(5, 6), 0);
  });

  it('should skip eliminated players', () => {
    const active = new Set([0, 2, 4]);
    // Dealer is 0, next active = 2
    assert.equal(advanceDealer(0, 6, active), 2);
    // Dealer is 2, next active = 4
    assert.equal(advanceDealer(2, 6, active), 4);
    // Dealer is 4, next active = 0 (wraps)
    assert.equal(advanceDealer(4, 6, active), 0);
  });
});

describe('blindPositions', () => {
  it('should place SB left of dealer, BB left of SB (multi-way)', () => {
    const active = new Set([0, 1, 2, 3, 4, 5]);
    const positions = blindPositions(0, 6, 6, active);
    assert.equal(positions.smallBlind, 1);
    assert.equal(positions.bigBlind, 2);
  });

  it('should handle heads-up (dealer = SB)', () => {
    const active = new Set([0, 3]);
    const positions = blindPositions(0, 2, 6, active);
    assert.equal(positions.smallBlind, 0);
    assert.equal(positions.bigBlind, 3);
  });

  it('should skip eliminated players', () => {
    const active = new Set([0, 3, 4]); // players 1, 2, 5 eliminated
    const positions = blindPositions(0, 3, 6, active);
    assert.equal(positions.smallBlind, 3);
    assert.equal(positions.bigBlind, 4);
  });

  it('should skip eliminated between SB and BB', () => {
    const active = new Set([0, 2, 5]);
    const positions = blindPositions(0, 3, 6, active);
    assert.equal(positions.smallBlind, 2);
    assert.equal(positions.bigBlind, 5);
  });
});

describe('createBlinds', () => {
  it('should create blinds with default BB', () => {
    const blinds = createBlinds(5);
    assert.equal(blinds.smallBlind, 5);
    assert.equal(blinds.bigBlind, 10);
  });

  it('should create blinds with explicit BB', () => {
    const blinds = createBlinds(5, 15);
    assert.equal(blinds.smallBlind, 5);
    assert.equal(blinds.bigBlind, 15);
  });
});
