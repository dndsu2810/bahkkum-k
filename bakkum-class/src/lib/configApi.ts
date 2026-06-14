// 전역 설정(학원 로고 등) + 파일 업로드(R2).

export async function getConfig(): Promise<Record<string, string>> {
  const r = await fetch("/api/config", { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = (await r.json()) as { config?: Record<string, string> };
  return j.config || {};
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
  if (!r.ok) throw new Error("HTTP " + r.status);
}

/** 이미지 파일을 R2에 올리고 URL을 받는다(원본 바이트 + content-type). */
export async function uploadImage(file: File): Promise<string> {
  const r = await fetch("/api/upload", { method: "POST", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
  const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!r.ok || !j.url) throw new Error(j.error || "upload_failed");
  return j.url;
}
