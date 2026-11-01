/**
 * 审稿：合成前过一遍脚本。点说话人换人、改文字、删一句或加一句；编辑停顿后自动保存到草稿，
 * 关掉也能回来接着审。「开始合成」把当前草稿交给后台任务。
 */
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, AudioLines, ChevronDown, Plus, X } from "lucide-react";
import { Button, IconButton, Menu, cn, toast } from "@tau/ui";
import type { Draft, Episode, ScriptLine } from "../data/model";
import { useRuntime } from "../runtime";
import { Avatar, ICON, Legend, tone } from "./bits";

/** 按中文约每分钟 260 字估算 */
const estimate = (lines: ScriptLine[]) => {
  const chars = lines.reduce((sum, line) => sum + line.text.length, 0);
  const seconds = Math.round((chars / 260) * 60);
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
};

export function ReviewView({ episode, onBack }: { episode: Episode; onBack(): void }) {
  const { data, jobs } = useRuntime();
  const [draft, setDraft] = useState<Draft>(() => episode.draft!);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const save = (next: Draft) =>
    data.patch(episode.id, current => (current.status === "review" ? { draft: next } : null));

  useEffect(() => {
    if (!dirty.current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      dirty.current = false;
      void save(draft).catch(() => toast.error("草稿保存失败"));
    }, 600);
    return () => clearTimeout(timer.current);
  }, [draft]);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // 离开页面时把没来得及保存的修改写进草稿
  useEffect(
    () => () => {
      if (dirty.current) void save(draftRef.current);
    },
    []
  );

  const update = (change: (lines: ScriptLine[]) => ScriptLine[]) => {
    dirty.current = true;
    setDraft(current => ({ ...current, lines: change(current.lines) }));
  };

  const confirm = async () => {
    const lines = draft.lines
      .map(line => ({ ...line, text: line.text.trim() }))
      .filter(line => line.text);
    if (!lines.length) return toast.error("脚本是空的");
    clearTimeout(timer.current);
    dirty.current = false;
    try {
      await jobs.confirmReview(episode.id, { ...draft, lines });
      toast.success("开始合成，可以离开这个页面");
      onBack();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "开始合成失败");
    }
  };
  const discard = async () => {
    clearTimeout(timer.current);
    dirty.current = false;
    await jobs.discard(episode.id);
    onBack();
  };

  return (
    <div className="pc:mx-auto pc:max-w-[760px] pc:px-8 pc:pb-10">
      <div className="pc:bg-surface pc:border-line-2 pc:sticky pc:top-0 pc:z-[3] pc:mb-2.5 pc:flex pc:items-center pc:gap-2 pc:border-b pc:py-3">
        <IconButton aria-label="返回" onClick={onBack}>
          <ArrowLeft {...ICON} />
        </IconButton>
        <div className="pc:min-w-0">
          <div className="pc:truncate pc:text-[15px] pc:font-semibold">审稿 · {draft.title}</div>
          <div className="pc:text-ink-3 pc:flex pc:flex-wrap pc:items-center pc:gap-2 pc:text-[12px]">
            {draft.lines.length} 句 · 预计 {estimate(draft.lines)}
            <Legend speakers={draft.speakers} />
          </div>
        </div>
        <span className="pc:flex-1" />
        <Button size="sm" variant="ghost" onClick={() => void discard()}>
          放弃
        </Button>
        <Button size="sm" variant="primary" icon={AudioLines} onClick={() => void confirm()}>
          开始合成
        </Button>
      </div>

      {draft.lines.map((line, index) => {
        const speaker = draft.speakers[line.speaker];
        return (
          <div
            key={index}
            className="pc:group pc:hover:bg-hover pc:rounded-tau-sm pc:grid pc:grid-cols-[110px_minmax(0,1fr)_28px] pc:items-start pc:gap-2.5 pc:px-1.5 pc:py-2"
          >
            <Menu
              trigger={
                <button
                  type="button"
                  className={cn(
                    "pc:inline-flex pc:h-[26px] pc:items-center pc:gap-1.5 pc:rounded-[6px] pc:px-1.5 pc:text-[12px] pc:font-semibold",
                    tone(speaker?.tone ?? 1).text
                  )}
                >
                  {speaker && <Avatar speaker={speaker} />}
                  <span className="pc:truncate">{speaker?.name}</span>
                  {draft.speakers.length > 1 && (
                    <ChevronDown size={12} strokeWidth={1.75} className="pc:text-ink-3" />
                  )}
                </button>
              }
            >
              {draft.speakers.map((item, i) => (
                <Menu.Item
                  key={i}
                  onSelect={() =>
                    update(lines => lines.map((l, j) => (j === index ? { ...l, speaker: i } : l)))
                  }
                >
                  {item.name}
                </Menu.Item>
              ))}
            </Menu>
            <textarea
              rows={Math.max(1, Math.ceil(line.text.length / 38))}
              value={line.text}
              onChange={event => {
                const text = event.target.value;
                update(lines => lines.map((l, j) => (j === index ? { ...l, text } : l)));
              }}
              className="pc:text-ink-1 pc:focus:bg-surface pc:focus:shadow-[0_0_0_1px_var(--tau-accent),var(--tau-focus-ring)] pc:w-full pc:resize-none pc:rounded-[6px] pc:border-0 pc:bg-transparent pc:px-1.5 pc:py-px pc:leading-[1.75] pc:outline-none"
            />
            <IconButton
              aria-label="删除这句"
              className="pc:opacity-0 pc:group-hover:opacity-100"
              onClick={() => update(lines => lines.filter((_, j) => j !== index))}
            >
              <X size={14} strokeWidth={1.75} />
            </IconButton>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() =>
          update(lines => [
            ...lines,
            {
              speaker: lines.length
                ? (lines[lines.length - 1].speaker + 1) % draft.speakers.length
                : 0,
              text: "",
              start: 0,
              duration: 0,
            },
          ])
        }
        className="pc:text-ink-3 pc:hover:text-accent-text pc:flex pc:items-center pc:gap-1.5 pc:px-1.5 pc:py-2 pc:text-[12.5px]"
      >
        <Plus size={14} strokeWidth={1.75} />
        加一句
      </button>
      <div className="pc:text-ink-3 pc:px-1.5 pc:pt-1.5 pc:text-[12px]">
        点说话人换人 · 编辑自动保存，关掉也能回来接着审
      </div>
    </div>
  );
}
