/**
 * 播客选项：形式、谁来说（名字 + 音色，可试听）、时长、是否先审稿。卡片入口的生成对话框与
 * Notebook 输出的选项区共用；上次的选择记在插件存储里。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Pause, Play, Plus, Search, VolumeX, X } from "lucide-react";
import type { PluginContext, TTSSynthesisSession, TTSVoice } from "@tau/plugins";
import { Checkbox, IconButton, Input, Menu, Popover, Spinner, cn, toast } from "@tau/ui";
import type { GenerationOptions, PodcastFormat, Speaker } from "../data/model";
import { Avatar, Avatars, ICON } from "./bits";

export const OPTIONS_KEY = "lastOptions";
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

/** 选项区编辑的部分（focus 由各入口自己处理） */
export type PodcastForm = Omit<GenerationOptions, "focus">;

/** 存储里的上次选择 → 完整的表单；字段不合规的用默认值 */
export function readForm(value: unknown): PodcastForm {
  const v = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const format: PodcastFormat = v.format === "panel" || v.format === "solo" ? v.format : "duo";
  const speakers = Array.isArray(v.speakers)
    ? v.speakers.flatMap((s, i) =>
        typeof s === "object" && s && typeof (s as Speaker).name === "string"
          ? [{ ...blankSpeaker(i), ...(s as Speaker) }]
          : []
      )
    : [];
  return {
    format,
    speakers: fitSpeakers(speakers, format),
    minutes: typeof v.minutes === "number" && MINUTES.includes(v.minutes as 3) ? v.minutes : 5,
    review: v.review === true,
  };
}

export const saveForm = (context: PluginContext, form: PodcastForm) =>
  context.storage.set(OPTIONS_KEY, {
    format: form.format,
    speakers: form.speakers.map(s => ({
      name: s.name.trim(),
      voiceId: s.voiceId,
      voiceName: s.voiceName,
      tone: s.tone,
    })),
    minutes: form.minutes,
    review: form.review,
  });

/** 表单不能提交的原因；可以提交时为 null */
export function formBlocker(form: PodcastForm): string | null {
  if (form.speakers.some(s => !s.name.trim())) return "每位说话人都要有名字";
  if (new Set(form.speakers.map(s => s.name.trim())).size !== form.speakers.length)
    return "说话人的名字不能重复";
  if (form.speakers.some(s => !s.voiceId)) return "给每位说话人选一个音色";
  return null;
}

export const trimForm = (form: PodcastForm): PodcastForm => ({
  ...form,
  speakers: form.speakers.map(s => ({ ...s, name: s.name.trim() })),
});

export type VoiceState =
  | { kind: "loading" }
  | { kind: "no-tts"; reason: string }
  | { kind: "ready"; providerName: string; voices: TTSVoice[]; session: TTSSynthesisSession };

/** 打开语音会话读音色（试听也用它）；卸载或 enabled 变假时关闭 */
export function useVoices(context: PluginContext, enabled: boolean): VoiceState {
  const [state, setState] = useState<VoiceState>({ kind: "loading" });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let session: TTSSynthesisSession | null = null;
    setState({ kind: "loading" });
    void (async () => {
      try {
        const reason = context.tts.unavailableReason();
        if (reason) return setState({ kind: "no-tts", reason });
        session = await context.tts.open({ signal: controller.signal });
        const voices = await session.getVoices({ signal: controller.signal });
        if (!controller.signal.aborted)
          setState({ kind: "ready", providerName: session.providerName, voices, session });
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("[播客] 读取音色失败", error);
        setState({
          kind: "no-tts",
          reason:
            error instanceof Error ? error.message.replace(/^[A-Z_]+：/, "") : "语音服务不可用",
        });
      }
    })();
    return () => {
      controller.abort();
      void session?.close();
    };
  }, [context, enabled]);
  return state;
}

export function NoTTSNotice({ reason }: { reason: string }) {
  return (
    <Notice icon={<VolumeX {...ICON} />} title="还没有可用的语音合成服务">
      {reason}。播客要把脚本念出来，需要先在插件中心装一个语音插件（如 MiniMax 语音），再到「设置 ›
      语音」里选好服务。
    </Notice>
  );
}

export function VoicesLoading() {
  return (
    <div className="pc:text-ink-3 pc:flex pc:items-center pc:justify-center pc:gap-2 pc:py-10 pc:text-[12.5px]">
      <Spinner className="pc:size-3.5" />
      正在读取音色…
    </div>
  );
}

/** 形式 / 谁来说 / 时长 / 审稿；extra 放在时长右边（卡片入口的「想多聊点什么」） */
export function PodcastOptionsForm({
  form,
  onChange,
  voices,
  extra,
}: {
  form: PodcastForm;
  onChange(form: PodcastForm): void;
  voices: Extract<VoiceState, { kind: "ready" }>;
  extra?: React.ReactNode;
}) {
  const { format, speakers, minutes, review } = form;
  const changeFormat = (next: PodcastFormat) =>
    onChange({ ...form, format: next, speakers: fitSpeakers(speakers, next) });
  const setSpeakers = (next: Speaker[]) => onChange({ ...form, speakers: next });
  const updateSpeaker = (index: number, patch: Partial<Speaker>) =>
    setSpeakers(speakers.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  return (
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
                <Avatars speakers={fitSpeakers(format === item.key ? speakers : [], item.key)} />
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
                voices={voices.voices}
                value={speaker.voiceId}
                role={ROLE_LABEL(format, index)}
                session={voices.session}
                onChange={voice =>
                  updateSpeaker(index, { voiceId: voice.id, voiceName: voice.name })
                }
              />
              {format === "panel" && speakers.length > 3 ? (
                <IconButton
                  aria-label="移除"
                  onClick={() => setSpeakers(speakers.filter((_, i) => i !== index))}
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
              onClick={() => setSpeakers([...speakers, blankSpeaker(speakers.length)])}
              className="pc:text-ink-3 pc:hover:text-accent-text pc:flex pc:items-center pc:gap-1.5 pc:py-2 pc:pl-[38px] pc:text-[12.5px]"
            >
              <Plus size={14} strokeWidth={1.75} />
              再加一位（最多 5 位）
            </button>
          )}
        </div>
      </Field>

      <div
        className={cn(
          "pc:grid pc:gap-3.5",
          extra ? "pc:grid-cols-[180px_minmax(0,1fr)]" : "pc:grid-cols-[180px]"
        )}
      >
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
                onSelect={() => onChange({ ...form, minutes: value })}
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
        {extra}
      </div>

      <Checkbox
        checked={review}
        onChange={event => onChange({ ...form, review: event.target.checked })}
        label="脚本写好后先给我看一遍，再合成语音"
      />
    </>
  );
}

export function Field({
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

export function Notice({
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
