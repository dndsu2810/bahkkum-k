"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getStudent, saveStudent, type Student } from "@/lib/student";
import { games } from "@/lib/games";
import { getRecords, formatScore } from "@/lib/records";
import Header from "@/components/Header";
import GameCard from "@/components/GameCard";
import CategoryFilter from "@/components/CategoryFilter";
import MobileNotice from "@/components/MobileNotice";

const CATEGORIES = ["전체", "5학년", "6학년", "신작", "인기", "미니게임", "학습도구"];

export default function HubPage() {
  const router = useRouter();
  const [student, setStudent] = useState<Student | null>(null);
  const [ready, setReady] = useState(false);
  const [category, setCategory] = useState("전체");
  const [bestLabels, setBestLabels] = useState<Record<string, string>>({});

  // 첫 방문(이름 없음)이면 환영 화면으로. 아니면 기록도 함께 로드.
  useEffect(() => {
    const s = getStudent();
    if (!s) {
      router.replace("/welcome");
      return;
    }
    setStudent(s);

    const records = getRecords();
    const labels: Record<string, string> = {};
    for (const game of games) {
      const rec = records[game.id];
      if (rec) labels[game.id] = formatScore(game.scoreType, rec.best_score);
    }
    setBestLabels(labels);
    setReady(true);
  }, [router]);

  const filtered = useMemo(() => {
    if (category === "전체") return games;
    if (category === "5학년" || category === "6학년") {
      return games.filter((g) => g.grades.includes(category));
    }
    return games.filter((g) => g.tags.includes(category));
  }, [category]);

  if (!ready || !student) {
    return (
      <main className="flex min-h-screen items-center justify-center text-gray-400">
        불러오는 중…
      </main>
    );
  }

  return (
    <>
      <MobileNotice />
      <Header
        studentName={student.name}
        onChangeName={(name) => setStudent(saveStudent(name))}
      />

      <main className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        {/* 히어로 */}
        <section className="py-8 sm:py-10">
          <h1 className="text-2xl font-extrabold tracking-tight text-navy sm:text-3xl">
            {student.name}님, 어서 와요 👋
          </h1>
          <p className="mt-2 text-base text-gray-500">
            오늘은 어떤 수학 게임을 해볼까요?
          </p>
        </section>

        {/* 카테고리 필터 */}
        <CategoryFilter
          categories={CATEGORIES}
          active={category}
          onChange={setCategory}
        />

        {/* 게임 카드 그리드 */}
        <section className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              bestLabel={bestLabels[game.id]}
            />
          ))}
        </section>

        {filtered.length === 0 && (
          <p className="mt-12 text-center text-gray-400">
            이 카테고리에는 아직 게임이 없어요.
          </p>
        )}
      </main>

      {/* 푸터 */}
      <footer className="border-t border-gray-100 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-6 text-sm text-gray-400 sm:px-6">
          <span>ezssam — 수학을 몸으로 배우다 · 만든 사람: 지현</span>
          <a href="/admin" className="hover:text-brand">
            마법 거울 설정
          </a>
        </div>
      </footer>
    </>
  );
}
