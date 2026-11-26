export type WebPushEnvironment = 'supported' | 'ios-home-screen-required' | 'unsupported';

export function getWebPushEnvironment(): WebPushEnvironment {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported';

  const userAgent = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/i.test(userAgent)
    || (/Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches === true
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;

  // iOS/iPadOS only exposes Web Push to Home Screen web apps (16.4+).
  // A regular Safari tab, even with Push APIs detected, is not a supported context.
  if (isIOS && !standalone) return 'ios-home-screen-required';

  return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window
    ? 'supported'
    : 'unsupported';
}
