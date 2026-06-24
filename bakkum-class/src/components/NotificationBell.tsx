import { useEffect, useMemo, useRef, useState } from "react";
import { feedbackApi, type Issue, type Notice } from "../lib/feedbackApi";
import { Icon, type IconName } from "../icons";

const ARCH_KEY = "bk_notif_arch";
function loadArch(): Set<string> { try { return new Set(JSON.parse(localStorage.getItem(ARCH_KEY) || "[]")); } catch { return new Set(); } }
function saveArch(s: Set<string>) { try { localStorage.setItem(ARCH_KEY, JSON.stringify([...s])); } catch { /* ignore */ } }

interface Notif { key: string; title: string; sub?: string; tone?: string; go?: string }

/**
 * 알림 종 — 클릭하면 어떤 알림이 왔는지 목록으로 보여준다.
 * 상단 바로가기(요청/메시지·권한자만/주문/시간표변경) + 알림 목록 + 보관함.
 * 알림 클릭 → 해당 화면 이동 + 보관함으로 이동. 출처: 오류·개선 요청 답변/접수, 공지사항, 변경요청·주문 요약.
 */
export function NotificationBell({ onGo, canMessage, isAdmin, mySub, reqPending, ordersPending }: {
  onGo: (key: string) => void;
  canMessage: boolean;
  isAdmin: boolean;
  mySub: string;
  reqPending: number;
  ordersPending: number;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"new" | "arch">("new");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [arch, setArch] = useState<Set<string>>(loadArch);
  const ref = useRef<HTMLDivElement>(null);

  const load = () => {
    feedbackApi.issues().then((r) => setIssues(r.issues)).catch(() => {});
    feedbackApi.notices().then(setNotices).catch(() => {});
  };
  useEffect(() => { load(); const iv = setInterval(load, 30000); const f = () => load(); window.addEventListener("focus", f); return () => { clearInterval(iv); window.removeEventListener("focus", f); }; }, []);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const items = useMemo<Notif[]>(() => {
    const out: Notif[] = [];
    for (const i of issues) {
      const mine = i.authorSub === mySub;
      // 내가 올린 요청에 답변·상태변경 → 작성자에게만. (남의 글 해결 알림이 오지 않도록)
      if (mine && !i.seen && (i.reply || i.status !== "접수")) {
        out.push({ key: `iss:${i.id}:${i.updatedAt}`, title: i.reply ? "내 요청에 답변이 달렸어요" : "내 요청 상태가 바뀌었어요", sub: `${i.status} · ${(i.reply || i.body).slice(0, 40)}`, tone: "reply", go: "issues" });
      } else if (isAdmin && !mine && i.status === "접수") {
        // 관리자: 남이 새로 올린 접수만 처리 알림.
        out.push({ key: `iss:${i.id}:${i.createdAt}`, title: "새 오류·개선 요청", sub: `${i.authorName} · ${i.body.slice(0, 40)}`, tone: "new", go: "issues" });
      }
    }
    for (const n of notices) out.push({ key: `ntc:${n.id}:${n.createdAt}`, title: "공지사항", sub: n.text.slice(0, 60), tone: "notice" });
    if (reqPending > 0) out.push({ key: `reqs:${reqPending}`, title: `받은 시간표 변경 요청 ${reqPending}건`, tone: "warn", go: "reqs" });
    if (ordersPending > 0) out.push({ key: `ord:${ordersPending}`, title: `구매 전 주문 ${ordersPending}건`, tone: "warn", go: "orders" });
    return out;
  }, [issues, notices, isAdmin, mySub, reqPending, ordersPending]);

  const active = items.filter((i) => !arch.has(i.key));
  const archived = items.filter((i) => arch.has(i.key));
  const shownItems = tab === "new" ? active : archived;

  function dismiss(key: string) { const s = new Set(arch); s.add(key); setArch(s); saveArch(s); }
  function restore(key: string) { const s = new Set(arch); s.delete(key); setArch(s); saveArch(s); }
  function clickItem(n: Notif) { if (n.go) onGo(n.go); dismiss(n.key); setOpen(false); }

  const QUICK: { key: string; label: string; icon: IconName }[] = [
    { key: "issues", label: "오류·개선 요청", icon: "clipboard" },
    ...(canMessage ? [{ key: "messages_send", label: "학생 메시지", icon: "megaphone" as IconName }] : []),
    { key: "orders", label: "주문 관리", icon: "copy" },
    { key: "reqs", label: "시간표 변경 요청", icon: "refresh" },
  ];

  return (
    <div className="notif" ref={ref}>
      <button className="topbell" onClick={() => { setOpen((o) => !o); if (!open) load(); }} title="알림" aria-label="알림">
        <Icon name="bell" />
        {active.length > 0 && <span className="topbell-badge">{active.length}</span>}
      </button>
      {open && (
        <div className="notif-pop">
          <div className="notif-quick">
            {QUICK.map((q) => (
              <button key={q.key} className="notif-q" onClick={() => { onGo(q.key); setOpen(false); }}>
                <Icon name={q.icon} /><span>{q.label}</span>
              </button>
            ))}
          </div>
          <div className="notif-tabs">
            <button className={tab === "new" ? "on" : ""} onClick={() => setTab("new")}>알림{active.length > 0 ? ` ${active.length}` : ""}</button>
            <button className={tab === "arch" ? "on" : ""} onClick={() => setTab("arch")}>보관함</button>
          </div>
          <div className="notif-list">
            {shownItems.length === 0 ? (
              <div className="notif-empty">{tab === "new" ? "새 알림이 없어요." : "보관한 알림이 없어요."}</div>
            ) : (
              shownItems.map((n) => (
                <div key={n.key} className={"notif-item tone-" + (n.tone || "")}>
                  <button className="notif-item-main" onClick={() => (tab === "new" ? clickItem(n) : (n.go && onGo(n.go), setOpen(false)))}>
                    <b>{n.title}</b>{n.sub && <span>{n.sub}</span>}
                  </button>
                  {tab === "new"
                    ? <button className="notif-x" title="보관함으로" onClick={() => dismiss(n.key)}>보관</button>
                    : <button className="notif-x" title="알림으로 복원" onClick={() => restore(n.key)}>복원</button>}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
