/**
 * Betting and Pot Management for Texas Hold'em.
 *
 * Handles betting rounds, actions (fold/check/call/bet/raise), pot calculation
 * including side-pots for all-in situations, blind posting, and dealer rotation.
 *
 * This is a pure-logic module — no UI, no DOM, no I/O.
 */

// ── Action types ──────────────────────────────────────────────────────────────

export const ACTION = Object.freeze({
  FOLD:  'fold',
  CHECK: 'check',
  CALL:  'call',
  BET:   'bet',
  RAISE: 'raise',
});

// ── Betting round constants ───────────────────────────────────────────────────

export const ROUND = Object.freeze({
  PREFLOP: 'preflop',
  FLOP:    'flop',
  TURN:    'turn',
  RIVER:   'river',
});

export const ROUND_ORDER = Object.freeze([ROUND.PREFLOP, ROUND.FLOP, ROUND.TURN, ROUND.RIVER]);

// ── Blinds ────────────────────────────────────────────────────────────────────

/**
 * Standard blind structure.
 *
 * @typedef {Object} Blinds
 * @property {number} smallBlind  small blind amount
 * @property {number} bigBlind    big blind amount (usually 2× small blind)
 */

/**
 * Create a blinds configuration.
 * @param {number} smallBlind
 * @param {number} [bigBlind]  defaults to 2× smallBlind
 * @returns {Blinds}
 */
export function createBlinds(smallBlind, bigBlind) {
  return {
    smallBlind,
    bigBlind: bigBlind !== undefined ? bigBlind : smallBlind * 2,
  };
}

// ── Pot / Side-pot calculation ────────────────────────────────────────────────

/**
 * Calculate the main pot and side pots.
 *
 * This is the canonical "chip-dumping" algorithm:
 * 1. Group players by total amount contributed this hand (all-in thresholds)
 * 2. Create a pot for each threshold level
 * 3. Each pot is only eligible for players who contributed >= that threshold
 *
 * Returns an array of pots. Each pot has:
 *   - amount: total chips in this pot
 *   - eligiblePlayers: indices of players who can win this pot
 *
 * @param {Array<{stack: number, totalBet: number, folded: boolean, allIn: boolean, isActive: boolean}>} players
 * @returns {Array<{amount: number, eligiblePlayers: Set<number>}>}
 */
export function calculatePots(players) {
  // Collect total bets from active (non-folded) players
  const activePlayers = players
    .map((p, i) => ({ ...p, idx: i }))
    .filter(p => !p.folded);

  if (activePlayers.length === 0) {
    return [];
  }

  // Get unique non-zero bet amounts, sorted ascending
  const betAmounts = [...new Set(activePlayers.map(p => p.totalBet))]
    .filter(a => a > 0)
    .sort((a, b) => a - b);

  if (betAmounts.length === 0) {
    return [];
  }

  const pots = [];
  let previousLevel = 0;

  for (const level of betAmounts) {
    const increment = level - previousLevel;
    const eligible = activePlayers.filter(p => p.totalBet >= level);
    const amount = increment * eligible.length;

    pots.push({
      amount,
      eligiblePlayers: new Set(eligible.map(p => p.idx)),
    });

    previousLevel = level;
  }

  return pots;
}

// ── Betting round state ───────────────────────────────────────────────────────

/**
 * Immutable betting-round state.
 *
 * Tracks the current state of bets within a single betting round (pre-flop,
 * flop, turn, or river).
 */
export class BettingRound {
  /**
   * The current highest bet in this round.
   * @type {number}
   */
  currentBet;

  /**
   * The minimum raise amount (typically the big blind).
   * @type {number}
   */
  minRaise;

  /**
   * Index of the last player who raised (or -1 if none).
   * @type {number}
   */
  lastRaiser;

  /**
   * Number of raises in this round (for limit games — tracked for completeness).
   * @type {number}
   */
  raiseCount;

  /** @type {Map<number, number>} player index → total bet amount this round */
  #playerBets;

  /**
   * @param {number} minRaise  minimum raise amount (typically BB)
   */
  constructor(minRaise) {
    this.currentBet = 0;
    this.minRaise = minRaise;
    this.lastRaiser = -1;
    this.raiseCount = 0;
    this.#playerBets = new Map();
  }

