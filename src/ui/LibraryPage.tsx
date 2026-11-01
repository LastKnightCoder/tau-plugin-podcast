/**
 * 播客库：一整张纸。纸顶标题 + 搜索 + 新建；生成中 / 待审 / 失败的任务置顶；全部播客按来源类型筛选，
 * 每行露出原文、点原文跳转、点封面即播。底部迷你播放条，页面里只有这一个 <audio>。
 * 参数 episode 打开单期详情，review=1 打开审稿；参数变化由宿主栈机原位更新。
 */
import { useEffect, useMemo, useState } from "react";
import { AudioLines, Maximize2, Pause, Play, Plus, Podcast, Search, X } from "lucide-react";
import type { PluginEntityDescription, PluginPageProps } from "@tau/plugins";
import { Button, FilterPill, IconButton, Input, Loading, Tooltip, cn } from "@tau/ui";
import {
  PICKABLE_KINDS,
  SOURCE_KINDS,
  sourceKey,
  type Episode,
  type PickableKind,
  type SourceKind,
} from "../data/model";
import { requestDialog, useRuntime, useStore } from "../runtime";
import { Avatars, ICON, SOURCE_META, SourceLink, Waveform, fmtDate, fmtTime, tone } from "./bits";
import { DetailView } from "./DetailView";
import { EpisodeMenu, RateMenu } from "./menus";
import { JobStatus } from "./JobStatus";
import { usePlayback, type Playback } from "./playback";
import { useBusyEpisodes, useEpisode, useEpisodeList, useSourceStates } from "./queries";
import { ReviewView } from "./ReviewView";

const param = (value: unknown) => (typeof value === "string" && value ? value : null);
type KindFilter = "all" | SourceKind;

