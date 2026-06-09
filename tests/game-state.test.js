/**
 * Tests for Game State Machine.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GameState, PHASE } from '../src/engine/game-state.js';
import { ACTION } from '../src/engine/betting.js';

function makePlayers(n = 4, stacks = [100, 100, 100, 100]) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    stack: stacks[i] || 100,
  }));
}

describe('GameState construction', () => {
  it('should create a game with players', () => {
    const game = new GameState({
      players: makePlayers(),
      blinds: { smallBlind: 1, bigBlind: 2 },
    });
    assert.equal(game.players.length, 4);
    assert.equal(game.phase, PHASE.IDLE);
    assert.equal(game.smallBlind, 1);
    assert.equal(game.bigBlind, 2);
    assert.equal(game.pot, 0);
  });

  it('should reject fewer than 2 players', () => {
    assert.throws(() => {
      new GameState({ players: makePlayers(1), blinds: { smallBlind: 1, bigBlind: 2 } });
    }, RangeError);
  });

  it('should support seedable RNG', () => {
    const g1 = new GameState({ players: makePlayers(), blinds: { smallBlind: 1, bigBlind: 2 }, deckSeed: 42 });
    const g2 = new GameState({ players: makePlayers(), blinds: { smallBlind: 1, bigBlind: 2 }, deckSeed: 42 });
    g1.startHand();
    g2.startHand();
    // Both games should deal identical cards
    const cards1 = g1.players.map(p => p.holeCards.map(c => c.toString()));
    const cards2 = g2.players.map(p => p.holeCards.map(c => c.toString()));
    assert.deepEqual(cards1, cards2);
  });
});

describe('GameState — hand lifecycle', () => {
  it('should start a hand and deal hole cards', () => {
    const game = new GameState({
      players: makePlayers(4),
      blinds: { smallBlind: 1, bigBlind: 2 },
      deckSeed: 123,
    });
    const result = game.startHand();
    assert.equal(result.phase, PHASE.PREFLOP);
    assert.ok(typeof result.actorIdx === 'number');

    // Every active player should have 2 hole cards
    for (const p of game.players) {
      assert.equal(p.holeCards.length, 2, `Player ${p.name} should have 2 hole cards`);
    }
    // Community cards should be empty
    assert.equal(game.communityCards.length, 0);
    // Hand number incremented
    assert.equal(game.handNumber, 1);
  });

  it('should post blinds correctly', () => {
    // startHand advances dealer, so set initial dealer to 3 so that after
    // advancing to seat 0, SB=1 and BB=2.
    const game = new GameState({
      players: makePlayers(4, [100, 100, 100, 100]),
      blinds: { smallBlind: 1, bigBlind: 2 },
      dealerIdx: 3,
      deckSeed: 123,
    });
    game.startHand();

    // SB is seat 1 (left of dealer), BB is seat 2
    const sb = game.players[1];
    const bb = game.players[2];
    assert.equal(sb.stack, 99);
    assert.equal(bb.stack, 98);
    assert.equal(game.pot, 3);
  });

  it('should handle SB all-in when stack < SB amount', () => {
    // startHand advances dealer: set initial dealer=3 so after advancing to
    // seat 0, SB=1 (with 0.5 stack), BB=2.
    const game = new GameState({
      players: makePlayers(4, [100, 0.5, 100, 100]),
      blinds: { smallBlind: 1, bigBlind: 2 },
      dealerIdx: 3,
      deckSeed: 123,
    });
    game.startHand();
    const sb = game.players[1];
    assert.equal(sb.stack, 0);
    assert.equal(sb.allIn, true);
    assert.equal(game.pot, 2.5); // 0.5 (SB all-in) + 2 (BB)
  });
});

describe('GameState — preflop actions', () => {
  /**
   * Set up a 4-player game, start hand, convenience helper.
   */
  function freshGame() {
    const game = new GameState({
      players: makePlayers(4, [100, 100, 100, 100]),
      blinds: { smallBlind: 1, bigBlind: 2 },
      dealerIdx: 0,
      deckSeed: 42,
    });
    game.startHand();
    return game;
  }

  it('should allow calling the big blind', () => {
    const game = freshGame();
    // The first actor (UTG, seat 3) can call
    const result = game.act(game.actorIdx, { action: ACTION.CALL });
    assert.equal(result.ok, true);
  });

  it('should allow folding', () => {
    const game = freshGame();
    const result = game.act(game.actorIdx, { action: ACTION.FOLD });
    assert.equal(result.ok, true);
    const player = game.players[game.actorIdx]; // won't be correct anymore but check folding
    const foldedPlayer = game.players.find(p => p.folded);
    assert.ok(foldedPlayer, 'At least one player should be folded');
  });

  it('should allow raising', () => {
    const game = freshGame();
    const result = game.act(game.actorIdx, { action: ACTION.RAISE, amount: 6 });
    assert.equal(result.ok, true);
    assert.equal(game.currentBet, 6);
  });

  it('should reject action from wrong player', () => {
    const game = freshGame();
    const wrongIdx = (game.actorIdx + 1) % 4;
    const result = game.act(wrongIdx, { action: ACTION.CALL });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('Not player'));
  });

  it('should advance actor after action', () => {
    const game = freshGame();
    const firstActor = game.actorIdx;
    const result = game.act(firstActor, { action: ACTION.CALL });
    assert.equal(result.ok, true);
    assert.notEqual(result.nextActor, firstActor);
  });
});

