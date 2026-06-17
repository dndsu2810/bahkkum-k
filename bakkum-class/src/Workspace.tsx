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
import type { PageId } from "./lib/nav";
import { MathContent } from "./screens/MathContent";
import { HubHome, type HomeStat } from "./screens/HubHome";
import { MessageSend } from "./screens/MessageSend";
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
import { PointCatalog } from "./screens/PointCatalog";
import { IssueBoard } from "./screens/IssueBoard";
import { Checkin } from "./screens/Checkin";
import { CheckinReport } from "./screens/CheckinReport";
import { Orders } from "./screens/Orders";
import { ordersApi } from "./lib/ordersApi";
import { NotificationBell } from "./components/NotificationBell";
import { Materials } from "./screens/Materials";
import { Guide } from "./screens/Guide";
import { NoticeBanner } from "./components/NoticeBanner";
import { reqsApi } from "./lib/hubApi";
import { feedbackApi } from "./lib/feedbackApi";
import { getRoster, type RosterStudent } from "./lib/rosterApi";
import { engApi } from "./lib/engApi";
import { messageApi } from "./lib/messageApi";
import { getConfig } from "./lib/configApi";
import { NEW_REQ_EVENT, type ReqPrefill } from "./lib/changeReqLive";
import { Settings } from "./pages/Settings";

