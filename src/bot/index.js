/**
 * Bot AI Module — Pluggable Strategy Engine for Texas Hold'em.
 *
 * Provides a pluggable bot AI system that consumes the game engine API.
 * Each bot implements a common interface: game state → action.
 *
 * Usage:
 *   import { createBot, Bot, BOT_STRATEGIES } from './bot/index.js';
 *
 *   const bot = createBot('tag');
 *   const action = bot.decide(game, playerIdx);
 *   // → { action: 'raise', amount: 20 }
 *
 * Bot interface:
 *   decide(game: GameState, playerIdx: number) → { action: string, amount?: number }
 */

import { TAGStrategy } from './strategies/tag.js';
import { LoosePassiveStrategy } from './strategies/loose-passive.js';
import { ManiacStrategy } from './strategies/maniac.js';
import { RockStrategy } from './strategies/rock.js';
import { BalancedStrategy } from './strategies/balanced.js';

// ── Strategy registry ─────────────────────────────────────────────────────────

/** Available bot strategy identifiers. */
export const BOT_STRATEGIES = Object.freeze({
  TAG:             'tag',
  LOOSE_PASSIVE:   'loose-passive',
  MANIAC:          'maniac',
  ROCK:            'rock',
  BALANCED:        'balanced',
});

/** Strategy display names. */
export const BOT_NAMES = Object.freeze({
  [BOT_STRATEGIES.TAG]:             'Tight-Aggressive (TAG)',
  [BOT_STRATEGIES.LOOSE_PASSIVE]:   'Loose-Passive (Calling Station)',
  [BOT_STRATEGIES.MANIAC]:          'Maniac',
  [BOT_STRATEGIES.ROCK]:            'Tight-Passive (Rock)',
  [BOT_STRATEGIES.BALANCED]:        'Balanced',
});

// ── Strategy constructors ─────────────────────────────────────────────────────

const STRATEGY_CTORS = Object.freeze({
  [BOT_STRATEGIES.TAG]:             TAGStrategy,
  [BOT_STRATEGIES.LOOSE_PASSIVE]:   LoosePassiveStrategy,
  [BOT_STRATEGIES.MANIAC]:          ManiacStrategy,
  [BOT_STRATEGIES.ROCK]:            RockStrategy,
  [BOT_STRATEGIES.BALANCED]:        BalancedStrategy,
});

// ── Bot ───────────────────────────────────────────────────────────────────────

/**
 * A bot player that wraps a strategy with a friendly name.
 *
 * The bot delegates decisions to its strategy. This class exists so that
 * bots can be treated as uniform objects with a name, strategy type, and
 * a decide() method.
 */
export class Bot {
  /** @type {string} */
  name;

  /** @type {string} */
  strategyType;

  /** @private */
  #strategy;

  /**
   * @param {string} name         display name for this bot (e.g. "Alice")
   * @param {string} strategyType one of BOT_STRATEGIES values
   */
  constructor(name, strategyType) {
    const Ctor = STRATEGY_CTORS[strategyType];
    if (!Ctor) {
      throw new RangeError(
        `Unknown strategy "${strategyType}". Valid: ${Object.values(BOT_STRATEGIES).join(', ')}`,
      );
    }
    this.name = name;
    this.strategyType = strategyType;
    this.#strategy = new Ctor();
  }

  /**
   * Decide what action to take given the current game state.
   *
   * @param {import('../engine/game-state.js').GameState} game
   * @param {number} playerIdx  this bot's seat index
   * @returns {{ action: string, amount?: number }}
   */
  decide(game, playerIdx) {
    return this.#strategy.decide(game, playerIdx);
  }

  /**
   * The underlying strategy instance (for introspection / testing).
   */
  get strategy() {
    return this.#strategy;
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a bot with the given strategy and a default name.
 *
 * @param {string} strategyType  one of BOT_STRATEGIES values
 * @param {string} [name]        display name (defaults to strategy name)
 * @returns {Bot}
 */
export function createBot(strategyType, name) {
  const displayName = name || BOT_NAMES[strategyType] || strategyType;
  return new Bot(displayName, strategyType);
}

/**
 * Create a lineup of bots for a table.
 *
 * @param {Array<{ name: string, strategy: string }>} configs
 * @returns {Bot[]}
 */
export function createBotLineup(configs) {
  return configs.map(c => new Bot(c.name, c.strategy));
}

// ── Re-exports ────────────────────────────────────────────────────────────────

// Re-export strategy base utilities for consumers who want to build
// custom strategies.
export {
  preflopStrength,
  postflopStrength,
  estimatedEquity,
  isProfitableCall,
  potOdds,
  getPosition,
  betSize,
  raiseSize,
  spr,
  sprZone,
  OpponentModel,
} from './strategy-base.js';
