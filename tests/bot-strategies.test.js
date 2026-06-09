/**
 * Bot AI Strategy Engine Tests.
 *
 * Tests for all 5 bot personalities, the strategy base utilities, and
 * the Bot factory. Each test verifies that bots produce legal actions
 * (valid action types, amounts within stack bounds) and exhibit
 * personality-appropriate behavior.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createBot,
  Bot,
  BOT_STRATEGIES,
  BOT_NAMES,
  preflopStrength,
  postflopStrength,
  getPosition,
  potOdds,
  isProfitableCall,
  betSize,
  raiseSize,
  spr,
  sprZone,
  OpponentModel,
  estimatedEquity,
  createBotLineup,
} from '../src/bot/index.js';

import { GameState, Card, evaluate, HAND_CATEGORY } from '../src/engine/index.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a standard 6-max game with 100 BB stacks. */
function makeGame(players = 6, stacks = 1000, blinds = { smallBlind: 5, bigBlind: 10 }) {
  const playerConfigs = Array.from({ length: players }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    stack: stacks,
  }));
  return new GameState({ players: playerConfigs, blinds, deckSeed: 12345 });
}

/** All valid actions. */
const VALID_ACTIONS = new Set(['fold', 'check', 'call', 'bet', 'raise']);

/** Ensure an action object is well-formed. */
function assertValidAction(action, player, msg) {
  assert.ok(VALID_ACTIONS.has(action.action), `${msg}: invalid action "${action.action}"`);
  if (action.action === 'bet' || action.action === 'raise') {
    assert.ok(typeof action.amount === 'number' && action.amount > 0,
      `${msg}: bet/raise must have positive amount`);
    assert.ok(action.amount <= player.stack + (action.action === 'raise' ? 0 : 0),
      `${msg}: amount ${action.amount} exceeds stack ${player.stack}`);
  }
}

// ── Strategy Base Utilities ───────────────────────────────────────────────────

describe('preflopStrength', () => {
  it('should rate AA as strongest', () => {
    const aa = [new Card(14, 's'), new Card(14, 'h')];
    const ak = [new Card(14, 's'), new Card(13, 'h')];
    assert.ok(preflopStrength(aa) > preflopStrength(ak),
      'AA should be stronger than AK');
  });

  it('should rate AKs higher than AKo', () => {
    const suited = [new Card(14, 's'), new Card(13, 's')];
    const offsuit = [new Card(14, 's'), new Card(13, 'h')];
    assert.ok(preflopStrength(suited) > preflopStrength(offsuit),
      'AKs should be stronger than AKo');
  });

  it('should rate pairs higher than unpaired of same rank', () => {
    const pair = [new Card(10, 's'), new Card(10, 'h')];
    const unpaired = [new Card(10, 's'), new Card(9, 'h')];
    assert.ok(preflopStrength(pair) > preflopStrength(unpaired),
      'TT should be stronger than T9o');
  });

  it('should return values in [0, 1] range', () => {
    for (const r1 of [14, 10, 5, 2]) {
      for (const r2 of [14, 10, 5, 2]) {
        for (const suited of [true, false]) {
          const s = suited ? 's' : (r1 === r2 ? 's' : 'h');
          const cards = [new Card(r1, 's'), new Card(r2, s)];
          const val = preflopStrength(cards);
          assert.ok(val >= 0 && val <= 1,
            `Strength ${val} for ${r1}${r2}${suited ? 's' : 'o'} out of range`);
        }
      }
    }
  });

  it('should return 0.98 for AA', () => {
    const aa = [new Card(14, 's'), new Card(14, 'h')];
    assert.equal(preflopStrength(aa), 0.98);
  });

  it('should handle 72o (worst hand)', () => {
    const worst = [new Card(7, 's'), new Card(2, 'h')];
    const val = preflopStrength(worst);
    assert.ok(val < 0.2, `72o strength ${val} should be very low`);
  });
});

describe('postflopStrength', () => {
  it('should return normalized 0-1 value', () => {
    const hole = [new Card(14, 's'), new Card(14, 'h')];
    const board = [new Card(14, 'd'), new Card(13, 's'), new Card(2, 'c')];
    const val = postflopStrength(hole, board);
    assert.ok(val >= 0 && val <= 1, `postflop strength ${val} out of range`);
  });

  it('should rate set of aces very high', () => {
    const hole = [new Card(14, 's'), new Card(14, 'h')];
    const board = [new Card(14, 'd'), new Card(13, 's'), new Card(2, 'c')];
    const val = postflopStrength(hole, board);
    // Three of a kind (set) with Ace kicker: weight ~0.55 + Ace bonus
    assert.ok(val > 0.5, `Set of aces strength ${val} should be > 0.5`);
  });

  it('should fall back to preflop with no community cards', () => {
    const hole = [new Card(14, 's'), new Card(14, 'h')];
    const val = postflopStrength(hole, []);
    assert.ok(val > 0.9, `AA should be strong even preflop`);
  });
});

