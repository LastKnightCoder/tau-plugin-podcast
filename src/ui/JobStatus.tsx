/**
 * 一期播客的任务状态行：生成中（步骤 + 进度条）、待审稿、失败（可续）。原文面板、播客库、详情页共用。
 */
import { Check, CircleAlert, FilePenLine, LoaderCircle } from "lucide-react";
import { Button, cn, toast } from "@tau/ui";
import { isBusy, type Episode } from "../data/model";
import type { LiveProgress } from "../gen/jobs";
import { useLive, useRuntime } from "../runtime";

const run = (task: Promise<unknown>, fallback: string) =>
  task.catch(error => toast.error(error instanceof Error ? error.message : fallback));

function Steps({ episode, live }: { episode: Episode; live: LiveProgress | null }) {
  const phase = live?.phase ?? (episode.status === "script" ? "script" : "synth");
  const step = phase === "script" ? 0 : phase === "synth" ? 1 : 2;
  const items = [
    "写脚本",
    live && phase === "synth" && live.total
      ? `合成语音 ${live.done} / ${live.total} 段`
      : "合成语音",
    phase === "save" ? "保存" : "合并",
  ];
  return (
    <div className="pc:text-ink-3 pc:flex pc:flex-wrap pc:items-center pc:gap-1.5 pc:text-[12px]">
      {items.map((label, i) => (
        <span key={i} className="pc:inline-flex pc:items-center pc:gap-1.5">
          {i > 0 && <span className="pc:text-line-1">—</span>}
          <span
            className={cn(
              "pc:inline-flex pc:items-center pc:gap-1",
              i < step && "pc:text-ok",
              i === step && "pc:text-ink-1 pc:font-medium"
            )}
          >
            {i < step && <Check size={13} strokeWidth={2} />}
            {label}
          </span>
        </span>
      ))}
    </div>
  );
}

export function progressRatio(live: LiveProgress | null, episode: Episode) {
  if (!live) return episode.status === "script" ? 0.05 : 0.1;
  if (live.phase === "script") return 0.08;
  if (live.phase === "synth") return 0.1 + (live.total ? (live.done / live.total) * 0.75 : 0);
  return live.phase === "merge" ? 0.9 : 0.97;
}

/** 有任务时返回状态行，没有时返回 null */
export function JobStatus({
  episode,
  onReview,
  compact = false,
}: {
  episode: Episode;
  onReview(): void;
  compact?: boolean;
}) {
  const { jobs } = useRuntime();
  const live = useLive(episode.id);
  const title = compact ? null : (
    <div className="pc:truncate pc:font-medium">{episode.draft?.title || episode.title}</div>
  );

  if (isBusy(episode.status)) {
    return (
      <Row icon={<LoaderCircle size={16} strokeWidth={1.75} className="pc:animate-spin" />}>
        <div className="pc:min-w-0 pc:flex-1">
          {title ?? (
            <div className="pc:font-medium">{episode.audio ? "正在重新生成" : "正在生成播客"}</div>
          )}
          <Steps episode={episode} live={live} />
          <div className="pc:bg-track pc:mt-1.5 pc:h-[3px] pc:overflow-hidden pc:rounded-full">
            <i
              className="pc:bg-accent pc:block pc:h-full pc:rounded-full pc:transition-[width] pc:duration-300"
              style={{ width: `${Math.round(progressRatio(live, episode) * 100)}%` }}
            />
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void run(jobs.discard(episode.id), "取消失败")}
        >
          取消
        </Button>
      </Row>
    );
  }
  if (episode.status === "review" && episode.draft) {
    return (
      <Row icon={<FilePenLine size={16} strokeWidth={1.75} />}>
        <div className="pc:min-w-0 pc:flex-1">
          {title}
          <div className="pc:text-ink-3 pc:text-[12px]">
            脚本已写好（{episode.draft.lines.length} 句），合成前等你过一遍
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void run(jobs.discard(episode.id), "放弃失败")}
        >
          放弃
        </Button>
        <Button size="sm" variant="primary" onClick={onReview}>
          审稿
        </Button>
      </Row>
    );
  }
  if (episode.status === "failed") {
    const resumable = !!episode.draft;
    return (
      <Row danger icon={<CircleAlert size={16} strokeWidth={1.75} />}>
        <div className="pc:min-w-0 pc:flex-1">
          {title ?? <div className="pc:font-medium">播客没有生成完</div>}
          <div className="pc:text-danger pc:text-[12px]">{episode.error ?? "生成失败"}</div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void run(jobs.discard(episode.id), "放弃失败")}
        >
          放弃
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void run(jobs.resume(episode.id), "重试失败")}
        >
          {resumable ? "继续合成" : "重试"}
        </Button>
      </Row>
    );
  }
  return null;
}

function Row({
  icon,
  danger,
  children,
}: {
  icon: React.ReactNode;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "pc:rounded-tau-md pc:flex pc:items-center pc:gap-3 pc:border pc:px-3.5 pc:py-3",
        danger ? "pc:border-danger-soft" : "pc:border-line-1"
      )}
    >
      <span
        className={cn(
          "pc:grid pc:size-8 pc:shrink-0 pc:place-items-center pc:rounded-[9px]",
          danger ? "pc:bg-danger-soft pc:text-danger" : "pc:bg-accent-soft pc:text-accent-text"
        )}
      >
        {icon}
      </span>
      {children}
    </div>
  );
}
