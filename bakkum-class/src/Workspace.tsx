import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "./store";
import { useAuth } from "./auth";
import { getMyPrefs, saveMyPrefs } from "./lib/authApi";
import { Icon, StarIcon } from "./icons";
import { ThemeToggle } from "./components/Header";
import { ModalHost, ToastHost } from "./components/ModalHost";
import { type Category, getCategories, setCategories } from "./lib/categories";
import { ROLE_LABEL, shownRole, dutyText } from "./lib/roles";
import { sidebarFor, defaultEntry, dutyLabel, type WsEntry } from "./lib/workspace";
import { MathContent } from "./screens/MathContent";
import { HubHome } from "./screens/HubHome";
import { Notes } from "./screens/Notes";
import { BoardShared } from "./screens/BoardShared";
import { Desk } from "./screens/Desk";
import { Wiki } from "./screens/Wiki";
import { Sns } from "./screens/Sns";
import { English } from "./screens/English";
import { EngReport } from "./screens/EngReport";
import { StudentMaster } from "./screens/StudentMaster";
import { AcademySchedule } from "./screens/AcademySchedule";
import { AdminAccounts } from "./screens/AdminAccounts";
import { AdminDashboard } from "./screens/AdminDashboard";
import { ChangeRequests } from "./screens/ChangeRequests";
import { PointRanking } from "./screens/PointRanking";
import { IssueBoard } from "./screens/IssueBoard";
import { NoticeBanner } from "./components/NoticeBanner";
import { reqsApi } from "./lib/hubApi";
import { getRoster, type RosterStudent } from "./lib/rosterApi";
import { getConfig } from "./lib/configApi";
import { NEW_REQ_EVENT, type ReqPrefill } from "./lib/changeReqLive";
import { Settings } from "./pages/Settings";