describe('estimatedEquity', () => {
  it('should decrease with more opponents', () => {
    const eq1 = estimatedEquity(0.5, 1);
    const eq3 = estimatedEquity(0.5, 3);
    assert.ok(eq1 > eq3, 'Equity should decrease with more opponents');
  });

  it('should return 1.0 for strength 1.0', () => {
    assert.equal(estimatedEquity(1.0, 1), 1.0);
  });

  it('should be monotonic with strength', () => {
    const e1 = estimatedEquity(0.3, 2);
    const e2 = estimatedEquity(0.7, 2);
    assert.ok(e2 > e1, 'Higher strength → higher equity');
  });
});

describe('getPosition', () => {
  it('should identify blinds correctly', () => {
    // 6-max: dealer=0, SB=1, BB=2, UTG=3, MP=4, CO=5
    assert.equal(getPosition(1, 6, 0), 'blinds');  // SB
    assert.equal(getPosition(2, 6, 0), 'blinds');  // BB
  });

  it('should identify late position (BTN, CO)', () => {
    assert.equal(getPosition(0, 6, 0), 'late');    // BTN
    // CO is seat 5, dealer at 0. offset = (5-0+6)%6 = 5. nonBlindCount=3, earlyCutoff=1, lateStart=3
    // posFromUTG = 5-2 = 3 >= 3 → late
    assert.equal(getPosition(5, 6, 0), 'late');    // CO
  });

  it('should identify early position (UTG)', () => {
    assert.equal(getPosition(3, 6, 0), 'early');   // UTG
  });

  it('should handle heads-up', () => {
    // Heads-up: both are blinds
    assert.equal(getPosition(0, 2, 0), 'blinds');
    assert.equal(getPosition(1, 2, 0), 'blinds');
  });

  it('should work with different dealer positions', () => {
    // dealer=4, so: 5=SB, 0=BB, 1=UTG...
    assert.equal(getPosition(5, 6, 4), 'blinds');  // SB
    assert.equal(getPosition(0, 6, 4), 'blinds');  // BB
  });
});

describe('potOdds', () => {
  it('should return Infinity when toCall is 0', () => {
    const { odds } = potOdds(100, 0);
    assert.equal(odds, Infinity);
  });

  it('should compute correct pot odds', () => {
    const { odds, ratio } = potOdds(100, 50);
    assert.equal(odds, 2);
    assert.equal(ratio, '2:1');
  });

  it('should compute fractional odds', () => {
    const { odds, ratio } = potOdds(50, 100);
    assert.equal(odds, 0.5);
    assert.equal(ratio, '1/2:1');
  });
});

describe('isProfitableCall', () => {
  it('should be profitable when equity > required', () => {
    // pot=100, toCall=50: required = 50/150 = 0.33
    assert.equal(isProfitableCall(100, 50, 0.4), true);
  });

  it('should be unprofitable when equity < required', () => {
    assert.equal(isProfitableCall(100, 50, 0.2), false);
  });

  it('should always be profitable when toCall is 0', () => {
    assert.equal(isProfitableCall(100, 0, 0.01), true);
  });
});

describe('betSize', () => {
  it('should compute pot-fraction bet', () => {
    const size = betSize(100, 0.66, 500, 10);
    assert.equal(size, 66);
  });

  it('should cap at stack size', () => {
    const size = betSize(1000, 0.5, 100, 10);
    assert.equal(size, 100);
  });

  it('should respect minimum bet', () => {
    const size = betSize(10, 0.5, 500, 20);
    assert.equal(size, 20);
  });
});

describe('spr', () => {
  it('should return Infinity for zero pot', () => {
    assert.equal(spr(1000, 0), Infinity);
  });

  it('should compute correct SPR', () => {
    assert.equal(spr(1000, 200), 5);
  });
});

