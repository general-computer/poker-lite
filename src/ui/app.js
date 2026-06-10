/**
 * Texas Hold'em Poker — Browser UI Application.
 *
 * Single-page app that imports the engine module and drives the table UI,
 * player controls, bot AI, and game flow.
 *
 * Works without a server — open index.html directly in a browser.
 */

import {
  GameState, PHASE, ACTION, SUIT_SYMBOLS, RANK_SHORT, evaluate,
} from '../engine/index.js';

import {
  botDecide, handStrength, assignPersonality, BOT_PERSONALITY,
} from './bots.js';

// ── DOM refs ───────────────────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);

const startScreen = $('#start-screen');
const gameScreen = $('#game-screen');
const seatsContainer = $('#seats-container');
const communityCardsEl = $('#community-cards');
const potDisplay = $('#pot-display');
const actionButtons = $('#action-buttons');
const betControls = $('#bet-controls');
const betSlider = $('#bet-slider');
const betInput = $('#bet-input');
const confirmBetBtn = $('#confirm-bet');
const cancelBetBtn = $('#cancel-bet');
const resultOverlay = $('#result-overlay');
const resultTitle = $('#result-title');
const resultWinners = $('#result-winners');
const resultHands = $('#result-hands');
const nextHandBtn = $('#next-hand-btn');
const handNumberEl = $('#hand-number');
const blindLevelEl = $('#blind-level');
const phaseDisplay = $('#phase-display');
const startBtn = $('#start-btn');

// ── State ──────────────────────────────────────────────────────────────────────

/** @type {GameState} */
let game = null;

/** Configuration */
let config = {};

/** Human player index */
let humanIdx = 0;

/** Pending action (bet/raise) awaiting amount confirmation */
let pendingAction = null;

/** Bot personalities per player index */
let botPersonalities = {};

/** Is a deal animation in progress? */
let animating = false;

/** Track human's per-round bet (resets each street). */
let humanRoundBet = 0;
let lastPhase = null;

// ── Seat positions (ellipse layout for up to 9 seats) ──────────────────────────

/**
 * Calculate seat positions on the table.
 * Seat 0 (human) is always at bottom center.
 * Remaining seats are distributed around the table perimeter — left side,
 * top arc, right side — so bots fan out naturally around an oval table.
 */
function seatPositions(totalSeats) {
  const positions = [];
  // Human always bottom center
  positions.push({ x: 50, y: 88 }); // seat 0

  if (totalSeats <= 1) return positions;

  const remaining = totalSeats - 1;
  // Sweep from lower-left (200°) through top (270°) to lower-right (340°).
  // Angles measured in standard math convention: 0° = right, 90° = top,
  // 180° = left, 270° = bottom.  The 200°–340° arc passes through the
  // top at 270°, giving bots a wide U-shaped spread around the table
  // with the human at the bottom.
  const startAngle = 200; // degrees — lower left side
  const endAngle = 340;   // degrees — lower right side
  const radiusX = 40;     // % horizontal spread
  const radiusY = 36;     // % vertical spread
  const centerX = 50;
  const centerY = 45;     // lower centre avoids squeezing bots into the top edge

  for (let i = 0; i < remaining; i++) {
    const angleDeg = remaining === 1
      ? 270 // single bot goes to top centre
      : startAngle + (i / (remaining - 1)) * (endAngle - startAngle);
    const angleRad = (angleDeg * Math.PI) / 180;
    const x = centerX + radiusX * Math.cos(angleRad);
    const y = centerY + radiusY * Math.sin(angleRad);
    positions.push({ x, y });
  }

  return positions;
}

// ── Card rendering ─────────────────────────────────────────────────────────────

