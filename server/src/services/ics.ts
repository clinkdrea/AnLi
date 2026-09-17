// RFC 5545 标准 .ics 日历文件生成
// 用途：服务器通过 osascript 只能写入"本机"的日历/提醒事项；
// 远程访问（如蒲公英）时，生成 .ics 供客户端电脑下载后双击导入其本地日历。

// iCalendar 文本转义
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// 按 RFC 5545 折行：每行不超过 75 字节，续行以单个空格开头；按字符切分避免截断 UTF-8 多字节字符
function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  let curLen = 0;
  let first = true;
  for (const ch of line) {
    const len = Buffer.byteLength(ch, 'utf8');
    const limit = first ? 75 : 74; // 续行有前导空格，占 1 字节
    if (curLen + len > limit) {
      out.push((first ? '' : ' ') + cur);
      first = false;
      cur = ch;
      curLen = len;
    } else {
      cur += ch;
      curLen += len;
    }
  }
  if (cur) out.push((first ? '' : ' ') + cur);
  return out.join('\r\n');
}

// 紧凑日期/时间
function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}
function nextDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return ymd(d);
}

export interface IcsTask {
  id: number;
  title: string;
  caseName?: string | null;
  description?: string | null;
  /** YYYY-MM-DD 或 YYYY-MM-DDTHH:MM */
  dueDate?: string | null;
}

// 生成单个任务的 .ics（VEVENT + VALARM；无截止时间返回 null）
export function buildTaskIcs(task: IcsTask): string | null {
  if (!task.dueDate) return null;

  const summary = task.caseName ? `${task.title} · ${task.caseName}` : task.title;
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AnLi Legal Platform//Task//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:task-${task.id}@anli.local`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
  ];

  const d = String(task.dueDate);
  const isAllDay = d.length <= 10;
  if (isAllDay) {
    // 全天事件
    const day = d.slice(0, 10).replace(/-/g, '');
    lines.push(`DTSTART;VALUE=DATE:${day}`);
    lines.push(`DTEND;VALUE=DATE:${nextDay(d.slice(0, 10))}`);
  } else {
    // 浮动本地时间（不带 Z/TZID）：由导入方电脑按其本地时区解释
    const m = d.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
    if (m) {
      const day = m[1].replace(/-/g, '');
      const start = `${day}T${m[2]}${m[3]}00`;
      // 结束时间 = 开始 + 1 小时
      const startD = new Date(`${m[1]}T${m[2]}:${m[3]}:00`);
      startD.setHours(startD.getHours() + 1);
      const end = `${ymd(startD)}T${String(startD.getHours()).padStart(2, '0')}${String(startD.getMinutes()).padStart(2, '0')}00`;
      lines.push(`DTSTART:${start}`);
      lines.push(`DTEND:${end}`);
    } else {
      // 兜底：按全天
      const day = d.slice(0, 10).replace(/-/g, '');
      lines.push(`DTSTART;VALUE=DATE:${day}`);
      lines.push(`DTEND;VALUE=DATE:${nextDay(d.slice(0, 10))}`);
    }
  }

  lines.push(fold(`SUMMARY:${esc(summary)}`));
  if (task.description) lines.push(fold(`DESCRIPTION:${esc(task.description)}`));

  // 提醒闹钟：定时事件到点提醒；全天事件当天 9:00 提醒（事件开始为当天 0 点，提前 15 小时）
  const trigger = isAllDay ? '-PT15H' : 'PT0S';
  lines.push(
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    fold(`DESCRIPTION:${esc(summary)} 到期提醒`),
    `TRIGGER:${trigger}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  );
  return lines.join('\r\n');
}

// 安全的 .ics 文件名（去掉文件系统非法字符）
export function safeIcsName(title: string): string {
  return title.replace(/[\x00-\x1f/\\:*?"<>|]/g, '_').trim().slice(0, 80) || 'task';
}

// 多任务合并为一个 .ics（单 VCALENDAR 内含多个 VEVENT）
// 无截止时间的任务自动跳过；返回 null 表示没有可导出的事件
export function buildTasksIcs(tasks: IcsTask[]): string | null {
  const events: string[] = [];
  for (const t of tasks) {
    const vevent = buildTaskIcs(t);
    if (!vevent) continue;
    // 提取 VEVENT...END:VEVENT 片段（含 VALARM）
    const start = vevent.indexOf('BEGIN:VEVENT');
    const end = vevent.lastIndexOf('END:VEVENT') + 'END:VEVENT'.length;
    if (start >= 0 && end > start) events.push(vevent.slice(start, end));
  }
  if (events.length === 0) return null;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AnLi Legal Platform//Tasks//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');
}
