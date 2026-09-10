import './style.css';
import { Breaker, WIDTH, HEIGHT, PADDLE_Y, RADIUS } from './game';
import { loadRecord, saveRecord, submitScore, openLeaderboard, track, initializeHost, closeGame, createRewardedAd, browserPreview } from './platform';

function element<T extends Element>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error('화면 초기화 실패: ' + selector);
  return value;
}
element('#app').innerHTML = '<main class="game-shell">' +
  '<header class="game-header"><p class="game-kicker">RETRO BREAKER</p><h1>60초 벽돌방</h1>' +
  '<div class="controls"><button id="sound" type="button" aria-pressed="false">소리 OFF</button>' +
  '<button id="pause" type="button" disabled>일시정지</button><button id="exit" type="button">나가기</button></div></header>' +
  '<section class="game-frame" aria-label="벽돌깨기 게임"><canvas width="360" height="560" aria-label="게임 화면"></canvas>' +
  '<div class="game-overlay is-visible" role="dialog" aria-label="게임 안내"></div></section>' +
  '<footer class="game-guide"><span>드래그 · 방향키로 이동</span><span id="best">최고 0점</span></footer>' +
  '<p id="notice" role="status" aria-live="polite"></p></main>' +
  '<dialog id="exit-dialog" aria-labelledby="exit-title"><h2 id="exit-title">게임을 나갈까요?</h2>' +
  '<p>진행 중인 판은 종료돼요. 저장된 최고기록은 유지돼요.</p>' +
  '<button id="exit-cancel" type="button">계속 머무르기</button><button id="exit-confirm" type="button">나가기</button></dialog>';

const canvas = element<HTMLCanvasElement>('canvas');
const context = canvas.getContext('2d');
if (!context) throw new Error('Canvas를 지원하지 않아요.');
const ctx: CanvasRenderingContext2D = context;
const overlay = element<HTMLDivElement>('.game-overlay');
const pauseButton = element<HTMLButtonElement>('#pause');
const soundButton = element<HTMLButtonElement>('#sound');
const notice = element<HTMLParagraphElement>('#notice');
const game = new Breaker();
let best = 0, sound = false, run = 0, frame = 0, last = 0;
let initialized = false, audio: AudioContext | undefined;
let completed = 0, finalizedRun = -1, adBusy = false;
let runId = '', offerShown = false;
const loadedAt = performance.now();
const exitDialog = element<HTMLDialogElement>('#exit-dialog');
const rewarded = createRewardedAd();
const keys = new Set<string>();