function createCardEl(card, size = '') {
  const el = document.createElement('div');
  el.className = `card ${size}`;
  if (card) {
    const isRed = card.suit === 'h' || card.suit === 'd';
    el.classList.add(isRed ? 'red' : 'black');
    el.innerHTML = `
      <span class="card-rank">${RANK_SHORT[card.rank]}</span>
      <span class="card-suit">${SUIT_SYMBOLS[card.suit]}</span>
    `;
  }
  return el;
}

function createFaceDownCard(size = '') {
  const el = document.createElement('div');
  el.className = `card face-down ${size}`;
  return el;
}

// ── Table rendering ────────────────────────────────────────────────────────────

function renderTable() {
  const state = game.getState();
  const totalPlayers = state.players.length;
  const positions = seatPositions(totalPlayers);

  // Track phase changes to reset per-round bet tracking
  if (state.phase !== lastPhase) {
    if (lastPhase !== null) {
      humanRoundBet = 0;
    }
    lastPhase = state.phase;
  }

  // Update top bar
  handNumberEl.textContent = `Hand #${state.handNumber || 1}`;
  blindLevelEl.textContent = `Blinds ${state.smallBlind}/${state.bigBlind}`;
  phaseDisplay.textContent = phaseLabel(state.phase);

  // Render seats
  seatsContainer.innerHTML = '';

  for (let i = 0; i < totalPlayers; i++) {
    const player = state.players[i];
    const pos = positions[i];
    const isHuman = i === humanIdx;
    const isActiveTurn = i === state.actorIdx && !animating;

    const seat = document.createElement('div');
    seat.className = 'seat';
    if (player.folded) seat.classList.add('folded');
    if (player.allIn) seat.classList.add('all-in');
    if (player.stack === 0 && player.totalBet === 0) seat.classList.add('eliminated');
    if (isActiveTurn) seat.classList.add('active-turn');
    seat.style.left = `${pos.x}%`;
    seat.style.top = `${pos.y}%`;
    seat.dataset.playerIdx = i;

    // Dealer button
    if (i === state.dealerIdx) {
      const db = document.createElement('div');
      db.className = 'dealer-btn';
      db.textContent = 'D';
      seat.appendChild(db);
    }

    // Player name
    const nameEl = document.createElement('div');
    nameEl.className = 'player-name';
    nameEl.textContent = isHuman ? 'You' : player.name;
    seat.appendChild(nameEl);

    // Stack
    const stackEl = document.createElement('div');
    stackEl.className = 'player-stack';
    stackEl.textContent = formatChips(player.stack);
    seat.appendChild(stackEl);

    // Current bet
    const betEl = document.createElement('div');
    betEl.className = 'player-bet';
    if (player.totalBet > 0) {
      betEl.textContent = `Bet: ${player.totalBet}`;
    }
    seat.appendChild(betEl);

    // Status badge
    if (player.folded) {
      const badge = document.createElement('div');
      badge.className = 'status-badge folded';
      badge.textContent = 'Fold';
      seat.appendChild(badge);
    } else if (player.allIn) {
      const badge = document.createElement('div');
      badge.className = 'status-badge all-in';
      badge.textContent = 'All In';
      seat.appendChild(badge);
    } else if (player.stack === 0 && player.totalBet === 0) {
      const badge = document.createElement('div');
      badge.className = 'status-badge out';
      badge.textContent = 'Out';
      seat.appendChild(badge);
    }

    // Hole cards (face up for human, face down for bots)
    const holeCardsEl = document.createElement('div');
    holeCardsEl.className = 'hole-cards';
    if (player.holeCards && player.holeCards.length > 0) {
      if (isHuman || state.phase === PHASE.HAND_COMPLETE || state.phase === PHASE.SHOWDOWN) {
        // Show cards face up
        for (const card of player.holeCards) {
          holeCardsEl.appendChild(createCardEl(card, 'card-sm'));
        }
      } else {
        // Face down
        for (let j = 0; j < player.holeCards.length; j++) {
          holeCardsEl.appendChild(createFaceDownCard('card-sm'));
        }
      }
    }
    seat.appendChild(holeCardsEl);

    // Seat marker
    const marker = document.createElement('div');
    marker.className = 'seat-marker';
    marker.textContent = `S${i + 1}`;
    seat.appendChild(marker);

    seatsContainer.appendChild(seat);
  }

  // Render community cards
  renderCommunityCards(state);

  // Update pot
  potDisplay.textContent = `Pot: ${state.pot}`;

  // Update controls
  if (state.phase !== PHASE.HAND_COMPLETE && state.phase !== PHASE.SHOWDOWN) {
    updateControls(state);
  }
}

