import { useAuth } from "../auth";
import { AREAS, ROLE_LABEL, areasForUser, type Role } from "../lib/roles";
import { getCachedLogo } from "../lib/configApi";

/** 학생 화면 + 운영(스태프) 임시 홈.
 *  - 스태프: 원장이 이 계정에 허용한 화면(영역) 목록을 보여준다(아직 미구현은 '준비 중').
 *  - 학생: 본인 기록 화면(다음 단계). */
export function RoleHome({ role }: { role: Role }) {
  const { user, logout } = useAuth();
  const isStudent = role === "student";
  const myAreas = user ? areasForUser(user) : [];
  const areaDefs = AREAS.filter((a) => myAreas.includes(a.key));

  return (
    <div className="hub-shell">
      <header className="hub-top">
        <div className="hub-top-brand">
          <div className="hub-logo">바</div>
          <div>
            <b>바꿈 통합 허브</b>
            <span>
              {user?.name} · {ROLE_LABEL[role]}
            </span>
          </div>
        </div>
        <button className="btn ghost" onClick={() => logout()}>
          로그아웃
        </button>
      </header>

      <main className="hub-body">
        {isStudent ? (
          <div className="hub-card">
            <div className="hub-card-tag">학생 화면</div>
            <h2>곧 준비됩니다</h2>
            <p className="hub-muted">로그인됐어요. 목표·숙제·진도 기록 화면은 다음 단계에서 추가됩니다.</p>
          </div>
        ) : (
          <div className="hub-card" style={{ maxWidth: 560 }}>
            <div className="hub-card-tag">{ROLE_LABEL[role]} 화면</div>
            <h2>내 화면</h2>
            <p className="hub-muted">
              원장이 이 계정에 허용한 화면이에요. 아직 준비 중인 화면은 다음 단계에서 열립니다.
            </p>
            {areaDefs.length > 0 ? (
              <div className="area-grid">
                {areaDefs.map((a) => (
                  <div className={"area-tile" + (a.pending ? " pending" : "")} key={a.key}>
                    <div className="area-tile-h">
                      <b>{a.label}</b>
                      {a.pending && <span className="area-soon">준비 중</span>}
                    </div>
                    <p>{a.desc}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="hub-muted" style={{ marginTop: 16 }}>
                아직 배정된 화면이 없어요. 원장에게 화면 배정을 요청하세요.
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

/** 입장·로딩·전환 시 스플래시(흰 깜빡임 대신). 캐시된 학원 로고 + 학원명 + 로딩 점. */
export function AuthSplash() {
  const logo = getCachedLogo();
  return (
    <div className="splash">
      <div className="splash-in">
        {logo.url ? <img className="splash-logo splash-logo-img" src={logo.url} alt="바꿈영수학원" /> : <div className="splash-logo">바</div>}
        <div className="splash-name">바꿈영수학원</div>
        <div className="splash-dots" aria-label="불러오는 중"><span></span><span></span><span></span></div>
      </div>
    </div>
  );
}
