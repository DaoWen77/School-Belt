export const RTC_DISABLED_MESSAGE =
  '音视频通话功能已暂时关闭，当前仅供内部联调，暂不对外开放。';

export function notifyRtcDisabled(): void {
  if (typeof window !== 'undefined') window.alert(RTC_DISABLED_MESSAGE);
}