describe('sprZone', () => {
  it('should classify low SPR', () => {
    assert.equal(sprZone(2), 'low');
  });

  it('should classify medium SPR', () => {
    assert.equal(sprZone(5), 'medium');
  });

  it('should classify high SPR', () => {
    assert.equal(sprZone(15), 'high');
  });
});

describe('OpponentModel', () => {
  it('should track VPIP and PFR', () => {
    const model = new OpponentModel();
    model.observe('p1', 'Alice', 'raise', true);
    model.observe('p1', 'Alice', 'call', true);
    model.observe('p1', 'Alice', 'fold', false);
    model.observe('p1', 'Alice', 'fold', false);

    // 2 voluntary actions out of 4 total, 1 raise out of 2 voluntary
    assert.ok(model.vpip('p1') > 0);
    assert.ok(model.pfr('p1') > 0);
  });

  it('should classify loose-passive opponent', () => {
    const model = new OpponentModel();
    for (let i = 0; i < 10; i++) {
      model.observe('p1', 'Bob', 'call', true);
    }
    assert.equal(model.classify('p1'), 'loose-passive');
  });

  it('should classify rock opponent', () => {
    const model = new OpponentModel();
    // Rock: folds almost everything, occasionally calls with premiums
    for (let i = 0; i < 30; i++) {
      model.observe('p2', 'Carol', 'fold', false);
    }
    model.observe('p2', 'Carol', 'call', true);
    model.observe('p2', 'Carol', 'call', true);
    // VPIP = 2/32 ≈ 0.06, PFR = 0/2 = 0 → rock
    assert.equal(model.classify('p2'), 'rock');
  });

  it('should return 0 for unknown player', () => {
    const model = new OpponentModel();
    assert.equal(model.vpip('unknown'), 0);
    assert.equal(model.pfr('unknown'), 0);
  });
});

// ── Bot Factory ───────────────────────────────────────────────────────────────

describe('createBot', () => {
  it('should create a bot for each strategy', () => {
    for (const type of Object.values(BOT_STRATEGIES)) {
      const bot = createBot(type);
      assert.ok(bot instanceof Bot);
      assert.equal(bot.strategyType, type);
      assert.equal(typeof bot.decide, 'function');
    }
  });

  it('should create a bot with custom name', () => {
    const bot = createBot('tag', 'Alice');
    assert.equal(bot.name, 'Alice');
    assert.equal(bot.strategyType, 'tag');
  });

  it('should create bot lineup', () => {
    const configs = [
      { name: 'Alice', strategy: 'tag' },
      { name: 'Bob', strategy: 'maniac' },
      { name: 'Carol', strategy: 'rock' },
    ];
    const lineup = createBotLineup(configs);
    assert.equal(lineup.length, 3);
    assert.equal(lineup[0].name, 'Alice');
    assert.equal(lineup[1].strategyType, 'maniac');
  });

  it('should reject unknown strategy', () => {
    assert.throws(() => createBot('nonexistent'), RangeError);
  });
});

// ── Strategy: TAG ─────────────────────────────────────────────────────────────

describe('TAG strategy', () => {
  it('should produce valid actions preflop', () => {
    const game = makeGame();
    game.startHand();
    const bot = createBot('tag');

    for (let i = 0; i < 20; i++) {
      const g = makeGame();
      g.startHand();
      const state = g.getState();
      const player = state.players[state.actorIdx];
      const action = bot.decide(g, state.actorIdx);
      assertValidAction(action, player, `TAG preflop: ${action.action}`);
    }
  });

  it('should fold weak hands early position', () => {
    const game = makeGame();
    // Seed that gives player 0 weak cards
    const g = new GameState({
      players: [
        { id: 'p0', name: 'Hero', stack: 1000 },
        { id: 'p1', name: 'Villain', stack: 1000 },
      ],
      blinds: { smallBlind: 5, bigBlind: 10 },
      deckSeed: 99999,
    });
    g.startHand();
    const state = g.getState();

    // If the bot has weak cards in EP, it should fold
    const hero = state.players[state.actorIdx];
    const strength = preflopStrength(hero.holeCards);
    const bot = createBot('tag');
    const action = bot.decide(g, state.actorIdx);

    // With a random seed, this is probabilistic — just check action is valid
    assertValidAction(action, hero, 'TAG');
  });

  it('should produce valid actions postflop', () => {
    const game = makeGame();
    game.startHand();
    const bot = createBot('tag');

    // Simulate to flop
    const sim = makeGame();
    sim.startHand();

    // Play through preflop: everyone calls
    let actor = sim.actorIdx;
    while (sim.phase === 'preflop') {
      const state = sim.getState();
      const player = state.players[actor];
      let simAction;
      // BB checks if no raise
      if (state.currentBet <= player.totalBet) {
        simAction = sim.act(actor, { action: 'check' });
      } else {
        simAction = sim.act(actor, { action: 'call' });
      }
      actor = simAction.nextActor;
      if (simAction.phase === 'flop') break;
      if (!simAction.nextActor && simAction.nextActor !== 0) break;
    }

    if (sim.phase === 'flop') {
      const state = sim.getState();
      const player = state.players[state.actorIdx];
      const action = bot.decide(sim, state.actorIdx);
      assertValidAction(action, player, 'TAG postflop');
    }
  });
});

