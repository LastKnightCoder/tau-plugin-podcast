import { Podcast } from "lucide-react";
import {
  SIDEBAR_GROUPS,
  definePlugin,
  type PluginEntityPanelProps,
  type PluginPageProps,
} from "@tau/plugins";
import { toast } from "@tau/ui";
import { EPISODE_INDEXES, EPISODE_KIND, PAGE_ID, type PickableKind } from "./data/model";
import { AI_FEATURE } from "./gen/jobs";
import { createRuntime, requestDialog, RuntimeProvider } from "./runtime";
import { LibraryPage } from "./ui/LibraryPage";
import { NotebookEpisodeView, NotebookOptions } from "./ui/NotebookOutput";
import { readForm, saveForm } from "./ui/PodcastOptions";
import { SourcePanel } from "./ui/SourcePanel";

declare const __PLUGIN_META__: { id: string; name: string; version: string };

export default definePlugin({
  ...__PLUGIN_META__,
  ai: {
    features: [
      { id: AI_FEATURE, name: "播客脚本", description: "把卡片、文章或项目文档改写成多人对话脚本" },
    ],
  },
  create: () => ({
    activate(context) {
      const runtime = createRuntime(context);
      context.entities.registerKind({
        kind: EPISODE_KIND,
        label: "播客",
        icon: Podcast,
        open: { page: PAGE_ID, params: entity => ({ episode: entity.id }) },
        indexes: EPISODE_INDEXES,
      });
      const page = context.pages.register({
        id: PAGE_ID,
        title: "播客",
        component: (props: PluginPageProps) => (
          <RuntimeProvider runtime={runtime}>
            <LibraryPage {...props} />
          </RuntimeProvider>
        ),
      });
      runtime.pages.library = page;

      const item = context.sidebar.registerItem({
        id: "podcasts",
        title: "播客",
        icon: Podcast,
        group: SIDEBAR_GROUPS.learning,
        page,
      });
      // 角标：需要用户处理或正在进行的任务数
      const refreshBadge = () =>
        void runtime.data
          .busy()
          .then(list => item.update({ badge: list.length }))
          .catch(() => undefined);
      context.events.on(
        ["entity.created", "entity.updated", "entity.deleted", "workspace.reset"],
        refreshBadge
      );
      refreshBadge();

      context.actions.register({
        id: "generate",
        title: "生成播客",
        icon: Podcast,
        targets: ["card", "article", "document"],
        run: async target => {
          const source = target as { kind: PickableKind; id: string };
          requestDialog(runtime, source);
          try {
            await context.app.open(source);
          } catch (error) {
            runtime.pendingDialog.set(null);
            toast.error(error instanceof Error ? error.message : "打不开这篇内容");
          }
        },
      });
      // Notebook：资料检索与写脚本走 Notebook 的生成流程，这里只给任务要求、拿回脚本后合成
      context.notebooks.registerOutput({
        id: "podcast",
        title: "播客",
        icon: Podcast,
        description: "把选中的资料改写成一期多人对话播客",
        kind: EPISODE_KIND,
        options: NotebookOptions,
        view: props => (
          <RuntimeProvider runtime={runtime}>
            <NotebookEpisodeView {...props} />
          </RuntimeProvider>
        ),
        prepare: async ({ notebook, userPrompt, options, signal }) => {
          const form = readForm(options);
          const plan = await runtime.jobs.prepareNotebook({
            notebook,
            options: { ...form, focus: userPrompt.trim() },
            signal,
          });
          await saveForm(context, form).catch(() => undefined);
          return { ...plan, title: "播客脚本" };
        },
        complete: ({ entity, text, task, signal }) =>
          runtime.jobs.completeNotebook(entity, text, task, signal),
        fail: ({ entity, reason, message }) => runtime.jobs.failNotebook(entity, reason, message),
      });

      context.views.registerEntityPanel({
        id: "podcast",
        kinds: ["card", "article", "document"],
        component: (props: PluginEntityPanelProps) => (
          <RuntimeProvider runtime={runtime}>
            <SourcePanel {...props} />
          </RuntimeProvider>
        ),
      });
    },
  }),
});
