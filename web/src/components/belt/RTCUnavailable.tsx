import Link from 'next/link';

export function RTCUnavailable() {
  return (
    <main className="rtc-disabled-page">
      <p className="belt-page-kicker">AURORA CALL / 极光通讯</p>
      <h1>音视频通话已暂时关闭</h1>
      <p>当前版本仅供内部联调，暂不对外开放语音与视频通讯。</p>
      <p className="belt-hint">如需恢复，请联系系统 Owner。</p>
      <Link href="/belt/channel" className="belt-button is-signal">返回环带</Link>
    </main>
  );
}
