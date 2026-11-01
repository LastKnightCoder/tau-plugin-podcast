/**
 * 原文详情正文上方的区块：没有播客时不占位；生成中 / 待审 / 失败显示任务状态；完成后是一条紧凑播放条。
 * 「⋯ › 生成播客」打开原文后，由这里弹出生成对话框（对话框留在宿主的界面树里，Esc 由宿主统一处理）。
 */
import { useEffect, useState } from "react";
import { ArrowUpRight, MoreHorizontal, Pause, Play, RefreshCw, Trash2 } from "lucide-react";
import type { PluginEntityPanelProps } from "@tau/plugins";
import { IconButton, Menu, Tooltip, toast } from "@tau/ui";
import { sourceKey, type PickableKind } from "../data/model";
import { useRuntime, useStore } from "../runtime";
import { ICON, Legend, Waveform, fmtTime } from "./bits";
import { GenerateDialog } from "./GenerateDialog";
import { JobStatus } from "./JobStatus";
import { usePlayback } from "./playback";
import { useEpisodeBySource } from "./queries";

export function SourcePanel({ target }: PluginEntityPanelProps) {
  const runtime = useRuntime();
  const { context, pendingDialog, pages } = runtime;
  const source = target as { kind: PickableKind; id: string };
  const key = sourceKey(source);
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

  return (
    <div className="pc:@container/podcast pc:flex pc:min-w-0 pc:w-full pc:flex-col pc:gap-2">
      {hasJob && <JobStatus episode={episode} onReview={openReview} />}
      {audio && (
        <div className="pc:border-line-1 pc:rounded-tau-md pc:flex pc:min-w-0 pc:flex-wrap pc:items-center pc:gap-x-3 pc:gap-y-2.5 pc:border pc:px-3.5 pc:py-2.5">
          {playback.element}
          <button
            type="button"
            aria-label={playback.playing ? "暂停" : "播放"}
            disabled={!playback.ready}
            onClick={playback.toggle}
            className="pc:bg-accent pc:hover:bg-accent-hover pc:text-ink-inverse pc:grid pc:size-9 pc:shrink-0 pc:place-items-center pc:rounded-full pc:disabled:opacity-50"
          >
            {playback.playing ? (
              <Pause size={16} strokeWidth={2} />
            ) : (
              <Play size={16} strokeWidth={2} />
            )}
          </button>
          <div className="pc:min-w-0 pc:flex-1 pc:@min-[560px]/podcast:w-[200px] pc:@min-[560px]/podcast:flex-none">
            <div className="pc:truncate pc:font-medium" title={episode.title}>
              {episode.title}
            </div>
            <div className="pc:text-ink-3 pc:flex pc:flex-wrap pc:items-center pc:gap-x-2 pc:gap-y-1 pc:text-[12px]">
              <span className="pc:shrink-0 pc:whitespace-nowrap pc:tabular-nums">
                {playback.playing || playback.time > 0 ? `${fmtTime(playback.time)} / ` : ""}
                {fmtTime(playback.duration || audio.duration)}
              </span>
              <Legend speakers={audio.speakers} />
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
            <Tooltip content="在播客库打开">
              <IconButton aria-label="在播客库打开" onClick={openLibrary}>
                <ArrowUpRight {...ICON} />
              </IconButton>
            </Tooltip>
            <Menu
              align="end"
              trigger={
                <IconButton aria-label="更多">
                  <MoreHorizontal {...ICON} />
                </IconButton>
              }
            >
              <Menu.Item
                icon={<RefreshCw {...ICON} />}
                disabled={hasJob}
                onSelect={() => setDialog(true)}
              >
                按原文重新生成
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item
                danger
                icon={<Trash2 {...ICON} />}
                disabled={hasJob}
                onSelect={() =>
                  void runtime.data
                    .remove(episode.id)
                    .then(() => toast.success("已删除这期播客，可在插件详情页的「最近删除」里恢复"))
                    .catch(() => toast.error("删除失败"))
                }
              >
                删除播客
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
