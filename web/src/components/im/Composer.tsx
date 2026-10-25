'use client';

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from 'react';
import type { Attachment, Message } from '@/lib/types';
import { formatBytes } from '@/lib/upload';
import type { UploadRow } from './types';
import { CloseIcon, ChartIcon, FileIcon, ImageIcon, MusicIcon, PaperclipIcon, PlusIcon, SendIcon, StickerIcon, TaskIcon, VoteIcon } from './icons';

export function Composer({
  draft,
  onDraftChange,
  onSend,
  pendingAttachments,
  onRemoveAttachment,
  uploads,
  onAddFiles,
  onClearUploads,
  onOpenVote,
  onOpenTask,
  onOpenMusic,
  onOpenChart,
  onOpenSticker,
  onMaterialFiles,
  quotedMessage,
  onClearQuote,
  disabled = false,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  pendingAttachments: Attachment[];
  onRemoveAttachment: (fileId: string) => void;
  uploads: UploadRow[];
  onAddFiles: (files: FileList | File[]) => void;
  onClearUploads: () => void;
  onOpenVote: () => void;
  onOpenTask: () => void;
  onOpenMusic: () => void;
  onOpenChart: () => void;
  onOpenSticker: () => void;
  onMaterialFiles: (files: File[]) => void;
  quotedMessage?: Message | null;
  onClearQuote?: () => void;
  disabled?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const attachInput = useRef<HTMLInputElement | null>(null);
  const imageInput = useRef<HTMLInputElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const materialInput = useRef<HTMLInputElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 136)}px`;
  }, [draft]);

  const canSend = !disabled && (draft.trim().length > 0 || pendingAttachments.length > 0);

  const send = () => {
    if (!canSend) return;
    onSend();
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) el.style.height = 'auto';
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    send();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (event.clipboardData.files.length > 0) {
      event.preventDefault();
      onAddFiles(event.clipboardData.files);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    if (event.dataTransfer.files.length > 0) onAddFiles(event.dataTransfer.files);
  };

  const menuItem =
    'flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-ink hover:bg-accent hover:text-on-accent';

  return (
    <div
      className={`im-composer shrink-0 border-t border-line bg-panel px-2 pt-2 md:px-4 ${dragOver ? 'outline outline-2 outline-dashed outline-ink' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {uploads.length > 0 ? (
        <ul className="mb-1.5 flex flex-col gap-0.5" aria-label="上传进度">
          {uploads.map((row) => (
            <li key={row.id} className="flex items-center gap-2 border border-line px-2 py-1 text-[10px] text-ink-2">
              <span className="min-w-0 flex-1 truncate text-ink">{row.name}</span>
              {row.status === 'uploading' ? (
                <span className="h-1 w-16 bg-chip" aria-hidden="true">
                  <i className="block h-full bg-accent" style={{ width: `${row.percent}%` }} />
                </span>
              ) : null}
              <span className={row.status === 'failed' ? 'text-danger' : ''}>
                {row.status === 'uploading' ? `${row.percent}%` : row.status === 'done' ? '已上传' : `${row.code ?? '失败'}`}
              </span>
            </li>
          ))}
          <li className="text-right">
            <button type="button" className="text-[10px] text-ink-2 underline" onClick={onClearUploads}>
              清除已完成/失败
            </button>
          </li>
        </ul>
      ) : null}

      {pendingAttachments.length > 0 ? (
        <ul className="mb-1.5 flex flex-wrap gap-1" aria-label="待发送附件">
          {pendingAttachments.map((attachment) => (
            <li key={attachment.fileId} className="flex max-w-[16rem] items-center gap-1 border border-line bg-paper px-1.5 py-1 text-[10px]">
              <PaperclipIcon size={11} className="shrink-0 text-ink-2" />
              <span className="min-w-0 truncate text-ink">{attachment.originalName}</span>
              <span className="shrink-0 text-ink-2">{formatBytes(attachment.sizeBytes)}</span>
              <button type="button" onClick={() => onRemoveAttachment(attachment.fileId)} className="shrink-0 p-0.5 text-ink-2 hover:text-danger" aria-label="移除附件">
                <CloseIcon size={10} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <form onSubmit={submit} className="relative flex items-end gap-1.5">
        {!quotedMessage ? (
          <button
            type="button"
            aria-label="引用最近一条消息"
            title="引用最近一条消息（/translate 用）"
            onClick={() => window.dispatchEvent(new CustomEvent('dj:quote-latest'))}
            className="mb-1 shrink-0 border border-line px-1.5 py-1 text-[9px] text-ink-2 hover:border-ink hover:text-ink"
          >
            引用
          </button>
        ) : null}
        {quotedMessage ? (
          <div className="absolute bottom-full left-0 right-0 mb-1 flex items-center gap-2 border border-line bg-paper px-2 py-1 text-[10px] text-ink-2">
            <span className="shrink-0 border border-ink px-1 text-[9px] text-ink">引用</span>
            <span className="min-w-0 flex-1 truncate">{(quotedMessage.body ?? '（无正文）').slice(0, 80)}</span>
            <button type="button" onClick={onClearQuote} className="shrink-0 text-danger" aria-label="取消引用">
              ×
            </button>
          </div>
        ) : null}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            className={`grid h-8 w-8 place-items-center border text-ink-2 hover:border-ink hover:text-ink ${menuOpen ? 'border-ink bg-accent text-on-accent' : 'border-line'}`}
            aria-label="添加内容"
            aria-expanded={menuOpen}
          >
            <PlusIcon size={16} className={menuOpen ? 'rotate-45' : ''} />
          </button>

          {menuOpen ? (
            <div className="cut-corner-sm absolute bottom-10 left-0 z-30 w-36 border border-ink bg-panel py-1 shadow-none" role="menu">
              <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenuOpen(false); materialInput.current?.click(); }}>
                <FileIcon size={14} /> 素材
              </button>
              <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenuOpen(false); onOpenVote(); }}>
                <VoteIcon size={14} /> 投票
              </button>
              <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenuOpen(false); onOpenTask(); }}>
                <TaskIcon size={14} /> 任务
              </button>
              <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenuOpen(false); onOpenMusic(); }}>
                <MusicIcon size={14} /> 音乐
              </button>
              <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenuOpen(false); onOpenChart(); }}>
                <ChartIcon size={14} /> 图表
              </button>
              <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenuOpen(false); onOpenSticker(); }}>
                <StickerIcon size={14} /> 贴纸
              </button>
              <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenuOpen(false); imageInput.current?.click(); }}>
                <ImageIcon size={14} /> 图片
              </button>
              <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenuOpen(false); fileInput.current?.click(); }}>
                <FileIcon size={14} /> 文件
              </button>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => attachInput.current?.click()}
          className="grid h-8 w-8 place-items-center text-ink-2 hover:text-ink"
          aria-label="添加附件"
          title="添加附件"
        >
          <PaperclipIcon size={16} />
        </button>

        <textarea
          ref={textareaRef}
          value={draft}
          rows={1}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          maxLength={8000}
          placeholder="输入信号..."
          aria-label="输入信号"
          className="im-textarea min-h-8 max-h-[8.5rem] flex-1 border border-line bg-paper px-2.5 py-1.5 text-[13px] leading-[1.6] text-ink outline-none focus:border-ink"
        />

        <button
          type="submit"
          disabled={!canSend}
          className="cut-corner-sm flex h-8 items-center gap-1 bg-accent px-3 text-[11px] font-bold text-on-accent disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="发送"
        >
          <SendIcon size={14} />
          <span className="hidden sm:inline">发送</span>
        </button>
      </form>

      <p className="mt-1 flex items-center justify-between px-1 font-sans text-[9px] uppercase tracking-[0.1em] text-ink-2/70">
        <span>Enter 发送 · Shift+Enter 换行</span>
        <span>可拖拽 / 粘贴文件</span>
      </p>

      <input ref={attachInput} type="file" multiple className="hidden" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; onAddFiles(files); }} />
      <input ref={imageInput} type="file" accept="image/*" multiple className="hidden" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; onAddFiles(files); }} />
      <input ref={fileInput} type="file" multiple className="hidden" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; onAddFiles(files); }} />
      <input ref={materialInput} type="file" multiple className="hidden" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; onMaterialFiles(files); }} />
    </div>
  );
}
