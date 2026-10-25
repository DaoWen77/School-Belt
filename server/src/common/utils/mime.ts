import { ErrorCode } from '../errors/error-codes';
import type { FileKind } from '../types/enums';

/**
 * 文件策略（契约 §9 / §10）：
 * - 直传前按 MIME 白名单 + 大小上限校验；
 * - complete 阶段用魔数嗅探（读取对象前 512 字节）与服务端 HEAD 结果交叉验证。
 */

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic'] as const;
const VIDEO_MIMES = ['video/mp4', 'video/webm'] as const;
const AUDIO_MIMES = [
  'audio/mpeg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
] as const;
const DOCUMENT_MIMES = [
  'application/pdf',
  'application/zip',
  'text/markdown',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;
const ARCHIVE_MIMES = ['application/zip', 'application/x-7z-compressed', 'application/vnd.rar', 'application/gzip'] as const;

export interface UploadPolicy {
  kind: FileKind;
  maxBytes: number;
  mimes: readonly string[];
}

const MB = 1024 * 1024;

export const FILE_POLICIES: Readonly<Record<FileKind, UploadPolicy>> = {
  image: { kind: 'image', maxBytes: 20 * MB, mimes: IMAGE_MIMES },
  video: { kind: 'video', maxBytes: 200 * MB, mimes: VIDEO_MIMES },
  audio: { kind: 'audio', maxBytes: 50 * MB, mimes: AUDIO_MIMES },
  document: { kind: 'document', maxBytes: 100 * MB, mimes: DOCUMENT_MIMES },
  archive: { kind: 'archive', maxBytes: 100 * MB, mimes: ARCHIVE_MIMES },
  // 未列入白名单的类型一律不接受
  other: { kind: 'other', maxBytes: 0, mimes: [] },
};

const MIME_TO_KIND: Readonly<Record<string, FileKind>> = {
  ...Object.fromEntries(IMAGE_MIMES.map((m) => [m, 'image' as FileKind])),
  ...Object.fromEntries(VIDEO_MIMES.map((m) => [m, 'video' as FileKind])),
  ...Object.fromEntries(AUDIO_MIMES.map((m) => [m, 'audio' as FileKind])),
  ...Object.fromEntries(DOCUMENT_MIMES.map((m) => [m, 'document' as FileKind])),
  ...Object.fromEntries(ARCHIVE_MIMES.map((m) => [m, 'archive' as FileKind])),
};

/** 去掉 charset 等参数并转小写 */
export function normalizeMime(mime: string): string {
  return mime.split(';')[0]?.trim().toLowerCase() ?? '';
}

export function classifyMime(mime: string): FileKind | null {
  return MIME_TO_KIND[normalizeMime(mime)] ?? null;
}

export type UploadCheck =
  | { ok: true; kind: FileKind; policy: UploadPolicy }
  | { ok: false; code: ErrorCode; message: string; maxBytes?: number };

export function checkUpload(mime: string, sizeBytes: number): UploadCheck {
  const kind = classifyMime(mime);
  if (!kind) {
    return {
      ok: false,
      code: ErrorCode.FILE_TYPE_NOT_ALLOWED,
      message: `不支持的文件类型：${mime || '(空)'}`,
    };
  }
  const policy = FILE_POLICIES[kind];
  if (sizeBytes <= 0) {
    return { ok: false, code: ErrorCode.VALIDATION_FAILED, message: '文件大小必须为正数' };
  }
  if (sizeBytes > policy.maxBytes) {
    return {
      ok: false,
      code: ErrorCode.FILE_TOO_LARGE,
      message: `${kind} 上限 ${Math.round(policy.maxBytes / MB)} MB`,
      maxBytes: policy.maxBytes,
    };
  }
  return { ok: true, kind, policy };
}

// ─────────────────────────── 魔数嗅探 ───────────────────────────

export type SniffedType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/gif'
  | 'image/avif'
  | 'image/heic'
  | 'video/mp4'
  | 'video/webm'
  | 'audio/mpeg'
  | 'audio/ogg'
  | 'audio/wav'
  | 'application/pdf'
  | 'application/zip'
  | 'application/gzip'
  | 'application/octet-stream';

function startsWith(head: Uint8Array, bytes: readonly number[], offset = 0): boolean {
  if (head.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (head[offset + i] !== bytes[i]) return false;
  }
  return true;
}

function ascii(head: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    const byte = head[offset + i];
    if (byte === undefined) return out;
    out += String.fromCharCode(byte);
  }
  return out;
}

/** 读取对象头部 512 字节后判断真实类型（无法识别时返回 application/octet-stream） */
export function sniffMagic(head: Uint8Array): SniffedType {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(head, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') return 'image/webp';
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WAVE') return 'audio/wav';
  if (ascii(head, 4, 4) === 'ftyp') {
    const brand = ascii(head, 8, 4);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (brand.startsWith('hei') || brand === 'mif1' || brand === 'msf1') return 'image/heic';
    return 'video/mp4';
  }
  if (ascii(head, 0, 4) === 'OggS') return 'audio/ogg';
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
  if (ascii(head, 0, 3) === 'ID3' || startsWith(head, [0xff, 0xfb]) || startsWith(head, [0xff, 0xf3])) {
    return 'audio/mpeg';
  }
  if (ascii(head, 0, 4) === '%PDF') return 'application/pdf';
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) return 'application/zip';
  if (startsWith(head, [0x1f, 0x8b])) return 'application/gzip';
  return 'application/octet-stream';
}

/** 声明类型 → 允许的嗅探结果集合 */
const COMPATIBLE: Readonly<Record<string, readonly SniffedType[]>> = {
  'image/png': ['image/png'],
  'image/jpeg': ['image/jpeg'],
  'image/webp': ['image/webp'],
  'image/gif': ['image/gif'],
  'image/avif': ['image/avif'],
  'image/heic': ['image/heic'],
  'video/mp4': ['video/mp4'],
  'video/webm': ['video/webm'],
  'audio/mpeg': ['audio/mpeg'],
  'audio/mp4': ['video/mp4'],
  'audio/x-m4a': ['video/mp4'],
  'audio/ogg': ['audio/ogg'],
  'audio/wav': ['audio/wav'],
  'audio/x-wav': ['audio/wav'],
  'application/pdf': ['application/pdf'],
  'application/zip': ['application/zip'],
  'application/gzip': ['application/gzip'],
  // OOXML / ODF 本质是 zip 容器
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['application/zip'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['application/zip'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['application/zip'],
  'application/msword': ['application/octet-stream'],
  'application/x-7z-compressed': ['application/octet-stream'],
  'application/vnd.rar': ['application/octet-stream'],
};

export interface MagicCheck {
  ok: boolean;
  sniffed: SniffedType;
  reason?: string;
}

/**
 * 交叉校验：声明 MIME 与魔数是否一致。
 * 纯文本类（md/txt）没有魔数，只接受声明本身。
 */
export function verifyMagic(head: Uint8Array, declaredMime: string): MagicCheck {
  const mime = normalizeMime(declaredMime);
  const sniffed = sniffMagic(head);
  const allowed = COMPATIBLE[mime];
  if (!allowed) {
    // 未登记的类型不参与魔数判定（由白名单负责拒绝）
    return { ok: true, sniffed, reason: '未登记的 MIME，跳过魔数校验' };
  }
  if (mime.startsWith('text/')) return { ok: true, sniffed };
  if (allowed.includes(sniffed)) return { ok: true, sniffed };
  return {
    ok: false,
    sniffed,
    reason: `声明类型 ${mime} 与文件头 ${sniffed} 不一致`,
  };
}
