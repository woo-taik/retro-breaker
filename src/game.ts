export const WIDTH = 360;
export const HEIGHT = 560;
export const RADIUS = 7;
export const PADDLE_Y = 508;
export type Brick = { x: number; y: number; w: number; h: number; color: string; alive: boolean };
export type State = 'ready' | 'playing' | 'paused' | 'over';
export type GameEvent = 'brick' | 'paddle' | 'miss' | 'wave' | 'over';
const COLORS = ['#ff6b6b', '#ffac5c', '#fada74', '#62dcaa', '#7babff'];

export function createPattern(wave: number): Brick[] {
  return Array.from({ length: 30 }, (_, i) => {
    const row = Math.floor(i / 6), col = i % 6;
    const masks = [true, (row + col) % 2 === 0, col !== 2 && col !== 3 || row % 2 === 0,
      row === 0 || row === 4 || col === 0 || col === 5, Math.abs(col - 2.5) <= row / 2 + .5,
      row % 2 === 0 || col % 2 === 0];
    return { x: 24.5 + col * 53, y: 116 + row * 25, w: 46, h: 18, color: COLORS[row], alive: masks[(wave - 1) % 6] };
  });
}

export class Breaker {
  state: State = 'ready';
  score = 0;
  lives = 3;
  combo = 0;
  maxCombo = 0;
  wave = 1;
  remaining = 60;
  paddleX = 137;
  x = 180;
  y = 480;
  vx = 0;
  vy = 0;
  launchDelay = 1;
  fever = 0;
  reason = '';
  continued = false;
  bricks = createPattern(1);
  events: GameEvent[] = [];

  get paddleWidth() { return this.fever > 0 ? 112 : 86; }
  get ended() { return this.state === 'over'; }
  get canContinue() { return this.ended && this.lives === 0 && this.remaining >= 10 && !this.continued; }
  continueWithReward() {
    if (!this.canContinue) return false;
    this.continued = true; this.lives = 1; this.combo = 0; this.fever = 0;
    this.launchDelay = 1; this.reason = ''; this.events = []; this.state = 'paused';
    return true;
  }
  get multiplier() { return Math.min(3, 1 + Math.floor(this.combo / 5)); }
  get speed() { return 245 + Math.min(80, Math.floor((60 - this.remaining) / 20) * 35 + (this.wave - 1) * 5); }

  start() {
    Object.assign(this, new Breaker());
    this.state = 'playing';
  }
  move(center: number) {
    this.paddleX = Math.max(0, Math.min(WIDTH - this.paddleWidth, center - this.paddleWidth / 2));
  }
  pause() { if (this.state === 'playing') this.state = 'paused'; }
  resume() { if (this.state === 'paused') this.state = 'playing'; }
  finish(reason: string) {
    if (this.state !== 'playing') return;
    this.state = 'over'; this.reason = reason; this.events.push('over');
  }
  step(seconds: number) {
    if (this.state !== 'playing' || !Number.isFinite(seconds) || seconds <= 0) return;
    const dt = Math.min(seconds, this.remaining);
    this.remaining = Math.max(0, this.remaining - dt);
    if (this.remaining === 0) { this.finish('60초 도전 완료'); return; }
    // Small physics steps prevent passing through bricks even at low frame rates.
    let pending = dt;
    while (pending > 0 && this.state === 'playing') {
      const step = Math.min(pending, 1 / 240);
      this.physics(step); pending -= step;
    }
  }
  private physics(dt: number) {
    this.fever = Math.max(0, this.fever - dt);
    this.move(this.paddleX + this.paddleWidth / 2);
    if (this.launchDelay > 0) {
      this.x = this.paddleX + this.paddleWidth / 2; this.y = PADDLE_Y - 18;
      this.launchDelay -= dt;
      if (this.launchDelay <= 0) { this.vx = this.speed * .42; this.vy = -this.speed * .9075; }
      return;
    }
    this.x += this.vx * dt; this.y += this.vy * dt;
    if (this.x < RADIUS) { this.x = RADIUS; this.vx = Math.abs(this.vx); }
    if (this.x > WIDTH - RADIUS) { this.x = WIDTH - RADIUS; this.vx = -Math.abs(this.vx); }
    if (this.y < 102) { this.y = 102; this.vy = Math.abs(this.vy); }
    if (this.vy > 0 && this.y + RADIUS >= PADDLE_Y && this.y - RADIUS <= PADDLE_Y + 12 &&
      this.x + RADIUS >= this.paddleX && this.x - RADIUS <= this.paddleX + this.paddleWidth) {
      const offset = Math.max(-1, Math.min(1, (this.x - this.paddleX - this.paddleWidth / 2) / (this.paddleWidth / 2)));
      const angle = offset * 1.05;
      this.vx = Math.sin(angle) * this.speed; this.vy = -Math.cos(angle) * this.speed;
      this.y = PADDLE_Y - RADIUS; this.events.push('paddle');
    }
    for (const brick of this.bricks) {
      if (!brick.alive) continue;
      const nx = Math.max(brick.x, Math.min(this.x, brick.x + brick.w));
      const ny = Math.max(brick.y, Math.min(this.y, brick.y + brick.h));
      if ((this.x - nx) ** 2 + (this.y - ny) ** 2 > RADIUS ** 2) continue;
      const overlaps = [this.x + RADIUS - brick.x, brick.x + brick.w + RADIUS - this.x,
        this.y + RADIUS - brick.y, brick.y + brick.h + RADIUS - this.y];
      const side = overlaps.indexOf(Math.min(...overlaps));
      if (side === 0) { this.x = brick.x - RADIUS; this.vx = -Math.abs(this.vx); }
      if (side === 1) { this.x = brick.x + brick.w + RADIUS; this.vx = Math.abs(this.vx); }
      if (side === 2) { this.y = brick.y - RADIUS; this.vy = -Math.abs(this.vy); }
      if (side === 3) { this.y = brick.y + brick.h + RADIUS; this.vy = Math.abs(this.vy); }
      brick.alive = false; this.combo++; this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.score += 100 * this.multiplier;
      if (this.combo % 10 === 0) this.fever = 5;
      this.events.push('brick'); break;
    }
    if (this.y - RADIUS > HEIGHT) {
      this.lives--; this.combo = 0; this.fever = 0; this.events.push('miss');
      if (this.lives === 0) this.finish('다음엔 더 높이!');
      else this.launchDelay = 1;
    } else if (!this.bricks.some(b => b.alive)) {
      this.wave++; this.bricks = createPattern(this.wave); this.launchDelay = 1; this.events.push('wave');
    }
  }
}
