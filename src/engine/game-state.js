/**
 * Game State Machine for Texas Hold'em.
 *
 * Coordinates deck, cards, betting rounds, and showdown detection.
 * Pure-logic module — no UI, no DOM, no I/O.
 *
 * Usage:
 *   const game = new GameState({ players: [...], blinds: { smallBlind: 1, bigBlind: 2 } });
 *   game.startHand();
 *   game.act(0, { action: 'call' });
 *   // ... continue until handComplete
 */

import { Deck, Card } from './card.js';
import {
  ACTION,
  ROUND,
  ROUND_ORDER,
  BettingRound,
  validateAction,
  calculatePots,
  advanceDealer,
  blindPositions,
} from './betting.js';
import { evaluate, showdown, describe, HAND_NAMES } from './hand-evaluator.js';

// ── Game phases ───────────────────────────────────────────────────────────────

export const PHASE = Object.freeze({
  IDLE:           'idle',
  PREFLOP:        'preflop',
  FLOP:           'flop',
  TURN:           'turn',
  RIVER:          'river',
  SHOWDOWN:       'showdown',
  HAND_COMPLETE:  'hand_complete',
});

// ── Player seat model ────────────────────────────────────────────────────────

/**
 * @typedef {Object} PlayerState
 * @property {string} id        unique player identifier
 * @property {string} name      display name
 * @property {number} stack     chips the player has
 * @property {Card[]} holeCards private hole cards (empty until dealt)
 * @property {number} totalBet  total chips bet this hand
 * @property {boolean} folded   true if player folded
 * @property {boolean} allIn    true if player is all-in
 * @property {boolean} isActive true if player can still act (not folded, not all-in)
 * @property {boolean} sittingOut true if player is sitting out (not in hand)
 */

// ── GameState ─────────────────────────────────────────────────────────────────

export class GameState {
  /** @type {PlayerState[]} */
  #players;

  /** @type {Deck} */
  #deck;

  /** @type {Card[]} */
  #communityCards;

  /** @type {string}  current phase */
  #phase;

  /** @type {number}  dealer button index */
  #dealerIdx;

  /** @type {number}  index of player whose turn it is */
  #actorIdx;

  /** @type {number}  small blind amount */
  #smallBlind;

  /** @type {number}  big blind amount */
  #bigBlind;

  /** @type {number}  current pot total (main pot, for display) */
  #pot;

  /**
   * The current betting round tracker.
   * @type {BettingRound}
   */
  #bettingRound;

  /**
   * Number of players who have acted in the current betting round since the
   * last raise. Used to determine when the round is complete.
   * @type {number}
   */
  #actedSinceLastRaise;

  /**
   * The last aggressive action index (for determining if a round is complete
   * when everyone has either folded or matched the current bet).
   * @type {number}
   */
  #lastAggressor;

  /**
   * Total bets for each player across all rounds this hand.
   * @type {Map<number, number>}
   */
  #handBets;

  /** @type {number}  hand counter */
  #handNumber;

  /** @type {Array}  hand history log */
  #history;

  /**
   * Seed for the deck (optional, for reproducible tests).
   * @type {number|undefined}
   */
  #deckSeed;

