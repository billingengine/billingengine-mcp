export class BillingEngineError extends Error {}

type Query = Record<string, string | number | undefined>;

export class BillingEngineClient {
  constructor(
    readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async get(path: string, query: Query = {}): Promise<unknown> {
    const response = await this.fetch("GET", path, query);
    return response.json();
  }

  async getFile(path: string): Promise<{ data: Buffer; filename: string }> {
    const response = await this.fetch("GET", path);
    const disposition = response.headers.get("content-disposition") ?? "";
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
    return {
      data: Buffer.from(await response.arrayBuffer()),
      filename: match ? decodeURIComponent(match[1]) : path.split("/").pop()!,
    };
  }

  async post(path: string, body: unknown): Promise<unknown> {
    const response = await this.fetch("POST", path, {}, body);
    return response.json();
  }

  async patch(path: string, body: unknown): Promise<unknown> {
    const response = await this.fetch("PATCH", path, {}, body);
    return response.json();
  }

  private async fetch(method: string, path: string, query: Query = {}, body?: unknown): Promise<Response> {
    const url = new URL(`/api/v1${path}`, this.baseUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "billingengine-mcp",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new BillingEngineError(`BillingEngine could not be reached at ${this.baseUrl}: ${(error as Error).message}`);
    }

    if (!response.ok) throw new BillingEngineError(await describeFailure(response));
    return response;
  }
}

async function describeFailure(response: Response): Promise<string> {
  const text = await response.text();
  let messages: string[] = [];
  try {
    const parsed = JSON.parse(text);
    messages = parsed.errors ?? (parsed.error ? [parsed.error] : []);
  } catch {
    // Not JSON, e.g. a proxy error page.
  }

  switch (response.status) {
    case 401:
      return "The API key was rejected. Check BILLINGENGINE_API_KEY (Settings > API in BillingEngine).";
    case 403:
      return messages.join("; ") || "This API key is not allowed to do that. The API needs a paid plan.";
    case 429:
      return "Too many requests: the limit is 60 per minute. Wait a moment and try again.";
    default:
      return `BillingEngine answered ${response.status}: ${messages.join("; ") || text.slice(0, 200)}`;
  }
}
