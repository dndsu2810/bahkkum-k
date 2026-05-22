"use client";

import { useEffect, useRef, useState } from "react";

type NameModalProps = {
  initialName: string;
  onSave: (name: string) => void;
  onClose: () => void;
};

export default function NameModal({
  initialName,
  onSave,
  onClose,
}: NameModalProps) {
  const [value, setValue] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSave = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSave(trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-card bg-white p-6 shadow-card-hover"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold">이름 바꾸기</h2>
        <p className="mt-1 text-sm text-gray-500">
          새로 사용할 이름(닉네임)을 적어주세요.
        </p>
        <input
          ref={inputRef}
          value={value}
          maxLength={10}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          className="mt-4 w-full rounded-lg border border-gray-200 px-4 py-3 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          placeholder="이름 (10자 이내)"
        />
        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-gray-200 py-3 font-semibold text-gray-600 transition hover:bg-gray-50"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={!value.trim()}
            className="flex-1 rounded-xl bg-brand py-3 font-semibold text-white transition hover:bg-brand-dark disabled:opacity-40"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
