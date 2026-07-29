export function createAppsScriptReadClient(input) {
    const timeoutMs = input.timeoutMs ?? 60_000;
    const fetchImpl = input.fetchImpl ?? fetch;
    if (!input.webAppUrl) {
        throw new Error("Apps Script web app URL is required");
    }
    if (!input.sharedSecret) {
        throw new Error("Apps Script shared secret is required");
    }
    return async (action, params) => {
        const url = new URL(input.webAppUrl);
        url.searchParams.set("action", action);
        url.searchParams.set("secret", input.sharedSecret);
        for (const [key, value] of Object.entries(params)) {
            url.searchParams.set(key, value);
        }
        const response = await fetchImpl(url, {
            method: "GET",
            redirect: "follow",
            signal: AbortSignal.timeout(timeoutMs),
        });
        const responseText = await response.text();
        let parsed;
        try {
            parsed = JSON.parse(responseText);
        }
        catch {
            throw new Error("Apps Script returned an invalid JSON response");
        }
        if (!response.ok) {
            throw new Error(`Apps Script request failed with HTTP ${response.status}`);
        }
        return parsed;
    };
}
