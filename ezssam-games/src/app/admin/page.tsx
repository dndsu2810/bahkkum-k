"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getMirrorSettings,
  saveMirrorSettings,
  DEFAULT_BLOCKED,
  type MirrorSettings,
  type Student,
  type Teacher,
} from "@/lib/mirror";

// 업로드 이미지를 작게 줄여 dataURL 로 (localStorage 용량 절약)
function fileToSmallDataURL(file: File, max = 220): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("no ctx"));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

let idc = 0;
const newId = () => `${Date.now()}-${idc++}`;

export default function AdminPage() {
  const [settings, setSettings] = useState<MirrorSettings | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [tName, setTName] = useState("");
  const [tKeywords, setTKeywords] = useState("");
  const [tPhoto, setTPhoto] = useState<string | undefined>();
  const [blockedInput, setBlockedInput] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSettings(getMirrorSettings());
  }, []);

  const update = (next: MirrorSettings) => {
    setSettings(next);
    saveMirrorSettings(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  if (!settings)
    return (
      <main className="flex min-h-screen items-center justify-center text-gray-400">
        불러오는 중…
      </main>
    );

  const addStudents = () => {
    const names = nameInput
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length === 0) return;
    const added: Student[] = names.map((name) => ({ id: newId(), name }));
    update({ ...settings, students: [...settings.students, ...added] });
    setNameInput("");
  };

  const removeStudent = (id: string) =>
    update({
      ...settings,
      students: settings.students.filter((s) => s.id !== id),
    });

  const addTeacher = () => {
    if (!tName.trim()) return;
    const teacher: Teacher = {
      id: newId(),
      name: tName.trim(),
      photo: tPhoto,
      keywords: tKeywords
        .split(/[,\s]/)
        .map((k) => k.trim())
        .filter(Boolean),
    };
    update({ ...settings, teachers: [...settings.teachers, teacher] });
    setTName("");
    setTKeywords("");
    setTPhoto(undefined);
  };

  const removeTeacher = (id: string) =>
    update({
      ...settings,
      teachers: settings.teachers.filter((t) => t.id !== id),
    });

  const addBlocked = () => {
    const b = blockedInput.trim();
    if (!b) return;
    update({ ...settings, blocked: [...settings.blocked, b] });
    setBlockedInput("");
  };

  const removeBlocked = (word: string) =>
    update({
      ...settings,
      blocked: settings.blocked.filter((b) => b !== word),
    });

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-navy">마법 거울 설정</h1>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-mint">저장됨 ✓</span>}
          <Link
            href="/"
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
          >
            허브로
          </Link>
        </div>
      </div>

      {/* 학생 명단 */}
      <section className="mb-6 rounded-card bg-white p-6 shadow-card">
        <h2 className="text-lg font-bold text-navy">
          학생 명단{" "}
          <span className="text-sm font-normal text-gray-400">
            ({settings.students.length}명)
          </span>
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          이름을 쉼표나 줄바꿈으로 여러 명 한 번에 넣을 수 있어요.
          (모각공 연동 전까지 임시로 직접 등록)
        </p>
        <div className="mt-3 flex gap-2">
          <textarea
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="민준, 서연, 지호 …"
            rows={2}
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 outline-none focus:border-brand"
          />
          <button
            onClick={addStudents}
            className="rounded-xl bg-brand px-4 font-semibold text-white hover:bg-brand-dark"
          >
            추가
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {settings.students.map((s) => (
            <span
              key={s.id}
              className="flex items-center gap-1 rounded-full bg-gray-100 py-1 pl-3 pr-1 text-sm"
            >
              {s.name}
              <button
                onClick={() => removeStudent(s.id)}
                className="flex h-5 w-5 items-center justify-center rounded-full text-gray-400 hover:bg-gray-200 hover:text-gray-700"
              >
                ×
              </button>
            </span>
          ))}
          {settings.students.length === 0 && (
            <span className="text-sm text-gray-400">아직 학생이 없어요.</span>
          )}
        </div>
      </section>

      {/* 선생님 사진 */}
      <section className="mb-6 rounded-card bg-white p-6 shadow-card">
        <h2 className="text-lg font-bold text-navy">선생님 사진 + 키워드</h2>
        <p className="mt-1 text-sm text-gray-500">
          예: 이름 &quot;지현&quot;, 키워드 &quot;예쁜 최고 멋진&quot; → &quot;예쁜 쌤&quot; 하면 이 사진이
          나와요. (&quot;무서운&quot; 키워드도 등록 가능)
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-center">
          <label className="flex h-16 w-16 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-gray-300 text-xs text-gray-400">
            {tPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tPhoto} alt="" className="h-full w-full object-cover" />
            ) : (
              "사진"
            )}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setTPhoto(await fileToSmallDataURL(f));
              }}
            />
          </label>
          <input
            value={tName}
            onChange={(e) => setTName(e.target.value)}
            placeholder="선생님 이름"
            className="rounded-lg border border-gray-200 px-3 py-2 outline-none focus:border-brand"
          />
          <input
            value={tKeywords}
            onChange={(e) => setTKeywords(e.target.value)}
            placeholder="키워드 (예: 예쁜 최고)"
            className="rounded-lg border border-gray-200 px-3 py-2 outline-none focus:border-brand"
          />
          <button
            onClick={addTeacher}
            className="rounded-xl bg-brand px-4 py-2 font-semibold text-white hover:bg-brand-dark"
          >
            추가
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          {settings.teachers.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 rounded-xl bg-gray-50 p-2"
            >
              <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-brand/10 text-sm font-bold text-brand-dark">
                {t.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.photo} alt="" className="h-full w-full object-cover" />
                ) : (
                  t.name.charAt(0)
                )}
              </div>
              <div>
                <div className="text-sm font-bold">{t.name}</div>
                <div className="text-xs text-gray-400">
                  {t.keywords.join(", ") || "키워드 없음"}
                </div>
              </div>
              <button
                onClick={() => removeTeacher(t.id)}
                className="ml-1 text-gray-400 hover:text-gray-700"
              >
                ×
              </button>
            </div>
          ))}
          {settings.teachers.length === 0 && (
            <span className="text-sm text-gray-400">아직 등록된 선생님이 없어요.</span>
          )}
        </div>
      </section>

      {/* 차단 키워드 */}
      <section className="mb-6 rounded-card bg-white p-6 shadow-card">
        <h2 className="text-lg font-bold text-navy">차단 키워드 (안전장치)</h2>
        <p className="mt-1 text-sm text-gray-500">
          학생을 깎아내리는 질문은 거울이 농담으로 피해요. 항상 켜져 있어요.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            value={blockedInput}
            onChange={(e) => setBlockedInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addBlocked()}
            placeholder="차단할 표현"
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 outline-none focus:border-brand"
          />
          <button
            onClick={addBlocked}
            className="rounded-xl bg-brand px-4 font-semibold text-white hover:bg-brand-dark"
          >
            추가
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {settings.blocked.map((b) => (
            <span
              key={b}
              className="flex items-center gap-1 rounded-full bg-red-50 py-1 pl-3 pr-1 text-sm text-red-600"
            >
              {b}
              <button
                onClick={() => removeBlocked(b)}
                className="flex h-5 w-5 items-center justify-center rounded-full text-red-300 hover:bg-red-100 hover:text-red-700"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        {settings.blocked.length === 0 && (
          <button
            onClick={() => update({ ...settings, blocked: DEFAULT_BLOCKED })}
            className="mt-2 text-sm text-brand underline"
          >
            기본 차단 키워드 다시 넣기
          </button>
        )}
      </section>

      {/* 테마 */}
      <section className="mb-6 rounded-card bg-white p-6 shadow-card">
        <h2 className="text-lg font-bold text-navy">거울 테마</h2>
        <div className="mt-3 flex gap-2">
          {(["snow", "orient"] as const).map((th) => (
            <button
              key={th}
              onClick={() => update({ ...settings, theme: th })}
              className={
                "rounded-xl border px-5 py-3 font-semibold transition " +
                (settings.theme === th
                  ? "border-brand bg-brand/10 text-brand-dark"
                  : "border-gray-200 text-gray-500 hover:bg-gray-50")
              }
            >
              {th === "snow" ? "백설공주풍 (밝음)" : "동양 거울풍 (어둠)"}
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
