import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  appName: 'retro-breaker',
  brand: {
    primaryColor: '#3182F6', // 화면에 노출될 앱의 기본 색상으로 바꿔주세요.
  },
  permissions: [],
  navigationBar: { withBackButton: true, withHomeButton: true, theme: 'dark' },
  webView: { bounces: false, pullToRefreshEnabled: false, overScrollMode: 'never' },
  webBundleDir: 'dist',
});
