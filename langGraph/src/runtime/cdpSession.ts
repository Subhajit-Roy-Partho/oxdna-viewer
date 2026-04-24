import { PAGE_HELPERS_SOURCE } from "../tools/pageHelpers.js";

type RuntimeEvaluateResult<T> = {
  result: {
    value?: T;
    description?: string;
  };
  exceptionDetails?: {
    text?: string;
    exception?: {
      description?: string;
    };
  };
};

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type OxViewPageTarget = {
  id?: string;
  type?: string;
  title?: string;
  url?: string;
  webSocketDebuggerUrl: string;
};

export class OxViewCDPSession {
  private readonly baseUrl: URL;
  private readonly waitForTargetMs: number;
  private readonly pageTargetMatch: RegExp;
  private ws: WebSocket | null = null;
  private nextId = 0;
  private pending = new Map<number, PendingCall>();
  private helpersInstalled = false;
  private connectedTarget: OxViewPageTarget | null = null;

  constructor(options: {
    baseUrl: string;
    waitForTargetMs?: number;
    pageTargetMatch?: RegExp;
  }) {
    this.baseUrl = new URL(options.baseUrl);
    this.waitForTargetMs = options.waitForTargetMs ?? 20_000;
    this.pageTargetMatch = options.pageTargetMatch ?? /index\.html/i;
  }

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    const target = await this.waitForOxViewTarget();
    this.connectedTarget = target;
    this.ws = new WebSocket(target.webSocketDebuggerUrl);

    await new Promise<void>((resolve, reject) => {
      if (!this.ws) {
        reject(new Error("WebSocket was not created."));
        return;
      }

      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error("Failed to connect to the oxView CDP target."));
      this.ws.onmessage = (event) => this.handleMessage(event);
    });

    await this.call("Runtime.enable");
    await this.ensureHelpersInstalled();
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.pending.clear();
    this.helpersInstalled = false;
    this.connectedTarget = null;
  }

  getTargetInfo(): { id?: string; title?: string; url?: string } | null {
    if (!this.connectedTarget) {
      return null;
    }

    const { id, title, url } = this.connectedTarget;
    return { id, title, url };
  }

  async evaluate<T>(expression: string): Promise<T> {
    await this.connect();

    const result = (await this.call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })) as RuntimeEvaluateResult<T>;

    if (result.exceptionDetails) {
      const description =
        result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        "Unknown CDP evaluation error.";
      throw new Error(description);
    }

    return (result.result.value ?? null) as T;
  }

  async invokeFunction<T>(fn: (...args: any[]) => unknown, ...args: unknown[]): Promise<T> {
    const expression = `(${fn.toString()})(${args.map((arg) => JSON.stringify(arg)).join(", ")})`;
    return this.evaluate<T>(expression);
  }

  async runHelper<T = unknown>(helperName: string, input: unknown = {}): Promise<T> {
    await this.ensureHelpersInstalled();
    const expression = `globalThis.__oxviewLangGraphHelpers.${helperName}(${JSON.stringify(input)})`;
    return this.evaluate<T>(expression);
  }

  private async ensureHelpersInstalled(): Promise<void> {
    if (this.helpersInstalled) {
      return;
    }
    await this.evaluate(PAGE_HELPERS_SOURCE);
    this.helpersInstalled = true;
  }

  private async waitForOxViewTarget(): Promise<OxViewPageTarget> {
    const deadline = Date.now() + this.waitForTargetMs;
    while (Date.now() < deadline) {
      try {
        const targets = await this.fetchJson<OxViewPageTarget[]>("/json/list");
        const pageTarget = targets.find(
          (target) =>
            target.type === "page" &&
            typeof target.url === "string" &&
            this.pageTargetMatch.test(target.url),
        );

        if (pageTarget?.webSocketDebuggerUrl) {
          return pageTarget;
        }
      } catch {
        // Keep polling until the deadline.
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error(
      `Timed out waiting for an oxView page target at ${this.baseUrl.toString()}.`,
    );
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const url = new URL(path, this.baseUrl);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`CDP endpoint ${url} returned ${response.status}.`);
    }
    return (await response.json()) as T;
  }

  private async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    await this.connect();

    if (!this.ws) {
      throw new Error("CDP WebSocket is not connected.");
    }

    const id = ++this.nextId;
    const payload = JSON.stringify({ id, method, params });

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(payload);
    });
  }

  private handleMessage(event: MessageEvent<string>): void {
    const message = JSON.parse(event.data) as {
      id?: number;
      error?: unknown;
      result?: unknown;
    };

    if (!message.id || !this.pending.has(message.id)) {
      return;
    }

    const pending = this.pending.get(message.id)!;
    this.pending.delete(message.id);

    if (message.error) {
      pending.reject(new Error(JSON.stringify(message.error)));
      return;
    }

    pending.resolve(message.result);
  }
}
