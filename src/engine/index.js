/**
 * Texas Hold'em Poker Engine — Public API.
 *
 * Standalone JS module with no UI dependencies. Exports everything needed
 * to build a poker UI, bot AI, or server-side game runner.
 *
 * Usage:
 *   import { GameState, Deck, Card, evaluate, showdown, ... } from './engine/index.js';
 */

// Card & Deck
export {
  Card,
  Deck,
  mulberry32,
  SUIT,
  SUIT_SYMBOLS,
  SUIT_NAMES,
  RANK_SHORT,
  RANK_NAMES,
  ALL_SUITS,
  ALL_RANKS,
} from './card.js';

// Hand Evaluation
export {
  evaluate,
  evaluate5,
  showdown,
  describe,
  HandRank,
  HAND_CATEGORY,
  HAND_NAMES,
} from './hand-evaluator.js';

// Betting & Pots
export {
  ACTION,
  ROUND,
  ROUND_ORDER,
  BettingRound,
  validateAction,
  calculatePots,
  advanceDealer,
  blindPositions,
  createBlinds,
} from './betting.js';

// Game State Machine
export {
  GameState,
  PHASE,
} from './game-state.js';
