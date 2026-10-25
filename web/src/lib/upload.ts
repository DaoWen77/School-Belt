import { ApiError, api } from './api';
import { resolvePublicUrl } from './fileUrl';
import type { FileView } from './types';

const MB = 1024 * 1024;

/** 与 server/src/common/utils/mime.ts 的 FILE_POLICIES 对齐（客户端预检，服务端仍会复核） */
const LIMITS = {
  image: 20,
  video: 200,
  audio: 50,
  document: 100,
  archive: 100,
} as const;

type KnownKind = keyof typeof LIMITS;

export function fileKindOf(file: File): KnownKind | 'other' {
  const mime = (file.type || '').toLowerCase();
  const name = file.name.toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (
    mime.startsWith('text/') ||
    mime === 'application/pdf' ||
    mime === 'application/json' ||
    mime.includes('officedocument') ||
    mime.includes('msword') ||
    /\.(docx?|xlsx?|pptx?|md|csv|txt|pdf)$/.test(name)
  ) {
    return 'document';
  }
  if (/\.(zip|rar|7z|tar|gz|bz2)$/.test(name) || mime.includes('zip') || mime.includes('compressed')) return 'archive';
  return 'other';
}

export interface Precheck {
  ok: boolean;
  kind: string;
  message?: string;
}

/** 客户端预检：类型、空文件、大小上限 */
export function precheckFile(file: File): Precheck {
  const kind = fileKindOf(file);
  if (kind === 'other') return { ok: false, kind, message: `不支持的文件类型：${file.name}` };
  if (file.size <= 0) return { ok: false, kind, message: `空文件：${file.name}` };
  const max = LIMITS[kind] * MB;
  if (file.size > max) return { ok: false, kind, message: `${file.name} 超过 ${LIMITS[kind]} MB 上限` };
  return { ok: true, kind };
}

export function formatBytes(bytes: number | string | null | undefined): string {
  const value = typeof bytes === 'string' ? Number(bytes) : bytes;
  if (!value || !Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < MB) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / MB).toFixed(2)} MB`;
}

interface PresignResponse {
  fileId: string;
  uploadUrl: string;
  method: 'PUT';
  headers?: Record<string, string>;
  expiresIn: number;
  kind?: string;
  maxBytes?: number;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

/**
 * 真实直传：presign → PUT（XHR，带进度）→ complete。
 * 错误保留服务端 code（FILE_TOO_LARGE / FILE_TYPE_NOT_ALLOWED / FILE_NOT_READY / INTERNAL…）。
 */
export async function uploadFile(
  channelId: string,
  file: File,
  onProgress?: (progress: UploadProgress) => void,
): Promise<FileView> {
  const precheck = precheckFile(file);
  if (!precheck.ok) {
    throw new ApiError(400, precheck.kind === 'other' ? 'FILE_TYPE_NOT_ALLOWED' : 'FILE_TOO_LARGE', precheck.message ?? '文件预检失败');
  }

  const presign = await api<PresignResponse>('/files/presign', {
    method: 'POST',
    body: JSON.stringify({
      channelId,
      filename: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
    }),
  });

  if (!presign.uploadUrl || !presign.fileId) {
    throw new ApiError(500, 'INTERNAL', '服务端未返回上传地址');
  }

  await putFile(resolvePublicUrl(presign.uploadUrl), file, presign.headers ?? {}, onProgress);

  return api<FileView>(`/files/${presign.fileId}/complete`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

function putFile(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress?: (progress: UploadProgress) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [key, value] of Object.entries(headers)) {
      try {
        xhr.setRequestHeader(key, value);
      } catch {
        /* 某些预签名头不允许浏览器改写，忽略 */
      }
    }
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress?.({
        loaded: event.loaded,
        total: event.total,
        percent: Math.min(100, Math.round((event.loaded / event.total) * 100)),
      });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      reject(new ApiError(xhr.status, `HTTP_${xhr.status}`, `对象存储上传失败（HTTP ${xhr.status}）`));
    };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK', '无法连接对象存储（S3），请稍后重试'));
    xhr.ontimeout = () => reject(new ApiError(0, 'NETWORK', '对象存储上传超时'));
    xhr.send(file);
  });
}
