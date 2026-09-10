import test from 'node:test';
import assert from 'node:assert/strict';
import { Breaker, createPattern, HEIGHT } from '../src/game.ts';

test('reward continue preserves score and time, pauses, and is usable once', () => {
  const game = new Breaker(); game.start();
  game.state = 'over'; game.lives = 0; game.remaining = 12; game.score = 900;
  assert.equal(game.continueWithReward(), true);
  assert.equal(game.lives, 1); assert.equal(game.state, 'paused');
  game.step(5); assert.equal(game.remaining, 12); assert.equal(game.score, 900);
  game.state = 'over'; game.lives = 0;
  assert.equal(game.continueWithReward(), false);
  game.start(); assert.equal(game.continued, false);
  game.state = 'over'; game.lives = 0; game.remaining = 9.99;
  assert.equal(game.continueWithReward(), false);
});

test('third miss ends the run and resets combo', () => {
  const game = new Breaker(); game.start();
  for (let i = 2; i >= 0; i--) {
    game.launchDelay = 0; game.combo = 8; game.y = HEIGHT + 20;
    game.step(.01);
    assert.equal(game.lives, i); assert.equal(game.combo, 0);
    assert.equal(game.state, i ? 'playing' : 'over');
  }
});
test('clearing a board preserves time and score and supplies a different pattern', () => {
  const game = new Breaker(); game.start(); game.launchDelay = 0;
  game.score = 1200; game.remaining = 42;
  game.bricks.forEach(b => b.alive = false);
  game.step(.01);
  assert.equal(game.wave, 2); assert.equal(game.score, 1200);
  assert.ok(game.remaining < 42 && game.remaining > 41);
  assert.ok(game.bricks.some(b => b.alive));
  assert.notDeepEqual(createPattern(1), createPattern(2));
});
test('fifth and tenth hits increase multiplier, tenth activates fever', () => {
  const game = new Breaker(); game.start();
  for (const [combo, expected] of [[4, 200], [9, 300]]) {
    game.combo = combo; game.score = 0; game.launchDelay = 0;
    game.bricks = [{ x: 150, y: 150, w: 46, h: 18, alive: true, color: '' },
      { x: 20, y: 120, w: 46, h: 18, alive: true, color: '' }];
    game.x = 175; game.y = 174; game.vx = 0; game.vy = -245;
    game.step(.004);
    assert.equal(game.score, expected);
  }
  assert.ok(game.fever > 0); assert.equal(game.paddleWidth, 112);
});
test('paused time is frozen and exact timeout finishes once', () => {
  const game = new Breaker(); game.start(); game.pause(); game.step(30);
  assert.equal(game.remaining, 60);
  game.resume(); game.remaining = .2; game.step(.3); game.step(1);
  assert.equal(game.remaining, 0); assert.equal(game.state, 'over');
  assert.equal(game.events.filter(e => e === 'over').length, 1);
});
test('side collision reflects horizontally and reset starts a fresh run', () => {
  const game = new Breaker(); game.start(); game.launchDelay = 0;
  game.bricks = [{ x: 150, y: 150, w: 46, h: 18, alive: true, color: '' },
    { x: 20, y: 120, w: 46, h: 18, alive: true, color: '' }];
  game.x = 144; game.y = 160; game.vx = 220; game.vy = 10;
  game.step(.004); assert.ok(game.vx < 0); assert.ok(game.vy > 0);
  game.start(); assert.equal(game.lives, 3); assert.equal(game.score, 0); assert.equal(game.combo, 0);
});
