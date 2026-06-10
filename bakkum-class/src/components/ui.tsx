import type { ReactNode } from "react";
import type { Grade, StudentStatus } from "../types";
import { avatarText, gradeColor, statusTone } from "../lib/logic";
import { useStore } from "../store";
import { Icon, type IconName } from "../icons";

/* ---------- badge / avatar ---------- */
export function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={"badge b-" + tone}>{children}</span>;
}

/** 안내 부제 안에서 '오늘' 화면으로 이동하는 텍스트 링크. */
export function TodayLink() {
  const { navigate } = useStore();
  return (
    <button type="button" className="tlink" onClick={() => navigate("today")}>
      오늘
    </button>
  );
}

export function GradeBadge({ grade }: { grade: Grade | string }) {
  return <Badge tone={gradeColor(grade)}>{grade}</Badge>;
}

export function StatusBadge({ status }: { status: StudentStatus }) {
  return <Badge tone={statusTone(status)}>{status}</Badge>;
}

export function Avatar({ name, grade, lg }: { name: string; grade: Grade | string; lg?: boolean }) {
  return (
    <span className={"av av-" + gradeColor(grade) + (lg ? " av-lg" : "")}>{avatarText(name)}</span>
  );
}

/* ---------- styled select with chevron ---------- */
export function Select({
  value,
  onChange,
  options,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { v: string; l: string }[];
  id?: string;
}) {
  return (
    <div className="select-wrap">
      <select
        className="ctrl"
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.l}
          </option>
        ))}
      </select>
      <Icon name="chev" />
    </div>
  );
}

/* ---------- button helper ---------- */
export function Btn({
  variant,
  sm,
  icon,
  children,
  onClick,
  type = "button",
}: {
  variant?: "primary" | "ghost" | "danger";
  sm?: boolean;
  icon?: IconName;
  children?: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  const cls = ["btn", variant, sm ? "sm" : ""].filter(Boolean).join(" ");
  return (
    <button type={type} className={cls} onClick={onClick}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

/* ---------- empty state ---------- */
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