function renderCommunityCards(state) {
  communityCardsEl.innerHTML = '';

  // Placeholder slots for 5 community cards
  const totalSlots = 5;
  for (let i = 0; i < totalSlots; i++) {
    const card = state.communityCards[i];
    if (card) {
      const el = createCardEl(card);
      communityCardsEl.appendChild(el);
    } else {
      // Empty placeholder
      const placeholder = document.createElement('div');
      placeholder.className = 'card';
      placeholder.style.cssText = 'background: rgba(255,255,255,0.08); border: 2px dashed rgba(255,255,255,0.12); box-shadow: none;';
      communityCardsEl.appendChild(placeholder);
    }
  }
}

// ── Controls ───────────────────────────────────────────────────────────────────

function updateControls(state) {
  const isHumanTurn = state.actorIdx === humanIdx && !animating;

  if (!isHumanTurn) {
    // Disable all action buttons
    actionButtons.querySelectorAll('.btn').forEach(b => b.disabled = true);
    betControls.classList.add('hidden');
    return;
  }

  // Get the human player
  const human = state.players[humanIdx];

  // Determine legal actions using per-round bet tracking
  const legalActions = getLegalActions(humanIdx, human, state);

  // Enable/disable buttons
  const foldBtn = actionButtons.querySelector('[data-action="fold"]');
  const checkBtn = actionButtons.querySelector('[data-action="check"]');
  const callBtn = actionButtons.querySelector('[data-action="call"]');
  const betBtn = actionButtons.querySelector('[data-action="bet"]');
  const raiseBtn = actionButtons.querySelector('[data-action="raise"]');

  foldBtn.disabled = !legalActions.fold;
  checkBtn.disabled = !legalActions.check;
  callBtn.disabled = !legalActions.call;
  betBtn.disabled = !legalActions.bet;
  raiseBtn.disabled = !legalActions.raise;

  // Update call amount display
  const callAmtEl = $('#call-amount');
  if (legalActions.callAmount > 0) {
    callAmtEl.textContent = legalActions.callAmount >= human.stack
      ? `${legalActions.callAmount} (all-in)`
      : legalActions.callAmount;
  } else {
    callAmtEl.textContent = '';
  }

  // Hide bet controls if not pending
  if (!pendingAction) {
    betControls.classList.add('hidden');
    actionButtons.classList.remove('hidden');
  }
}

/**
 * Determine legal actions for a player by testing each action.
 */
function getLegalActions(playerIdx, player, state) {
  // Use per-round tracking: how much does the human still need to call?
  const toCall = Math.max(0, state.currentBet - humanRoundBet);
  const canCheck = toCall === 0;
  const minRaise = game.bigBlind;

  return {
    fold: true,
    check: canCheck,
    call: toCall > 0,
    callAmount: toCall,
    bet: canCheck && player.stack > 0,
    raise: !canCheck && player.stack > toCall,
    minBet: canCheck ? game.bigBlind : state.currentBet + minRaise,
    maxBet: player.stack + humanRoundBet,
    stack: player.stack,
  };
}

// ── Action handlers ────────────────────────────────────────────────────────────

function onActionClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn || btn.disabled) return;

  const action = btn.dataset.action;

  if (action === 'fold' || action === 'check') {
    executeAction(action);
    return;
  }

  if (action === 'call') {
    executeAction('call');
    return;
  }

  // Bet or raise — show amount controls
  if (action === 'bet' || action === 'raise') {
    pendingAction = action;
    showBetControls(action);
  }
}