describe('GameState — full hand simulation', () => {
  it('should complete a hand where everyone folds to a raise', () => {
    // startHand advances dealer: set initial dealer=3 so after advancing
    // to seat 0, dealer=0, SB=1, BB=2, UTG=3.
    const game = new GameState({
      players: makePlayers(4, [100, 100, 100, 100]),
      blinds: { smallBlind: 1, bigBlind: 2 },
      dealerIdx: 3,
      deckSeed: 42,
    });
    game.startHand();

    // UTG (seat 3) folds
    let result = game.act(game.actorIdx, { action: ACTION.FOLD });
    assert.equal(result.ok, true);

    // Seat 0 (CO) folds too
    result = game.act(game.actorIdx, { action: ACTION.FOLD });
    assert.equal(result.ok, true);

    // SB (seat 1) raises TO 8 (SB already posted 1 blind)
    result = game.act(game.actorIdx, { action: ACTION.RAISE, amount: 8 });
    assert.equal(result.ok, true);

    // BB (seat 2) folds
    result = game.act(game.actorIdx, { action: ACTION.FOLD });
    assert.equal(result.ok, true);

    // Hand should be complete (SB won)
    assert.equal(result.phase, PHASE.HAND_COMPLETE);
    assert.ok(result.handResult);
    assert.equal(result.handResult.winners[0].playerId, 'p1'); // SB

    // SB: 100 - 1 (blind) - 7 (raise to 8) = 92. Pot = 8 (SB) + 2 (BB) = 10.
    // SB wins pot: 92 + 10 = 102.
    const sb = game.players[1];
    assert.equal(sb.stack, 102);
  });

  it('should complete a hand to showdown', () => {
    const game = new GameState({
      players: makePlayers(4, [100, 100, 100, 100]),
      blinds: { smallBlind: 1, bigBlind: 2 },
      dealerIdx: 0,
      deckSeed: 42,
    });
    game.startHand();

    // Helper: get current state
    function doAction(action, amount) {
      const r = game.act(game.actorIdx, { action, amount });
      return r;
    }

    // Everyone calls preflop (UTG, then remaining players)
    let result = doAction(ACTION.CALL);
    assert.equal(result.ok, true, 'UTG call failed');
    result = doAction(ACTION.CALL);
    assert.equal(result.ok, true, 'Seat3 call failed');
    // SB (already posted 1)
    result = doAction(ACTION.CALL);
    assert.equal(result.ok, true, 'SB call failed');
    // BB can check
    result = doAction(ACTION.CHECK);
    assert.equal(result.ok, true, 'BB check failed');

    // Should now be on FLOP
    assert.equal(result.phase, PHASE.FLOP);
    assert.equal(game.communityCards.length, 3);

    // Everyone checks flop
    for (let i = 0; i < 4; i++) {
      result = doAction(ACTION.CHECK);
      assert.equal(result.ok, true, `Flop check ${i} failed: ${result.error}`);
    }

    // Should be on TURN
    assert.equal(result.phase, PHASE.TURN);
    assert.equal(game.communityCards.length, 4);

    // Everyone checks turn
    for (let i = 0; i < 4; i++) {
      result = doAction(ACTION.CHECK);
      assert.equal(result.ok, true, `Turn check ${i} failed: ${result.error}`);
    }

    // Should be on RIVER
    assert.equal(result.phase, PHASE.RIVER);
    assert.equal(game.communityCards.length, 5);

    // Everyone checks river
    for (let i = 0; i < 4; i++) {
      result = doAction(ACTION.CHECK);
      assert.equal(result.ok, true, `River check ${i} failed: ${result.error}`);
    }

    // Should go to showdown
    assert.equal(result.phase, PHASE.HAND_COMPLETE);
    assert.ok(result.handResult);
    assert.ok(result.handResult.winners.length >= 1);
    assert.ok(result.handResult.allHands.length === 4);
  });
});

