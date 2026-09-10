import test from 'node:test';
import assert from 'node:assert/strict';
import { RewardedAd } from '../src/rewarded.ts';

function fixture(timeout = 1000) {
  let loaded, shown, failed;
  const logs = [];
  const ad = new RewardedAd({
    load(event) { loaded = event; return () => {}; },
    show(event, error) { shown = event; failed = error; return () => {}; },
  }, event => logs.push(event), timeout);
  return { ad, logs, load: () => loaded('loaded'), event: value => shown(value), fail: () => failed() };
}
test('only a loaded ad may show; duplicate reward signals grant once', async () => {
  const f = fixture();
  assert.equal((await f.ad.show()).earned, false);
  f.ad.prepare(); f.load(); const result = f.ad.show();
  assert.equal((await f.ad.show()).reason, 'unavailable');
  f.event('userEarnedReward'); f.event('userEarnedReward'); f.event('dismissed');
  assert.deepEqual(await result, { earned: true, reason: 'closed' });
  assert.equal(f.logs.filter(x => x === 'ad_reward').length, 1);
  f.event('userEarnedReward'); assert.equal(f.ad.state, 'idle');
});
test('dismissal and SDK errors without a reward never grant a life', async () => {
  for (const fail of [false, true]) {
    const f = fixture(); f.ad.prepare(); f.load(); const result = f.ad.show();
    if (fail) f.fail(); else f.event('dismissed');
    assert.equal((await result).earned, false);
  }
});
test('disposal ignores late callbacks and resolves pending display', async () => {
  const f = fixture(); f.ad.prepare(); f.load(); const result = f.ad.show();
  f.ad.dispose(); f.event('userEarnedReward'); f.event('dismissed');
  assert.equal((await result).earned, false);
  assert.equal(f.logs.includes('ad_reward'), false);
});
test('missing SDK callbacks time out without a reward', async () => {
  const f = fixture(10); f.ad.prepare(); f.load();
  assert.deepEqual(await f.ad.show(), { earned: false, reason: 'timeout' });
  assert.equal(f.ad.state, 'idle');
});
test('synchronous SDK completion cleans each subscription once', async () => {
  let cleaned = 0;
  const ad = new RewardedAd({
    load(event) { event('loaded'); return () => cleaned++; },
    show(event) { event('userEarnedReward'); event('dismissed'); return () => cleaned++; },
  });
  ad.prepare(); assert.equal((await ad.show()).earned, true);
  ad.dispose(); assert.equal(cleaned, 2);
});
