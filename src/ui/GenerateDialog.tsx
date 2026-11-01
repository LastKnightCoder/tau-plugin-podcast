/**
 * 生成对话框：只问形式、谁来说、多长；标题由 AI 起。上次的选择记在插件存储里。
 * 打开时检查脚本模型与语音服务，缺哪个就只显示对应的引导；「生成」后立即关闭，任务在后台跑。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  Check,
  ChevronDown,
  Pause,
  Play,
  Plus,
  Podcast,
  Search,
  Settings2,
  Sparkles,
  VolumeX,
  X,
} from "lucide-react";
import type { TTSSynthesisSession, TTSVoice } from "@tau/plugins";
import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  IconButton,
  Input,
  Menu,
  Popover,
  Spinner,
  cn,
  toast,
} from "@tau/ui";
import type { Episode, GenerationOptions, PodcastFormat, SourceKind, Speaker } from "../data/model";
import { AI_FEATURE } from "../gen/jobs";
import { useRuntime } from "../runtime";
import { Avatar, Avatars, ICON, SOURCE_META } from "./bits";

const OPTIONS_KEY = "lastOptions";
const MINUTES = [3, 5, 10, 15] as const;
const DEFAULT_NAMES = ["林舟", "夏禾", "陈默", "苏晴", "周野"];
const FORMATS: { key: PodcastFormat; title: string; desc: string; count: number }[] = [
  { key: "duo", title: "双人对谈", desc: "一问一答，轻松易懂", count: 2 },
  { key: "panel", title: "圆桌讨论", desc: "三人各执一词，适合有争议的话题", count: 3 },
  { key: "solo", title: "单人讲述", desc: "像有声书，一个人讲完", count: 1 },
];
const ROLE_LABEL = (format: PodcastFormat, index: number) =>
  format === "solo" ? "讲述" : index === 0 ? "主持" : "嘉宾";
const SAMPLE = "你好，这是我的声音，听起来怎么样？";

const blankSpeaker = (index: number): Speaker => ({
  name: DEFAULT_NAMES[index] ?? `说话人 ${index + 1}`,
  voiceId: "",
  voiceName: "",
  tone: [2, 5, 3, 4, 1][index] ?? 1,
});

function fitSpeakers(speakers: Speaker[], format: PodcastFormat): Speaker[] {
  const count = FORMATS.find(f => f.key === format)!.count;
  const min = format === "panel" ? 3 : count;
  const max = format === "panel" ? 5 : count;
  const next = speakers.slice(0, Math.max(min, Math.min(max, speakers.length)));
  while (next.length < min) next.push(blankSpeaker(next.length));
  return next;
}

function readSaved(value: unknown): Partial<GenerationOptions> {
  if (typeof value !== "object" || value === null) return {};
  const v = value as Record<string, unknown>;
  const format =
    v.format === "panel" || v.format === "solo" ? v.format : v.format === "duo" ? "duo" : undefined;
  const speakers = Array.isArray(v.speakers)
    ? v.speakers.flatMap((s, i) =>
        typeof s === "object" && s && typeof (s as Speaker).name === "string"
          ? [{ ...blankSpeaker(i), ...(s as Speaker) }]
          : []
      )
    : undefined;
  return {
    ...(format ? { format } : {}),
    ...(speakers?.length ? { speakers } : {}),
    ...(typeof v.minutes === "number" ? { minutes: v.minutes } : {}),
    ...(typeof v.review === "boolean" ? { review: v.review } : {}),
  };
}

type Readiness =
  | { kind: "loading" }
  | { kind: "no-model" }
  | { kind: "no-tts"; reason: string }
  | { kind: "ready"; providerName: string; voices: TTSVoice[] };

export function GenerateDialog({
  open,
  source,
  sourceTitle,
  episode,
  onClose,
}: {
  open: boolean;
  source: { kind: SourceKind; id: string };
  sourceTitle: string;
  episode?: Episode | null;
  onClose(): void;
}) {
  const { context, jobs } = useRuntime();
  const [readiness, setReadiness] = useState<Readiness>({ kind: "loading" });
  const [format, setFormat] = useState<PodcastFormat>("duo");
  const [speakers, setSpeakers] = useState<Speaker[]>(() => fitSpeakers([], "duo"));
  const [minutes, setMinutes] = useState(5);
  const [focus, setFocus] = useState("");
  const [review, setReview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const sessionRef = useRef<TTSSynthesisSession | null>(null);
  // 查询刷新会换掉 episode 对象；对话框只在打开时读一次，不因刷新重置表单
  const episodeRef = useRef(episode);
  episodeRef.current = episode;
  const episodeId = episode?.id;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setReadiness({ kind: "loading" });
    void (async () => {
      const initial = episodeRef.current;
      const saved = initial ? initial.options : readSaved(await context.storage.get(OPTIONS_KEY));
      const nextFormat = saved.format ?? "duo";
      setFormat(nextFormat);
      setSpeakers(fitSpeakers(saved.speakers ?? [], nextFormat));
      setMinutes(saved.minutes && MINUTES.includes(saved.minutes as 3) ? saved.minutes : 5);
      setReview(saved.review ?? false);
      setFocus(initial?.options.focus ?? "");
      try {
        const status = await context.ai.getStatus(AI_FEATURE);
        if (controller.signal.aborted) return;
        if (!status.configured || !status.enabled) return setReadiness({ kind: "no-model" });
        const reason = context.tts.unavailableReason();
        if (reason) return setReadiness({ kind: "no-tts", reason });
        const session = await context.tts.open({ signal: controller.signal });
        sessionRef.current = session;
        const voices = await session.getVoices({ signal: controller.signal });
        if (!controller.signal.aborted)
          setReadiness({ kind: "ready", providerName: session.providerName, voices });
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("[播客] 准备生成失败", error);
        setReadiness({
          kind: "no-tts",
          reason:
            error instanceof Error ? error.message.replace(/^[A-Z_]+：/, "") : "语音服务不可用",
        });
      }
    })();
    return () => {
      controller.abort();
      void sessionRef.current?.close();
      sessionRef.current = null;
    };
  }, [open, context, episodeId]);

  const changeFormat = (next: PodcastFormat) => {
    setFormat(next);
    setSpeakers(current => fitSpeakers(current, next));
  };
  const updateSpeaker = (index: number, patch: Partial<Speaker>) =>
    setSpeakers(current => current.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  const missingVoice = speakers.some(s => !s.voiceId);
  const duplicateName = new Set(speakers.map(s => s.name.trim())).size !== speakers.length;
  const emptyName = speakers.some(s => !s.name.trim());
  const blocker =
    readiness.kind !== "ready"
      ? undefined
      : emptyName
        ? "每位说话人都要有名字"
        : duplicateName
          ? "说话人的名字不能重复"
          : missingVoice
            ? "给每位说话人选一个音色"
            : undefined;

  const submit = async () => {
    if (blocker || readiness.kind !== "ready") return;
    const options: GenerationOptions = {
      format,
      speakers: speakers.map(s => ({ ...s, name: s.name.trim() })),
      minutes,
      focus: focus.trim(),
      review,
    };
    setSubmitting(true);
    try {
      await jobs.start({ source, sourceTitle, options });
      await context.storage.set(OPTIONS_KEY, {
        format,
        speakers: options.speakers.map(s => ({
          name: s.name,
          voiceId: s.voiceId,
          voiceName: s.voiceName,
          tone: s.tone,
        })),
        minutes,
        review,
      });
      onClose();
      toast.success("已开始生成，可以离开这个页面");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "开始生成失败");
    } finally {
      setSubmitting(false);
    }
  };

  const SourceIcon = SOURCE_META[source.kind].icon;
  const footer =
    readiness.kind === "no-model" ? (
      <>
        <Button size="sm" onClick={onClose}>
          取消
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={Settings2}
          onClick={() => context.ai.openSettings(AI_FEATURE)}
        >
          去选模型
        </Button>
      </>
    ) : readiness.kind === "no-tts" ? (
      <Button size="sm" onClick={onClose}>
        知道了
      </Button>
    ) : (
      <>
        <Button size="sm" onClick={onClose}>
          取消
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={AudioLines}
          disabled={readiness.kind !== "ready" || !!blocker}
          loading={submitting}
          onClick={() => void submit()}
        >
          {episode?.audio ? "重新生成" : "生成"}
        </Button>
      </>
    );

  return (
    <Dialog
      open={open}
      onOpenChange={next => !next && onClose()}
      title={episode?.audio ? "重新生成播客" : "生成播客"}
      icon={<Podcast size={16} strokeWidth={1.75} />}
      width={560}
      impact={
        readiness.kind === "ready" ? (blocker ?? `语音：${readiness.providerName}`) : undefined
      }
      footer={footer}
    >
      <DialogBody>
        <div className="pc:flex pc:flex-col pc:gap-4 pc:pt-1">
          <div className="pc:bg-hover pc:rounded-tau-sm pc:flex pc:items-center pc:gap-2 pc:px-2.5 pc:py-2 pc:text-[12.5px]">
            <SourceIcon {...ICON} className="pc:text-ink-3 pc:shrink-0" />
            <b className="pc:min-w-0 pc:truncate pc:font-medium">{sourceTitle || "未命名"}</b>
            <span className="pc:text-ink-3 pc:ml-auto pc:shrink-0 pc:text-[12px]">
              {SOURCE_META[source.kind].label}
            </span>
          </div>

          {readiness.kind === "loading" && (
            <div className="pc:text-ink-3 pc:flex pc:items-center pc:justify-center pc:gap-2 pc:py-10 pc:text-[12.5px]">
              <Spinner className="pc:size-3.5" />
              正在读取音色…
            </div>
          )}
          {readiness.kind === "no-model" && (
            <Notice icon={<Sparkles {...ICON} />} title="还没给「播客脚本」选模型">
              播客插件用 AI 把原文改写成对话脚本。在插件的 AI
              配置里选一个已配置的模型并开启，用量计入插件的每日额度。
            </Notice>
          )}
          {readiness.kind === "no-tts" && (
            <Notice icon={<VolumeX {...ICON} />} title="还没有可用的语音合成服务">
              {readiness.reason}。播客要把脚本念出来，需要先在插件中心装一个语音插件（如 MiniMax
              语音），再到「设置 › 语音」里选好服务。
            </Notice>
          )}

          {readiness.kind === "ready" && (
            <>
              <Field label="形式">
                <div className="pc:grid pc:grid-cols-3 pc:gap-2">
                  {FORMATS.map(item => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => changeFormat(item.key)}
                      className={cn(
                        "pc:rounded-tau-md pc:border pc:px-3 pc:py-2.5 pc:text-left",
                        format === item.key
                          ? "pc:border-accent pc:bg-accent-soft"
                          : "pc:border-line-1 pc:hover:bg-surface-hover"
                      )}
                    >
                      <div className="pc:text-[12.5px] pc:font-medium">{item.title}</div>
                      <div className="pc:text-ink-3 pc:mt-0.5 pc:text-[11.5px]">{item.desc}</div>
                      <div className="pc:mt-2">
                        <Avatars
                          speakers={fitSpeakers(format === item.key ? speakers : [], item.key)}
                        />
                      </div>
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="谁来说" hint="上次的选择会记住">
                <div>
                  {speakers.map((speaker, index) => (
                    <div
                      key={index}
                      className="pc:border-line-2 pc:grid pc:grid-cols-[28px_120px_minmax(0,1fr)_28px] pc:items-center pc:gap-2.5 pc:py-1.5 pc:[&+&]:border-t"
                    >
                      <Avatar speaker={speaker} size="md" />
                      <Input
                        size="sm"
                        value={speaker.name}
                        maxLength={12}
                        aria-label="说话人名字"
                        onChange={event => updateSpeaker(index, { name: event.target.value })}
                      />
                      <VoicePicker
                        voices={readiness.voices}
                        value={speaker.voiceId}
                        role={ROLE_LABEL(format, index)}
                        session={sessionRef.current}
                        onChange={voice =>
                          updateSpeaker(index, { voiceId: voice.id, voiceName: voice.name })
                        }
                      />
                      {format === "panel" && speakers.length > 3 ? (
                        <IconButton
                          aria-label="移除"
                          onClick={() =>
                            setSpeakers(current => current.filter((_, i) => i !== index))
                          }
                        >
                          <X {...ICON} />
                        </IconButton>
                      ) : (
                        <span />
                      )}
                    </div>
                  ))}
                  {format === "panel" && speakers.length < 5 && (
                    <button
                      type="button"
                      onClick={() =>
                        setSpeakers(current => [...current, blankSpeaker(current.length)])
                      }
                      className="pc:text-ink-3 pc:hover:text-accent-text pc:flex pc:items-center pc:gap-1.5 pc:py-2 pc:pl-[38px] pc:text-[12.5px]"
                    >
                      <Plus size={14} strokeWidth={1.75} />
                      再加一位（最多 5 位）
                    </button>
                  )}
                </div>
              </Field>

              <div className="pc:grid pc:grid-cols-[180px_minmax(0,1fr)] pc:gap-3.5">
                <Field label="时长">
                  <Menu
                    trigger={
                      <button
                        type="button"
                        className="pc:border-line-1 pc:hover:bg-surface-hover pc:rounded-tau-sm pc:flex pc:h-[30px] pc:w-full pc:items-center pc:justify-between pc:border pc:px-2.5 pc:text-[12.5px]"
                      >
                        约 {minutes} 分钟
                        <ChevronDown size={14} strokeWidth={1.75} className="pc:text-ink-3" />
                      </button>
                    }
                  >
                    {MINUTES.map(value => (
                      <Menu.Item
                        key={value}
                        onSelect={() => setMinutes(value)}
                        icon={
                          value === minutes ? (
                            <Check size={14} strokeWidth={1.75} />
                          ) : (
                            <span className="pc:inline-block pc:w-[14px]" />
                          )
                        }
                      >
                        约 {value} 分钟
                      </Menu.Item>
                    ))}
                  </Menu>
                </Field>
                <Field label="想多聊点什么" hint="选填">
                  <Input
                    size="sm"
                    value={focus}
                    maxLength={200}
                    placeholder="例如：多举例子，少讲公式"
                    onChange={event => setFocus(event.target.value)}
                  />
                </Field>
              </div>

              <Checkbox
                checked={review}
                onChange={event => setReview(event.target.checked)}
                label="脚本写好后先给我看一遍，再合成语音"
              />
            </>
          )}
        </div>
      </DialogBody>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pc:flex pc:flex-col pc:gap-1.5">
      <div className="pc:text-ink-2 pc:flex pc:items-center pc:text-[12px] pc:font-medium">
        {label}
        {hint && <span className="pc:text-ink-3 pc:ml-auto pc:font-normal">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Notice({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pc:bg-warn-soft pc:rounded-tau-md pc:flex pc:items-start pc:gap-2.5 pc:px-3.5 pc:py-3 pc:text-[12.5px]">
      <span className="pc:text-warn pc:mt-0.5">{icon}</span>
      <div>
        <b className="pc:font-semibold">{title}</b>
        <div className="pc:text-ink-2 pc:mt-0.5">{children}</div>
      </div>
    </div>
  );
}

/** 音色选择：按「我的音色 / 服务音色」分组，可搜索、可试听 */
function VoicePicker({
  voices,
  value,
  role,
  session,
  onChange,
}: {
  voices: TTSVoice[];
  value: string;
  role: string;
  session: TTSSynthesisSession | null;
  onChange(voice: TTSVoice): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [previewing, setPreviewing] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const selected = voices.find(v => v.id === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? voices.filter(v => `${v.name} ${v.description ?? ""}`.toLowerCase().includes(q))
      : voices;
  }, [voices, query]);
  const mine = filtered.filter(v => v.type !== "system");
  const system = filtered.filter(v => v.type === "system");

  useEffect(
    () => () => {
      audioRef.current?.pause();
      if (audioRef.current?.src) URL.revokeObjectURL(audioRef.current.src);
    },
    []
  );

  const preview = async (voice: TTSVoice) => {
    if (previewing === voice.id) {
      audioRef.current?.pause();
      setPreviewing(null);
      return;
    }
    if (!session) return;
    setPreviewing(voice.id);
    try {
      const audio = await session.synthesize({ text: SAMPLE, voiceId: voice.id });
      audioRef.current?.pause();
      if (audioRef.current?.src) URL.revokeObjectURL(audioRef.current.src);
      const element = new Audio(
        URL.createObjectURL(new Blob([audio.audio.slice()], { type: audio.mime }))
      );
      element.onended = () => setPreviewing(current => (current === voice.id ? null : current));
      audioRef.current = element;
      await element.play();
    } catch (error) {
      setPreviewing(null);
      toast.error(error instanceof Error ? error.message : "试听失败");
    }
  };

  const row = (voice: TTSVoice) => (
    <div
      key={voice.id}
      role="option"
      aria-selected={voice.id === value}
      onClick={() => {
        onChange(voice);
        setOpen(false);
      }}
      className={cn(
        "pc:hover:bg-hover pc:flex pc:h-[34px] pc:cursor-pointer pc:items-center pc:gap-2 pc:rounded-[6px] pc:px-2 pc:text-[12.5px]",
        voice.id === value && "pc:bg-hover"
      )}
    >
      <span className="pc:shrink-0">{voice.name}</span>
      {voice.description && (
        <span className="pc:text-ink-3 pc:min-w-0 pc:truncate pc:text-[11.5px]">
          {voice.description}
        </span>
      )}
      <span className="pc:flex-1" />
      {voice.id === value && (
        <Check size={14} strokeWidth={1.75} className="pc:text-accent-text pc:shrink-0" />
      )}
      <button
        type="button"
        aria-label={`试听${voice.name}`}
        onClick={event => {
          event.stopPropagation();
          void preview(voice);
        }}
        className={cn(
          "pc:grid pc:size-6 pc:shrink-0 pc:place-items-center pc:rounded-full pc:border",
          previewing === voice.id
            ? "pc:bg-accent pc:border-accent pc:text-ink-inverse"
            : "pc:border-line-1 pc:text-ink-2"
        )}
      >
        {previewing === voice.id ? (
          <Pause size={11} strokeWidth={2} />
        ) : (
          <Play size={11} strokeWidth={2} />
        )}
      </button>
    </div>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      arrow={false}
      className="pc:w-[320px] pc:p-1.5"
      trigger={
        <button
          type="button"
          className={cn(
            "pc:rounded-tau-sm pc:hover:bg-surface-hover pc:flex pc:h-[30px] pc:min-w-0 pc:items-center pc:gap-2 pc:border pc:pl-2.5 pc:pr-2 pc:text-left pc:text-[12.5px]",
            open ? "pc:border-accent" : "pc:border-line-1"
          )}
        >
          <span className={cn("pc:min-w-0 pc:flex-1 pc:truncate", !selected && "pc:text-ink-3")}>
            {selected?.name ?? "选择音色"}
          </span>
          <span className="pc:text-ink-3 pc:shrink-0 pc:text-[11px]">{role}</span>
          <ChevronDown size={14} strokeWidth={1.75} className="pc:text-ink-3 pc:shrink-0" />
        </button>
      }
    >
      <div role="listbox" className="pc:max-h-[320px] pc:overflow-y-auto">
        {voices.length > 8 && (
          <Input
            size="sm"
            lead={Search}
            value={query}
            placeholder="搜索音色"
            onChange={e => setQuery(e.target.value)}
            wrapperClassName="pc:mb-1"
          />
        )}
        {mine.length > 0 && (
          <div className="pc:text-ink-3 pc:px-2 pc:pb-0.5 pc:pt-1.5 pc:text-[11.5px]">我的音色</div>
        )}
        {mine.map(row)}
        {system.length > 0 && (
          <div className="pc:text-ink-3 pc:px-2 pc:pb-0.5 pc:pt-1.5 pc:text-[11.5px]">服务音色</div>
        )}
        {system.map(row)}
        {!filtered.length && (
          <div className="pc:text-ink-3 pc:px-2 pc:py-4 pc:text-center pc:text-[12px]">
            没有匹配的音色
          </div>
        )}
      </div>
      <div className="pc:border-line-2 pc:text-ink-3 pc:mt-1 pc:border-t pc:px-2 pc:pb-0.5 pc:pt-1.5 pc:text-[12px]">
        想用自己的声音？在「设置 › 语音」里克隆后会出现在这里
      </div>
    </Popover>
  );
}
