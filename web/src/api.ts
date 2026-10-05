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

/** The ApiError a response stands for, or null when it is a success. A redirect or a 401 means the Access session expired. */
export async function responseError(res: Response): Promise<ApiError | null> {
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400) || res.status === 401) {
    for (const listener of signedOutListeners) {
      try {
        listener();
      } catch {
        // A failing listener must not hide the sign-out or starve the listeners after it.
      }
    }
    return new ApiError("signed_out", res.status, "signed_out", "Signed out");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    const code = typeof body?.error === "string" ? body.error : "http_error";
    return new ApiError("http", res.status, code, `Request failed (${res.status})`);
  }
  return null;
}

export async function api<T>(path: string, options: { method?: string; json?: unknown; blob?: Blob } = {}): Promise<T> {
  const hasJson = options.json !== undefined;
  const blob = options.blob;
  let res: Response;
  try {
    res = await fetch(path, {
      method: options.method ?? (hasJson || blob ? "POST" : "GET"),
      // Our API never redirects. Asking to see redirects is how an expired Access
      // session (a redirect to its login page) is told apart from being offline.
      redirect: "manual",
      credentials: "same-origin",
      headers: hasJson
        ? { "content-type": "application/json" }
        : blob
          ? { "content-type": blob.type || "application/octet-stream" }
          : undefined,
      body: hasJson ? JSON.stringify(options.json) : blob,
    });
  } catch {
    throw new ApiError("offline", 0, "offline", "You appear to be offline.");
  }

  const failure = await responseError(res);
  if (failure) throw failure;
  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError("http", res.status, "bad_response", "The server sent something that is not JSON.");
  }
}
