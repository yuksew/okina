/**
 * 状況更新CLI共通: Worker API クライアント。
 * 必要な環境変数: OKINA_API_URL / OKINA_STATUS_TOKEN（Routinesのクラウド環境 or ローカル.env）
 */

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(
      `ERROR: 環境変数 ${name} が未設定です。Routines環境変数またはローカルの .env を確認してください`,
    );
    process.exit(2);
  }
  return v;
}

export async function api(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const base = requireEnv("OKINA_API_URL").replace(/\/$/, "");
  const token = requireEnv("OKINA_STATUS_TOKEN");
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  let body: unknown;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (res.status === 401) {
    console.error("ERROR: トークン無効（401）。OKINA_STATUS_TOKEN を確認してください");
    process.exit(2);
  }
  return { status: res.status, body };
}
