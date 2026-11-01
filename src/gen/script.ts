/**
 * 播客脚本：提示词与解析。模型第一行给标题，之后每行「说话人: 内容」；同一人连续发言合并成一段。
 */
import type { PluginAIMessage } from "@tau/plugins";
import type { PodcastFormat, ScriptLine, Speaker } from "../data/model";

const FORMAT_GUIDE: Record<PodcastFormat, (speakers: Speaker[]) => string> = {
  duo: ([host, guest]) =>
    `双人对谈。${host.name}是主持人，负责引导、提问、掌控节奏；${guest.name}是嘉宾，负责深入讲解、举例、回应追问。两人有来有往，像真实的电台节目。`,
  panel: ([host, ...guests]) =>
    `圆桌讨论。${host.name}是主持人，负责引出话题、点名发言、在分歧处追问；${guests.map(g => g.name).join("、")}是嘉宾，各自从不同角度表达观点，可以有分歧，但都要有依据。注意平衡每位嘉宾的发言机会。`,
  solo: ([narrator]) =>
    `单人讲述。${narrator.name}独自讲完全部内容，像有声书或单口电台：有开场、有层次、有总结，可以用设问引出下一部分。`,
};

export function buildScriptMessages(input: {
  sourceTitle: string;
  content: string;
  format: PodcastFormat;
  speakers: Speaker[];
  minutes: number;
  focus: string;
  textInstructions?: string;
}): PluginAIMessage[] {
  const { speakers, minutes } = input;
  const names = speakers.map(s => s.name).join("、");
  const system = `你是播客脚本作者。把用户给的内容改写成一期约 ${minutes} 分钟的中文播客。

形式：${FORMAT_GUIDE[input.format](speakers)}

写作要求：
- 只基于给出的内容，不补充没有依据的事实；没覆盖的细节不要脑补。
- 像在直接讲知识本身，不要出现「原文」「材料」「文中」「上文」这类说法。
- 口语化、有情绪起伏，可以用「嗯」「其实」「你看」这类语气词，但不要堆砌。
- 每次发言 50–150 字、表达完整的意思，不要把同一个人的一段话拆成多行。
- 开场简短介绍主题${speakers.length > 1 ? "和说话人" : ""}，主体覆盖内容的主要部分，结尾总结要点。
- 不写任何动作、心理或场景描述，如（笑）（停顿）（翻资料）。
${input.textInstructions ? `- 朗读规则：${input.textInstructions}\n` : ""}
输出格式（严格遵守，不输出其他任何文字、标题符号或代码块）：
第一行：标题：<这一期的标题，15 字以内，不带书名号>
之后每行：<说话人>: <内容>
说话人只能是：${names}`;
  const user = `内容标题：${input.sourceTitle || "未命名"}

---
${input.content}
---${input.focus.trim() ? `\n\n希望多聊的方向：${input.focus.trim()}` : ""}`;
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

const TITLE_PATTERN = /^\s*(?:#+\s*)?标题\s*[:：]\s*(.+)$/;
const LINE_PATTERN = /^\s*(?:[-*]\s*)?\**([^:：*]{1,20}?)\**\s*[:：]\s*(.+)$/;

/** 解析模型输出；只保留能对上说话人的行，标题缺失时为空字符串 */
export function parseScript(
  output: string,
  speakers: Speaker[]
): { title: string; lines: ScriptLine[] } {
  let title = "";
  const lines: ScriptLine[] = [];
  const index = new Map(speakers.map((s, i) => [s.name.trim(), i]));
  for (const raw of output.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const titleMatch = !title && !lines.length ? raw.match(TITLE_PATTERN) : null;
    if (titleMatch) {
      title = titleMatch[1]
        .trim()
        .replace(/^[《「"]|[》」"]$/g, "")
        .slice(0, 60);
      continue;
    }
    const match = raw.match(LINE_PATTERN);
    if (!match) continue;
    const speaker = index.get(match[1].trim());
    const text = match[2].trim();
    if (speaker === undefined || !text) continue;
    const last = lines[lines.length - 1];
    if (last && last.speaker === speaker) last.text += text;
    else lines.push({ speaker, text, start: 0, duration: 0 });
  }
  return { title, lines };
}

/** 按每段实际时长重排起点 */
export function retime(lines: ScriptLine[], durations: number[]): ScriptLine[] {
  let cursor = 0;
  return lines.map((line, i) => {
    const duration = durations[i] ?? line.duration;
    const next = { ...line, start: cursor, duration };
    cursor += duration;
    return next;
  });
}

/** 正在播放的那一句：起点不晚于当前时间的最后一句 */
export function lineAt(lines: readonly ScriptLine[], time: number) {
  let found = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].start <= time + 0.05) found = i;
    else break;
  }
  return found;
}
