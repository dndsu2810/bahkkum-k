"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStudent, saveStudent } from "@/lib/student";
import Logo from "@/components/Logo";

export default function WelcomePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [checked, setChecked] = useState(false);

  // 이미 이름이 있으면 바로 허브로
  useEffect(() => {
    if (getStudent()) {
      router.replace("/");
    } else {
      setChecked(true);
    }
  }, [router]);

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    saveStudent(name);
    router.replace("/");
  };

  if (!checked) return null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-light/40 to-gray-50 px-4">
      <div className="w-full max-w-md rounded-card bg-white p-8 shadow-card-hover">
        <div className="flex justify-center">
          <Logo />
        </div>

        <h1 className="mt-6 text-center text-2xl font-extrabold text-navy">
          안녕! 이름을 알려줘
        </h1>
        <p className="mt-2 text-center text-sm text-gray-500">
          이름은 이 기기에만 저장돼요. 닉네임도 괜찮아요.
        </p>

        <form onSubmit={handleStart} className="mt-6">
          <input
            autoFocus
            value={name}
            maxLength={10}
            onChange={(e) => setName(e.target.value)}
            placeholder="이름 (10자 이내)"
            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-center text-lg outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          />

          <button
            type="submit"
            disabled={!name.trim()}
            className="mt-4 w-full rounded-xl bg-brand py-3.5 text-lg font-bold text-white transition hover:bg-brand-dark disabled:opacity-40"
          >
            시작!
          </button>
        </form>

        <p className="mt-5 rounded-xl bg-gray-50 px-4 py-3 text-center text-xs text-gray-500">
          게임을 누르면 카메라 권한이 필요해요. 수업용이니 안심하고 허용해 주세요.
        </p>
      </div>
    </main>
  );
}
