import type { ReactNode } from "react";
import type { Grade } from "../types";
import { avatarText, gradeColor } from "../lib/logic";
import { Icon, type IconName } from "../icons";

/* ---------- badge / avatar ---------- */
export function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={"badge b-" + tone}>{children}</span>;
}

export function GradeBadge({ grade }: { grade: Grade | string }) {
  return <Badge tone={grade === "초등" ? "blue" : "purple"}>{grade}</Badge>;
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
