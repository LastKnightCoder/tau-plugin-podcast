/**
 * 一期播客的「⋯」菜单与倍速菜单：播客库的行、播放条与详情页共用。
 */
import { ExternalLink, MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import { IconButton, Menu, toast } from "@tau/ui";
import type { Episode } from "../data/model";
import { requestDialog, useRuntime } from "../runtime";
import { ICON } from "./bits";
import { RATES, type Playback } from "./playback";

export function EpisodeMenu({
  episode,
  gone,
  trigger,
  onDeleted,
}: {
  episode: Episode;
  gone: boolean;
  trigger: "row" | "detail";
  onDeleted?(): void;
}) {
  const runtime = useRuntime();
  const { context, data } = runtime;
  const busy = episode.status !== "ready";
  const source = episode.source;
  // Notebook 的播客要在 Notebook 里重新生成（脚本由 Notebook 的生成流程写）
  const fromNotebook = source.kind === "notebook";
  const regenerate = async () => {
    if (source.kind === "notebook") return;
    requestDialog(runtime, { kind: source.kind, id: source.id });
    await context.app.open(source);
  };
  return (
    <Menu
      align="end"
      trigger={
        <IconButton
          aria-label="更多"
          className={
            trigger === "row"
              ? "pc:opacity-0 pc:group-hover:opacity-100 pc:aria-expanded:opacity-100"
              : undefined
          }
        >
          <MoreHorizontal {...ICON} />
        </IconButton>
      }
    >
      {!gone && (
        <Menu.Item
          icon={<ExternalLink {...ICON} />}
          onSelect={() => void context.app.open(episode.source)}
        >
          {fromNotebook ? "打开 Notebook" : "打开原文"}
        </Menu.Item>
      )}
      {!gone && !fromNotebook && (
        <Menu.Item
          icon={<RefreshCw {...ICON} />}
          disabled={busy}
          onSelect={() => void regenerate()}
        >
          按原文重新生成
        </Menu.Item>
      )}
      <Menu.Separator />
      <Menu.Item
        danger
        icon={<Trash2 {...ICON} />}
        disabled={busy}
        onSelect={() =>
          void data
            .remove(episode.id)
            .then(() => {
              onDeleted?.();
              toast.success(`已删除「${episode.title}」，可在插件详情页的「最近删除」里恢复`);
            })
            .catch(() => toast.error("删除失败"))
        }
      >
        删除
      </Menu.Item>
    </Menu>
  );
}

export function RateMenu({ playback }: { playback: Playback }) {
  return (
    <Menu
      align="end"
      trigger={
        <button
          type="button"
          aria-label="播放速度"
          className="pc:border-line-1 pc:text-ink-2 pc:hover:bg-hover pc:rounded-[6px] pc:border pc:px-1.5 pc:font-mono pc:text-[11.5px] pc:tabular-nums"
        >
          {playback.rate}×
        </button>
      }
    >
      {RATES.map(rate => (
        <Menu.Item key={rate} onSelect={() => playback.setRate(rate)}>
          {rate}×{rate === playback.rate ? "（当前）" : ""}
        </Menu.Item>
      ))}
    </Menu>
  );
}
