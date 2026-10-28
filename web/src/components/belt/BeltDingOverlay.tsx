'use client';

/** DING 接收端全屏强提醒：闪烁边框，必须手动「我知道了」关闭，同一时刻只渲染一条。 */
export function BeltDingOverlay({
  from,
  body,
  channelName,
  onClose,
}: {
  from: string;
  body: string;
  channelName?: string | null;
  onClose: () => void;
}) {
  return (
    <div className="belt-ding-overlay" role="alertdialog" aria-modal="true" aria-label="DING 强提醒">
      <div className="belt-ding-card">
        <p className="belt-page-kicker">DING // 强提醒</p>
        <b className="belt-ding-from">{from}</b>
        {channelName ? <span className="belt-ding-channel">#{channelName}</span> : null}
        {body ? <p className="belt-ding-body">{body}</p> : <p className="belt-ding-body">有人敲了你一下。</p>}
        <button type="button" className="belt-button is-signal" onClick={onClose}>
          我知道了
        </button>
      </div>
    </div>
  );
}
