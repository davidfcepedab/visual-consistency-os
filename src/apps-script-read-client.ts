import type { BackendReader } from "./safe-read-tools.js";

type FetchLike = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export function createAppsScriptReadClient(input: {
  webAppUrl: string;
  sharedSecret: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}): BackendReader {
  const timeoutMs = input.timeoutMs ?? 60_000;
  const fetchImpl = input.fetchImpl ?? fetch;

  if (!input.webAppUrl) {
    throw new Error("Apps Script web app URL is required");
  }
  if (!input.sharedSecret) {
    throw new Error("Apps Script shared secret is required");
  }

  return async (
    action: string,
    params: Record<string, string>
  ): Promise<unknown> => {
    const url = new URL(input.webAppUrl);
    url.searchParams.set("secret", input.sharedSecret);

    // Exhaustive Drive cursors can legitimately exceed conservative GET URL
    // limits. This remains a read operation, but transports its cursor in a
    // JSON POST body so no continuation state is truncated by intermediaries.
    const usePost = action === "library_snapshot";
    if (!usePost) url.searchParams.set("action", action);

    if (!usePost) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetchImpl(url, {
      method: usePost ? "POST" : "GET",
      ...(usePost
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action, ...params }),
          }
        : {}),
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const responseText = await response.text();

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      throw new Error("Apps Script returned an invalid JSON response");
    }

    if (!response.ok) {
      throw new Error(
        `Apps Script request failed with HTTP ${response.status}`
      );
    }

    return parsed;
  };
}
