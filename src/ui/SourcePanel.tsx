/**
 * 原文详情正文上方的区块：没有播客时不占位；生成中 / 待审 / 失败显示任务状态；完成后是一条紧凑播放条。
 * 「⋯ › 生成播客」打开原文后，由这里弹出生成对话框（对话框留在宿主的界面树里，Esc 由宿主统一处理）。
 */
import { useEffect, useState } from "react";
import { ArrowUpRight, MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import type { PluginEntityPanelProps } from "@tau/plugins";
import { useI18n } from "@tau/plugins";
import { IconButton, Menu, Tooltip, cn, toast } from "@tau/ui";
import { messages } from "../i18n";
import { sourceKey, type PickableKind } from "../data/model";
import { useEpisodeNoticeSurface, useRuntime, useStore } from "../runtime";
import { ICON, Legend, PlayGlyph, Waveform, audioNotice, fmtTime, playLabel } from "./bits";
import { GenerateDialog } from "./GenerateDialog";
import { JobStatus } from "./JobStatus";
import { usePlayback } from "./playback";
import { useEpisodeBySource } from "./queries";

export function SourcePanel({ target }: PluginEntityPanelProps) {
  const { t } = useI18n(messages);
  const runtime = useRuntime();
  const { context, pendingDialog, pages } = runtime;
  const source = target as { kind: PickableKind; id: string };
  const key = sourceKey(source);
  useEpisodeNoticeSurface(episode => sourceKey(episode.source) === key);
  const query = useEpisodeBySource(source);
  const episode = query.data ?? null;
  const pending = useStore(pendingDialog);
  const [dialog, setDialog] = useState(false);
  const [sourceTitle, setSourceTitle] = useState("");

  useEffect(() => {
    if (pending !== key) return;
    pendingDialog.set(null);
    setDialog(true);
  }, [pending, key, pendingDialog]);
  useEffect(() => {
    if (!dialog) return;
    void context.app.describe([source]).then(([item]) => {
      if (item?.status === "ok") setSourceTitle(item.title);
    });
  }, [dialog, context, source.kind, source.id]);

  const playback = usePlayback(episode?.audio?.url ?? null, episode?.audio?.duration ?? 0);
  const openLibrary = () => void pages.library?.open({ episode: episode!.id });
  const openReview = () => void pages.library?.open({ episode: episode!.id, review: "1" });

  const dialogNode = (
    <GenerateDialog
      open={dialog}
      source={source}
      sourceTitle={sourceTitle || episode?.sourceTitle || ""}
      episode={episode}
      onClose={() => setDialog(false)}
    />
  );
  if (!episode) return dialogNode;

  const hasJob = episode.status !== "ready";
  const audio = episode.audio;
  const notice = audioNotice(playback, t);

  return (
    <div className="pc:@container/podcast pc:flex pc:min-w-0 pc:w-full pc:flex-col pc:gap-2">
      {hasJob && <JobStatus episode={episode} onReview={openReview} />}
      {audio && (
        <div className="pc:border-line-1 pc:rounded-tau-md pc:flex pc:min-w-0 pc:flex-wrap pc:items-center pc:gap-x-3 pc:gap-y-2.5 pc:border pc:px-3.5 pc:py-2.5">
          {playback.element}
          <button
            type="button"
            aria-label={playLabel(playback, t)}
            disabled={playback.error}
            onClick={playback.toggle}
            className="pc:bg-accent pc:hover:bg-accent-hover pc:text-ink-inverse pc:grid pc:size-9 pc:shrink-0 pc:place-items-center pc:rounded-full pc:disabled:opacity-50"
          >
            <PlayGlyph playing={playback.playing} loading={playback.showLoading} size={16} />
          </button>
          <div className="pc:min-w-0 pc:flex-1 pc:@min-[560px]/podcast:w-[200px] pc:@min-[560px]/podcast:flex-none">
            <div className="pc:truncate pc:font-medium" title={episode.title}>
              {episode.title}
            </div>
            <div className="pc:text-ink-3 pc:flex pc:flex-wrap pc:items-center pc:gap-x-2 pc:gap-y-1 pc:text-[12px]">
              <span className="pc:shrink-0 pc:whitespace-nowrap pc:tabular-nums">
                {fmtTime(playback.time)} / {fmtTime(playback.duration || audio.duration)}
              </span>
              <span className="pc:relative pc:inline-flex pc:min-w-0 pc:max-w-full">
                <span className={cn("pc:inline-flex pc:min-w-0", notice && "pc:invisible")}>
                  <Legend speakers={audio.speakers} />
                </span>
                {notice && (
                  <span role="status" className="pc:absolute pc:inset-0 pc:flex pc:items-center">
                    {notice}
                  </span>
                )}
              </span>
            </div>
          </div>
          <div className="pc:order-last pc:flex pc:min-w-0 pc:basis-full pc:@min-[560px]/podcast:order-none pc:@min-[560px]/podcast:flex-1 pc:@min-[560px]/podcast:basis-0">
            <Waveform
              small
              lines={audio.lines}
              speakers={audio.speakers}
              duration={playback.duration || audio.duration}
              progress={playback.duration ? playback.time / playback.duration : 0}
              onSeek={time => {
                playback.seek(time);
                if (!playback.playing) playback.play();
              }}
            />
          </div>
          <div className="pc:flex pc:shrink-0 pc:items-center pc:gap-1">
            <Tooltip content={t("detail.openLibrary")}>
              <IconButton aria-label={t("detail.openLibrary")} onClick={openLibrary}>
                <ArrowUpRight {...ICON} />
              </IconButton>
            </Tooltip>
            <Menu
              align="end"
              trigger={
                <IconButton aria-label={t("common.more")}>
                  <MoreHorizontal {...ICON} />
                </IconButton>
              }
            >
              <Menu.Item
                icon={<RefreshCw {...ICON} />}
                disabled={hasJob}
                onSelect={() => setDialog(true)}
              >
                {t("action.regenerate")}
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item
                danger
                icon={<Trash2 {...ICON} />}
                disabled={hasJob}
                onSelect={() =>
                  void runtime.data
                    .remove(episode.id)
                    .then(() => toast.success(t("toast.deletedSource")))
                    .catch(() => toast.error(t("toast.deleteFailed")))
                }
              >
                {t("action.deletePodcast")}
              </Menu.Item>
            </Menu>
          </div>
        </div>
      )}
      {dialogNode}
    </div>
  );
}

/** 「⋯」菜单与对话框请求只认这几类 */
export const isSourceKind = (kind: string): kind is PickableKind =>
  kind === "card" || kind === "article" || kind === "document";
