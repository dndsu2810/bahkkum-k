// 카카오워크 발송. 두 방식 지원:
//  1) Incoming Webhook (권장·간단): KAKAO_WEBHOOK_URL 로 JSON POST → 연결된 대화방에 전송.
//  2) Bot API: KAKAO_WORK_TOKEN + KAKAO_WORK_RECIPIENT(이메일/user id)로 1:1 발송.
// 둘 다 없으면 조용히 건너뛴다(테스트 모드).

interface KakaoEnv {
  KAKAO_WEBHOOK_URL?: string;
  KAKAO_WORK_TOKEN?: string;
  KAKAO_WORK_RECIPIENT?: string;
}

export interface KakaoResult {
  sent: boolean;
  reason?: string;
  status?: number;
  body?: string;
}

export interface KakaoButton {
  label: string;
  url: string;
}

/** 텍스트(+선택 헤더·버튼) 발송. 웹훅이 있으면 웹훅, 없으면 봇 API, 둘 다 없으면 sent:false.
 *  header를 주면 카드 상단에 파란 제목 띠가 붙는다(카드형 레이아웃). */
export async function sendKakao(env: KakaoEnv, text: string, button?: KakaoButton, header?: string): Promise<KakaoResult> {
  if (env.KAKAO_WEBHOOK_URL) return sendViaWebhook(env.KAKAO_WEBHOOK_URL, text, button, header);
  if (env.KAKAO_WORK_TOKEN && env.KAKAO_WORK_RECIPIENT) return sendViaBotApi(env.KAKAO_WORK_TOKEN, env.KAKAO_WORK_RECIPIENT, text, button, header);
  return { sent: false, reason: "no_webhook_or_token" };
}

/** (선택) 헤더 띠 + 본문 텍스트 블록 + (선택) 버튼 블록. fallback text엔 제목·링크를 같이 넣는다. */
function buildBlocks(text: string, button?: KakaoButton, header?: string) {
  const blocks: Record<string, unknown>[] = [];
  if (header) blocks.push({ type: "header", text: header, style: "blue" });
  blocks.push({ type: "text", text, markdown: false });
  if (button) {
    blocks.push({ type: "divider" });
    blocks.push({ type: "button", text: button.label, style: "primary", action_type: "open_system_browser", value: button.url });
  }
  const fallback = [header, text, button ? `${button.label}: ${button.url}` : ""].filter(Boolean).join("\n\n");
  return { text: fallback, blocks };
}

/** Incoming Webhook — hook URL로 POST. */
async function sendViaWebhook(url: string, text: string, button?: KakaoButton, header?: string): Promise<KakaoResult> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildBlocks(text, button, header)),
  });
  const body = await res.text();
  return { sent: res.ok, status: res.status, body: body.slice(0, 300), reason: res.ok ? undefined : "webhook_failed" };
}

/** Bot API — 이메일이면 user 조회 → DM open → send. */
async function sendViaBotApi(token: string, recipient: string, text: string, button?: KakaoButton, header?: string): Promise<KakaoResult> {
  let userId = recipient;
  if (recipient.includes("@")) {
    const u = await kfetch(token, `https://api.kakaowork.com/v1/users.find_by_email?email=${encodeURIComponent(recipient)}`);
    const uj = (await u.json()) as { user?: { id?: string | number } };
    if (!uj.user?.id) return { sent: false, reason: "user_not_found", status: u.status, body: JSON.stringify(uj) };
    userId = String(uj.user.id);
  }
  const open = await kfetch(token, "https://api.kakaowork.com/v1/conversations.open", "POST", { user_id: Number(userId) });
  const oj = (await open.json()) as { conversation?: { id?: string | number } };
  const convId = oj.conversation?.id;
  if (!convId) return { sent: false, reason: "open_failed", status: open.status, body: JSON.stringify(oj) };
  const send = await kfetch(token, "https://api.kakaowork.com/v1/messages.send", "POST", {
    conversation_id: Number(convId),
    ...buildBlocks(text, button, header),
  });
  const sj = (await send.json()) as { success?: boolean };
  if (!sj.success) return { sent: false, reason: "send_failed", status: send.status, body: JSON.stringify(sj) };
  return { sent: true, status: send.status };
}

function kfetch(token: string, url: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<Response> {
  return fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}
