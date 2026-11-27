/**
 * 单期详情：标题（点击改名）、原文卡片（打开 / 重新生成）、播放器（分色波形、±15 秒、倍速）、
 * 跟读脚本（播放中高亮并跟随）。悬停一句可「从这里播」或改这句只重合成这一句。
 * 播客库里标题到播放器固定，只有脚本在纸内滚动；嵌在 Notebook 时随宿主整页滚动。
 */
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  AudioLines,
  Download,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
} from "lucide-react";
import { useI18n, type PluginEntityDescription } from "@tau/plugins";
import { Button, IconButton, Spinner, Tooltip, cn, toast } from "@tau/ui";
import type { Episode } from "../data/model";
import { messages } from "../i18n";
import { lineAt } from "../gen/script";
import { requestDialog, useEpisodeNoticeSurface, useLive, useRuntime } from "../runtime";
import {
  Avatar,
  ICON,
  Legend,
  PinnedScroll,
  PlayGlyph,
  SOURCE_META,
  Waveform,
  audioNotice,
  fmtDate,
  fmtTime,
  playLabel,
  tone,
} from "./bits";
import { JobStatus } from "./JobStatus";
import { EpisodeMenu, RateMenu } from "./menus";
import type { Playback } from "./playback";

const DETAIL_COLUMN = "pc:min-w-0 pc:max-w-[760px] pc:px-8";

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
  const { t } = useI18n(messages);
  const runtime = useRuntime();
  const { context, data, jobs } = runtime;
  useEpisodeNoticeSurface(candidate => candidate.id === episode.id);
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
      toast.error(error instanceof Error ? error.message : t("detail.exportFailed"));
    }
  };
  const redo = async () => {
    if (!editing || !audio) return;
    const text = editing.text.trim();
    if (!text) return toast.error(t("detail.lineEmpty"));
    if (text === audio.lines[editing.index]?.text) return setEditing(null);
    const index = editing.index;
    setEditing(null);
    try {
      if (playback.playing) playback.toggle();
      await jobs.redoLine(episode.id, index, text, await playback.blob());
      toast.success(t("detail.lineRegenerated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("detail.lineRegenerateFailed"));
    }
  };

  const SourceIcon = SOURCE_META[episode.source.kind].icon;
  const busy = episode.status !== "ready" || redoing !== null;

  const head = (
    <>
      <div className="pc:flex pc:items-center pc:gap-1.5 pc:pt-5">
        {embedded ? (
          <Button size="sm" variant="ghost" icon={ArrowUpRight} onClick={onBack}>
            {t("detail.openLibrary")}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={onBack}>
            {t("detail.allEpisodes")}
          </Button>
        )}
        <span className="pc:flex-1" />
        {audio && (
          <Tooltip content={t("detail.exportAudio")}>
            <IconButton
              aria-label={t("detail.exportAudio")}
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
          aria-label={t("detail.ariaTitle")}
          onBlur={event => {
            setRenaming(false);
            void data
              .rename(episode.id, event.currentTarget.value)
              .catch(() => toast.error(t("detail.renameFailed")));
          }}
          onKeyDown={event => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className="pc:border-line-1 pc:focus:border-accent pc:mb-1.5 pc:mt-2 pc:w-full pc:rounded-[6px] pc:border pc:bg-transparent pc:px-1.5 pc:text-[22px] pc:font-semibold pc:leading-[1.35] pc:outline-none"
        />
      ) : (
        <h1
          title={t("detail.renameHint")}
          onClick={() => setRenaming(true)}
          className="pc:mb-1.5 pc:mt-2 pc:break-words pc:cursor-text pc:text-[22px] pc:font-semibold pc:leading-[1.35]"
        >
          {episode.title}
        </h1>
      )}
      <div className="pc:text-ink-3 pc:flex pc:flex-wrap pc:items-center pc:gap-x-3.5 pc:gap-y-1.5 pc:text-[12.5px]">
        {audio && <span className="pc:tabular-nums">{fmtTime(audio.duration)}</span>}
        {audio && <span>{t("detail.lineCount", { count: audio.lines.length })}</span>}
        <span>{t("detail.generatedAt", { date: fmtDate(episode.updatedAt, t) })}</span>
        {audio && <Legend speakers={audio.speakers} />}
      </div>

      {!embedded && (
        <div
          className={cn(
            "pc:rounded-tau-md pc:mt-4 pc:flex pc:min-w-0 pc:flex-wrap pc:items-center pc:gap-2.5 pc:border pc:px-3 pc:py-2.5",
            gone ? "pc:border-line-1 pc:border-dashed" : "pc:border-line-1"
          )}
        >
          <span className="pc:bg-hover pc:text-ink-2 pc:grid pc:size-[30px] pc:shrink-0 pc:place-items-center pc:rounded-[8px]">
            <SourceIcon {...ICON} />
          </span>
          <div className="pc:min-w-0 pc:flex-1 pc:basis-[180px]">
            <div className={cn("pc:truncate pc:font-medium", gone && "pc:text-ink-3")}>
              {sourceTitle || t("detail.sourceFallback")}
            </div>
            <div className="pc:text-ink-3 pc:text-[12px]">
              {gone ? t("detail.sourceDeleted") : t(SOURCE_META[episode.source.kind].key)}
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
                  {t("action.regenerate")}
                </Button>
              )}
              <Button size="sm" onClick={() => void context.app.open(episode.source)}>
                {fromNotebook ? t("action.openNotebook") : t("action.openOriginal")}
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
                aria-label={playLabel(playback, t)}
                disabled={playback.error}
                onClick={playback.toggle}
                className="pc:bg-accent pc:hover:bg-accent-hover pc:text-ink-inverse pc:grid pc:size-[46px] pc:shrink-0 pc:place-items-center pc:rounded-full pc:disabled:opacity-50"
              >
                <PlayGlyph playing={playback.playing} loading={playback.showLoading} size={20} />
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
              <Tooltip content={t("detail.back15")}>
                <IconButton
                  aria-label={t("detail.back15")}
                  onClick={() => playback.seek(playback.time - 15)}
                >
                  <RotateCcw {...ICON} />
                </IconButton>
              </Tooltip>
              <Tooltip content={t("detail.forward15")}>
                <IconButton
                  aria-label={t("detail.forward15")}
                  onClick={() => playback.seek(playback.time + 15)}
                >
                  <RotateCw {...ICON} />
                </IconButton>
              </Tooltip>
              <span className="pc:ml-1">
                <RateMenu playback={playback} />
              </span>
              <span className="pc:flex-1" />
              {audioNotice(playback, t)}
            </div>
          </div>
          <h3 className="pc:mb-2 pc:mt-[22px] pc:flex pc:items-center pc:gap-2 pc:text-[13px] pc:font-semibold">
            {t("detail.script")}
            <span className="pc:text-ink-3 pc:text-[12px] pc:font-normal">
              {t("detail.scriptFollowsHint")}
            </span>
          </h3>
        </>
      )}
    </>
  );

  const script = audio && (
    <div ref={listRef}>
      {audio.lines.map((line, index) => {
        const speaker = audio.speakers[line.speaker];
        const palette = tone(speaker?.tone ?? 1);
        const isEditing = editing?.index === index;
        return (
          <div
            key={index}
            data-line={index}
            // 跟读滚动留出渐隐带，高亮句不压在滚动区边缘的渐隐里
            className={cn(
              "pc:group pc:relative pc:-mx-2.5 pc:grid pc:scroll-my-3 pc:grid-cols-[30px_minmax(0,1fr)_auto] pc:gap-2.5 pc:rounded-tau-sm pc:px-2.5 pc:py-2",
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
                  palette.text
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
                      {t("detail.lineRegenHint")}
                    </span>
                    <span className="pc:flex-1" />
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      {t("common.cancel")}
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      icon={AudioLines}
                      onClick={() => void redo()}
                    >
                      {t("detail.regenerate")}
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
                      {t("detail.regenerating")}
                    </span>
                  )}
                </div>
              )}
            </div>
            {!isEditing && (
              <div className="pc:flex pc:gap-0.5 pc:self-start pc:opacity-0 pc:group-hover:opacity-100">
                <Tooltip content={t("detail.playFrom")}>
                  <IconButton
                    aria-label={t("detail.playFrom")}
                    disabled={!playback.ready}
                    onClick={() => {
                      playback.seek(line.start);
                      if (!playback.playing) playback.play();
                    }}
                  >
                    <Play size={14} strokeWidth={1.75} />
                  </IconButton>
                </Tooltip>
                <Tooltip content={t("detail.editLine")}>
                  <IconButton
                    aria-label={t("detail.editLine")}
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
  );

  // 嵌在 Notebook 阅读区时宿主已有滚动区，整页随宿主滚动
  if (embedded)
    return (
      <div className={cn("pc:mx-auto pc:pb-10", DETAIL_COLUMN)}>
        {head}
        {script}
      </div>
    );
  return (
    <PinnedScroll column={DETAIL_COLUMN} head={head}>
      {script}
    </PinnedScroll>
  );
}