export function LibraryPage({ params }: PluginPageProps) {
  const runtime = useRuntime();
  const episodeId = param(params.episode);
  const reviewing = params.review === "1";
  const list = useEpisodeList();
  const busy = useBusyEpisodes();
  const detail = useEpisode(episodeId);
  const player = useStore(runtime.player);

  const loaded = useMemo(() => list.data?.pages.flatMap(page => page.items) ?? [], [list.data]);
  const states = useSourceStates(loaded);
  // 播放条：正在播放的那一期；打开详情时播放器跟着切到详情这一期
  const playingId = episodeId ?? player?.episodeId ?? null;
  const playingEpisode =
    (episodeId ? detail.data : null) ?? loaded.find(e => e.id === playingId) ?? null;
  const playback = usePlayback(
    playingEpisode?.audio?.url ?? null,
    playingEpisode?.audio?.duration ?? 0
  );

  const playEpisode = (episode: Episode) => {
    if (!episode.audio) return;
    if (playingEpisode?.id === episode.id) return playback.toggle();
    runtime.player.set({ episodeId: episode.id, seek: null, playing: true });
    playback.playWhenReady();
  };

  const open = (params: Record<string, string> | undefined) =>
    void runtime.pages.library?.open(params);

  let body: React.ReactNode;
  if (episodeId && reviewing && detail.data?.status === "review") {
    body = <ReviewView episode={detail.data} onBack={() => open({ episode: episodeId })} />;
  } else if (episodeId) {
    body = detail.isLoading ? (
      <Loading />
    ) : detail.data ? (
      <DetailView
        episode={detail.data}
        sourceState={states.data?.get(sourceKey(detail.data.source))}
        playback={playback}
        onBack={() => open(undefined)}
        onReview={() => open({ episode: episodeId, review: "1" })}
      />
    ) : (
      <div className="pc:text-ink-3 pc:grid pc:h-full pc:place-items-center pc:text-[13px]">
        这期播客已被删除
      </div>
    );
  } else {
    body = (
      <ListView
        loaded={loaded}
        list={list}
        jobs={busy.data ?? []}
        states={states.data}
        playingId={playingEpisode?.id ?? null}
        playing={playback.playing}
        onPlay={playEpisode}
        onOpen={episode => open({ episode: episode.id })}
        onReview={episode => open({ episode: episode.id, review: "1" })}
      />
    );
  }

  const showDock = !episodeId && playingEpisode?.audio;
  return (
    <div className="pc:@container/library pc:mx-auto pc:flex pc:h-full pc:min-h-0 pc:min-w-0 pc:w-full pc:max-w-[1720px] pc:flex-col pc:px-4 pc:pb-4 pc:pt-1">
      <div className="pc:bg-surface pc:shadow-card pc:rounded-tau-lg pc:flex pc:min-h-0 pc:flex-1 pc:flex-col pc:overflow-hidden">
        <div className="pc:min-h-0 pc:flex-1 pc:overflow-y-auto">{body}</div>
        {playback.element}
        {showDock && (
          <Dock
            episode={playingEpisode}
            state={states.data?.get(sourceKey(playingEpisode.source))}
            playback={playback}
            onOpen={() => open({ episode: playingEpisode.id })}
            onClose={() => {
              if (playback.playing) playback.toggle();
              runtime.player.set(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

function ListView({
  loaded,
  list,
  jobs,
  states,
  playingId,
  playing,
  onPlay,
  onOpen,
  onReview,
}: {
  loaded: Episode[];
  list: ReturnType<typeof useEpisodeList>;
  jobs: Episode[];
  states?: Map<string, PluginEntityDescription>;
  playingId: string | null;
  playing: boolean;
  onPlay(episode: Episode): void;
  onOpen(episode: Episode): void;
  onReview(episode: Episode): void;
}) {
  const runtime = useRuntime();
  const { context } = runtime;
  const [kind, setKind] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    void runtime.data.count().then(setTotal);
  }, [runtime, loaded.length]);
  // 搜索与筛选只在已加载的条目里做；还有下一页时继续加载，直到凑满或没有更多
  const q = query.trim().toLowerCase();
  const shown = loaded.filter(episode => {
    if (episode.status !== "ready" && !episode.audio) return false;
    if (kind !== "all" && episode.source.kind !== kind) return false;
    if (!q) return true;
    const state = states?.get(sourceKey(episode.source));
    const sourceTitle = state?.status === "ok" ? state.title : episode.sourceTitle;
    return `${episode.title} ${sourceTitle}`.toLowerCase().includes(q);
  });
  useEffect(() => {
    if ((q || kind !== "all") && shown.length < 20 && list.hasNextPage && !list.isFetchingNextPage)
      void list.fetchNextPage();
  }, [q, kind, shown.length, list]);

  const create = async () => {
    const [picked] = await context.app.pick({
      kinds: [...PICKABLE_KINDS],
      title: "选一篇内容生成播客",
    });
    if (!picked) return;
    requestDialog(runtime, picked.ref as { kind: PickableKind; id: string });
    await context.app.open(picked.ref);
  };

  const totalSeconds = loaded.reduce((sum, e) => sum + (e.audio?.duration ?? 0), 0);
  const head = (
    <div className="pc:flex pc:items-center pc:gap-2.5">
      <div>
        <h1 className="pc:text-tau-title-lg pc:m-0 pc:font-semibold pc:tracking-[-0.01em]">播客</h1>
        {total !== null && total > 0 && (
          <p className="pc:text-ink-3 pc:m-0 pc:mt-0.5 pc:text-[12.5px]">
            {total} 期
            {!list.hasNextPage && totalSeconds ? ` · 共 ${Math.round(totalSeconds / 60)} 分钟` : ""}
          </p>
        )}
      </div>
      <span className="pc:flex-1" />
      {loaded.length > 0 && (
        <Input
          size="sm"
          lead={Search}
          clearable
          value={query}
          placeholder="搜索标题或原文"
          onChange={event => setQuery(event.target.value)}
          wrapperClassName="pc:w-[220px]"
        />
      )}
      <Button size="sm" variant="primary" icon={Plus} onClick={() => void create()}>
        新建播客
      </Button>
    </div>
  );

  if (list.isLoading) return <Loading />;
  if (list.isError)
    return (
      <div className="pc:text-ink-3 pc:grid pc:h-full pc:place-items-center pc:text-[13px]">
        播客读取失败
      </div>
    );

  if (!loaded.length)
    return (
      <div className="pc:mx-auto pc:max-w-[920px] pc:px-8 pc:pb-10 pc:pt-6">
        {head}
        <div className="pc:px-5 pc:py-[70px] pc:text-center">
          <span className="pc:bg-accent-soft pc:text-accent-text pc:mb-3.5 pc:inline-grid pc:size-14 pc:place-items-center pc:rounded-[16px]">
            <Podcast size={26} strokeWidth={1.75} />
          </span>
          <h3 className="pc:m-0 pc:mb-1 pc:text-[15px] pc:font-semibold">还没有播客</h3>
          <p className="pc:text-ink-3 pc:mx-auto pc:mb-4 pc:mt-0 pc:max-w-[360px] pc:text-[12.5px]">
            在卡片、文章或项目文档的「⋯」菜单里选「生成播客」，把内容变成一期对话，通勤路上听。
          </p>
          <Button size="sm" variant="primary" icon={Plus} onClick={() => void create()}>
            选一篇内容生成
          </Button>
        </div>
      </div>
    );

  return (
    <div className="pc:mx-auto pc:max-w-[920px] pc:px-8 pc:pb-10 pc:pt-6">
      {head}
      {jobs.length > 0 && (
        <div className="pc:mt-4 pc:flex pc:flex-col pc:gap-2">
          {jobs.map(episode => (
            <JobStatus key={episode.id} episode={episode} onReview={() => onReview(episode)} />
          ))}
        </div>
      )}
      <div className="pc:mb-1.5 pc:mt-[18px] pc:flex pc:items-center pc:gap-1.5">
        {(["all", ...SOURCE_KINDS] as KindFilter[]).map(item => (
          <FilterPill
            key={item}
            active={kind === item}
            onClick={() => setKind(item)}
            label={item === "all" ? "全部" : SOURCE_META[item].label}
          />
        ))}
      </div>
      <div className="pc:text-ink-3 pc:grid pc:grid-cols-[44px_minmax(0,1fr)_120px_56px_84px_28px] pc:gap-3.5 pc:px-3 pc:pb-1 pc:text-[11.5px]">
        <span />
        <span>标题 · 原文</span>
        <span>说话人</span>
        <span>时长</span>
        <span>生成于</span>
        <span />
      </div>
      <div className="pc:-mx-3">
        {shown.map(episode => (
          <Row
            key={episode.id}
            episode={episode}
            state={states?.get(sourceKey(episode.source))}
            active={episode.id === playingId}
            playing={episode.id === playingId && playing}
            onPlay={() => onPlay(episode)}
            onOpen={() => onOpen(episode)}
          />
        ))}
        {!shown.length && (
          <div className="pc:text-ink-3 pc:py-10 pc:text-center pc:text-[12.5px]">
            {q ? `没有标题或原文包含「${query.trim()}」的播客` : "这一类还没有播客"}
          </div>
        )}
      </div>
      {list.hasNextPage && !q && kind === "all" && (
        <div className="pc:mt-3 pc:flex pc:justify-center">
          <Button
            size="sm"
            variant="ghost"
            loading={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            加载更多
          </Button>
        </div>
      )}
    </div>
  );
}

function Row({
  episode,
  state,
  active,
  playing,
  onPlay,
  onOpen,
}: {
  episode: Episode;
  state?: PluginEntityDescription;
  active: boolean;
  playing: boolean;
  onPlay(): void;
  onOpen(): void;
}) {
  const runtime = useRuntime();
  const audio = episode.audio!;
  const t = tone(audio.speakers[0]?.tone ?? 1);
  const gone = state?.status === "missing";
  return (
    <div
      onClick={onOpen}
      className={cn(
        "pc:group pc:rounded-tau-md pc:grid pc:cursor-pointer pc:grid-cols-[44px_minmax(0,1fr)_120px_56px_84px_28px] pc:items-center pc:gap-3.5 pc:px-3 pc:py-2.5",
        active ? "pc:bg-selected" : "pc:hover:bg-surface-hover"
      )}
    >
      <button
        type="button"
        aria-label={playing ? "暂停" : "播放"}
        onClick={event => {
          event.stopPropagation();
          onPlay();
        }}
        className={cn(
          "pc:relative pc:grid pc:size-11 pc:place-items-center pc:rounded-[11px]",
          t.soft,
          t.text
        )}
      >
        <AudioLines size={20} strokeWidth={1.75} />
        <span
          className={cn(
            "pc:bg-accent pc:text-ink-inverse pc:absolute pc:inset-0 pc:place-items-center pc:rounded-[11px]",
            active ? "pc:grid" : "pc:hidden pc:group-hover:grid"
          )}
        >
          {playing ? <Pause size={18} strokeWidth={2} /> : <Play size={18} strokeWidth={2} />}
        </span>
      </button>
      <div className="pc:min-w-0">
        <div className="pc:truncate pc:text-[13.5px] pc:font-medium">{episode.title}</div>
        <div className="pc:mt-px pc:flex pc:min-w-0 pc:items-center pc:gap-2">
          <SourceLink episode={episode} state={state} />
          {gone && <span className="pc:text-ink-3 pc:shrink-0 pc:text-[12px]">· 原文已删除</span>}
        </div>
      </div>
      <Avatars speakers={audio.speakers} />
      <span className="pc:text-ink-3 pc:text-[12px] pc:tabular-nums">
        {fmtTime(audio.duration)}
      </span>
      <span className="pc:text-ink-3 pc:text-[12px]">{fmtDate(episode.updatedAt)}</span>
      <span onClick={event => event.stopPropagation()}>
        <EpisodeMenu
          episode={episode}
          gone={gone}
          trigger="row"
          onDeleted={() =>
            runtime.player.get()?.episodeId === episode.id && runtime.player.set(null)
          }
        />
      </span>
    </div>
  );
}

function Dock({
  episode,
  state,
  playback,
  onOpen,
  onClose,
}: {
  episode: Episode;
  state?: PluginEntityDescription;
  playback: Playback;
  onOpen(): void;
  onClose(): void;
}) {
  const audio = episode.audio!;
  return (
    <div className="pc:border-line-1 pc:bg-surface pc:flex pc:min-w-0 pc:flex-none pc:flex-wrap pc:items-center pc:gap-x-3 pc:gap-y-2.5 pc:border-t pc:px-[18px] pc:py-2.5">
      <button
        type="button"
        aria-label={playback.playing ? "暂停" : "播放"}
        onClick={playback.toggle}
        className="pc:bg-accent pc:hover:bg-accent-hover pc:text-ink-inverse pc:grid pc:size-9 pc:shrink-0 pc:place-items-center pc:rounded-full"
      >
        {playback.playing ? (
          <Pause size={16} strokeWidth={2} />
        ) : (
          <Play size={16} strokeWidth={2} />
        )}
      </button>
      <div className="pc:min-w-0 pc:flex-1 pc:@min-[720px]/library:w-[220px] pc:@min-[720px]/library:flex-none">
        <div className="pc:truncate pc:font-medium">{episode.title}</div>
        <SourceLink episode={episode} state={state} />
      </div>
      <div className="pc:order-last pc:flex pc:min-w-0 pc:basis-full pc:items-center pc:gap-3 pc:@min-[720px]/library:order-none pc:@min-[720px]/library:flex-1 pc:@min-[720px]/library:basis-0">
        <span className="pc:text-ink-3 pc:shrink-0 pc:whitespace-nowrap pc:text-[11.5px] pc:tabular-nums">
          {fmtTime(playback.time)}
        </span>
        <Waveform
          small
          bars={150}
          lines={audio.lines}
          speakers={audio.speakers}
          duration={playback.duration || audio.duration}
          progress={playback.duration ? playback.time / playback.duration : 0}
          onSeek={playback.seek}
        />
        <span className="pc:text-ink-3 pc:shrink-0 pc:whitespace-nowrap pc:text-[11.5px] pc:tabular-nums">
          {fmtTime(playback.duration || audio.duration)}
        </span>
      </div>
      <div className="pc:flex pc:shrink-0 pc:items-center pc:gap-1">
        <RateMenu playback={playback} />
        <Tooltip content="打开详情">
          <IconButton aria-label="打开详情" onClick={onOpen}>
            <Maximize2 {...ICON} />
          </IconButton>
        </Tooltip>
        <Tooltip content="关闭">
          <IconButton aria-label="关闭" onClick={onClose}>
            <X {...ICON} />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  );
}