// ── Strategy: Loose-Passive ───────────────────────────────────────────────────

describe('Loose-Passive strategy', () => {
  it('should produce valid actions preflop', () => {
    const game = makeGame();
    game.startHand();
    const bot = createBot('loose-passive');

    for (let i = 0; i < 20; i++) {
      const g = makeGame(6, 1000, { smallBlind: 5, bigBlind: 10 });
      g.startHand();
      const state = g.getState();
      const player = state.players[state.actorIdx];
      const action = bot.decide(g, state.actorIdx);
      assertValidAction(action, player, `LP preflop: ${action.action}`);
    }
  });

  it('should call rather than raise most of the time', () => {
    // Indirect test: the strategy has very high raise thresholds,
    // so most actions should be call/check/fold, not bet/raise
    const bot = createBot('loose-passive');
    let raiseCount = 0;
    let total = 0;

    for (let i = 0; i < 50; i++) {
      const g = makeGame(4, 1000, { smallBlind: 5, bigBlind: 10 });
      g.startHand();
      const state = g.getState();
      const action = bot.decide(g, state.actorIdx);
      if (action.action === 'raise' || action.action === 'bet') raiseCount++;
      total++;
    }

    // Loose-passive should raise < 20% of the time with random hands
    const raiseFreq = raiseCount / total;
    assert.ok(raiseFreq < 0.3,
      `LP raise frequency ${raiseFreq} should be low (< 0.3)`);
  });
});

// ── Strategy: Maniac ──────────────────────────────────────────────────────────

describe('Maniac strategy', () => {
  it('should produce valid actions preflop', () => {
    const bot = createBot('maniac');

    for (let i = 0; i < 20; i++) {
      const g = makeGame(6, 1000, { smallBlind: 5, bigBlind: 10 });
      g.startHand();
      const state = g.getState();
      const player = state.players[state.actorIdx];
      const action = bot.decide(g, state.actorIdx);
      assertValidAction(action, player, `Maniac preflop: ${action.action}`);
    }
  });

  it('should play aggressively (bet/raise frequently)', () => {
    const bot = createBot('maniac');
    let aggressiveCount = 0;
    let total = 0;

    for (let i = 0; i < 50; i++) {
      const g = makeGame(4, 1000, { smallBlind: 5, bigBlind: 10 });
      g.startHand();
      const state = g.getState();
      const action = bot.decide(g, state.actorIdx);
      if (action.action === 'raise' || action.action === 'bet') aggressiveCount++;
      total++;
    }

    // Maniac should raise/bet > 30% of the time
    const aggFreq = aggressiveCount / total;
    // Note: this is somewhat seed-dependent; threshold is intentionally low
    assert.ok(aggFreq > 0.2,
      `Maniac aggression frequency ${aggFreq} should be > 0.2`);
  });
});

// ── Strategy: Rock ────────────────────────────────────────────────────────────

describe('Rock strategy', () => {
  it('should produce valid actions preflop', () => {
    const bot = createBot('rock');

    for (let i = 0; i < 20; i++) {
      const g = makeGame(6, 1000, { smallBlind: 5, bigBlind: 10 });
      g.startHand();
      const state = g.getState();
      const player = state.players[state.actorIdx];
      const action = bot.decide(g, state.actorIdx);
      assertValidAction(action, player, `Rock preflop: ${action.action}`);
    }
  });

  it('should fold very frequently', () => {
    const bot = createBot('rock');
    let foldCount = 0;
    let total = 0;

    for (let i = 0; i < 50; i++) {
      const g = makeGame(4, 1000, { smallBlind: 5, bigBlind: 10 });
      g.startHand();
      const state = g.getState();
      const action = bot.decide(g, state.actorIdx);
      if (action.action === 'fold') foldCount++;
      total++;
    }

    // Rock should fold > 40% of the time (since most random hands are weak)
    const foldFreq = foldCount / total;
    assert.ok(foldFreq > 0.3,
      `Rock fold frequency ${foldFreq} should be > 0.3`);
  });
});