function showBetControls(action) {
  const state = game.getState();
  const human = state.players[humanIdx];
  const minRaise = game.bigBlind;

  let min, max;
  if (action === 'bet') {
    min = Math.min(minRaise, human.stack);
    max = human.stack;
  } else {
    // raise — amount is the NEW TOTAL BET for this round
    min = Math.min(state.currentBet + minRaise, human.stack + humanRoundBet);
    max = human.stack + humanRoundBet;
  }

  betSlider.min = min;
  betSlider.max = max;
  betSlider.value = min;
  betSlider.step = 1;
  betInput.min = min;
  betInput.max = max;
  betInput.value = min;

  actionButtons.classList.add('hidden');
  betControls.classList.remove('hidden');
  betInput.focus();
}

function hideBetControls() {
  pendingAction = null;
  betControls.classList.add('hidden');
  actionButtons.classList.remove('hidden');
}

function onBetSliderChange() {
  betInput.value = betSlider.value;
}

function onBetInputChange() {
  betSlider.value = betInput.value;
}

function onConfirmBet() {
  if (!pendingAction) return;
  const amount = parseInt(betInput.value, 10);
  executeAction(pendingAction, amount);
  hideBetControls();
}

function onCancelBet() {
  hideBetControls();
  renderTable(); // refresh controls
}

// ── Action execution ───────────────────────────────────────────────────────────

async function executeAction(action, amount) {
  if (animating) return;

  // Calculate chips contributed this action for per-round tracking
  const stateBefore = game.getState();
  const humanBefore = stateBefore.players[humanIdx];
  const stackBefore = humanBefore.stack;

  const result = game.act(humanIdx, { action, amount });
  if (!result.ok) {
    console.error('Action failed:', result.error);
    renderTable();
    return;
  }

  // Update per-round human bet tracking
  const stateAfter = game.getState();
  const humanAfter = stateAfter.players[humanIdx];
  const chipsPutIn = Math.max(0, stackBefore - humanAfter.stack);
  humanRoundBet += chipsPutIn;

  renderTable();

  // Process result
  if (result.handResult) {
    await showHandResult(result.handResult);
    return;
  }

  // Animate transition
  await sleep(300);
  renderTable();

  // If next actor is a bot, auto-play
  if (result.nextActor !== undefined && result.nextActor !== humanIdx) {
    await autoPlayBots();
  }
}

// ── Bot auto-play ─────────────────────────────────────────────────────────────

async function autoPlayBots() {
  while (true) {
    const state = game.getState();

    // Check if hand is complete
    if (state.phase === PHASE.HAND_COMPLETE || state.phase === PHASE.SHOWDOWN) {
      renderTable();
      return;
    }

    // If it's human's turn, stop
    if (state.actorIdx === humanIdx || state.actorIdx === -1) {
      renderTable();
      return;
    }

    // Check if current actor is a bot
    const botIdx = state.actorIdx;
    const bot = state.players[botIdx];
    if (!bot || bot.folded || bot.allIn || !bot.isActive || bot.stack === 0) {
      renderTable();
      return;
    }

    await sleep(400); // brief "thinking" pause

    // Bot decides
    const personality = botPersonalities[botIdx] || BOT_PERSONALITY.PASSIVE;
    const strength = handStrength(evaluate, bot.holeCards, state.communityCards);
    const toCall = state.currentBet - bot.totalBet;
    const canCheck = toCall <= 0;

    const decision = botDecide({
      personality,
      strength,
      toCall: Math.max(0, toCall),
      currentBet: state.currentBet,
      minRaise: game.bigBlind,
      stack: bot.stack,
      pot: state.pot,
      canCheck,
    });

    const result = game.act(botIdx, decision);
    if (!result.ok) {
      console.error(`Bot ${botIdx} action failed:`, result.error, decision);
      // Fallback: try to check or fold
      if (canCheck) {
        game.act(botIdx, { action: ACTION.CHECK });
      } else if (toCall <= bot.stack) {
        game.act(botIdx, { action: ACTION.CALL });
      } else {
        game.act(botIdx, { action: ACTION.FOLD });
      }
    }

    renderTable();

    if (result.handResult) {
      await sleep(400);
      await showHandResult(result.handResult);
      return;
    }

    await sleep(300);
    renderTable();
  }
}

