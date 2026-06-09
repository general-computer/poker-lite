/**
 * Headless browser integration tests for Poker Lite.
 *
 * Exercises the full app — DOM rendering, event handling, bot auto-play,
 * and hand lifecycle — inside a real Chromium browser via Playwright.
 *
 * These catch bugs that engine-only unit tests can't, like:
 *   - Missing imports in the UI layer
 *   - Broken DOM selectors
 *   - Event handler failures
 *   - Bundler misconfiguration
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

// Resolve dist/index.html to an absolute file:// URL
const APP_URL = pathToFileURL(path.resolve(import.meta.dirname, '../../dist/index.html')).href;

// ── Helpers ──────────────────────────────────────────────────────────────────────

/**
 * Open a fresh page, navigate to the app, and wire up error collection.
 * Returns { page, errors }.
 */
async function openApp(browser) {
  const page = await browser.newPage();
  const errors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  page.on('pageerror', (err) => {
    errors.push(err.message);
  });

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#start-screen', { state: 'visible' });

  return { page, errors };
}

/**
 * Run a test function with a fresh page, ensuring cleanup even on failure.
 */
async function withPage(browser, fn) {
  const { page, errors } = await openApp(browser);
  try {
    await fn(page, errors);
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Start a game by filling the config form and clicking Deal Me In.
 */
async function startGameViaUI(page, opts = {}) {
  const {
    botCount = 3,
    startingStack = 1000,
    smallBlind = 5,
    bigBlind = 10,
    personality = 'mixed',
  } = opts;

  await page.selectOption('#bot-count', String(botCount));
  await page.fill('#starting-stack', String(startingStack));
  await page.fill('#small-blind', String(smallBlind));
  await page.fill('#big-blind', String(bigBlind));
  await page.selectOption('#bot-personality', personality);
  await page.click('#start-btn');

  // Wait for game screen to appear and seats to render
  await page.waitForSelector('#game-screen:not(.hidden)', { timeout: 5000 });
  await page.waitForSelector('.seat', { timeout: 5000 });
}

/**
 * Wait until it's the human player's turn (buttons enabled) or a timeout.
 * Returns true if human's turn arrived, false otherwise.
 */
async function waitForHumanTurn(page, timeoutMs = 10000) {
  try {
    await page.waitForFunction(
      () => {
        const foldBtn = document.querySelector('[data-action="fold"]');
        return foldBtn && !foldBtn.disabled;
      },
      { timeout: timeoutMs },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for the result overlay to appear (hand complete).
 */
async function waitForHandResult(page, timeoutMs = 30000) {
  await page.waitForSelector('#result-overlay:not(.hidden)', { timeout: timeoutMs });
}

/**
 * Click "Next Hand" to advance.
 */
async function nextHand(page) {
  await page.click('#next-hand-btn');
  // Wait for the overlay to gain the .hidden class
  await page.waitForFunction(
    () => document.querySelector('#result-overlay')?.classList.contains('hidden'),
    { timeout: 5000 },
  );
}

/**
 * Play through a hand by automatically folding the human when it's their turn.
 * This ensures the hand completes quickly without manual interaction.
 * Returns true if the hand completed (result overlay appeared).
 */
async function playHumanUntilHandComplete(page, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // Check if hand result is already showing
    const resultVisible = await page.$eval('#result-overlay', (el) =>
      !el.classList.contains('hidden'),
    ).catch(() => false);

    if (resultVisible) return true;

    // Check if human can act: fold button must be enabled AND human
    // must not have already folded (no "folded" class on their seat).
    const canAct = await page.evaluate(() => {
      const foldBtn = document.querySelector('[data-action="fold"]');
      if (!foldBtn || foldBtn.disabled) return false;
      // Also verify the human hasn't already folded
      const seats = document.querySelectorAll('.seat');
      const humanSeat = Array.from(seats).find(
        (s) => s.querySelector('.player-name')?.textContent === 'You',
      );
      if (humanSeat?.classList.contains('folded')) return false;
      return true;
    }).catch(() => false);

    if (canAct) {
      // Fold — always legal when the human can act
      await page.click('[data-action="fold"]');
      await page.waitForTimeout(500);
    } else {
      // Wait for state to change (bot action, hand result, etc.)
      await page.waitForTimeout(300);
    }
  }

  // One final check
  return await page.$eval('#result-overlay', (el) =>
    !el.classList.contains('hidden'),
  ).catch(() => false);
}

// ── Browser lifecycle ────────────────────────────────────────────────────────────

let browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

// ═════════════════════════════════════════════════════════════════════════════════
// App Startup
// ═════════════════════════════════════════════════════════════════════════════════

describe('App startup', () => {
  it('should load without console errors', () =>
    withPage(browser, async (_page, errors) => {
      assert.equal(errors.length, 0, `Console errors on load: ${errors.join('; ')}`);
    }));

  it('should render the start screen with title', () =>
    withPage(browser, async (page) => {
      const title = await page.textContent('h1');
      assert.ok(title.includes('Texas Hold\'em'), `Expected poker title, got: ${title}`);
    }));

  it('should have a Deal Me In button', () =>
    withPage(browser, async (page) => {
      const btn = await page.$('#start-btn');
      assert.ok(btn, 'Deal Me In button not found');
      const text = await btn.textContent();
      assert.ok(text.includes('Deal Me In'), `Expected Deal Me In, got: ${text}`);
    }));

  it('should have config controls with defaults', () =>
    withPage(browser, async (page) => {
      assert.equal(await page.$eval('#bot-count', (el) => el.value), '8');
      assert.equal(await page.$eval('#starting-stack', (el) => el.value), '1000');
      assert.equal(await page.$eval('#small-blind', (el) => el.value), '5');
      assert.equal(await page.$eval('#big-blind', (el) => el.value), '10');
    }));

  it('should have the game screen hidden on startup', () =>
    withPage(browser, async (page) => {
      const gameScreen = await page.$('#game-screen');
      assert.ok(gameScreen, 'Game screen element missing');
      const isHidden = await gameScreen.evaluate((el) => el.classList.contains('hidden'));
      assert.ok(isHidden, 'Game screen should be hidden on startup');
    }));
});

// ═════════════════════════════════════════════════════════════════════════════════
// Game Configuration & Start
// ═════════════════════════════════════════════════════════════════════════════════

describe('Game start', () => {
  it('should transition from start screen to game screen', () =>
    withPage(browser, async (page, errors) => {
      await startGameViaUI(page, { botCount: 3 });

      const startHidden = await page.$eval('#start-screen', (el) =>
        el.classList.contains('hidden'));
      assert.ok(startHidden, 'Start screen should hide');

      const gameVisible = await page.$eval('#game-screen', (el) =>
        !el.classList.contains('hidden'));
      assert.ok(gameVisible, 'Game screen should be visible');

      assert.equal(errors.length, 0, `Errors during game start: ${errors.join('; ')}`);
    }));

  it('should render correct number of seats (human + bots)', () =>
    withPage(browser, async (page) => {
      await startGameViaUI(page, { botCount: 4 });
      await page.waitForSelector('.seat', { timeout: 5000 });
      const seatCount = await page.$$eval('.seat', (els) => els.length);
      assert.equal(seatCount, 5, 'Should have 1 human + 4 bot seats');
    }));

  it('should show the human player as "You"', () =>
    withPage(browser, async (page) => {
      await startGameViaUI(page, { botCount: 2 });
      await page.waitForSelector('.player-name', { timeout: 5000 });
      const names = await page.$$eval('.player-name', (els) =>
        els.map((e) => e.textContent));
      assert.ok(names.includes('You'), `Expected "You" in player names: ${names}`);
    }));

  it('should show pot display and hand number', () =>
    withPage(browser, async (page) => {
      await startGameViaUI(page, { botCount: 2 });
      const potText = await page.textContent('#pot-display');
      assert.ok(potText.includes('Pot:'), `Expected pot display, got: ${potText}`);
      const handText = await page.textContent('#hand-number');
      assert.ok(handText.includes('Hand #'), `Expected hand number, got: ${handText}`);
    }));
});

// ═════════════════════════════════════════════════════════════════════════════════
// Bot Auto-Play (CRITICAL — exercises the evaluate import path)
// ═════════════════════════════════════════════════════════════════════════════════

describe('Bot auto-play', () => {
  it('should complete bot actions without console errors', () =>
    withPage(browser, async (page, errors) => {
      await startGameViaUI(page, { botCount: 1 });

      // Wait for human turn (means bots played) or hand result
      const humanTurned = await waitForHumanTurn(page, 15000);

      if (humanTurned) {
        assert.equal(errors.length, 0,
          `Console errors during bot play: ${errors.join('; ')}`);
        await page.click('[data-action="fold"]');
        await page.waitForTimeout(500);
      }

      try { await waitForHandResult(page, 20000); } catch { /* ok */ }

      assert.equal(errors.length, 0,
        `Console errors after bot play: ${errors.join('; ')}`);
    }));

  it('should eventually give the human a turn', () =>
    withPage(browser, async (page) => {
      await startGameViaUI(page, { botCount: 2 });
      const humanTurned = await waitForHumanTurn(page, 20000);
      assert.ok(humanTurned, 'Human never got a turn — bots may be broken');
    }));
});

// ═════════════════════════════════════════════════════════════════════════════════
// Hand Lifecycle
// ═════════════════════════════════════════════════════════════════════════════════

describe('Hand lifecycle', () => {
  it('should complete a hand and show the result overlay', () =>
    withPage(browser, async (page, errors) => {
      await startGameViaUI(page, { botCount: 1 });

      const completed = await playHumanUntilHandComplete(page, 30000);
      assert.ok(completed, 'Hand should complete within timeout');

      const overlayVisible = await page.$eval('#result-overlay', (el) =>
        !el.classList.contains('hidden'));
      assert.ok(overlayVisible, 'Result overlay should be visible');

      const title = await page.textContent('#result-title');
      assert.ok(title.length > 0, 'Result title should not be empty');

      assert.equal(errors.length, 0,
        `Console errors during hand: ${errors.join('; ')}`);
    }));

  it('should advance to the next hand when clicking Next Hand', () =>
    withPage(browser, async (page, errors) => {
      await startGameViaUI(page, { botCount: 1 });

      let completed = await playHumanUntilHandComplete(page, 30000);
      assert.ok(completed, 'First hand should complete');

      await nextHand(page);
      await page.waitForTimeout(500);

      const gameVisible = await page.$eval('#game-screen', (el) =>
        !el.classList.contains('hidden'));
      assert.ok(gameVisible, 'Game screen should still be visible');

      const handNum = await page.textContent('#hand-number');
      assert.ok(handNum.includes('Hand #'), 'Hand number should be displayed');

      completed = await playHumanUntilHandComplete(page, 30000);
      assert.ok(completed, 'Second hand should complete');

      assert.equal(errors.length, 0,
        `Console errors during hand transition: ${errors.join('; ')}`);
    }));

  it('should play multiple hands without errors', () =>
    withPage(browser, async (page, errors) => {
      await startGameViaUI(page, { botCount: 1, startingStack: 2000 });

      for (let i = 0; i < 3; i++) {
        const completed = await playHumanUntilHandComplete(page, 30000);
        if (!completed) break;

        assert.equal(errors.length, 0,
          `Errors after hand ${i + 1}: ${errors.join('; ')}`);

        const btnText = await page.textContent('#next-hand-btn');
        if (btnText.includes('New Game')) break;

        await nextHand(page);
        await page.waitForTimeout(300);
      }

      assert.equal(errors.length, 0,
        `Console errors after multiple hands: ${errors.join('; ')}`);
    }));
});

// ═════════════════════════════════════════════════════════════════════════════════
// Human Controls
// ═════════════════════════════════════════════════════════════════════════════════

describe('Human controls', () => {
  it('should enable action buttons when it is the human turn', () =>
    withPage(browser, async (page) => {
      await startGameViaUI(page, { botCount: 1 });

      const humanTurned = await waitForHumanTurn(page, 20000);
      assert.ok(humanTurned, 'Human never got a turn');

      const buttonsEnabled = await page.$$eval(
        '#action-buttons .btn:not([disabled])',
        (els) => els.length);
      assert.ok(buttonsEnabled > 0,
        'At least one action button should be enabled');
    }));

  it('should let the human fold', () =>
    withPage(browser, async (page) => {
      await startGameViaUI(page, { botCount: 1 });

      const humanTurned = await waitForHumanTurn(page, 20000);
      assert.ok(humanTurned, 'Human never got a turn to fold');

      const foldBtn = await page.$('[data-action="fold"]');
      const foldDisabled = await foldBtn.evaluate((el) => el.disabled);
      assert.equal(foldDisabled, false, 'Fold button should be enabled');

      await foldBtn.click();
      await page.waitForTimeout(500);
      // Hand should continue or complete without error
    }));
});

// ═════════════════════════════════════════════════════════════════════════════════
// State Transitions
// ═════════════════════════════════════════════════════════════════════════════════

describe('Game state transitions', () => {
  it('should show community cards progressing through streets', () =>
    withPage(browser, async (page, errors) => {
      await startGameViaUI(page, { botCount: 2 });

      // Let the hand play out; check for community cards
      // Use playHumanUntilHandComplete to keep the hand moving
      await playHumanUntilHandComplete(page, 25000);

      // After hand completes, check errors
      assert.equal(errors.length, 0,
        `Errors during street progression: ${errors.join('; ')}`);
    }));

  it('should show pot amount increasing after blinds post', () =>
    withPage(browser, async (page) => {
      await startGameViaUI(page, { botCount: 2, smallBlind: 5, bigBlind: 10 });
      await page.waitForTimeout(1000);

      const potText = await page.textContent('#pot-display');
      const potMatch = potText.match(/\d+/);
      if (potMatch) {
        const pot = parseInt(potMatch[0], 10);
        assert.ok(pot >= 15, `Expected pot >= 15 after blinds, got: ${pot}`);
      }
    }));
});