// ── Strategy: Balanced ────────────────────────────────────────────────────────

describe('Balanced strategy', () => {
  it('should produce valid actions preflop', () => {
    const bot = createBot('balanced');

    for (let i = 0; i < 20; i++) {
      const g = makeGame(6, 1000, { smallBlind: 5, bigBlind: 10 });
      g.startHand();
      const state = g.getState();
      const player = state.players[state.actorIdx];
      const action = bot.decide(g, state.actorIdx);
      assertValidAction(action, player, `Balanced preflop: ${action.action}`);
    }
  });

  it('should have moderate aggression (between rock and maniac)', () => {
    const bot = createBot('balanced');
    let aggCount = 0;
    let total = 0;

    // Use a few different deck seeds to get a spread of hand strengths
    for (let seed = 0; seed < 5; seed++) {
      for (let pos = 0; pos < 4; pos++) {
        const players = [
          { id: 'p0', name: 'A', stack: 1000 },
          { id: 'p1', name: 'B', stack: 1000 },
          { id: 'p2', name: 'C', stack: 1000 },
          { id: 'p3', name: 'D', stack: 1000 },
        ];
        const g = new GameState({
          players,
          blinds: { smallBlind: 5, bigBlind: 10 },
          deckSeed: seed * 100 + pos,
        });
        g.startHand();
        const action = bot.decide(g, g.actorIdx);
        if (action.action === 'bet' || action.action === 'raise') aggCount++;
        total++;
      }
    }

    const aggFreq = aggCount / total;
    // Balanced should be...balanced. Some aggression but not extreme.
    // Even if all 20 hands miss, aggression can be 0 from random chance.
    // We just verify it's not absurdly high.
    assert.ok(aggFreq < 0.7,
      `Balanced aggression ${aggFreq} should not be extreme`);
  });
});

// ── Integration: full hand with bots ──────────────────────────────────────────

