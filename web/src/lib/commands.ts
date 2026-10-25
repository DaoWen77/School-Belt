/**
 * 斜杠指令解析（纯函数，集中管理，Composer/Workspace 不散落正则）。
 * 严格匹配，避免把 /botany、/clearx、/rollx 等误判；未识别的 /xxx 返回 none，按普通消息发送。
 */
export type StartCommand =
  | { type: 'task' }
  | { type: 'poll' }
  | { type: 'tasks' }
  | { type: 'goto'; channelName: string }
  | { type: 'report' }
  | { type: 'ping' }
  | { type: 'sudo' }
  | { type: 'bot' }
  | { type: 'clear' }
  | { type: 'summarize' }
  | { type: 'translate' }
  | { type: 'roll'; count: number; sides: number }
  | { type: 'roll-invalid' }
  | { type: 'none' };

const TASK_RE = /^\/task$/;
const POLL_RE = /^\/poll$/;
const TASKS_RE = /^\/tasks$/;
const GOTO_RE = /^\/goto\s+(.+)$/;
const REPORT_RE = /^\/report$/;
const PING_RE = /^\/ping$/;
const SUDO_RE = /^sudo\s+rm\s+-rf\s+\/$/;
const BOT_RE = /^\/bot$/;
const CLEAR_RE = /^\/clear$/;
const SUMMARIZE_RE = /^\/summarize$/;
const TRANSLATE_RE = /^\/translate$/;
const ROLL_RE = /^\/roll\s+(\d+)d(\d+)$/;

export function parseStartCommand(input: string): StartCommand {
  const text = input.trim();
  if (TASK_RE.test(text)) return { type: 'task' };
  if (POLL_RE.test(text)) return { type: 'poll' };
  if (TASKS_RE.test(text)) return { type: 'tasks' };
  const goto = GOTO_RE.exec(text);
  if (goto?.[1]?.trim()) return { type: 'goto', channelName: goto[1].trim() };
  if (REPORT_RE.test(text)) return { type: 'report' };
  if (PING_RE.test(text)) return { type: 'ping' };
  if (SUDO_RE.test(text)) return { type: 'sudo' };
  if (BOT_RE.test(text)) return { type: 'bot' };
  if (CLEAR_RE.test(text)) return { type: 'clear' };
  if (SUMMARIZE_RE.test(text)) return { type: 'summarize' };
  if (TRANSLATE_RE.test(text)) return { type: 'translate' };
  const roll = ROLL_RE.exec(text);
  if (roll) return { type: 'roll', count: Number(roll[1]), sides: Number(roll[2]) };
  if (/^\/roll(?:\s|$)/.test(text)) return { type: 'roll-invalid' };
  return { type: 'none' };
}

/** 供 UI 提示/测试使用；顺序与解析优先级一致。 */
export const COMMAND_PATTERNS = {
  task: TASK_RE,
  poll: POLL_RE,
  tasks: TASKS_RE,
  goto: GOTO_RE,
  report: REPORT_RE,
  ping: PING_RE,
  sudo: SUDO_RE,
  bot: BOT_RE,
  clear: CLEAR_RE,
  summarize: SUMMARIZE_RE,
  translate: TRANSLATE_RE,
  roll: ROLL_RE,
} as const;
