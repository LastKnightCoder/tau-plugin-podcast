/**
 * 播客界面的小零件：说话人头像（tag 色板）、按说话人分段着色的波形、原文链接、时间格式。
 */
import { useMemo, type MouseEvent } from "react";
import { FileText, FlaskConical, FolderKanban, Layers, type LucideIcon } from "lucide-react";
import { cn, toast } from "@tau/ui";
import type { PluginEntityDescription } from "@tau/plugins";
import type { Episode, ScriptLine, SourceKind, Speaker } from "../data/model";
import { useRuntime } from "../runtime";

export const SOURCE_META: Record<SourceKind, { label: string; icon: LucideIcon }> = {
  card: { label: "卡片", icon: Layers },
  article: { label: "文章", icon: FileText },
  document: { label: "项目文档", icon: FolderKanban },
  notebook: { label: "Notebook", icon: FlaskConical },
};

/** tag 色板：文字 / 软底 / 实色，类名写全以便 Tailwind 扫描 */
export const TONE = {
  1: { text: "pc:text-tag-1", soft: "pc:bg-tag-1-soft", solid: "pc:bg-tag-1" },
  2: { text: "pc:text-tag-2", soft: "pc:bg-tag-2-soft", solid: "pc:bg-tag-2" },
  3: { text: "pc:text-tag-3", soft: "pc:bg-tag-3-soft", solid: "pc:bg-tag-3" },
  4: { text: "pc:text-tag-4", soft: "pc:bg-tag-4-soft", solid: "pc:bg-tag-4" },
  5: { text: "pc:text-tag-5", soft: "pc:bg-tag-5-soft", solid: "pc:bg-tag-5" },
} as const;
export const tone = (value: number) => TONE[Math.min(5, Math.max(1, value)) as 1 | 2 | 3 | 4 | 5];

export const ICON = { size: 15, strokeWidth: 1.75 } as const;

