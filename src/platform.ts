import { Game, Storage, User, Analytics, SafeArea, Screen, graniteEvent, loadFullScreenAd, showFullScreenAd } from '@apps-in-toss/web-framework';
import { RewardedAd } from './rewarded';

export const browserPreview = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
let storageKey: string | null = null;
let storageReady = false;
let writes = Promise.resolve();
export type Saved = { best: number; sound: boolean; completed: number };

export function track(name: string, data: Record<string, string | number | boolean> = {}) {
  const params = { log_name: name, rules_version: '1', ...data };
  if (browserPreview) { if (import.meta.env.DEV) console.debug('[game-event]', params); return; }
  if (import.meta.env.VITE_ANALYTICS_ENABLED !== 'true') return;
  // The SDK supplies its own identifier; never copy user keys into custom parameters.
  try { void Analytics.log({ log_type: 'event', log_name: name, params }).catch(() => {}); } catch { /* Best effort. */ }
}

export function initializeHost(onExit: () => void, onPause: () => void): () => void {
  if (browserPreview) return () => {};
  const releases: (() => void)[] = [];
  const applyInsets = (insets: ReturnType<typeof SafeArea.get>) => {
    for (const side of ['top', 'bottom', 'left', 'right'] as const) {
      const value = insets[side];
      if (Number.isFinite(value)) document.documentElement.style.setProperty('--safe-' + side, Math.max(0, value) + 'px');
    }
  };
  try { applyInsets(SafeArea.get()); releases.push(SafeArea.subscribe({ onEvent: applyInsets })); } catch { /* CSS env fallback. */ }
  try { releases.push(graniteEvent.addEventListener('backEvent', { onEvent: onExit })); } catch { /* Visible exit remains. */ }
  try { releases.push(graniteEvent.addEventListener('homeEvent', { onEvent: onPause })); } catch { /* Visibility listener remains. */ }
  return () => { for (const release of releases) { try { release(); } catch { /* Best effort. */ } } };
}

export async function closeGame(): Promise<boolean> {
  if (browserPreview) return false;
  try { await deadline(Screen.close()); return true; } catch { return false; }
}

export function createRewardedAd(): RewardedAd | undefined {
  const adGroupId = import.meta.env.VITE_REWARDED_AD_ID?.trim();
  if (!adGroupId || browserPreview) return undefined;
  try {
    if (!loadFullScreenAd.isSupported() || !showFullScreenAd.isSupported()) return undefined;
    return new RewardedAd({
      load: (event, error) => loadFullScreenAd({ options: { adGroupId }, onEvent: value => event(value.type), onError: error }),
      show: (event, error) => showFullScreenAd({ options: { adGroupId }, onEvent: value => event(value.type as import('./rewarded').AdEvent), onError: error }),
    }, name => track(name));
  } catch { return undefined; }
}

export function deadline<T>(promise: Promise<T>, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('응답 시간이 초과됐어요.')), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

export async function loadRecord(): Promise<Saved> {
  if (browserPreview) storageKey = 'retro-breaker:preview:v1';
  else {
    if (!User.getAnonymousKey.isSupported()) throw new Error('사용자 식별 미지원');
    const user = await deadline(User.getAnonymousKey());
    if (user.type !== 'HASH' || !user.hash) throw new Error('사용자 식별 실패');
    storageKey = 'retro-breaker:v1:' + user.hash;
  }
  const raw = browserPreview ? localStorage.getItem(storageKey) : await deadline(Storage.getItem(storageKey));
  storageReady = true;
  try {
    const data = JSON.parse(raw ?? '{}');
    return { best: Number.isSafeInteger(data.best) && data.best >= 0 ? data.best : 0, sound: data.sound === true,
      completed: Number.isSafeInteger(data.completed) && data.completed >= 0 ? data.completed : 0 };
  } catch { return { best: 0, sound: false, completed: 0 }; }
}

export function saveRecord(record: Saved): Promise<void> {
  const key = storageKey;
  if (!key || !storageReady) return Promise.reject(new Error('저장소 준비 안 됨'));
  const value = JSON.stringify(record);
  const write = writes.catch(() => {}).then(async () => {
    if (browserPreview) localStorage.setItem(key, value);
    else await deadline(Storage.setItem(key, value));
  });
  writes = write;
  return write;
}

export async function submitScore(score: number): Promise<string> {
  if (browserPreview) return '토스 앱에서 순위에 도전할 수 있어요.';
  if (!Number.isSafeInteger(score) || score < 0) return '점수를 확인하지 못했어요.';
  try {
    if (!Game.setLeaderboardScore.isSupported()) return '현재 토스 버전에서는 순위를 지원하지 않아요.';
    const profile = await deadline(Game.getUserProfile());
    if (profile?.statusCode !== 'SUCCESS') return '토스 게임 프로필을 확인해 주세요.';
    const result = await deadline(Game.setLeaderboardScore({ score: String(score) }));
    return result?.statusCode === 'SUCCESS' ? '순위에 기록했어요.' : '순위 등록을 완료하지 못했어요.';
  } catch { return '순위 등록에 실패했어요. 게임은 계속 즐길 수 있어요.'; }
}

export async function openLeaderboard(): Promise<string> {
  if (browserPreview) return '토스 앱에서 순위를 확인할 수 있어요.';
  try {
    if (!Game.openLeaderboard.isSupported()) return '현재 환경에서는 순위를 지원하지 않아요.';
    await deadline(Game.openLeaderboard());
    return '';
  } catch { return '순위를 열지 못했어요. 잠시 후 다시 시도해 주세요.'; }
}
