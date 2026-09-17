import path from 'node:path';

// 按扩展名推断 MIME（用于浏览器 inline 预览），未知类型回退 application/octet-stream
const MAP: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.csv': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip', '.rar': 'application/vnd.rar', '.7z': 'application/x-7z-compressed',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};

export function guessMime(fileName: string, fallback?: string | null): string {
  const ext = path.extname(fileName).toLowerCase();
  return MAP[ext] || fallback || 'application/octet-stream';
}

// 浏览器可直接内嵌预览的类型
export function previewKind(fileName: string): 'image' | 'pdf' | 'text' | 'video' | 'unsupported' {
  const ext = path.extname(fileName).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'].includes(ext)) return 'image';
  if (ext === '.pdf') return 'pdf';
  if (['.txt', '.md', '.csv', '.log', '.json'].includes(ext)) return 'text';
  if (['.mp4', '.mov', '.webm'].includes(ext)) return 'video';
  return 'unsupported';
}
