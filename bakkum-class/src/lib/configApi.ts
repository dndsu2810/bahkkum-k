// 전역 설정(학원 로고 등) + 파일 업로드(R2).

const LOGO_KEY = "bk_logo";

/** 로그인 전(스플래시·로그인 화면)에 보여줄 로고를 캐시에서 읽는다.
 *  /api/config는 로그인이 필요하므로, 로그인 후 받은 로고를 localStorage에 저장해 재사용. */
export function getCachedLogo(): { url: string; size: number } {
  try {
    const raw = localStorage.getItem(LOGO_KEY);
    if (raw) return JSON.parse(raw) as { url: string; size: number };
  } catch {
    /* ignore */
  }
  return { url: "", size: 0 };
}
function cacheLogo(cfg: Record<string, string>) {
  try {
    localStorage.setItem(LOGO_KEY, JSON.stringify({ url: cfg.logoUrl || "", size: Number(cfg.logoSize) || 0 }));
  } catch {
    /* ignore */
  }
}

export async function getConfig(): Promise<Record<string, string>> {
  const r = await fetch("/api/config", { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = (await r.json()) as { config?: Record<string, string> };
  const cfg = j.config || {};
  cacheLogo(cfg);
  return cfg;
}

/** secret_* 키 중 값이 설정된 키 목록(값은 노출 안 됨). */
export async function getSecretSet(): Promise<string[]> {
  const r = await fetch("/api/config", { cache: "no-store" });
  if (!r.ok) return [];
  const j = (await r.json()) as { secretSet?: string[] };
  return j.secretSet || [];
}

export async function setConfig(patch: Record<string, string>): Promise<void> {
  const r = await fetch("/api/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
  // 권한이 없으면(원장 전용 설정) 조용히 실패하지 않고 사람 말로 알려준다.
  if (r.status === 403) throw new Error("이 설정은 원장님 계정에서 바꿀 수 있어요.");
  if (!r.ok) throw new Error("HTTP " + r.status);
  // 로고를 바꾸면 캐시도 즉시 갱신(스플래시·로그인 화면에 바로 반영).
  if ("logoUrl" in patch || "logoSize" in patch) {
    const cur = getCachedLogo();
    cacheLogo({ logoUrl: patch.logoUrl ?? cur.url, logoSize: String(patch.logoSize ?? cur.size) });
  }
}

/** 이미지 파일을 R2에 올리고 URL을 받는다(원본 바이트 + content-type). */
export async function uploadImage(file: File): Promise<string> {
  const r = await fetch("/api/upload", { method: "POST", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
  const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!r.ok || !j.url) throw new Error(j.error || "upload_failed");
  return j.url;
}

/** 링크 미리보기(북마크 카드)용 메타데이터. 서버가 대상 페이지의 og 태그를 읽어 돌려줌. */
export interface LinkMeta { url: string; title: string; desc: string; image: string; site: string }
export async function linkMeta(url: string): Promise<LinkMeta> {
  const r = await fetch("/api/linkmeta?url=" + encodeURIComponent(url));
  const j = (await r.json().catch(() => ({}))) as Partial<LinkMeta> & { error?: string };
  if (!r.ok || !j.url) throw new Error(j.error || "linkmeta_failed");
  return { url: j.url, title: j.title || j.site || url, desc: j.desc || "", image: j.image || "", site: j.site || "" };
}
