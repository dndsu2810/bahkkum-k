"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMirrorSettings,
  parseQuery,
  type MirrorAction,
  type Student,
} from "@/lib/mirror";
import { playBeep, playCorrect } from "@/lib/sound";

type Phase = "listening" | "thinking" | "result";

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { results: { 0: { 0: { transcript: string } } } }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

function Avatar({ student, size = 96 }: { student: Student; size?: number }) {
  return (
    <div
      className="flex items-center justify-center overflow-hidden rounded-full bg-brand text-white shadow-lg"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {student.photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={student.photo} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="font-extrabold">{student.name.charAt(0)}</span>
      )}
    </div>
  );
}

export default function MagicMirror({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("listening");
  const [transcript, setTranscript] = useState("");
  const [action, setAction] = useState<MirrorAction | null>(null);
  const [spinName, setSpinName] = useState("");
  const [speechOk, setSpeechOk] = useState(true);
  const [theme, setTheme] = useState<"snow" | "orient">("snow");

  const recogRef = useRef<SpeechRecognitionLike | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spinTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef = useRef(false);

  const handleQuery = useCallback((text: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    recogRef.current?.abort();
    const settings = getMirrorSettings();
    const a = parseQuery(text, settings);
    setTranscript(text);
    setAction(a);
    setPhase("thinking");
    playBeep();

    // 두구두구 + (뽑기면) 룰렛
    const names = settings.students.map((s) => s.name);
    if ((a.kind === "pick" || a.kind === "groups") && names.length > 0) {
      spinTimerRef.current = setInterval(() => {
        setSpinName(names[Math.floor(Math.random() * names.length)]);
      }, 90);
    }

    setTimeout(() => {
      if (spinTimerRef.current) clearInterval(spinTimerRef.current);
      setPhase("result");
      playCorrect();
      closeTimerRef.current = setTimeout(onClose, 6000);
    }, 1800);
  }, [onClose]);

  useEffect(() => {
    setTheme(getMirrorSettings().theme);

    const SR =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike })
        .webkitSpeechRecognition;

    if (!SR) {
      setSpeechOk(false);
      return;
    }
    const recog = new SR();
    recog.lang = "ko-KR";
    recog.interimResults = false;
    recog.maxAlternatives = 1;
    recog.continuous = false;
    recog.onresult = (e) => {
      const t = e.results[0][0].transcript;
      handleQuery(t);
    };
    recog.onerror = () => setSpeechOk(false);
    recog.onend = () => {
      // 결과 없이 끝나면 수동 버튼 안내
      if (!doneRef.current) setSpeechOk(false);
    };
    recogRef.current = recog;
    try {
      recog.start();
    } catch {
      setSpeechOk(false);
    }

    return () => {
      recog.abort();
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (spinTimerRef.current) clearInterval(spinTimerRef.current);
    };
  }, [handleQuery]);

  const dark = theme === "orient";
  const overlay = dark ? "bg-[#0B1020]/95 text-white" : "bg-navy/90 text-white";

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center px-6 ${overlay} backdrop-blur-sm`}
    >
      <button
        onClick={onClose}
        className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-2xl hover:bg-white/25"
        aria-label="닫기"
      >
        ×
      </button>

      {/* 거울 테두리 */}
      <div className="relative w-full max-w-xl">
        <div
          className={
            "rounded-[40px] p-8 text-center " +
            (dark
              ? "bg-gradient-to-b from-slate-800 to-slate-900 ring-4 ring-amber-300/40"
              : "bg-gradient-to-b from-sky-100/20 to-white/10 ring-4 ring-white/40")
          }
        >
          {phase === "listening" && (
            <div className="py-6">
              <div className="text-5xl">🪞</div>
              <p className="mt-4 text-xl font-bold">거울아 거울아…</p>
              <p className="mt-2 text-white/70">
                {speechOk ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-block h-3 w-3 animate-ping rounded-full bg-mint" />
                    듣고 있어요. 질문해 보세요!
                  </span>
                ) : (
                  "음성 인식이 안 돼요. 아래 버튼으로 골라주세요."
                )}
              </p>

              {/* 수동/예시 버튼 (음성 안될 때 + 항상 가능) */}
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {[
                  ["한 명 뽑아줘", "한 명 뽑기"],
                  ["두 명 뽑아줘", "두 명 뽑기"],
                  ["발표할 사람", "발표자"],
                  ["모둠 네 개 만들어줘", "모둠 4개"],
                  ["예쁜 쌤", "예쁜 쌤 ✨"],
                ].map(([q, label]) => (
                  <button
                    key={label}
                    onClick={() => handleQuery(q)}
                    className="rounded-full bg-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/25"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {phase === "thinking" && (
            <div className="py-10">
              <div className="text-5xl">🪞</div>
              <p className="mt-4 animate-pulse text-2xl font-extrabold">
                두구두구두구…
              </p>
              {spinName && (
                <p className="mt-4 font-num text-3xl font-bold text-amber-300">
                  {spinName}
                </p>
              )}
            </div>
          )}

          {phase === "result" && action && (
            <div className="animate-pop-in py-6">
              <ResultView action={action} />
            </div>
          )}
        </div>

        {transcript && phase !== "listening" && (
          <p className="mt-4 text-center text-sm text-white/50">
            “{transcript}”
          </p>
        )}
      </div>
    </div>
  );
}

function ResultView({ action }: { action: MirrorAction }) {
  if (action.kind === "safety" || action.kind === "mogakgong" || action.kind === "none") {
    return (
      <div className="py-6">
        <div className="text-5xl">🪞</div>
        <p className="mt-5 text-xl font-bold">{action.message}</p>
      </div>
    );
  }

  if (action.kind === "praise") {
    return (
      <div>
        <div className="text-4xl">👑</div>
        <div className="mt-4 flex justify-center">
          {action.teacher?.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={action.teacher.photo}
              alt=""
              className="h-32 w-32 rounded-full object-cover shadow-lg ring-4 ring-amber-300"
            />
          ) : (
            <div className="flex h-32 w-32 items-center justify-center rounded-full bg-amber-300 text-5xl font-extrabold text-white shadow-lg">
              {action.teacher?.name.charAt(0) ?? "★"}
            </div>
          )}
        </div>
        <p className="mt-4 text-2xl font-extrabold text-amber-300">
          {action.teacher?.name ?? "최고의 선생님"} 쌤!
        </p>
        <p className="mt-1 text-white/80">
          {action.title}: {action.score}
        </p>
      </div>
    );
  }

  if (action.kind === "pick") {
    const single = action.students.length === 1;
    return (
      <div>
        <p className="text-white/70">{action.label}</p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-5">
          {action.students.map((s) => (
            <div key={s.id} className="flex flex-col items-center gap-2">
              <Avatar student={s} size={single ? 120 : 80} />
              <span
                className={
                  "font-extrabold " + (single ? "text-3xl" : "text-xl")
                }
              >
                {s.name}
              </span>
            </div>
          ))}
        </div>
        {single && <div className="mt-3 text-3xl">🎉👑🎉</div>}
      </div>
    );
  }

  // groups
  return (
    <div>
      <p className="text-white/70">{action.label}</p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {action.groups.map((g, i) => (
          <div key={i} className="rounded-2xl bg-white/10 p-3">
            <div className="text-sm font-bold text-amber-300">{i + 1}모둠</div>
            <div className="mt-1 space-y-0.5 text-sm">
              {g.map((s) => (
                <div key={s.id}>{s.name}</div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