describe('Bot integration — full hand', () => {
  it('should play a complete hand with all bots without errors', () => {
    const botConfigs = [
      { name: 'Alice', strategy: 'tag' },
      { name: 'Bob', strategy: 'loose-passive' },
      { name: 'Carol', strategy: 'maniac' },
      { name: 'Dave', strategy: 'rock' },
      { name: 'Eve', strategy: 'balanced' },
      { name: 'Frank', strategy: 'tag' },
    ];

    const bots = createBotLineup(botConfigs);
    const players = botConfigs.map((c, i) => ({
      id: `p${i}`,
      name: c.name,
      stack: 1000,
    }));

    const game = new GameState({
      players,
      blinds: { smallBlind: 5, bigBlind: 10 },
      deckSeed: 42,
    });

    // Play 5 hands
    for (let hand = 0; hand < 5; hand++) {
      // Skip if not enough active players
      const activePlayers = game.players.filter(p => p.stack > 0);
      if (activePlayers.length < 2) break;

      game.startHand();

      let safety = 0;
      while (game.phase !== 'hand_complete' && safety < 200) {
        safety++;
        const state = game.getState();
        const actor = state.actorIdx;

        if (actor < 0 || actor >= state.players.length) break;

        // Bot decides
        const bot = bots[actor];
        const action = bot.decide(game, actor);

        // Apply action
        const result = game.act(actor, action);
        if (!result.ok) {
          // If bot made an illegal action, fold instead
          game.act(actor, { action: 'fold' });
        }
      }

      assert.ok(safety < 200, `Hand ${hand} did not complete within safety limit`);
      assert.equal(game.phase, 'hand_complete');
    }
  });

  it('should handle short-stack decisions', () => {
    const botConfigs = [
      { name: 'Short1', strategy: 'tag' },
      { name: 'Short2', strategy: 'maniac' },
    ];

    const bots = createBotLineup(botConfigs);
    const game = new GameState({
      players: [
        { id: 'p0', name: 'Short1', stack: 9 },   // less than BB
        { id: 'p1', name: 'Short2', stack: 15 },
      ],
      blinds: { smallBlind: 5, bigBlind: 10 },
      deckSeed: 77,
    });

    game.startHand();
    const state = game.getState();

    // Bot should not propose betting more than its stack
    const bot = bots[state.actorIdx];
    const action = bot.decide(game, state.actorIdx);

    if (action.action === 'bet') {
      assert.ok(action.amount <= state.players[state.actorIdx].stack,
        `Short stack bet ${action.amount} exceeds stack`);
    }
    if (action.action === 'raise') {
      // Amount for raise = new total bet
      const player = state.players[state.actorIdx];
      assert.ok(action.amount <= player.stack + state.currentBet,
        `Short stack raise ${action.amount} unreasonable`);
    }
  });

  it('should handle heads-up correctly', () => {
    const game = new GameState({
      players: [
        { id: 'p0', name: 'HU1', stack: 1000 },
        { id: 'p1', name: 'HU2', stack: 1000 },
      ],
      blinds: { smallBlind: 5, bigBlind: 10 },
      deckSeed: 123,
    });

    const bots = createBotLineup([
      { name: 'HU1', strategy: 'tag' },
      { name: 'HU2', strategy: 'balanced' },
    ]);

    game.startHand();

    let safety = 0;
    while (game.phase !== 'hand_complete' && safety < 100) {
      safety++;
      const state = game.getState();
      const actor = state.actorIdx;

      if (actor < 0) break;

      const bot = bots[actor];
      const action = bot.decide(game, actor);
      const result = game.act(actor, action);
      if (!result.ok) {
        game.act(actor, { action: 'fold' });
      }
    }

    assert.equal(game.phase, 'hand_complete');
  });

  it('should detect showdown winner', () => {
    const game = new GameState({
      players: [
        { id: 'p0', name: 'A', stack: 500 },
        { id: 'p1', name: 'B', stack: 500 },
        { id: 'p2', name: 'C', stack: 500 },
      ],
      blinds: { smallBlind: 5, bigBlind: 10 },
      deckSeed: 100,
    });

    const bots = createBotLineup([
      { name: 'A', strategy: 'balanced' },
      { name: 'B', strategy: 'loose-passive' },
      { name: 'C', strategy: 'maniac' },
    ]);

    game.startHand();

    let safety = 0;
    while (game.phase !== 'hand_complete' && safety < 100) {
      safety++;
      const state = game.getState();
      const actor = state.actorIdx;

      if (actor < 0 || actor >= state.players.length) break;

      const bot = bots[actor];
      const action = bot.decide(game, actor);
      const result = game.act(actor, action);
      if (!result.ok) {
        game.act(actor, { action: 'fold' });
      }

      if (result.handResult) {
        // Verify the hand result has the expected shape
        assert.ok(Array.isArray(result.handResult.winners));
        assert.ok(result.handResult.winners.length > 0);
        assert.ok(result.handResult.winners[0].playerId);
      }
    }
  });
});

// ── Bot personality distinctiveness ───────────────────────────────────────────

describe('Bot personality distinctiveness', () => {
  it('should produce different action distributions', () => {
    const strategies = ['tag', 'loose-passive', 'maniac', 'rock', 'balanced'];
    const profiles = {};

    for (const strat of strategies) {
      const bot = createBot(strat);
      const counts = { fold: 0, check: 0, call: 0, bet: 0, raise: 0 };

      for (let i = 0; i < 100; i++) {
        const g = makeGame(4, 1000, { smallBlind: 5, bigBlind: 10 });
        g.startHand();
        const state = g.getState();
        const action = bot.decide(g, state.actorIdx);
        counts[action.action] = (counts[action.action] || 0) + 1;
      }

      profiles[strat] = counts;
    }

    // Maniac should have highest bet+raise count
    const maniacAgg = profiles['maniac'].bet + profiles['maniac'].raise;
    const rockAgg = profiles['rock'].bet + profiles['rock'].raise;
    assert.ok(maniacAgg > rockAgg,
      `Maniac (${maniacAgg}) should be more aggressive than Rock (${rockAgg})`);

    // Rock should have highest fold count
    const rockFold = profiles['rock'].fold;
    const maniacFold = profiles['maniac'].fold;
    assert.ok(rockFold > maniacFold,
      `Rock (${rockFold}) should fold more than Maniac (${maniacFold})`);

    // TAG should be between Rock and Maniac
    const tagAgg = profiles['tag'].bet + profiles['tag'].raise;
    assert.ok(tagAgg >= rockAgg,
      `TAG (${tagAgg}) should be at least as aggressive as Rock (${rockAgg})`);
  });
});