export function Workspace() {
  const { user, noBackend, logout } = useAuth();
  const store = useStore();
  const groups = useMemo(() => (user ? sidebarFor(user) : []), [user]);
  const entries = useMemo(() => groups.flatMap((g) => g.entries), [groups]);
  const byKey = useMemo(() => new Map(entries.map((e) => [e.key, e])), [entries]);

  // 새로고침해도 현재 화면 유지 + 화면별 주소(해시). 예: #eng_today_mid, 수학은 #math:attendance.
  const [view, setView] = useState<string>(() => {
    const h = location.hash.slice(1);
    if (h.startsWith("math:")) return "math";
    if (h && byKey.get(h)) return byKey.get(h)!.kind === "math" ? "math" : h;
    const d = user ? defaultEntry(user) : "home";
    return byKey.get(d)?.kind === "math" ? "math" : d;
  });
  // 첫 로드 시 해시가 수학 페이지면 그 페이지로 이동.
  useEffect(() => {
    const h = location.hash.slice(1);
    if (h.startsWith("math:")) store.navigate(h.slice(5) as PageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 화면(또는 수학 페이지) 바뀔 때 주소 해시 갱신 — 그 주소로 새로고침/공유하면 같은 화면이 열린다.
  useEffect(() => {
    const h = view === "math" ? "math:" + store.page : view;
    if (location.hash.slice(1) !== h) history.replaceState(null, "", "#" + h);
  }, [view, store.page]);
  const [cats, setCats] = useState<Category[]>(getCategories());

  // 화면(카테고리) 전환 시 스크롤을 맨 위로 — 이전 화면에서 내려둔 스크롤이 남아 다음 화면이 아래에서 시작하던 문제.
  useEffect(() => {
    document.querySelector(".content")?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [view, store.page]);

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

  // 오류·개선 요청 알림 — 원장: 새 접수 / 그 외: 내 글 새 답변·해결. 종 배지 + 사이드바 + 팝업.
  const [issueUnseen, setIssueUnseen] = useState(0);
  const [issueKind, setIssueKind] = useState("reply");
  const [issuePopup, setIssuePopup] = useState(false);
  useEffect(() => {
    if (noBackend || !user) return;
    let alive = true;
    const load = () => feedbackApi.issueUnseen().then((r) => {
      if (!alive) return;
      setIssueUnseen(r.count);
      setIssueKind(r.kind || "reply");
      if (r.count > 0 && r.kind === "reply") setIssuePopup(true); // 답변 도착 팝업(작성자)
    }).catch(() => {});
    void load();
    const iv = setInterval(load, 30000);
    const onFocus = () => void load();
    const onSeen = () => { setIssueUnseen(0); setIssuePopup(false); };
    window.addEventListener("focus", onFocus);
    window.addEventListener("issue-seen", onSeen);
    return () => { alive = false; clearInterval(iv); window.removeEventListener("focus", onFocus); window.removeEventListener("issue-seen", onSeen); };
  }, [noBackend, user]);

  // 교재·비품 주문 — 구매 전 건수(사이드바 주황 배지)
  const [ordersPending, setOrdersPending] = useState(0);
  useEffect(() => {
    if (noBackend || !user) return;
    let alive = true;
    const load = () => ordersApi.pendingCount().then((n) => { if (alive) setOrdersPending(n); }).catch(() => {});
    void load();
    const iv = setInterval(load, 30000);
    const onFocus = () => void load();
    const onChanged = () => void load();
    window.addEventListener("focus", onFocus);
    window.addEventListener("orders-changed", onChanged);
    return () => { alive = false; clearInterval(iv); window.removeEventListener("focus", onFocus); window.removeEventListener("orders-changed", onChanged); };
  }, [noBackend, user]);

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

  // 영어 보강 '대기' 건수(밴드별) — 사이드바 배지(수학과 동일하게 노란 숫자).
  const engBandRef = useRef<Record<string, string>>({});
  const [engWait, setEngWait] = useState<{ mid: number; elem: number }>({ mid: 0, elem: 0 });
  function refreshEngWait() {
    engApi.makeups().then((mks) => {
      const bandOf = engBandRef.current;
      let mid = 0, elem = 0;
      for (const mk of mks) {
        if (mk.status === "대기" || !mk.makeupDate) {
          const b = bandOf[mk.studentId];
          if (b === "mid") mid++;
          else if (b === "elem") elem++;
        }
      }
      setEngWait({ mid, elem });
    }).catch(() => {});
  }
  useEffect(() => {
    getRoster().then((roster) => {
      const m: Record<string, string> = {};
      for (const s of roster) if (s.subjects.includes("english")) m[s.id] = s.englishBand;
      engBandRef.current = m;
      refreshEngWait();
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 화면 이동 시 갱신 — 보강 등록/상태변경 후 사이드바 배지가 따라오도록.
  useEffect(() => {
    refreshEngWait();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // 학생 답장 미확인 수 — '학생에게 메시지 보내기' 사이드바 빨간 배지(원장·수학만).
  const canMessage = !!user && (user.role === "admin" || user.role === "math");
  const [replyUnseen, setReplyUnseen] = useState(0);
  const refreshReplyCount = () => { if (canMessage) messageApi.replyCount().then(setReplyUnseen).catch(() => {}); };
  useEffect(() => {
    refreshReplyCount();
    const onSeen = () => setReplyUnseen(0);
    window.addEventListener("msg-replies-seen", onSeen);
    const iv = window.setInterval(refreshReplyCount, 30000);
    return () => { window.removeEventListener("msg-replies-seen", onSeen); window.clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canMessage]);
  // 화면 이동 시 갱신(단, 발송 화면에선 화면이 '확인함' 처리하므로 제외 — 깜빡임 방지).
  useEffect(() => {
    if (view !== "messages_send") refreshReplyCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // 홈 대시보드 — 키로 이동(접근 가능한 뷰만), 오늘 요약 카드, 오늘 수업 CTA 대상.
  function goKey(key: string) {
    const e = byKey.get(key);
    if (e) open(e);
  }
  const homeSummary = useMemo<HomeStat[]>(() => {
    const out: HomeStat[] = [];
    if (byKey.has("reqs")) out.push({ key: "reqs", label: "받은 변경 요청", value: reqPending, icon: "bell", tone: "warn" });
    if (byKey.has("makeup")) out.push({ key: "makeup", label: "보강 대기", value: store.data.makeups.filter((k) => k.status === "pending").length, icon: "refresh", tone: "warn" });
    if (byKey.has("master")) out.push({ key: "master", label: "재원 학생", value: store.data.students.filter((s) => s.status === "재원").length, icon: "students" });
    return out;
  }, [byKey, reqPending, store.data.makeups, store.data.students]);
  const ctaKey = user ? defaultEntry(user) : "home";

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
    if (e.key === "eng_makeup_mid") return engWait.mid > 0 ? <span className="nav-badge warn">{engWait.mid}</span> : null;
    if (e.key === "eng_makeup_elem") return engWait.elem > 0 ? <span className="nav-badge warn">{engWait.elem}</span> : null;
    if (e.key === "messages_send") return replyUnseen > 0 ? <span className="nav-badge bad">{replyUnseen}</span> : null;
    if (e.key === "issues") return issueUnseen > 0 ? <span className="nav-badge bad">{issueUnseen}</span> : null;
    if (e.key === "orders") return ordersPending > 0 ? <span className="nav-badge orange">{ordersPending}</span> : null;
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
            <NotificationBell
              onGo={goKey}
              canMessage={byKey.has("messages_send")}
              isAdmin={user.role === "admin"}
              reqPending={reqPending}
              ordersPending={ordersPending}
            />
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
          <Body view={view} cats={cats} jumpStudent={jumpStudent} reqPrefill={reqPrefill} homeTiles={homeTiles} homeSummary={homeSummary} ctaKey={ctaKey} onGo={goKey} onOpen={open} onCats={(c) => { setCategories(c); setCats(c); }} />
          <footer className="maker-credit">제작자 EZ</footer>
        </main>
      </div>
      {issuePopup && issueUnseen > 0 && issueKind === "reply" && (
        <div className="issue-pop" role="status">
          <div className="issue-pop-b">
            <b>지현T가 요청에 답했어요</b>
            <span>오류·개선 요청 {issueUnseen}건에 답변·해결 소식이 있어요.</span>
          </div>
          <button className="btn primary sm" onClick={() => { setView("issues"); setIssuePopup(false); }}>보기</button>
          <button className="issue-pop-x" onClick={() => setIssuePopup(false)} aria-label="닫기">✕</button>
        </div>
      )}
      <ModalHost />
      <ToastHost />
    </div>
  );
}

function Body({ view, cats, jumpStudent, reqPrefill, homeTiles, homeSummary, ctaKey, onGo, onOpen, onCats }: { view: string; cats: Category[]; jumpStudent: { id: string; n: number } | null; reqPrefill: (ReqPrefill & { n: number }) | null; homeTiles: WsEntry[]; homeSummary: HomeStat[]; ctaKey: string; onGo: (key: string) => void; onOpen: (e: WsEntry) => void; onCats: (c: Category[]) => void }) {
  if (view === "math") return <MathContent />;
  if (view === "home") return <HubHome tiles={homeTiles} onOpen={onOpen} summary={homeSummary} ctaKey={ctaKey} onGo={onGo} />;
  if (view === "messages_send") return <MessageSend />;
  if (view === "schedule_hub") return <AcademySchedule />;
  if (view === "reqs") return <ChangeRequests prefill={reqPrefill} />;
  if (view === "ranking") return <PointRanking />;
  if (view === "point_catalog") return <PointCatalog />;
  if (view === "issues") return <IssueBoard />;
  if (view === "checkin") return <Checkin />;
  if (view === "checkin_report") return <CheckinReport />;
  if (view === "orders") return <Orders />;
  if (view === "materials") return <Materials />;
  if (view === "guide") return <Guide />;
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
                      : view.startsWith("eng_naesin")
                        ? "naesin"
                        : "today";
    return <English key={view} band={band} tab={tab} />;
  }
  if (view.startsWith("desk_")) {
    const tab = view === "desk_students" ? "students" : view === "desk_accounts" ? "accounts" : view === "desk_today" ? "today" : "timetable";
    return <Desk key={view} tab={tab} />;
  }
  return <HubHome tiles={homeTiles} onOpen={onOpen} summary={homeSummary} ctaKey={ctaKey} onGo={onGo} />;
}
