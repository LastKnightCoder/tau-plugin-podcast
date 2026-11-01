import { describe, expect, it } from "vitest";
import { lineAt, parseScript, retime } from "../gen/script";
import type { Speaker } from "../data/model";

const speakers: Speaker[] = [
  { name: "林舟", voiceId: "m", voiceName: "温润男声", tone: 2 },
  { name: "夏禾", voiceId: "f", voiceName: "明亮女声", tone: 5 },
];

describe("播客脚本解析", () => {
  it("取第一行标题，按说话人拆行，同一人连续发言合并，丢掉对不上的行", () => {
    const output = [
      "标题：《KV Cache 为什么快》",
      "",
      "林舟: 今天聊 KV Cache。",
      "**夏禾**：我一直以为它就是普通缓存。",
      "夏禾: 存点中间结果而已。",
      "旁白: 这一行没有对应的说话人",
      "随便一句不带冒号的话",
      "林舟：方向没错。",
    ].join("\n");
    const { title, lines } = parseScript(output, speakers);
    expect(title).toBe("KV Cache 为什么快");
    expect(lines.map(l => [l.speaker, l.text])).toEqual([
      [0, "今天聊 KV Cache。"],
      [1, "我一直以为它就是普通缓存。存点中间结果而已。"],
      [0, "方向没错。"],
    ]);
  });

  it("按每段实际时长重排起点，并能按时间找到当前句", () => {
    const { lines } = parseScript("林舟: 一\n夏禾: 二\n林舟: 三", speakers);
    const timed = retime(lines, [2.5, 4, 3]);
    expect(timed.map(l => [l.start, l.duration])).toEqual([
      [0, 2.5],
      [2.5, 4],
      [6.5, 3],
    ]);
    expect(lineAt(timed, 0)).toBe(0);
    expect(lineAt(timed, 3)).toBe(1);
    expect(lineAt(timed, 100)).toBe(2);
  });
});