export function Workspace() {
  const { user, noBackend, logout } = useAuth();
  const store = useStore();
  const groups = useMemo(() => (user ? sidebarFor(user) : []), [user]);
  const entries = useMemo(() => groups.flatMap((g) => g.entries), [groups]);
  const byKey = useMemo(() => new Map(entries.map((e) => [e.key, e])), [entries]);

  const [view, setView] = useState<string>(() => {
    const d = user ? defaultEntry(user) : "home";
    return byKey.get(d)?.kind === "math" ? "math" : d;
  });
  const [cats, setCats] = useState<Category[]>(getCategories());

  // 계정별 서버 저장 prefs: 즐겨찾기 + 사이드바 순서(카테고리·세부항목 드래그 정렬)
  const [favorites, setFavorites] = useState<string[]>([]);
  const [groupOrder, setGroupOrder] = useState<string[]>([]); // 카테고리(라벨) 순서
  const [entryOrder, setEntryOrder] = useState<Record<string, string[]>>({}); // 그룹라벨 → 항목키 순서
  const prefsDirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 항상 최신값을 저장하도록 ref 미러.
  const favRef = useRef(favorites); favRef.current = favorites;
  const goRef = useRef(groupOrder); goRef.current = groupOrder;
  const eoRef = useRef(entryOrder); eoRef.current = entryOrder;
  // 저장된 순서를 적용한 사이드바 그룹(미지정 항목은 원래 순서 유지).
  const orderedGroups = useMemo(() => {
    const rank = (arr: string[], v: string, fallback: number) => {
      const i = arr.indexOf(v);
      return i < 0 ? 1000 + fallback : i;
    };
    const unlabeled = groups.filter((g) => !g.label);
    const labeled = groups.filter((g) => g.label);
    const sortedLabeled = labeled
      .map((g, i) => ({ g, i }))
      .sort((a, b) => rank(groupOrder, a.g.label as string, a.i) - rank(groupOrder, b.g.label as string, b.i))
      .map((x) => x.g);
    const applyEntries = (g: (typeof groups)[number]) => {
      const ord = entryOrder[g.label || ""];
      if (!ord) return g;
      const sorted = g.entries
        .map((e, i) => ({ e, i }))
        .sort((a, b) => rank(ord, a.e.key, a.i) - rank(ord, b.e.key, b.i))
        .map((x) => x.e);
      return { ...g, entries: sorted };
    };
    return [...unlabeled, ...sortedLabeled].map(applyEntries);
  }, [groups, groupOrder, entryOrder]);

  // 드래그 상태(그룹/항목).
  const dragRef = useRef<{ type: "group" | "entry"; group: string; key: string } | null>(null);

  function persistPrefs() {
    if (noBackend) return;
    prefsDirty.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(
      () => void saveMyPrefs(JSON.stringify({ favorites: favRef.current, groupOrder: goRef.current, entryOrder: eoRef.current })),
      500
    );
  }
  useEffect(() => {
    if (noBackend) return;
    let alive = true;
    getMyPrefs().then((raw) => {
      if (!alive || prefsDirty.current || !raw) return;
      try {
        const p = JSON.parse(raw) as { favorites?: string[]; groupOrder?: string[]; entryOrder?: Record<string, string[]> };
        if (Array.isArray(p.favorites)) setFavorites(p.favorites);
        if (Array.isArray(p.groupOrder)) setGroupOrder(p.groupOrder);
        if (p.entryOrder && typeof p.entryOrder === "object") setEntryOrder(p.entryOrder);
      } catch {
        /* ignore */
      }
    });
    return () => {
      alive = false;
    };
  }, [noBackend]);
  function toggleFav(key: string) {
    setFavorites((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
    persistPrefs();
  }
  // 드래그로 카테고리(그룹) 순서 바꾸기.
  function moveGroup(fromLabel: string, toLabel: string) {
    if (fromLabel === toLabel) return;
    const labels = orderedGroups.filter((g) => g.label).map((g) => g.label as string);
    const from = labels.indexOf(fromLabel);
    const to = labels.indexOf(toLabel);
    if (from < 0 || to < 0) return;
    const next = [...labels];
    next.splice(from, 1);
    next.splice(to, 0, fromLabel);
    setGroupOrder(next);
    persistPrefs();
  }
  // 드래그로 같은 그룹 안 세부항목 순서 바꾸기.
  function moveEntry(groupLabel: string, fromKey: string, toKey: string) {
    if (fromKey === toKey) return;
    const g = orderedGroups.find((x) => (x.label || "") === groupLabel);
    if (!g) return;
    const keys = g.entries.map((e) => e.key);
    const from = keys.indexOf(fromKey);
    const to = keys.indexOf(toKey);
    if (from < 0 || to < 0) return;
    const next = [...keys];
    next.splice(from, 1);
    next.splice(to, 0, fromKey);
    setEntryOrder((cur) => ({ ...cur, [groupLabel]: next }));
    persistPrefs();
  }

  // 사이드바 카테고리 접기/펼치기(브라우저에 저장)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("bk_nav_collapsed");
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  });
  function toggleGroup(label: string) {
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      try {
        localStorage.setItem("bk_nav_collapsed", JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  // 학원 로고(설정에서 업로드·크기). 없으면 기본 "바" 박스.
  const [logoUrl, setLogoUrl] = useState("");
  const [logoSize, setLogoSize] = useState(0);
  useEffect(() => {
    if (noBackend) return;
    getConfig().then((c) => { setLogoUrl(c.logoUrl || ""); setLogoSize(Number(c.logoSize) || 0); }).catch(() => {});
  }, [noBackend]);

  // 시간표 변경 요청 — 나에게 온 대기 건수(사이드바 알림 배지)
  const [reqPending, setReqPending] = useState(0);
  useEffect(() => {
    if (noBackend || !user) return;
    let alive = true;
    const load = () =>
      reqsApi
        .list()
        .then((rs) => { if (alive) setReqPending(rs.filter((r) => r.targetId === user.sub && r.status === "pending").length); })
        .catch(() => {});
    void load();
    const iv = setInterval(load, 20000);
    return () => { alive = false; clearInterval(iv); };
  }, [noBackend, user]);

  // 전역 학생 검색 — 어느 화면에서든 이름으로 학생 명단 프로필로 점프.
  const canSearch = user?.role !== "student" && !noBackend;
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [gq, setGq] = useState("");
  const [gqOpen, setGqOpen] = useState(false);
  const [jumpStudent, setJumpStudent] = useState<{ id: string; n: number } | null>(null);
  useEffect(() => {
    if (!canSearch) return;
    let alive = true;
    getRoster().then((r) => { if (alive) setRoster(r); }).catch(() => {});
    return () => { alive = false; };
  }, [canSearch]);
  const gqResults = useMemo(() => {
    const kw = gq.trim();
    if (!kw) return [];
    return roster
      .filter((r) => r.name.includes(kw) || (r.school || "").includes(kw))
      .slice(0, 8);
  }, [gq, roster]);
  function jumpToStudent(s: RosterStudent) {
    setJumpStudent((cur) => ({ id: s.id, n: (cur?.n || 0) + 1 }));
    setView("master");
    setGq("");
    setGqOpen(false);
  }

  // 시간표 변경요청 프리필 — 수학/영어 '오늘'에서 '변경 요청하기'를 누르면
  // CustomEvent로 도착 → 변경요청 화면을 자동으로 열고 폼을 채운다.
  const [reqPrefill, setReqPrefill] = useState<(ReqPrefill & { n: number }) | null>(null);
  useEffect(() => {
    const onNew = (ev: Event) => {
      const detail = (ev as CustomEvent<ReqPrefill>).detail;
      if (!detail) return;
      setReqPrefill((cur) => ({ ...detail, n: (cur?.n || 0) + 1 }));
      setView("reqs");
    };
    window.addEventListener(NEW_REQ_EVENT, onNew);
    return () => window.removeEventListener(NEW_REQ_EVENT, onNew);
  }, []);

  function open(e: WsEntry) {
    if (e.kind === "math") {
      setView("math");
      store.navigate(e.page!);
    } else {
      setView(e.key);
    }
  }

  function isActive(e: WsEntry): boolean {
    if (e.kind === "math") return view === "math" && store.page === e.page;
    return view === e.key;
  }

  const favSet = new Set(favorites.filter((k) => byKey.has(k)));
  const favEntries = entries.filter((e) => favSet.has(e.key));

  // 홈 바로가기 타일 — 역할별 자주 쓰는 4곳(접근 가능한 것만).
  const homeTiles = useMemo(() => {
    const keysByRole: Record<string, string[]> = {
      admin: ["today", "master", "board", "admin_dash"],
      math: ["today", "master", "board", "timetable"],
      english_mid: ["eng_today_mid", "eng_tt_mid", "master", "board"],
      english_elem: ["eng_today_elem", "eng_tt_elem", "master", "board"],
      desk: ["desk_today", "desk_tt", "desk_students", "board"],
    };
    const keys = keysByRole[user?.role || ""] || [];
    return keys.map((k) => byKey.get(k)).filter((e): e is WsEntry => !!e);
  }, [user, byKey]);

  // 현재 위치(브레드크럼)
  const activeEntry =
    view === "math" ? entries.find((e) => e.kind === "math" && e.page === store.page) : byKey.get(view);
  const activeGroup = groups.find((g) => g.entries.some((e) => e === activeEntry));

  function badge(e: WsEntry) {
    if (e.key === "students") return <span className="nav-badge">{store.data.students.length}</span>;
    if (e.key === "makeup") {
      const n = store.data.makeups.filter((k) => k.status === "pending").length;
      return n > 0 ? <span className="nav-badge warn">{n}</span> : null;
    }
    if (e.key === "reqs") return reqPending > 0 ? <span className="nav-badge warn">{reqPending}</span> : null;
    return null;
  }

  function row(e: WsEntry, groupLabel?: string) {
    const fav = favSet.has(e.key);
    const drag = !!groupLabel; // 즐겨찾기 그룹(라벨 없음)은 드래그 정렬 제외
    return (
      <div
        className="nav-row"
        key={e.key}
        draggable={drag}
        onDragStart={drag ? (ev) => { dragRef.current = { type: "entry", group: groupLabel!, key: e.key }; ev.dataTransfer.effectAllowed = "move"; } : undefined}
        onDragOver={drag ? (ev) => { const d = dragRef.current; if (d?.type === "entry" && d.group === groupLabel) { ev.preventDefault(); ev.currentTarget.classList.add("drag-over"); } } : undefined}
        onDragLeave={drag ? (ev) => ev.currentTarget.classList.remove("drag-over") : undefined}
        onDrop={drag ? (ev) => { ev.preventDefault(); ev.currentTarget.classList.remove("drag-over"); const d = dragRef.current; if (d?.type === "entry" && d.group === groupLabel) moveEntry(groupLabel!, d.key, e.key); dragRef.current = null; } : undefined}
        onDragEnd={drag ? () => { dragRef.current = null; } : undefined}
      >
        <button className={"nav-item" + (isActive(e) ? " active" : "")} onClick={() => open(e)}>
          <span className="ic">
            <Icon name={e.icon} />
          </span>
          {e.label}
          {badge(e)}
        </button>
        <button
          className={"nav-star" + (fav ? " on" : "")}
          onClick={() => toggleFav(e.key)}
          title={fav ? "즐겨찾기 해제" : "즐겨찾기 추가"}
          aria-pressed={fav}
        >
          <StarIcon filled={fav} />
        </button>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="app">
      <aside className="side">
        <div className="brand" style={{ cursor: "default" }}>
          {logoUrl ? (
            <img className="logo logo-img" src={logoUrl} alt="바꿈" style={logoSize ? { width: logoSize, height: logoSize, borderRadius: Math.round(logoSize * 0.26) } : undefined} />
          ) : (
            <div className="logo" style={logoSize ? { width: logoSize, height: logoSize } : undefined}>바</div>
          )}
          <div>
            <b>바꿈영수학원</b>
            <span>
              {user.name}님{user.role === "admin" ? ` · ${ROLE_LABEL[shownRole(user)]}${user.duty?.length ? ` · ${dutyText(user.duty)}` : ""}` : `, 담당: ${dutyLabel(user)}`}
            </span>
          </div>
        </div>

        <nav>
          {favEntries.length > 0 && (
            <div className="nav-group">
              <div className="nav-label">즐겨찾기</div>
              {favEntries.map((e) => row(e))}
            </div>
          )}
          {orderedGroups.map((g, i) => {
            const items = g.entries.filter((e) => !favSet.has(e.key));
            if (!items.length) return null;
            // 라벨 없는 상단 그룹(홈·일정 등)은 항상 펼침. 라벨 있는 카테고리는 토글·드래그.
            const isCollapsed = g.label ? collapsed.has(g.label) : false;
            const lbl = g.label;
            return (
              <div
                className={"nav-group" + (isCollapsed ? " collapsed" : "")}
                key={lbl || "top" + i}
                onDragOver={lbl ? (ev) => { const d = dragRef.current; if (d?.type === "group") { ev.preventDefault(); ev.currentTarget.classList.add("group-drop"); } } : undefined}
                onDragLeave={lbl ? (ev) => ev.currentTarget.classList.remove("group-drop") : undefined}
                onDrop={lbl ? (ev) => { ev.preventDefault(); ev.currentTarget.classList.remove("group-drop"); const d = dragRef.current; if (d?.type === "group") moveGroup(d.group, lbl); dragRef.current = null; } : undefined}
              >
                {lbl && (
                  <button
                    className="nav-label toggle"
                    onClick={() => toggleGroup(lbl)}
                    aria-expanded={!isCollapsed}
                    draggable
                    onDragStart={(ev) => { dragRef.current = { type: "group", group: lbl, key: "" }; ev.dataTransfer.effectAllowed = "move"; }}
                    onDragEnd={() => { dragRef.current = null; }}
                    title="드래그해서 순서 바꾸기"
                  >
                    <span className={"nav-caret" + (isCollapsed ? " closed" : "")}>▾</span>
                    {lbl}
                  </button>
                )}
                {!isCollapsed && items.map((e) => row(e, lbl))}
              </div>
            );
          })}
        </nav>

        <div className="side-foot">
          <div className="h">
            <Icon name="users" />
            {ROLE_LABEL[shownRole(user)]}
          </div>
          <p>별(★)로 즐겨찾기하면 위로 모입니다. 설정은 로그인 계정별로 저장됩니다.</p>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="crumb">
            {activeGroup?.label ? activeGroup.label + " · " : ""}
            <b>{activeEntry?.label || "홈"}</b>
          </div>
          {canSearch && (
            <div className="gsearch">
              <input
                className="gsearch-input"
                value={gq}
                onChange={(e) => { setGq(e.target.value); setGqOpen(true); }}
                onFocus={() => setGqOpen(true)}
                onBlur={() => setTimeout(() => setGqOpen(false), 150)}
                placeholder="학생 검색 (이름·학교)"
                aria-label="학생 전역 검색"
              />
              {gqOpen && gqResults.length > 0 && (
                <div className="gsearch-pop">
                  {gqResults.map((s) => (
                    <button key={s.id} className="gsearch-item" onMouseDown={() => jumpToStudent(s)}>
                      <b>{s.name}</b>
                      <span className="gsearch-meta">
                        {[s.school, s.subjects.includes("math") ? "수학" : "", s.subjects.includes("english") ? "영어" : ""].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {gqOpen && gq.trim() && gqResults.length === 0 && (
                <div className="gsearch-pop"><div className="gsearch-empty">일치하는 학생이 없어요.</div></div>
              )}
            </div>
          )}
          <div className="top-actions">
            <button
              className="topbell"
              onClick={() => setView("reqs")}
              title={reqPending > 0 ? `받은 시간표 변경 요청 ${reqPending}건` : "시간표 변경 요청"}
              aria-label="시간표 변경 요청 알림"
            >
              <Icon name="bell" />
              {reqPending > 0 && <span className="topbell-badge">{reqPending}</span>}
            </button>
            <ThemeToggle />
            <span className="acct-chip">
              {user.name} · <span className="role">{ROLE_LABEL[shownRole(user)]}</span>
            </span>
            <button className="acct-logout" onClick={() => logout()}>
              로그아웃
            </button>
          </div>
        </header>
        <main className={"content " + (view === "math" ? "is-math" : "is-hub")}>
          <NoticeBanner />
          <Body view={view} cats={cats} jumpStudent={jumpStudent} reqPrefill={reqPrefill} homeTiles={homeTiles} onOpen={open} onCats={(c) => { setCategories(c); setCats(c); }} />
          <footer className="maker-credit">제작자 EZ</footer>
        </main>
      </div>
      <ModalHost />
      <ToastHost />
    </div>
  );
}

function Body({ view, cats, jumpStudent, reqPrefill, homeTiles, onOpen, onCats }: { view: string; cats: Category[]; jumpStudent: { id: string; n: number } | null; reqPrefill: (ReqPrefill & { n: number }) | null; homeTiles: WsEntry[]; onOpen: (e: WsEntry) => void; onCats: (c: Category[]) => void }) {
  if (view === "math") return <MathContent />;
  if (view === "home") return <HubHome tiles={homeTiles} onOpen={onOpen} />;
  if (view === "schedule_hub") return <AcademySchedule />;
  if (view === "reqs") return <ChangeRequests prefill={reqPrefill} />;
  if (view === "ranking") return <PointRanking />;
  if (view === "issues") return <IssueBoard />;
  if (view === "board") return <BoardShared />;
  if (view === "notes") return <Notes />;
  if (view === "wiki") return <Wiki />;
  if (view === "sns") return <Sns />;
  if (view === "master") return <StudentMaster jumpTo={jumpStudent} />;
  if (view === "engreport") return <EngReport />;
  if (view === "accounts") return <AdminAccounts />;
  if (view === "admin_dash") return <AdminDashboard />;
  if (view === "settings") return <Settings categories={cats} onCategoriesChange={onCats} />;
  if (view.startsWith("eng_")) {
    const band = view.endsWith("_elem") ? "elem" : "mid";
    const tab = view.startsWith("eng_progress")
      ? "progress"
      : view.startsWith("eng_test")
        ? "test"
        : view.startsWith("eng_dash")
          ? "board"
          : view.startsWith("eng_tt")
            ? "tt"
            : view.startsWith("eng_att")
              ? "att"
              : view.startsWith("eng_hw")
                ? "hw"
                : view.startsWith("eng_makeup")
                  ? "makeup"
                  : view.startsWith("eng_cur")
                    ? "cur"
                    : view.startsWith("eng_items")
                      ? "items"
                      : "today";
    return <English key={view} band={band} tab={tab} />;
  }
  if (view.startsWith("desk_")) {
    const tab = view === "desk_students" ? "students" : view === "desk_accounts" ? "accounts" : view === "desk_today" ? "today" : "timetable";
    return <Desk key={view} tab={tab} />;
  }
  return <HubHome tiles={homeTiles} onOpen={onOpen} />;
}
