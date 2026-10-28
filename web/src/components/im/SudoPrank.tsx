'use client';

/** `sudo rm -rf /` 彩蛋：全屏雪花/扫描线/错误抖动，3 秒后自动恢复，不发请求。 */
export function SudoPrank({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="sudo-prank fixed inset-0 z-[120] overflow-hidden bg-[#050505] text-[#e8e8e2]" role="alert" aria-live="assertive">
      <div className="sudo-snow absolute inset-0" aria-hidden="true" />
      <div className="sudo-scan absolute inset-0" aria-hidden="true" />
      <div className="relative grid h-full place-items-center px-6 text-center font-mono">
        <div className="sudo-glitch max-w-xl">
          <p className="text-[11px] tracking-[0.3em] text-[#fffa00]">[OMV/OS] KERNEL PANIC</p>
          <h2 className="mt-3 text-[28px] font-bold leading-tight">sudo: rm -rf /</h2>
          <p className="mt-2 text-[13px] text-[#ff9b9b]">权限拒绝 / PERMISSION DENIED</p>
          <pre className="mt-4 whitespace-pre-wrap text-left text-[11px] leading-relaxed text-[#bdbdb5]">
{`> unlink /dev/signal ....... FAILED
> purge /var/archive ...... FAILED
> integrity check ......... 0x0000FF
> 协议官已拦截该操作。你的权限不足以删除工作台。`}
          </pre>
          <p className="mt-5 animate-pulse text-[11px] text-[#fffa00]">RESTORING SESSION ██████████</p>
        </div>
      </div>
    </div>
  );
}