function tone(frequency: number, duration = .07) {
  if (!sound || document.hidden || !audio || audio.state !== 'running') return;
  const oscillator = audio.createOscillator(), gain = audio.createGain();
  oscillator.type = 'square'; oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(.035, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + duration);
  oscillator.connect(gain); gain.connect(audio.destination);
  oscillator.start(); oscillator.stop(audio.currentTime + duration);
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
}
function unlockAudio() {
  if (!sound) return;
  try {
    audio ??= new AudioContext();
    void audio.resume().catch(() => {});
  } catch { notice.textContent = '이 환경에서는 효과음을 재생할 수 없어요.'; }
}
function updateBest() { element('#best').textContent = '최고 ' + best.toLocaleString() + '점'; }
function persist() {
  void saveRecord({ best, sound, completed }).catch(() => {
    notice.textContent = '기록을 저장하지 못했어요. 현재 창에서는 계속 플레이할 수 있어요.';
  });
}
function label(value: string, x: number, y: number, size = 15, color = '#eef4ff', align: CanvasTextAlign = 'left') {
  ctx.font = '700 ' + size + 'px system-ui, sans-serif';
  ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(value, x, y);
}
function draw() {
  ctx.fillStyle = '#10182a'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#22304b';
  for (let y = 112; y < HEIGHT; y += 24) for (let x = 12; x < WIDTH; x += 24) ctx.fillRect(x, y, 1, 1);
  label('SCORE', 20, 27, 10, '#92a5c5');
  label(game.score.toLocaleString(), 20, 53, 24);
  label(Math.ceil(game.remaining) + '초', 340, 49, 24, game.remaining <= 10 ? '#ff8f8f' : '#eef4ff', 'right');
  label('생명 ' + '●'.repeat(game.lives) + '○'.repeat(3 - game.lives), 20, 82, 12, '#ff9999');
  label('패턴 ' + game.wave, 340, 82, 12, '#aebcda', 'right');
  if (game.combo > 0) label(game.combo + ' COMBO ×' + game.multiplier, 180, 81, 12, '#fada74', 'center');
  ctx.fillStyle = '#2b3e5f'; ctx.fillRect(20, 96, 320, 2);
  ctx.fillStyle = game.remaining <= 10 ? '#ff8f8f' : '#99b6ff'; ctx.fillRect(20, 96, 320 * game.remaining / 60, 2);
  for (const b of game.bricks) if (b.alive) {
    ctx.fillStyle = b.color; ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fillRect(b.x, b.y, b.w, 3);
  }
  ctx.fillStyle = game.fever > 0 ? '#fada74' : '#99b6ff';
  ctx.fillRect(game.paddleX, PADDLE_Y, game.paddleWidth, 12);
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(game.x, game.y, RADIUS, 0, Math.PI * 2); ctx.fill();
  if (game.launchDelay > 0 && game.state === 'playing') label('준비! 곧 출발해요', 180, 450, 15, '#aebcda', 'center');
  if (game.fever > 0) label('FEVER · 패들 확대 ' + Math.ceil(game.fever) + '초', 180, 305, 14, '#fada74', 'center');
  label('손가락을 좌우로 움직여 보세요', 180, 548, 11, '#8295b7', 'center');
}
function showOverlay(kicker: string, title: string, detail: string, action: string, callback: () => void, rank = false) {
  overlay.replaceChildren();
  const p = document.createElement('p'); p.className = 'overlay-kicker'; p.textContent = kicker;
  const strong = document.createElement('strong'); strong.textContent = title;
  const span = document.createElement('span'); span.textContent = detail;
  const button = document.createElement('button'); button.className = 'start-button'; button.textContent = action;
  button.addEventListener('click', callback); overlay.append(p, strong, span, button);
  if (rank) {
    const ranking = document.createElement('button'); ranking.className = 'rank-button'; ranking.textContent = '토스 순위 보기';
    ranking.onclick = async () => {
      ranking.disabled = true;
      notice.textContent = await openLeaderboard();
      ranking.disabled = false;
    };
    overlay.append(ranking);
  }
  overlay.classList.add('is-visible');
  button.focus({ preventScroll: true });
}
function result() {
  if (finalizedRun === run) return;
  finalizedRun = run; completed++;
  track('game_end', { run_id: runId, score: game.score, seconds: Math.round(60 - game.remaining), continued: game.continued, reason: game.reason });
  pauseButton.disabled = true;
  const isBest = game.score > best;
  best = Math.max(best, game.score); updateBest(); persist();
  showOverlay(isBest ? '최고기록 갱신!' : game.reason, game.score.toLocaleString() + '점',
    '최대 콤보 ' + game.maxCombo + ' · 패턴 ' + game.wave + (game.continued ? ' · 이어하기 사용' : ''), '다시 하기', start, true);
  const resultRun = run;
  void submitScore(game.score).then(message => {
    if (resultRun === run && game.state === 'over') notice.textContent = message;
  });
  rewarded?.prepare();
}
function handleEnd() {
  if (completed > 0 && game.canContinue && !offerShown && rewarded?.state === 'ready') {
    offerShown = true; pauseButton.disabled = true;
    track('ad_offer', { run_id: runId });
    showOverlay('아직 시간이 남았어요', Math.ceil(game.remaining) + '초 더 도전',
      '광고 시청을 완료하면 생명 1개로 이어해요. 한 판에 한 번만 가능해요.',
      '광고 보고 이어하기', () => void continueAd());
    const skip = document.createElement('button'); skip.className = 'rank-button'; skip.textContent = '결과 보기';
    skip.onclick = result; overlay.append(skip);
  } else result();
}
async function continueAd() {
  if (!rewarded || adBusy || !game.canContinue) return;
  adBusy = true; soundButton.disabled = true;
  const attemptRun = run;
  void audio?.suspend().catch(() => {});
  overlay.replaceChildren(); overlay.textContent = '광고가 끝나면 게임으로 돌아와요.';
  const outcome = await rewarded.show();
  adBusy = false; soundButton.disabled = false;
  if (attemptRun !== run) return;
  if (outcome.earned && game.continueWithReward()) {
    track('game_continue', { run_id: runId });
    showOverlay('생명 1개를 받았어요', '다시 도전!', '준비되면 남은 시간으로 이어가세요.', '계속하기', resume);
    draw();
  } else {
    result();
    notice.textContent = outcome.reason === 'closed' ? '시청 완료 보상이 없어 결과를 표시했어요.' : '광고를 완료하지 못했어요. 새 판은 바로 시작할 수 있어요.';
  }
}
function animate(now: number) {
  if (game.state !== 'playing') return;
  const dt = Math.max(0, (now - last) / 1000); last = now;
  if (dt > .5) { pause(); return; }
  const direction = Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'));
  if (direction) game.move(game.paddleX + game.paddleWidth / 2 + direction * 360 * dt);
  game.step(dt);
  for (const event of game.events.splice(0)) {
    if (event === 'brick') tone(500 + game.combo * 35);
    if (event === 'paddle') tone(260, .04);
    if (event === 'miss') tone(130, .16);
    if (event === 'wave') tone(1000, .15);
  }
  draw();
  if (game.ended) handleEnd();
  else frame = requestAnimationFrame(animate);
}
function start() {
  if (!initialized || adBusy) return;
  if (game.ended) track('restart_click', { run_id: runId });
  cancelAnimationFrame(frame); run++; game.start(); keys.clear(); notice.textContent = '';
  runId = crypto.randomUUID(); offerShown = false;
  track('game_start', { run_id: runId, first_run: completed === 0 });
  rewarded?.prepare();
  overlay.classList.remove('is-visible'); pauseButton.disabled = false;
  unlockAudio(); canvas.focus({ preventScroll: true }); last = performance.now(); draw();
  frame = requestAnimationFrame(animate);
}
function resume() {
  if (document.hidden || game.state !== 'paused' || adBusy || exitDialog.open) return;
  cancelAnimationFrame(frame); pauseButton.disabled = false;
  track('game_resume', { run_id: runId });
  game.resume(); overlay.classList.remove('is-visible'); unlockAudio();
  canvas.focus({ preventScroll: true }); last = performance.now(); frame = requestAnimationFrame(animate);
}
function pause() {
  if (game.state !== 'playing') return;
  game.pause(); keys.clear(); cancelAnimationFrame(frame);
  track('game_pause', { run_id: runId });
  void audio?.suspend().catch(() => {});
  showOverlay('잠시 쉬어가요', '일시정지', '시간과 생명은 그대로예요.', '계속하기', resume);
  draw();
}
function askExit() {
  if (exitDialog.open) return;
  pause();
  void audio?.suspend().catch(() => {});
  exitDialog.showModal();
}
function showHome() {
  showOverlay('작은 오락실, 한 판의 여유', '60초 벽돌깨기', '생명 3개 · 5콤보마다 배율 UP · 10콤보 피버', '게임 시작', start);
}
element<HTMLButtonElement>('#exit').onclick = askExit;
element<HTMLButtonElement>('#exit-cancel').onclick = () => exitDialog.close();
element<HTMLButtonElement>('#exit-confirm').onclick = async () => {
  const button = element<HTMLButtonElement>('#exit-confirm'); button.disabled = true;
  track('game_exit', { run_id: runId, state: game.state });
  const closed = await closeGame();
  button.disabled = false;
  if (closed) { releaseHost(); rewarded?.dispose(); return; }
  exitDialog.close();
  if (browserPreview) {
    run++; rewarded?.dispose(); cancelAnimationFrame(frame); Object.assign(game, new Breaker());
    pauseButton.disabled = true; showHome(); draw(); notice.textContent = '시작 화면으로 돌아왔어요.';
  } else notice.textContent = '닫지 못했어요. 토스 상단 닫기 버튼을 이용해 주세요.';
};
const releaseHost = initializeHost(askExit, pause);
window.addEventListener('pagehide', () => { pause(); });
if (import.meta.hot) import.meta.hot.dispose(() => {
  cancelAnimationFrame(frame); releaseHost(); rewarded?.dispose(); void audio?.close();
});
function move(clientX: number) {
  const rect = canvas.getBoundingClientRect();
  game.move((clientX - rect.left) / rect.width * WIDTH);
}
canvas.tabIndex = 0;
canvas.addEventListener('pointerdown', e => {
  if (game.state !== 'playing') return;
  canvas.setPointerCapture(e.pointerId); move(e.clientX);
});
canvas.addEventListener('pointermove', e => { if (canvas.hasPointerCapture(e.pointerId)) move(e.clientX); });
canvas.addEventListener('pointerup', e => { if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); });
document.addEventListener('keydown', e => {
  if (game.state === 'playing' && ['ArrowLeft', 'ArrowRight', 'Escape'].includes(e.key)) {
    e.preventDefault(); if (e.key === 'Escape') pause(); else keys.add(e.key);
  }
});
document.addEventListener('keyup', e => keys.delete(e.key));
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('blur', pause);
pauseButton.onclick = pause;
soundButton.onclick = () => {
  if (adBusy) return;
  sound = !sound; soundButton.textContent = sound ? '소리 ON' : '소리 OFF';
  soundButton.setAttribute('aria-pressed', String(sound));
  if (sound) { unlockAudio(); tone(600); } else void audio?.suspend().catch(() => {});
  persist();
};
soundButton.disabled = true;
overlay.textContent = '기록을 불러오고 있어요.';
draw();
void loadRecord().then(record => { best = record.best; sound = record.sound; completed = record.completed; }).catch(() => {
  notice.textContent = '저장된 기록을 불러오지 못했어요. 이번 기록은 저장되지 않을 수 있어요.';
}).finally(() => {
  initialized = true; updateBest(); soundButton.disabled = false;
  soundButton.textContent = sound ? '소리 ON' : '소리 OFF'; soundButton.setAttribute('aria-pressed', String(sound));
  track('app_ready', { loading_ms: Math.round(performance.now() - loadedAt) });
  showHome(); rewarded?.prepare();
});