  /**
   * @param {Object} config
   * @param {Array<{id: string, name: string, stack: number}>} config.players  initial player configs
   * @param {{ smallBlind: number, bigBlind: number }} config.blinds
   * @param {number} [config.dealerIdx]   starting dealer index (default 0)
   * @param {number} [config.deckSeed]    seed for reproducible deck shuffles
   */
  constructor({ players, blinds, dealerIdx = 0, deckSeed }) {
    if (!players || players.length < 2) {
      throw new RangeError('Need at least 2 players');
    }

    this.#players = players.map((p, i) => ({
      id: p.id,
      name: p.name,
      stack: p.stack,
      holeCards: [],
      totalBet: 0,
      folded: false,
      allIn: false,
      isActive: true,
      sittingOut: false,
      seatIndex: i,
    }));

    this.#communityCards = [];
    this.#phase = PHASE.IDLE;
    this.#dealerIdx = dealerIdx;
    this.#actorIdx = -1;
    this.#smallBlind = blinds.smallBlind;
    this.#bigBlind = blinds.bigBlind;
    this.#pot = 0;
    this.#bettingRound = new BettingRound(this.#bigBlind);
    this.#actedSinceLastRaise = 0;
    this.#lastAggressor = -1;
    this.#handBets = new Map();
    this.#handNumber = 0;
    this.#history = [];
    this.#deckSeed = deckSeed;
    this.#deck = new Deck(deckSeed);
  }

  // ── Read-only accessors ─────────────────────────────────────────────────

  get players() {
    return this.#players.map(p => ({ ...p, holeCards: [...p.holeCards] }));
  }

  get communityCards() {
    return [...this.#communityCards];
  }

  get phase() {
    return this.#phase;
  }

  get dealerIdx() {
    return this.#dealerIdx;
  }

  get actorIdx() {
    return this.#actorIdx;
  }

  get pot() {
    return this.#pot;
  }

  get handNumber() {
    return this.#handNumber;
  }

  get smallBlind() {
    return this.#smallBlind;
  }

  get bigBlind() {
    return this.#bigBlind;
  }

  get currentBet() {
    return this.#bettingRound.currentBet;
  }

  get history() {
    return [...this.#history];
  }

  /**
   * Get the number of active (non-folded, non-eliminated) players.
   */
  get activePlayerCount() {
    return this.#players.filter(p => !p.folded && p.stack > 0).length;
  }

  /**
   * Snapshot of current game state (useful for UI rendering).
   */
  getState() {
    return {
      phase: this.#phase,
      handNumber: this.#handNumber,
      dealerIdx: this.#dealerIdx,
      actorIdx: this.#actorIdx,
      pot: this.#pot,
      currentBet: this.#bettingRound.currentBet,
      communityCards: this.communityCards,
      players: this.players,
      smallBlind: this.#smallBlind,
      bigBlind: this.#bigBlind,
    };
  }

  // ── Hand lifecycle ──────────────────────────────────────────────────────

  /**
   * Start a new hand.
   *
   * - Advances dealer button
   * - Posts blinds
   * - Deals hole cards
   * - Sets phase to PREFLOP
   * - Sets first actor
   *
   * @returns {{ phase: string, actorIdx: number }}
   */
  startHand() {
    const activePlayers = this.#players.filter(p => p.stack > 0);
    if (activePlayers.length < 2) {
      throw new Error('Need at least 2 players with chips to start a hand');
    }

    this.#handNumber++;

    // Reset hand state
    this.#communityCards = [];
    this.#phase = PHASE.IDLE;
    this.#pot = 0;
    this.#handBets = new Map();
    this.#lastAggressor = -1;
    this.#actedSinceLastRaise = 0;

    for (const p of this.#players) {
      p.holeCards = [];
      p.totalBet = 0;
      p.folded = false;
      p.allIn = false;
      p.isActive = p.stack > 0;
    }

    this.#bettingRound = new BettingRound(this.#bigBlind);

    // Advance dealer
    const activeIndices = new Set(
      this.#players
        .map((p, i) => (p.stack > 0 ? i : -1))
        .filter(i => i >= 0),
    );
    this.#dealerIdx = advanceDealer(this.#dealerIdx, this.#players.length, activeIndices);

    // Determine blind positions
    const activeCount = activePlayers.length;
    const blinds = blindPositions(this.#dealerIdx, activeCount, this.#players.length, activeIndices);

    // Create a fresh deck and shuffle
    this.#deck = new Deck(this.#deckSeed);
    this.#deck.shuffle();

    // Deal hole cards (2 to each active player, starting left of dealer)
    const dealOrder = this.#dealOrder(); // SB first, then around
    for (const idx of dealOrder) {
      const p = this.#players[idx];
      if (p.stack > 0) {
        p.holeCards = this.#deck.deal(2);
      }
    }

    // Post blinds
    this.#postBlind(blinds.smallBlind, this.#smallBlind, 'small blind');
    this.#postBlind(blinds.bigBlind, this.#bigBlind, 'big blind');

    this.#phase = PHASE.PREFLOP;

    // First actor is UTG (first after big blind in deal order)
    this.#actorIdx = this.#firstActorPreflop(dealOrder, blinds.bigBlind);

    this.#log('hand_start', { handNumber: this.#handNumber, dealerIdx: this.#dealerIdx });

    return { phase: this.#phase, actorIdx: this.#actorIdx };
  }

  /**
   * Player performs an action.
   *
   * @param {number} playerIdx  the player acting
   * @param {{ action: string, amount?: number }} action
   * @returns {{ ok: boolean, phase?: string, nextActor?: number, error?: string, handResult?: object }}
   */
  act(playerIdx, { action, amount }) {
    if (playerIdx !== this.#actorIdx) {
      return { ok: false, error: `Not player ${playerIdx}'s turn — it is player ${this.#actorIdx}'s turn` };
    }

    const player = this.#players[playerIdx];
    if (!player.isActive || player.folded || player.allIn) {
      return { ok: false, error: `Player ${playerIdx} cannot act (folded, all-in, or inactive)` };
    }

    const canCheck = this.#bettingRound.toCall(playerIdx) === 0;

    const validation = validateAction({
      action,
      amount,
      playerIdx,
      playerStack: player.stack,
      round: this.#bettingRound,
      canCheck,
    });

    if (!validation.valid) {
      return { ok: false, error: validation.reason };
    }

    // Execute the action
    switch (action) {
      case ACTION.FOLD:
        player.folded = true;
        player.isActive = false;
        this.#log('fold', { playerIdx });
        break;

      case ACTION.CHECK:
        this.#log('check', { playerIdx });
        break;

      case ACTION.CALL: {
        const callAmt = validation.details.amount;
        player.stack -= callAmt;
        player.totalBet += callAmt;
        this.#pot += callAmt;
        this.#addHandBet(playerIdx, callAmt);
        this.#bettingRound.applyCall(playerIdx);
        if (validation.details.isAllIn) {
          player.allIn = true;
          player.isActive = false;
        }
        this.#log('call', { playerIdx, amount: callAmt, allIn: player.allIn });
        break;
      }

      case ACTION.BET: {
        const betAmt = validation.details.amount;
        player.stack -= betAmt;
        player.totalBet += betAmt;
        this.#pot += betAmt;
        this.#addHandBet(playerIdx, betAmt);
        this.#bettingRound.applyRaise(playerIdx, betAmt);
        this.#lastAggressor = playerIdx;
        this.#actedSinceLastRaise = 0;
        if (validation.details.isAllIn) {
          player.allIn = true;
          player.isActive = false;
        }
        this.#log('bet', { playerIdx, amount: betAmt, allIn: player.allIn });
        break;
      }

      case ACTION.RAISE: {
        const newTotalBet = validation.details.amount;     // raise TO this amount
        const chipsToAdd = validation.details.chipsToAdd;   // actual chips player puts in
        player.stack -= chipsToAdd;
        player.totalBet += chipsToAdd;
        this.#pot += chipsToAdd;
        this.#addHandBet(playerIdx, chipsToAdd);
        this.#bettingRound.applyRaise(playerIdx, newTotalBet);
        this.#lastAggressor = playerIdx;
        this.#actedSinceLastRaise = 0;
        if (validation.details.isAllIn) {
          player.allIn = true;
          player.isActive = false;
        }
        this.#log('raise', { playerIdx, newTotalBet, chipsToAdd, allIn: player.allIn });
        break;
      }
    }

    this.#actedSinceLastRaise++;

    // Check if hand is over (all but one folded)
    const activeNonFolded = this.#players.filter(p => !p.folded && p.stack >= 0);
    if (activeNonFolded.length === 1) {
      return this.#endHand(activeNonFolded[0]);
    }

    // Check if betting round is complete
    if (this.#isRoundComplete()) {
      return this.#advanceStreet();
    }

    // Advance to next actor
    this.#advanceActor();
    return { ok: true, phase: this.#phase, nextActor: this.#actorIdx };
  }

  /**
   * Apply an action and advance the game (convenience method).
   * Same as `act()` but throws on error.
   *
   * @param {number} playerIdx
   * @param {{ action: string, amount?: number }} action
   * @returns {{ phase?: string, nextActor?: number, handResult?: object }}
   */
  actOrThrow(playerIdx, action) {
    const result = this.act(playerIdx, action);
    if (!result.ok) {
      throw new Error(result.error);
    }
    return result;
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Deal order: starting left of dealer (SB spot), going clockwise.
   */
  #dealOrder() {
    const order = [];
    for (let i = 1; i <= this.#players.length; i++) {
      order.push((this.#dealerIdx + i) % this.#players.length);
    }
    return order;
  }

  /**
   * Post a blind from the given player index.
   */
  #postBlind(playerIdx, amount, label) {
    const player = this.#players[playerIdx];
    if (player.stack === 0) return;

    const postAmount = Math.min(amount, player.stack);
    player.stack -= postAmount;
    player.totalBet += postAmount;
    this.#pot += postAmount;
    this.#addHandBet(playerIdx, postAmount);
    this.#bettingRound.recordBet(playerIdx, postAmount);

    if (postAmount < amount) {
      // Player is all-in for less than the full blind
      player.allIn = true;
      player.isActive = false;
    }

    // If the posted amount is more than current bet, it becomes the bet
    if (postAmount > this.#bettingRound.currentBet) {
      this.#bettingRound.currentBet = Math.min(postAmount, amount);
    }

    this.#log('blind', { playerIdx, amount: postAmount, label });
  }

  /**
   * Determine first actor for preflop (UTG — first after big blind).
   * In heads-up: dealer/SB acts first preflop.
   */
  #firstActorPreflop(dealOrder, bbIdx) {
    const activePlayers = this.#players.filter(p => p.stack > 0 || (p.allIn && p.stack === 0));
    if (activePlayers.length === 2) {
      // Heads-up: dealer (SB) acts first preflop
      return this.#dealerIdx;
    }
    // Otherwise: UTG is the next active player after the big blind
    for (let i = 1; i <= this.#players.length; i++) {
      const idx = (bbIdx + i) % this.#players.length;
      if (this.#players[idx].isActive && !this.#players[idx].folded && !this.#players[idx].allIn) {
        return idx;
      }
    }
    return bbIdx; // fallback
  }

  /**
   * Advance to the next active player.
   */
  #advanceActor() {
    for (let i = 1; i <= this.#players.length; i++) {
      const idx = (this.#actorIdx + i) % this.#players.length;
      const p = this.#players[idx];
      if (p.isActive && !p.folded && !p.allIn) {
        this.#actorIdx = idx;
        return;
      }
    }
    this.#actorIdx = -1; // no one can act
  }

  /**
   * Check if the current betting round is complete.
   *
   * A round is complete when every active player has acted AND either:
   * - No bets have been made (everyone checked), OR
   * - Everyone still in has matched the current bet
   */
  #isRoundComplete() {
    const activeNonFolded = this.#players.filter(
      p => !p.folded && p.isActive && !p.allIn,
    );

    // If no one can act, round is trivially complete
    if (activeNonFolded.length === 0) {
      return true;
    }

    // Check that every active-non-folded-non-allin player's round bet
    // matches the current bet, AND everyone has acted at least once
    // since the last raise
    const allMatched = activeNonFolded.every(
      p => this.#bettingRound.playerRoundBet(this.#players.indexOf(p)) >= this.#bettingRound.currentBet,
    );

    // Also check: everyone who can act has acted since the last raise.
    // We track this with #actedSinceLastRaise — when it reaches the
    // number of active non-folded non-allin players, the round is done.
    if (allMatched && this.#actedSinceLastRaise >= activeNonFolded.length) {
      return true;
    }

    // Special case: in preflop, the big blind gets an option to raise
    // even after everyone has called. We handle this by checking if
    // the last raiser was the BB and everyone has acted since then.
    // (The actedSinceLastRaise counter covers this.)

    return false;
  }

  /**
   * Advance to the next street (or showdown).
   */
  #advanceStreet() {
    switch (this.#phase) {
      case PHASE.PREFLOP:
        return this.#dealFlop();
      case PHASE.FLOP:
        return this.#dealTurn();
      case PHASE.TURN:
        return this.#dealRiver();
      case PHASE.RIVER:
        return this.#goToShowdown();
      default:
        return { ok: false, error: `Cannot advance from phase ${this.#phase}` };
    }
  }

  #dealFlop() {
    this.#deck.burn();
    const flop = this.#deck.deal(3);
    this.#communityCards.push(...flop);
    this.#phase = PHASE.FLOP;
    this.#startNewBettingRound();
    this.#log('deal_flop', { cards: flop.map(c => c.toString()) });
    return { ok: true, phase: this.#phase, nextActor: this.#actorIdx, communityCards: this.communityCards };
  }

  #dealTurn() {
    this.#deck.burn();
    const turn = this.#deck.dealOne();
    this.#communityCards.push(turn);
    this.#phase = PHASE.TURN;
    this.#startNewBettingRound();
    this.#log('deal_turn', { card: turn.toString() });
    return { ok: true, phase: this.#phase, nextActor: this.#actorIdx, communityCards: this.communityCards };
  }

  #dealRiver() {
    this.#deck.burn();
    const river = this.#deck.dealOne();
    this.#communityCards.push(river);
    this.#phase = PHASE.RIVER;
    this.#startNewBettingRound();
    this.#log('deal_river', { card: river.toString() });
    return { ok: true, phase: this.#phase, nextActor: this.#actorIdx, communityCards: this.communityCards };
  }

  /**
   * Start a new betting round with reset bets and the first active player
   * left of the dealer.
   */
  #startNewBettingRound() {
    this.#bettingRound.reset();
    this.#actedSinceLastRaise = 0;
    this.#lastAggressor = -1;

    // First to act: first active player left of dealer
    // (In heads-up: non-dealer acts first on all post-flop streets)
    const activePlayers = this.#players.filter(p => !p.folded && p.stack > 0);
    if (activePlayers.length <= 2) {
      // Heads-up or less: non-dealer acts first post-flop
      for (let i = 1; i <= this.#players.length; i++) {
        const idx = (this.#dealerIdx + i) % this.#players.length;
        if (this.#players[idx].isActive && !this.#players[idx].folded && !this.#players[idx].allIn) {
          this.#actorIdx = idx;
          return;
        }
      }
    }

    // Standard: first active left of dealer
    for (let i = 1; i <= this.#players.length; i++) {
      const idx = (this.#dealerIdx + i) % this.#players.length;
      if (this.#players[idx].isActive && !this.#players[idx].folded && !this.#players[idx].allIn) {
        this.#actorIdx = idx;
        return;
      }
    }
    this.#actorIdx = -1; // no one can act
  }

  #goToShowdown() {
    this.#phase = PHASE.SHOWDOWN;

    // Collect players who haven't folded
    const contenders = this.#players
      .map((p, i) => ({ player: p, idx: i }))
      .filter(({ player }) => !player.folded);

    // Build 7-card hands for each contender
    const entries = contenders.map(({ player, idx }) => ({
      player: { id: player.id, name: player.name, idx },
      cards: [...player.holeCards, ...this.#communityCards],
    }));

    const winners = showdown(entries);

    // Calculate side pots
    const potPlayers = this.#players.map((p, i) => ({
      stack: p.stack,
      totalBet: p.totalBet,
      folded: p.folded,
      allIn: p.allIn,
      isActive: p.isActive,
      seatIndex: i,
    }));

    const pots = calculatePots(potPlayers);

    // Award pots to winners
    const payouts = this.#awardPots(pots, winners, entries);

    this.#phase = PHASE.HAND_COMPLETE;

    const result = {
      winners: winners.map(w => ({
        playerId: w.player.id,
        playerName: w.player.name,
        hand: w.hand.category,
        handName: HAND_NAMES[w.hand.category],
        description: w.description,
        cards: w.player.id, // caller can look up hole cards
      })),
      pots,
      payouts,
      communityCards: this.communityCards.map(c => c.toString()),
      allHands: entries.map(e => ({
        playerId: e.player.id,
        playerName: e.player.name,
        handCategory: evaluate(e.cards).category,
        handDescription: describe(evaluate(e.cards)),
        holeCards: this.#players[e.player.idx].holeCards.map(c => c.toString()),
      })),
    };

    this.#log('showdown', result);

    return { ok: true, phase: this.#phase, handResult: result };
  }

  /**
   * Award pots to winners.
   */
  #awardPots(pots, winners, entries) {
    const payouts = [];

    for (const pot of pots) {
      // Find winners eligible for this pot
      const eligibleWinners = winners.filter(w =>
        pot.eligiblePlayers.has(w.player.idx),
      );

      if (eligibleWinners.length === 0) {
        // Shouldn't happen, but give to overall winner
        const amount = pot.amount;
        winners[0].player.stack = (winners[0].player.stack || 0) + amount;
        payouts.push({ playerId: winners[0].player.id, amount, pot: 'uncontested' });
      } else if (eligibleWinners.length === 1) {
        const amount = pot.amount;
        const player = this.#players[eligibleWinners[0].player.idx];
        player.stack += amount;
        payouts.push({ playerId: eligibleWinners[0].player.id, amount, pot: 'main' });
      } else {
        // Split pot among tied winners
        const split = Math.floor(pot.amount / eligibleWinners.length);
        const remainder = pot.amount - split * eligibleWinners.length;
        for (let i = 0; i < eligibleWinners.length; i++) {
          const w = eligibleWinners[i];
          const share = split + (i < remainder ? 1 : 0);
          this.#players[w.player.idx].stack += share;
          payouts.push({ playerId: w.player.id, amount: share, pot: 'split' });
        }
      }
    }

    return payouts;
  }

  /**
   * End the hand early when all but one player folds.
   */
  #endHand(lastStanding) {
    this.#phase = PHASE.HAND_COMPLETE;

    // Award the pot to the last standing player
    const player = this.#players[this.#players.indexOf(lastStanding)];
    player.stack += this.#pot;

    const result = {
      winners: [{
        playerId: player.id,
        playerName: player.name,
        hand: null,
        handName: 'Fold — won by default',
        description: 'All opponents folded',
      }],
      pots: [{ amount: this.#pot, eligiblePlayers: new Set([this.#players.indexOf(lastStanding)]) }],
      payouts: [{ playerId: player.id, amount: this.#pot, pot: 'uncontested' }],
      communityCards: this.communityCards.map(c => c.toString()),
      allHands: [],
    };

    this.#log('hand_end_fold', result);
    this.#pot = 0;

    return { ok: true, phase: this.#phase, handResult: result };
  }

  #addHandBet(playerIdx, amount) {
    const current = this.#handBets.get(playerIdx) || 0;
    this.#handBets.set(playerIdx, current + amount);
  }

  #log(event, data) {
    this.#history.push({ event, data, timestamp: Date.now() });
  }

  // ── Serialization ───────────────────────────────────────────────────────

  /**
   * Serialize the game state to a plain object (for saving/resuming).
   */
  toJSON() {
    return {
      phase: this.#phase,
      handNumber: this.#handNumber,
      dealerIdx: this.#dealerIdx,
      actorIdx: this.#actorIdx,
      pot: this.#pot,
      smallBlind: this.#smallBlind,
      bigBlind: this.#bigBlind,
      communityCards: this.#communityCards.map(c => c.id),
      players: this.#players.map(p => ({
        ...p,
        holeCards: p.holeCards.map(c => c.id),
      })),
      currentBet: this.#bettingRound.currentBet,
      handBets: Object.fromEntries(this.#handBets),
      deckSeed: this.#deckSeed,
      history: this.#history,
    };
  }

  /**
   * Deserialize a plain object back into a GameState.
   *
   * @param {object} data
   * @returns {GameState}
   */
  static fromJSON(data) {
    const game = new GameState({
      players: data.players.map(p => ({
        id: p.id,
        name: p.name,
        stack: p.stack,
      })),
      blinds: { smallBlind: data.smallBlind, bigBlind: data.bigBlind },
      dealerIdx: data.dealerIdx,
      deckSeed: data.deckSeed,
    });

    game.#phase = data.phase;
    game.#handNumber = data.handNumber;
    game.#actorIdx = data.actorIdx;
    game.#pot = data.pot;
    game.#communityCards = data.communityCards.map(Card.fromId);
    game.#players = data.players.map((p, i) => ({
      ...p,
      holeCards: p.holeCards.map(Card.fromId),
    }));
    game.#bettingRound = new BettingRound(data.bigBlind);
    game.#bettingRound.currentBet = data.currentBet;
    game.#handBets = new Map(Object.entries(data.handBets));
    game.#history = data.history || [];

    return game;
  }
}