export function fmtTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function fmtDate(ms: number) {
  const date = new Date(ms);
  const now = new Date();
  const md = `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  return date.getFullYear() === now.getFullYear() ? md : `${date.getFullYear()} 年 ${md}`;
}

export function Avatar({ speaker, size = "sm" }: { speaker: Speaker; size?: "sm" | "md" }) {
  const t = tone(speaker.tone);
  return (
    <span
      title={speaker.voiceName ? `${speaker.name} · ${speaker.voiceName}` : speaker.name}
      className={cn(
        "pc:inline-grid pc:shrink-0 pc:place-items-center pc:rounded-full pc:font-semibold pc:shadow-[0_0_0_2px_var(--tau-bg-surface)]",
        size === "sm" ? "pc:size-[22px] pc:text-[11px]" : "pc:size-[28px] pc:text-[12.5px]",
        t.soft,
        t.text
      )}
    >
      {speaker.name.slice(0, 1)}
    </span>
  );
}

export function Avatars({ speakers }: { speakers: Speaker[] }) {
  return (
    <span className="pc:inline-flex pc:-space-x-1.5">
      {speakers.map((speaker, i) => (
        <Avatar key={i} speaker={speaker} />
      ))}
    </span>
  );
}

export function Legend({ speakers }: { speakers: Speaker[] }) {
  return (
    <span className="pc:text-ink-2 pc:inline-flex pc:min-w-0 pc:max-w-full pc:flex-wrap pc:items-center pc:gap-x-3 pc:gap-y-1 pc:text-[12px]">
      {speakers.map((speaker, i) => (
        <span
          key={i}
          className="pc:inline-flex pc:min-w-0 pc:max-w-full pc:items-center pc:gap-1.5"
        >
          <i className={cn("pc:size-2 pc:shrink-0 pc:rounded-full", tone(speaker.tone).solid)} />
          <span className="pc:truncate" title={speaker.name}>
            {speaker.name}
          </span>
        </span>
      ))}
    </span>
  );
}

/** 波形：柱高是装饰性的稳定伪随机，颜色按该时刻的说话人；进度前的柱子实色 */
export function Waveform({
  lines,
  speakers,
  duration,
  progress,
  bars = 120,
  small = false,
  onSeek,
}: {
  lines: readonly ScriptLine[];
  speakers: readonly Speaker[];
  duration: number;
  progress: number;
  bars?: number;
  small?: boolean;
  onSeek?: (time: number) => void;
}) {
  const shape = useMemo(() => {
    const out: { height: number; tone: number }[] = [];
    let lineIndex = 0;
    for (let i = 0; i < bars; i++) {
      const t = (i / bars) * duration;
      while (lineIndex + 1 < lines.length && lines[lineIndex + 1].start <= t) lineIndex++;
      const speaker = speakers[lines[lineIndex]?.speaker ?? 0];
      out.push({
        height: Math.min(100, 22 + Math.abs(Math.sin(i * 1.7) * 48 + Math.sin(i * 0.37) * 26)),
        tone: speaker?.tone ?? 1,
      });
    }
    return out;
  }, [lines, speakers, duration, bars]);
  const barSpacing = small ? 3.5 : 4;
  const seek = (event: MouseEvent<HTMLDivElement>) => {
    if (!onSeek || !duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek(((event.clientX - rect.left) / rect.width) * duration);
  };
  return (
    <div
      onClick={seek}
      className={cn(
        "pc:relative pc:min-w-0 pc:flex-1",
        small ? "pc:h-[22px]" : "pc:h-[34px]",
        onSeek && "pc:cursor-pointer"
      )}
    >
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${bars * barSpacing - (barSpacing - 2)} 100`}
        preserveAspectRatio="none"
        className="pc:absolute pc:inset-0 pc:h-full pc:w-full"
      >
        {shape.map((bar, i) => (
          <rect
            key={i}
            x={i * barSpacing}
            y={(100 - bar.height) / 2}
            width={2}
            height={bar.height}
            rx={1}
            fill="currentColor"
            className={cn(
              tone(bar.tone).text,
              i / bars < progress ? "pc:opacity-100" : "pc:opacity-30"
            )}
          />
        ))}
      </svg>
    </div>
  );
}

/** 原文链接：点击打开原文；已删除时显示删除线、不可点 */
export function SourceLink({
  episode,
  state,
  withKind = false,
  className,
}: {
  episode: Episode;
  state?: PluginEntityDescription;
  withKind?: boolean;
  className?: string;
}) {
  const { context } = useRuntime();
  const meta = SOURCE_META[episode.source.kind];
  const Icon = meta.icon;
  const gone = state?.status === "missing";
  const title = (state?.status === "ok" && state.title) || episode.sourceTitle || meta.label;
  const label = withKind ? `${meta.label} · ${title}` : title;
  if (gone)
    return (
      <span
        title="原文已删除"
        className={cn(
          "pc:text-ink-3 pc:inline-flex pc:min-w-0 pc:max-w-full pc:items-center pc:gap-[5px] pc:text-[12px] pc:line-through",
          className
        )}
      >
        <Icon size={13} strokeWidth={1.75} className="pc:shrink-0" />
        <span className="pc:truncate">{label}</span>
      </span>
    );
  return (
    <button
      type="button"
      title="打开原文"
      onClick={event => {
        event.stopPropagation();
        context.app.open(episode.source).catch(error => {
          console.error(error);
          toast.error("原文打不开，可能已被删除");
        });
      }}
      className={cn(
        "pc:text-ink-2 pc:hover:text-accent-text pc:group pc:inline-flex pc:min-w-0 pc:max-w-full pc:items-center pc:gap-[5px] pc:text-left pc:text-[12px]",
        className
      )}
    >
      <Icon
        size={13}
        strokeWidth={1.75}
        className="pc:text-ink-3 pc:group-hover:text-accent-text pc:shrink-0"
      />
      <span className="pc:truncate">{label}</span>
    </button>
  );
}
