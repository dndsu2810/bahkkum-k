"use client";

import { useState } from "react";
import Logo from "./Logo";
import NameModal from "./NameModal";

type HeaderProps = {
  studentName: string;
  onChangeName: (name: string) => void;
};

export default function Header({ studentName, onChangeName }: HeaderProps) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-gray-100 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />

          <div className="hidden text-sm font-medium text-gray-400 sm:block">
            수학을 몸으로 배우다
          </div>

          {/* 학생 이름 칩 — 클릭하면 이름 변경 */}
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 rounded-full bg-brand/10 py-1.5 pl-3 pr-3 text-sm font-semibold text-brand-dark transition hover:bg-brand/20"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">
              {studentName.charAt(0)}
            </span>
            <span className="max-w-[8rem] truncate">{studentName}</span>
          </button>
        </div>
      </header>

      {modalOpen && (
        <NameModal
          initialName={studentName}
          onSave={(name) => {
            onChangeName(name);
            setModalOpen(false);
          }}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}
