import { readFile } from "node:fs/promises";
import type { Manifest, Share, ShareDetail, ShareVersion, Usage } from "../shared/constants";
import { requireConnection } from "./config";
import { CliError } from "./ui";

export class Client {
  constructor(
    public url: string,
    private token: string,
  ) {}

  static fromConfig() {
    const { url, token } = requireConnection();
    return new Client(url, token);
  }

  private async request<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.url + path, {
        method,
        ...init,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
        body: body !== undefined ? JSON.stringify(body) : init.body,
      });
    } catch (err) {
      throw new CliError(`Could not reach ${this.url}`, `Check your connection, then run \`share doctor\`. (${(err as Error).message})`, "network");
    }
    const text = await res.text();
    let data: any;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new CliError(`Unexpected response from ${this.url} (HTTP ${res.status})`, "Is this a sharecli server? Run `share doctor`.", "bad_response");
    }
    if (!res.ok) {
      const e = data?.error ?? {};
      throw new CliError(e.message ?? `HTTP ${res.status}`, undefined, e.code ?? `http_${res.status}`);
    }
    return data as T;
  }

  health() {
    return this.request<{ sharecli: boolean; version: string; configured: boolean }>("GET", "/api/health");
  }
  usage() {
    return this.request<Usage>("GET", "/api/usage");
  }
  list() {
    return this.request<{ shares: Share[] }>("GET", "/api/shares").then((r) => r.shares);
  }
  get(slug: string) {
    return this.request<ShareDetail>("GET", `/api/shares/${slug}`);
  }
  create(body: { slug?: string; private?: boolean; passcode?: string; ttl_seconds?: number; permanent?: boolean; manifest: Manifest }) {
    return this.request<{ slug: string; version: number; passcode: string | null }>("POST", "/api/shares", body);
  }
  createVersion(slug: string, manifest: Manifest) {
    return this.request<{ slug: string; version: number }>("POST", `/api/shares/${slug}/versions`, { manifest });
  }
  async upload(slug: string, version: number, path: string, absPath: string, type: string) {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    // A buffered body gives the request a Content-Length, which R2 needs to store a stream.
    const body = await readFile(absPath);
    return this.request<{ path: string; size: number }>("PUT", `/api/shares/${slug}/versions/${version}/files/${encoded}`, undefined, {
      headers: { "content-type": type },
      body,
    });
  }
  commit(slug: string, version: number, body: { ttl_seconds?: number; permanent?: boolean } = {}) {
    return this.request<Share>("POST", `/api/shares/${slug}/versions/${version}/commit`, body);
  }
  update(
    slug: string,
    body: { private?: boolean; passcode?: string; regenerate_passcode?: boolean; ttl_seconds?: number; permanent?: boolean; extend?: boolean; title?: string },
  ) {
    return this.request<Share>("PATCH", `/api/shares/${slug}`, body);
  }
  remove(slug: string) {
    return this.request<{ deleted: string }>("DELETE", `/api/shares/${slug}`);
  }
  versions(slug: string) {
    return this.request<{ versions: ShareVersion[] }>("GET", `/api/shares/${slug}/versions`).then((r) => r.versions);
  }
  rollback(slug: string, version?: number) {
    return this.request<Share>("POST", `/api/shares/${slug}/rollback`, version === undefined ? {} : { version });
  }
}
