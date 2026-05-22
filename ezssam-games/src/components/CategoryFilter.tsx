"use client";

import { cn } from "@/lib/cn";

type CategoryFilterProps = {
  categories: string[];
  active: string;
  onChange: (category: string) => void;
};

export default function CategoryFilter({
  categories,
  active,
  onChange,
}: CategoryFilterProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {categories.map((cat) => (
        <button
          key={cat}
          onClick={() => onChange(cat)}
          className={cn(
            "whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold transition",
            active === cat
              ? "bg-brand text-white"
              : "bg-white text-gray-500 ring-1 ring-gray-200 hover:bg-gray-50"
          )}
        >
          {cat}
        </button>
      ))}
    </div>
  );
}