  /**
   * Get a player's total bet for this round.
   * @param {number} playerIdx
   * @returns {number}
   */
  playerRoundBet(playerIdx) {
    return this.#playerBets.get(playerIdx) || 0;
  }

  /**
   * Record a bet from a player.
   * @param {number} playerIdx
   * @param {number} amount  the additional amount this player is putting in
   */
  recordBet(playerIdx, amount) {
    const current = this.playerRoundBet(playerIdx);
    this.#playerBets.set(playerIdx, current + amount);
  }

  /**
   * Get all player round bets as a plain object (for serialization).
   */
  getBets() {
    return Object.freeze(Object.fromEntries(this.#playerBets));
  }

  /**
   * Calculate the amount a player needs to call.
   * @param {number} playerIdx
   * @returns {number}
   */
  toCall(playerIdx) {
    return this.currentBet - this.playerRoundBet(playerIdx);
  }

  /**
   * Calculate the valid raise range for a player, expressed as the NEW total
   * bet (the amount everyone must call). The minimum is currentBet + minRaise
   * (or all-in if stack is smaller). The maximum is currentBet + playerStack +
   * what the player has already contributed this round.
   *
   * Example: currentBet=2, playerRoundBet=1, minRaise=2, stack=99
   *   → min new bet = 4, max new bet = 101 (2 + 99 + 0 effectively, but roundBet is already in)
   *
   * @param {number} playerIdx
   * @param {number} playerStack  chips remaining in front of the player
   * @returns {{ min: number, max: number }}  min/max NEW TOTAL BET
   */
  raiseRange(playerIdx, playerStack) {
    const alreadyIn = this.playerRoundBet(playerIdx);
    const toCallAmt = this.toCall(playerIdx);
    // Minimum additional chips player must add
    const minAdditional = toCallAmt + this.minRaise;
    // Total chips player can add (stack + already-paid amount... no, stack is remaining)
    const maxAdditional = playerStack + alreadyIn;

    const minNewBet = Math.min(maxAdditional, this.currentBet + this.minRaise);
    const maxNewBet = playerStack + alreadyIn; // convert to new total bet
    return { min: minNewBet, max: maxNewBet };
  }

  /**
   * Apply a raise to a new total bet level.
   *
   * @param {number} playerIdx
   * @param {number} newTotalBet  the new current bet to set (raise TO this amount)
   * @returns {{ callAmount: number, raiseAmount: number }}
   */
  applyRaise(playerIdx, newTotalBet) {
    const callAmount = this.toCall(playerIdx);
    const raiseAmount = newTotalBet - this.currentBet;
    const chipsToAdd = newTotalBet - this.playerRoundBet(playerIdx);

    // Update minRaise if this raise amount is higher
    if (raiseAmount > this.minRaise) {
      this.minRaise = raiseAmount;
    }

    this.currentBet = newTotalBet;
    this.lastRaiser = playerIdx;
    this.raiseCount++;
    this.recordBet(playerIdx, chipsToAdd);

    return { callAmount, raiseAmount };
  }

  /**
   * Apply a call: player matches the current bet.
   * @param {number} playerIdx
   * @returns {number}  amount the player had to put in
   */
  applyCall(playerIdx) {
    const amount = this.toCall(playerIdx);
    this.recordBet(playerIdx, amount);
    return amount;
  }

  /**
   * Reset the round (call between streets — bets reset to zero).
   */
  reset() {
    this.currentBet = 0;
    this.lastRaiser = -1;
    this.raiseCount = 0;
    this.#playerBets.clear();
  }
}

// ── Action validation ─────────────────────────────────────────────────────────

/**
 * Validate a betting action against the current game state.
 *
 * Returns { valid: false, reason: '...' } or { valid: true, ...details }
 *
 * @param {Object} params
 * @param {string} params.action       ACTION value
 * @param {number} [params.amount]     bet/raise amount (required for bet/raise)
 * @param {number} params.playerIdx    acting player index
 * @param {number} params.playerStack  acting player's current stack
 * @param {BettingRound} params.round  current betting round state
 * @param {boolean} params.canCheck    true if player faces no bet (check is legal)
 * @returns {{ valid: boolean, reason?: string, details?: object }}
 */
export function validateAction({ action, amount, playerIdx, playerStack, round, canCheck }) {
  switch (action) {
    case ACTION.FOLD:
      return { valid: true, details: {} };

    case ACTION.CHECK:
      if (!canCheck) {
        return { valid: false, reason: 'Cannot check — must call or fold' };
      }
      return { valid: true, details: {} };

    case ACTION.CALL: {
      const toCall = round.toCall(playerIdx);
      if (toCall === 0) {
        return { valid: false, reason: 'Nothing to call — check instead' };
      }
      if (toCall > playerStack) {
        // Player can call all-in
        return { valid: true, details: { amount: playerStack, isAllIn: true } };
      }
      return { valid: true, details: { amount: toCall, isAllIn: toCall === playerStack } };
    }

    case ACTION.BET: {
      if (!canCheck) {
        return { valid: false, reason: 'Cannot bet — must call or raise' };
      }
      if (amount === undefined || amount == null) {
        return { valid: false, reason: 'Bet amount is required' };
      }
      if (amount < round.minRaise && amount < playerStack) {
        return { valid: false, reason: `Bet must be at least ${round.minRaise}` };
      }
      if (amount > playerStack) {
        return { valid: false, reason: `Bet (${amount}) exceeds stack (${playerStack})` };
      }
      return { valid: true, details: { amount, isAllIn: amount === playerStack } };
    }

    case ACTION.RAISE: {
      if (amount === undefined || amount == null) {
        return { valid: false, reason: 'Raise amount is required' };
      }
      const range = round.raiseRange(playerIdx, playerStack);
      // amount = new total bet
      if (amount < range.min && amount < range.max) {
        return { valid: false, reason: `Raise must be at least ${range.min} (current bet ${round.currentBet} + min raise ${round.minRaise})` };
      }
      if (amount > range.max) {
        return { valid: false, reason: `Raise to ${amount} exceeds max possible bet (${range.max})` };
      }
      const alreadyIn = round.playerRoundBet(playerIdx);
      const chipsToAdd = amount - alreadyIn;
      return { valid: true, details: { amount, chipsToAdd, isAllIn: chipsToAdd >= playerStack } };
    }

    default:
      return { valid: false, reason: `Unknown action: ${action}` };
  }
}

// ── Dealer button rotation ────────────────────────────────────────────────────

/**
 * Advance the dealer button to the next active player.
 *
 * @param {number} currentDealer  current dealer index
 * @param {number} playerCount   total number of seats
 * @param {Set<number>} [activePlayers]  indices of active players (if omitted, all are active)
 * @returns {number}  next dealer index
 */
export function advanceDealer(currentDealer, playerCount, activePlayers) {
  if (activePlayers && activePlayers.size === 0) {
    return currentDealer;
  }
  let next = (currentDealer + 1) % playerCount;
  // If activePlayers is provided, skip eliminated players
  if (activePlayers) {
    while (!activePlayers.has(next)) {
      next = (next + 1) % playerCount;
    }
  }
  return next;
}

/**
 * Determine the small blind and big blind positions.
 *
 * In heads-up (2 players): dealer = SB, other = BB.
 * Otherwise: dealer+1 = SB, dealer+2 = BB.
 *
 * @param {number} dealerIdx     dealer button index
 * @param {number} activeCount   number of active (non-eliminated) players
 * @param {number} playerCount   total seats
 * @param {Set<number>} [activePlayers]  indices of active players
 * @returns {{ smallBlind: number, bigBlind: number }}
 */
export function blindPositions(dealerIdx, activeCount, playerCount, activePlayers) {
  /**
   * Find the next active player after `startIdx`.
   */
  function nextActive(startIdx) {
    if (!activePlayers) return (startIdx + 1) % playerCount;
    let idx = (startIdx + 1) % playerCount;
    while (!activePlayers.has(idx)) {
      idx = (idx + 1) % playerCount;
    }
    return idx;
  }

  if (activeCount === 2) {
    // Heads-up: dealer is SB
    const bb = nextActive(dealerIdx);
    return { smallBlind: dealerIdx, bigBlind: bb };
  }

  const sb = nextActive(dealerIdx);
  const bb = nextActive(sb);
  return { smallBlind: sb, bigBlind: bb };
}