// ── Hand result ────────────────────────────────────────────────────────────────

async function showHandResult(handResult) {
  renderTable(); // show all cards face up

  await sleep(600);

  // Build result display
  const winners = handResult.winners || [];
  const allHands = handResult.allHands || [];

  // Title
  if (winners.length === 0) {
    resultTitle.textContent = 'Hand Complete';
  } else if (winners.length === 1 && winners[0].hand === null) {
    resultTitle.textContent = `${winners[0].playerName} wins — everyone folded`;
  } else if (winners.length === 1) {
    resultTitle.textContent = `${winners[0].playerName} wins!`;
  } else {
    resultTitle.textContent = `Split Pot — ${winners.map(w => w.playerName).join(' & ')}`;
  }

  // Winners
  resultWinners.innerHTML = '';
  for (const w of winners) {
    const payout = (handResult.payouts || []).find(p => p.playerId === w.playerId);
    const entry = document.createElement('div');
    entry.className = 'winner-entry';
    entry.innerHTML = `
      <div class="winner-name">${w.playerId === (game.players[humanIdx] || {}).id ? 'You' : w.playerName}</div>
      <div class="winner-hand">${w.handName}${w.description ? ' — ' + w.description : ''}</div>
      ${payout ? `<div class="winner-amount">Won ${payout.amount} chips</div>` : ''}
    `;
    resultWinners.appendChild(entry);
  }

  // All hands
  resultHands.innerHTML = '<h3 style="color:var(--text-dim);margin-bottom:8px;">All Hands</h3>';
  for (const h of allHands) {
    const entry = document.createElement('div');
    entry.className = 'result-player-hand';
    const isHuman = h.playerId === (game.players[humanIdx] || {}).id;
    entry.innerHTML = `
      <span class="rph-name">${isHuman ? 'You' : h.playerName}</span>
      <span class="rph-cards">${(h.holeCards || []).join(' ')}</span>
      <span class="rph-hand">${h.handDescription || ''}</span>
    `;
    resultHands.appendChild(entry);
  }

  resultOverlay.classList.remove('hidden');

  // Check for game over
  const activePlayers = game.players.filter(p => p.stack > 0);
  if (activePlayers.length <= 1) {
    nextHandBtn.textContent = activePlayers.length === 1
      ? `${activePlayers[0].id === game.players[humanIdx].id ? 'You' : activePlayers[0].name} wins the game! New Game?`
      : 'New Game';
  }
}

function onNextHand() {
  resultOverlay.classList.add('hidden');

  // Remove eliminated players and check if game is over
  const activePlayers = game.players.filter(p => p.stack > 0);
  if (activePlayers.length <= 1) {
    // Game over — restart
    startGame(config);
    return;
  }

  // Start next hand
  try {
    game.startHand();
    initRoundTracking();
    renderTable();

    // If first actor is a bot, auto-play
    const state = game.getState();
    if (state.actorIdx !== humanIdx && state.actorIdx !== -1) {
      setTimeout(() => autoPlayBots(), 500);
    }
  } catch (err) {
    console.error('Failed to start hand:', err);
    // Remove players with 0 stack and try again
    startGame({ ...config, players: activePlayers.map(p => ({
      id: p.id,
      name: p.name,
      stack: p.stack,
    })) });
  }
}