describe('GameState — serialization', () => {
  it('should serialize and deserialize', () => {
    const game = new GameState({
      players: makePlayers(4),
      blinds: { smallBlind: 1, bigBlind: 2 },
      deckSeed: 42,
    });
    game.startHand();

    const json = game.toJSON();
    const restored = GameState.fromJSON(json);

    assert.equal(restored.phase, game.phase);
    assert.equal(restored.handNumber, game.handNumber);
    assert.equal(restored.dealerIdx, game.dealerIdx);
    assert.equal(restored.pot, game.pot);
    assert.deepEqual(
      restored.communityCards.map(c => c.toString()),
      game.communityCards.map(c => c.toString()),
    );
    assert.equal(restored.players.length, game.players.length);
  });
});

describe('GameState — state snapshot', () => {
  it('should return a UI-friendly state snapshot', () => {
    const game = new GameState({
      players: makePlayers(4),
      blinds: { smallBlind: 1, bigBlind: 2 },
      deckSeed: 42,
    });
    game.startHand();
    const state = game.getState();
    assert.equal(state.phase, PHASE.PREFLOP);
    assert.equal(state.handNumber, 1);
    assert.equal(state.players.length, 4);
    assert.equal(state.communityCards.length, 0);
    assert.ok(typeof state.currentBet === 'number');
  });
});

describe('GameState — actOrThrow', () => {
  it('should throw on invalid action', () => {
    const game = new GameState({
      players: makePlayers(4),
      blinds: { smallBlind: 1, bigBlind: 2 },
      deckSeed: 42,
    });
    game.startHand();
    const wrongIdx = (game.actorIdx + 1) % 4;
    assert.throws(() => {
      game.actOrThrow(wrongIdx, { action: ACTION.CALL });
    }, Error);
  });

  it('should return result on valid action', () => {
    const game = new GameState({
      players: makePlayers(4),
      blinds: { smallBlind: 1, bigBlind: 2 },
      deckSeed: 42,
    });
    game.startHand();
    const result = game.actOrThrow(game.actorIdx, { action: ACTION.CALL });
    // After the action, game.actorIdx has been advanced to the next player.
    // The returned nextActor should match that same value.
    assert.equal(result.nextActor, game.actorIdx);
    assert.ok(typeof result.nextActor === 'number' && result.nextActor >= 0 && result.nextActor < 4);
  });
});
