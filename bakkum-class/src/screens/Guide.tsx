import { useState } from "react";
import { useAuth } from "../auth";
import { Icon } from "../icons";
import { ROLE_LABEL, type Role } from "../lib/roles";
import { GUIDES, GUIDE_ROLES, guideRoleFor, type RoleGuide } from "../lib/guide";

/** 앱 사용 가이드 화면 — 로그인한 역할에 맞는 안내를 보여준다.
 *  원장/개발자는 상단 탭으로 모든 역할의 가이드를 열람할 수 있다.
 *  forceRole: 학생 오버레이 등 특정 역할 가이드를 고정해 보여줄 때. */
export function Guide({ forceRole, embedded }: { forceRole?: Exclude<Role, "developer">; embedded?: boolean } = {}) {
  const { user } = useAuth();
  const myRole = guideRoleFor(user?.role || "student");
  const canSwitch = !forceRole && (user?.role === "admin" || user?.role === "developer");
  const [sel, setSel] = useState<Exclude<Role, "developer">>(forceRole || myRole);

  const guide: RoleGuide = GUIDES[sel];

  return (
    <div className={"guide" + (embedded ? " is-embed" : "")}>
      <div className="guide-head">
        <h1 className="guide-title">{guide.title}</h1>
        <p className="guide-summary">{guide.summary}</p>
        <div className="guide-start">
          <Icon name="today" /> <span>{guide.start}</span>
        </div>
      </div>

      {canSwitch && (
        <div className="guide-tabs" role="tablist" aria-label="역할별 가이드">
          {GUIDE_ROLES.map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={sel === r}
              className={"guide-tab" + (sel === r ? " active" : "")}
              onClick={() => setSel(r)}
            >
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>
      )}

      <div className="guide-groups">
        {guide.groups.map((g) => (
          <section className="guide-group" key={g.label}>
            <h2 className="guide-group-h">{g.label}</h2>
            <div className="guide-cards">
              {g.topics.map((t) => (
                <article className="guide-card" key={t.title}>
                  <div className="guide-card-h">
                    {t.icon && (
                      <span className="guide-card-ic">
                        <Icon name={t.icon} />
                      </span>
                    )}
                    <h3>{t.title}</h3>
                  </div>
                  <p className="guide-what">{t.what}</p>
                  {t.steps && t.steps.length > 0 && (
                    <ol className="guide-steps">
                      {t.steps.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ol>
                  )}
                  {t.tip && (
                    <div className="guide-tip">
                      <Icon name="alert" /> <span>{t.tip}</span>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
