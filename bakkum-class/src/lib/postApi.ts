// 공지사항 게시판 API — 목록·상세·작성/수정·삭제·미열람 수 + 파일 업로드.

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return (await r.json()) as T;
}
async function jpost<T = { ok?: boolean; id?: string; error?: string }>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  return j;
}

export interface PostFile { name: string; url: string; size: number }
export interface PostListItem {
  id: string;
  title: string;
  audience: "staff" | "all";
  banner: boolean;
  authorName: string;
  editorName: string;
  fileCount: number;
  createdAt: number;
  updatedAt: number;
  read: boolean;
}
export interface PostDetail extends PostListItem {
  body: string;
  files: PostFile[];
  authorSub: string;
}

/** 첨부 파일 업로드 — 원본 파일명 보존. {name,url,size} 반환. */
export async function uploadFile(file: File): Promise<PostFile> {
  const r = await fetch("/api/files", {
    method: "POST",
    headers: { "content-type": file.type || "application/octet-stream", "x-filename": encodeURIComponent(file.name) },
    body: file,
  });
  const j = (await r.json().catch(() => ({}))) as { url?: string; name?: string; size?: number; error?: string };
  if (!r.ok || !j.url) throw new Error(j.error || "upload_failed");
  return { url: j.url, name: j.name || file.name, size: j.size || file.size };
}

export const postApi = {
  list: () => jget<{ posts: PostListItem[] }>("/api/posts").then((j) => j.posts),
  get: (id: string) => jget<{ post: PostDetail }>(`/api/posts/${id}`).then((j) => j.post),
  unseen: () => jget<{ count: number }>("/api/posts/unseen").then((j) => j.count),
  save: (p: { id?: string; title: string; body: string; files: PostFile[]; audience: "staff" | "all"; banner: boolean }) =>
    jpost<{ ok?: boolean; id?: string }>("/api/posts", p),
  remove: (id: string) => jpost("/api/posts/delete", { id }),
};
