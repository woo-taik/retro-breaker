export type AdEvent = 'loaded' | 'show' | 'impression' | 'userEarnedReward' | 'dismissed' | 'failedToShow';
export type AdDriver = {
  load: (event: (value: AdEvent) => void, error: () => void) => () => void;
  show: (event: (value: AdEvent) => void, error: () => void) => () => void;
};
export type AdOutcome = { earned: boolean; reason: 'closed' | 'failed' | 'timeout' | 'unavailable' };

// Does not create rewards on close, and consumes each loaded ad at most once.
export class RewardedAd {
  state: 'idle' | 'loading' | 'ready' | 'showing' = 'idle';
  private generation = 0;
  private cleanup: (() => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private resolve: ((result: AdOutcome) => void) | undefined;
  private driver: AdDriver;
  private log: (event: string) => void;
  private timeout: number;

  constructor(driver: AdDriver, log: (event: string) => void = () => {}, timeout = 120_000) {
    this.driver = driver; this.log = log; this.timeout = timeout;
  }
  private clear() {
    clearTimeout(this.timer); this.timer = undefined;
    const cleanup = this.cleanup; this.cleanup = undefined;
    try { cleanup?.(); } catch { /* SDK cleanup must not block navigation. */ }
  }
  prepare() {
    if (this.state !== 'idle') return;
    this.state = 'loading'; const generation = ++this.generation;
    const failed = () => {
      if (generation !== this.generation || this.state !== 'loading') return;
      this.generation++; this.state = 'idle'; this.clear(); this.log('ad_load_failed');
    };
    this.timer = setTimeout(failed, this.timeout);
    try {
      const cleanup = this.driver.load(event => {
        if (generation !== this.generation || this.state !== 'loading' || event !== 'loaded') return;
        this.state = 'ready'; clearTimeout(this.timer); this.log('ad_loaded');
      }, failed);
      if (generation === this.generation) this.cleanup = cleanup;
      else cleanup();
    } catch { failed(); }
  }
  show(): Promise<AdOutcome> {
    if (this.state !== 'ready') return Promise.resolve({ earned: false, reason: 'unavailable' });
    this.clear(); this.state = 'showing'; const generation = ++this.generation;
    this.log('ad_opt_in');
    return new Promise(resolve => {
      this.resolve = resolve;
      let earned = false;
      const finish = (reason: AdOutcome['reason']) => {
        if (generation !== this.generation) return;
        this.generation++; this.clear(); this.state = 'idle'; this.resolve = undefined;
        resolve({ earned, reason });
      };
      this.timer = setTimeout(() => finish('timeout'), this.timeout);
      try {
        const cleanup = this.driver.show(event => {
          if (generation !== this.generation) return;
          if (event === 'userEarnedReward' && !earned) { earned = true; this.log('ad_reward'); }
          if (event === 'impression') this.log('ad_impression');
          if (event === 'dismissed') finish('closed');
          if (event === 'failedToShow') { this.log('ad_show_failed'); finish('failed'); }
        }, () => {
          if (generation !== this.generation) return;
          this.log('ad_show_failed'); finish('failed');
        });
        if (generation === this.generation) this.cleanup = cleanup;
        else cleanup();
      } catch { finish('failed'); }
    });
  }
  dispose() {
    this.generation++; this.clear(); this.state = 'idle';
    this.resolve?.({ earned: false, reason: 'unavailable' }); this.resolve = undefined;
  }
}
