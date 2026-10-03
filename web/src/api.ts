// Every call to the server goes through api(). The rule: a request either
// resolves with JSON or throws an ApiError that says what kind of failure it was.

export type ApiErrorKind = "signed_out" | "offline" | "http";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly code: string;

  constructor(kind: ApiErrorKind, status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

const signedOutListeners = new Set<() => void>();

/** Called whenever a request discovers the Access session has expired. */
export function onSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener);
  return () => {
    signedOutListeners.delete(listener);
  };
}

export async function api<T>(path: string, options: { method?: string; json?: unknown } = {}): Promise<T> {
  const hasBody = options.json !== undefined;
  let res: Response;
  try {
    res = await fetch(path, {
      method: options.method ?? (hasBody ? "POST" : "GET"),
      // Our API never redirects. Asking to see redirects is how an expired Access
      // session (a redirect to its login page) is told apart from being offline.
      redirect: "manual",
      credentials: "same-origin",
      headers: hasBody ? { "content-type": "application/json" } : undefined,
      body: hasBody ? JSON.stringify(options.json) : undefined,
    });
  } catch {
    throw new ApiError("offline", 0, "offline", "You appear to be offline.");
  }

  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400) || res.status === 401) {
    for (const listener of signedOutListeners) listener();
    throw new ApiError("signed_out", res.status, "signed_out", "Signed out");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError("http", res.status, body.error ?? "http_error", `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
