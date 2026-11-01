/**
 * 单期详情：标题（点击改名）、原文卡片（打开 / 重新生成）、播放器（分色波形、±15 秒、倍速）、
 * 跟读脚本（播放中高亮并跟随）。悬停一句可「从这里播」或改这句只重合成这一句。
 */
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  AudioLines,
  Download,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
} from "lucide-react";
import type { PluginEntityDescription } from "@tau/plugins";
import { Button, IconButton, Spinner, Tooltip, cn, toast } from "@tau/ui";
import type { Episode } from "../data/model";
import { lineAt } from "../gen/script";
import { requestDialog, useLive, useRuntime } from "../runtime";
import { Avatar, ICON, Legend, SOURCE_META, Waveform, fmtDate, fmtTime, tone } from "./bits";
import { JobStatus } from "./JobStatus";
import { EpisodeMenu, RateMenu } from "./menus";
import type { Playback } from "./playback";

export function DetailView({
  episode,
  sourceState,
  playback,
  onBack,
  onReview,
  embedded = false,
}: {
  episode: Episode;
  sourceState?: PluginEntityDescription;
  playback: Playback;
  onBack(): void;
  onReview(): void;
  /** 嵌在 Notebook 阅读区：不显示「全部播客」与来源卡片，onBack 打开播客库 */
  embedded?: boolean;
}) {
  const runtime = useRuntime();
  const { context, data, jobs } = runtime;
  const live = useLive(episode.id);
  const audio = episode.audio;
  const gone = sourceState?.status === "missing";
  const sourceTitle = (sourceState?.status === "ok" && sourceState.title) || episode.sourceTitle;
  const [renaming, setRenaming] = useState(false);
  const [editing, setEditing] = useState<{ index: number; text: string } | null>(null);
  const redoing = live?.phase === "line" ? live.done : null;
  const current =
    audio && (playback.playing || playback.time > 0) ? lineAt(audio.lines, playback.time) : -1;
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!playback.playing || current < 0) return;
    listRef.current
      ?.querySelector(`[data-line="${current}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [current, playback.playing]);

  const source = episode.source;
  const fromNotebook = source.kind === "notebook";
  const regenerate = async () => {
    if (source.kind === "notebook") return;
    requestDialog(runtime, { kind: source.kind, id: source.id });
    await context.app.open(source);
  };
  const download = async () => {
    try {
      const blob = await playback.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${episode.title}.mp3`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导出失败");
    }
  };
  const redo = async () => {
    if (!editing || !audio) return;
    const text = editing.text.trim();
    if (!text) return toast.error("这一句不能为空");
    if (text === audio.lines[editing.index]?.text) return setEditing(null);
    const index = editing.index;
    setEditing(null);
    try {
      if (playback.playing) playback.toggle();
      await jobs.redoLine(episode.id, index, text, await playback.blob());
      toast.success("这一句已重新合成");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重新合成失败");
    }
  };

  const SourceIcon = SOURCE_META[episode.source.kind].icon;
  const busy = episode.status !== "ready" || redoing !== null;

  return (
    <div className="pc:mx-auto pc:max-w-[760px] pc:px-8 pc:pb-10 pc:pt-5">
      <div className="pc:flex pc:items-center pc:gap-1.5">
        {embedded ? (
          <Button size="sm" variant="ghost" icon={ArrowUpRight} onClick={onBack}>
            在播客库打开
          </Button>
        ) : (
          <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={onBack}>
            全部播客
          </Button>
        )}
        <span className="pc:flex-1" />
        {audio && (
          <Tooltip content="导出音频">
            <IconButton
              aria-label="导出音频"
              disabled={!playback.ready}
              onClick={() => void download()}
            >
              <Download {...ICON} />
            </IconButton>
          </Tooltip>
        )}
        <EpisodeMenu episode={episode} gone={gone} trigger="detail" onDeleted={onBack} />
      </div>

      {renaming ? (
        <input
          autoFocus
          defaultValue={episode.title}
          maxLength={100}
          aria-label="播客标题"
          onBlur={event => {
            setRenaming(false);
            void data
              .rename(episode.id, event.currentTarget.value)
              .catch(() => toast.error("改名失败"));
          }}
          onKeyDown={event => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className="pc:border-line-1 pc:focus:border-accent pc:mb-1.5 pc:mt-2 pc:w-full pc:rounded-[6px] pc:border pc:bg-transparent pc:px-1.5 pc:text-[22px] pc:font-semibold pc:leading-[1.35] pc:outline-none"
        />
      ) : (
        <h1
          title="点击改名"
          onClick={() => setRenaming(true)}
          className="pc:mb-1.5 pc:mt-2 pc:cursor-text pc:text-[22px] pc:font-semibold pc:leading-[1.35]"
        >
          {episode.title}
        </h1>
      )}
      <div className="pc:text-ink-3 pc:flex pc:flex-wrap pc:items-center pc:gap-x-3.5 pc:gap-y-1.5 pc:text-[12.5px]">
        {audio && <span className="pc:tabular-nums">{fmtTime(audio.duration)}</span>}
        {audio && <span>{audio.lines.length} 句</span>}
        <span>{fmtDate(episode.updatedAt)}生成</span>
        {audio && <Legend speakers={audio.speakers} />}
      </div>

      {!embedded && (
        <div
          className={cn(
            "pc:rounded-tau-md pc:mt-4 pc:flex pc:items-center pc:gap-2.5 pc:border pc:px-3 pc:py-2.5",
            gone ? "pc:border-line-1 pc:border-dashed" : "pc:border-line-1"
          )}
        >
          <span className="pc:bg-hover pc:text-ink-2 pc:grid pc:size-[30px] pc:shrink-0 pc:place-items-center pc:rounded-[8px]">
            <SourceIcon {...ICON} />
          </span>
          <div className="pc:min-w-0 pc:flex-1">
            <div className={cn("pc:truncate pc:font-medium", gone && "pc:text-ink-3")}>
              {sourceTitle || "原文"}
            </div>
            <div className="pc:text-ink-3 pc:text-[12px]">
              {gone ? "原文已删除，这期播客还能继续听" : SOURCE_META[episode.source.kind].label}
            </div>
          </div>
          {!gone && (
            <>
              {!fromNotebook && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={RefreshCw}
                  disabled={busy}
                  onClick={() => void regenerate()}
                >
                  按原文重新生成
                </Button>
              )}
              <Button size="sm" onClick={() => void context.app.open(episode.source)}>
                {fromNotebook ? "打开 Notebook" : "打开原文"}
                <ArrowUpRight size={14} strokeWidth={1.75} />
              </Button>
            </>
          )}
        </div>
      )}

      {episode.status !== "ready" && (
        <div className="pc:mt-3">
          <JobStatus compact episode={episode} onReview={onReview} />
        </div>
      )}

      {audio && (
        <>
          <div className="pc:bg-surface pc:shadow-lift pc:rounded-tau-md pc:mt-3.5 pc:px-4 pc:pb-3 pc:pt-3.5">
            <div className="pc:flex pc:items-center pc:gap-3.5">
              <button
                type="button"
                aria-label={playback.playing ? "暂停" : "播放"}
                disabled={!playback.ready}
                onClick={playback.toggle}
                className="pc:bg-accent pc:hover:bg-accent-hover pc:text-ink-inverse pc:grid pc:size-[46px] pc:shrink-0 pc:place-items-center pc:rounded-full pc:disabled:opacity-50"
              >
                {playback.playing ? (
                  <Pause size={20} strokeWidth={2} />
                ) : (
                  <Play size={20} strokeWidth={2} />
                )}
              </button>
              <span className="pc:text-ink-3 pc:min-w-[34px] pc:text-[11.5px] pc:tabular-nums">
                {fmtTime(playback.time)}
              </span>
              <Waveform
                bars={110}
                lines={audio.lines}
                speakers={audio.speakers}
                duration={playback.duration || audio.duration}
                progress={playback.duration ? playback.time / playback.duration : 0}
                onSeek={playback.seek}
              />
              <span className="pc:text-ink-3 pc:min-w-[34px] pc:text-[11.5px] pc:tabular-nums">
                {fmtTime(playback.duration || audio.duration)}
              </span>
            </div>
            <div className="pc:mt-2 pc:flex pc:items-center pc:gap-1">
              <Tooltip content="后退 15 秒">
                <IconButton
                  aria-label="后退 15 秒"
                  onClick={() => playback.seek(playback.time - 15)}
                >
                  <RotateCcw {...ICON} />
                </IconButton>
              </Tooltip>
              <Tooltip content="前进 15 秒">
                <IconButton
                  aria-label="前进 15 秒"
                  onClick={() => playback.seek(playback.time + 15)}
                >
                  <RotateCw {...ICON} />
                </IconButton>
              </Tooltip>
              <span className="pc:ml-1">
                <RateMenu playback={playback} />
              </span>
              <span className="pc:flex-1" />
              {playback.error && (
                <span className="pc:text-danger pc:text-[12px]">音频加载失败</span>
              )}
            </div>
          </div>

          <div className="pc:mt-[22px]" ref={listRef}>
            <h3 className="pc:mb-2 pc:mt-0 pc:flex pc:items-center pc:gap-2 pc:text-[13px] pc:font-semibold">
              脚本<span className="pc:text-ink-3 pc:text-[12px] pc:font-normal">跟随播放高亮</span>
            </h3>
            {audio.lines.map((line, index) => {
              const speaker = audio.speakers[line.speaker];
              const t = tone(speaker?.tone ?? 1);
              const isEditing = editing?.index === index;
              return (
                <div
                  key={index}
                  data-line={index}
                  className={cn(
                    "pc:group pc:relative pc:-mx-2.5 pc:grid pc:grid-cols-[30px_minmax(0,1fr)_auto] pc:gap-2.5 pc:rounded-tau-sm pc:px-2.5 pc:py-2",
                    isEditing
                      ? "pc:bg-surface pc:shadow-[0_0_0_1px_var(--tau-accent),var(--tau-focus-ring)]"
                      : index === current
                        ? "pc:bg-accent-soft"
                        : "pc:hover:bg-hover"
                  )}
                >
                  {speaker && <Avatar speaker={speaker} size="md" />}
                  <div className="pc:min-w-0">
                    <div
                      className={cn(
                        "pc:flex pc:items-baseline pc:gap-2 pc:text-[12px] pc:font-semibold",
                        t.text
                      )}
                    >
                      {speaker?.name}
                      <span className="pc:text-ink-3 pc:font-mono pc:text-[11.5px] pc:font-normal pc:tabular-nums">
                        {fmtTime(line.start)}
                      </span>
                    </div>
                    {isEditing ? (
                      <>
                        <textarea
                          autoFocus
                          rows={3}
                          value={editing.text}
                          onChange={event => setEditing({ index, text: event.target.value })}
                          className="pc:text-ink-1 pc:w-full pc:resize-none pc:border-0 pc:bg-transparent pc:p-0 pc:leading-[1.7] pc:outline-none"
                        />
                        <div className="pc:mt-1.5 pc:flex pc:items-center pc:gap-1.5">
                          <span className="pc:text-ink-3 pc:text-[12px]">
                            只重新合成这一句，其余不动；时间轴自动顺延
                          </span>
                          <span className="pc:flex-1" />
                          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                            取消
                          </Button>
                          <Button
                            size="sm"
                            variant="primary"
                            icon={AudioLines}
                            onClick={() => void redo()}
                          >
                            重新合成
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div
                        className={cn(
                          "pc:leading-[1.7]",
                          redoing === index
                            ? "pc:text-ink-3"
                            : current >= 0 && index < current
                              ? "pc:text-ink-2"
                              : "pc:text-ink-1"
                        )}
                      >
                        {line.text}
                        {redoing === index && (
                          <span className="pc:text-ink-3 pc:ml-2 pc:inline-flex pc:items-center pc:gap-1 pc:text-[12px]">
                            <Spinner className="pc:size-3" />
                            正在重新合成
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {!isEditing && (
                    <div className="pc:flex pc:gap-0.5 pc:self-start pc:opacity-0 pc:group-hover:opacity-100">
                      <Tooltip content="从这里播">
                        <IconButton
                          aria-label="从这里播"
                          disabled={!playback.ready}
                          onClick={() => {
                            playback.seek(line.start);
                            if (!playback.playing) playback.play();
                          }}
                        >
                          <Play size={14} strokeWidth={1.75} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip content="改这句并重新合成">
                        <IconButton
                          aria-label="改这句并重新合成"
                          disabled={busy || !playback.ready}
                          onClick={() => setEditing({ index, text: line.text })}
                        >
                          <Pencil size={14} strokeWidth={1.75} />
                        </IconButton>
                      </Tooltip>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
