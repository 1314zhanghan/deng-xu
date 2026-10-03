/** 文件读写小工具（导出/导入卡片的浏览器端实现） */

/** 触发一次浏览器下载；data 为 JSON 可序列化对象或字符串 */
export function downloadFile(filename: string, data: unknown, mime = 'application/json'): void {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 给浏览器一点时间开始下载
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 读取本地文件为文本 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsText(file);
  });
}

/** 读取本地文件为 data URL（用于头像/封面） */
export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

/** 把任意字符串变成安全的文件名片段 */
export function safeFilename(name: string, fallback = 'card'): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.]+|[_.]+$/g, '')
    .slice(0, 60);
  return cleaned || fallback;
}

export function timestampSuffix(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** 本地 id 生成（不依赖 crypto.randomUUID，兼容 http 环境） */
export function makeId(prefix = 'id'): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}