// ── Game setup ─────────────────────────────────────────────────────────────────

function startGame(cfg) {
  config = cfg;

  // Build player list
  const players = [];
  const botCount = cfg.botCount;

  // Human player
  players.push({
    id: 'human',
    name: 'You',
    stack: cfg.startingStack,
  });

  // Bot players
  const botNames = ['Ava', 'Buddy', 'Chip', 'Diamond', 'Ellie', 'Frank', 'Grace', 'Hank'];
  for (let i = 0; i < botCount; i++) {
    players.push({
      id: `bot-${i}`,
      name: botNames[i % botNames.length],
      stack: cfg.startingStack,
    });
    botPersonalities[i + 1] = assignPersonality(i, cfg.botPersonality);
  }

  humanIdx = 0;

  game = new GameState({
    players,
    blinds: { smallBlind: cfg.smallBlind, bigBlind: cfg.bigBlind },
    dealerIdx: Math.floor(Math.random() * players.length),
    deckSeed: Math.floor(Math.random() * 0xFFFFFFFF),
  });

  // Switch to game screen
  startScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  resultOverlay.classList.add('hidden');

  // Start first hand
  game.startHand();
  initRoundTracking();
  renderTable();

  // If first actor is a bot, auto-play
  const state = game.getState();
  if (state.actorIdx !== humanIdx && state.actorIdx !== -1) {
    setTimeout(() => autoPlayBots(), 800);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function initRoundTracking() {
  humanRoundBet = 0;
  lastPhase = null;
  // After startHand, capture any blind posting by the human
  const state = game.getState();
  const human = state.players[humanIdx];
  humanRoundBet = human.totalBet; // includes any blind posted
  lastPhase = state.phase;
}

function phaseLabel(phase) {
  const labels = {
    idle: 'Idle',
    preflop: 'Pre-flop',
    flop: 'Flop',
    turn: 'Turn',
    river: 'River',
    showdown: 'Showdown',
    hand_complete: 'Hand Complete',
  };
  return labels[phase] || phase;
}

function formatChips(n) {
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Event listeners ────────────────────────────────────────────────────────────

actionButtons.addEventListener('click', onActionClick);
betSlider.addEventListener('input', onBetSliderChange);
betInput.addEventListener('input', onBetInputChange);
confirmBetBtn.addEventListener('click', onConfirmBet);
cancelBetBtn.addEventListener('click', onCancelBet);
nextHandBtn.addEventListener('click', onNextHand);

startBtn.addEventListener('click', () => {
  const cfg = {
    botCount: parseInt($('#bot-count').value, 10),
    startingStack: parseInt($('#starting-stack').value, 10),
    smallBlind: parseInt($('#small-blind').value, 10),
    bigBlind: parseInt($('#big-blind').value, 10),
    botPersonality: $('#bot-personality').value,
  };
  startGame(cfg);
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (resultOverlay.classList.contains('hidden') === false) {
    if (e.key === 'Enter' || e.key === ' ') {
      onNextHand();
    }
    return;
  }

  if (pendingAction) {
    if (e.key === 'Enter') onConfirmBet();
    if (e.key === 'Escape') onCancelBet();
    return;
  }

  const state = game ? game.getState() : null;
  if (!state || state.actorIdx !== humanIdx || animating) return;

  const legal = getLegalActions(humanIdx, state.players[humanIdx], state);
  switch (e.key.toLowerCase()) {
    case 'f': if (legal.fold) executeAction('fold'); break;
    case 'k': if (legal.check) executeAction('check'); break;
    case 'c': if (legal.call) executeAction('call'); break;
    case 'b': if (legal.bet) { pendingAction = 'bet'; showBetControls('bet'); } break;
    case 'r': if (legal.raise) { pendingAction = 'raise'; showBetControls('raise'); } break;
  }
});

console.log('♠♥♦♣ Poker Lite ready — configure and click Deal Me In');
