import type {
  Disposable,
  PluginContext,
  PluginNotificationAction,
  PluginPageHandle,
} from "@tau/plugins";
import type { EpisodeData } from "../data/episodes";
import type { Episode } from "../data/model";

export function createEpisodeNotices(
  context: PluginContext,
  data: EpisodeData,
  libraryPage: () => PluginPageHandle | undefined
) {
  const surfaces = new Set<(episode: Episode) => boolean>();
  const pendingReviews = new Map<string, Disposable>();

  function dismissReview(id: string) {
    const notice = pendingReviews.get(id);
    pendingReviews.delete(id);
    void notice?.dispose();
  }

  context.events.on(["entity.deleted", "workspace.reset"], event => {
    if (event.type === "workspace.reset") {
      for (const id of pendingReviews.keys()) dismissReview(id);
    } else if (event.id) dismissReview(event.id);
  });

  function announce(episode: Episode, status: "review" | "ready") {
    dismissReview(episode.id);
    if (context.signal.aborted) return;
    if (
      document.visibilityState === "visible" &&
      document.hasFocus() &&
      [...surfaces].some(matches => matches(episode))
    )
      return;

    const review = status === "review";
    const action: PluginNotificationAction = {
      label: review ? "去审稿" : "打开播客",
      primary: true,
      reveal: true,
      onClick: async () => {
        const current = await data.get(episode.id);
        if (!current) throw new Error("这期播客已被删除");
        if (review && (current.status !== "review" || !current.draft))
          throw new Error("这期播客已不需要审稿");
        const page = libraryPage();
        if (!page) throw new Error("播客页暂不可用");
        await page.open({ episode: current.id, ...(review ? { review: "1" } : {}) });
      },
    };
    try {
      const title = review ? (episode.draft?.title ?? episode.title) : episode.title;
      const notice = context.notifications.send({
        title: review ? "播客脚本写好了" : "播客已生成",
        body: review ? `「${title}」等你过一遍再合成` : `「${title}」可以收听了`,
        sticky: review,
        tone: review ? "neutral" : "ok",
        actions: [action],
      });
      if (review) pendingReviews.set(episode.id, notice);
    } catch (error) {
      if (!context.signal.aborted) console.error("[播客] 发送通知失败", error);
    }
  }

  return {
    announce,
    dismissReview,
    trackSurface(matches: (episode: Episode) => boolean) {
      surfaces.add(matches);
      return () => {
        surfaces.delete(matches);
      };
    },
  };
}
