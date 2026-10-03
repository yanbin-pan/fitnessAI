import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, cacheControlFor } from "../src/app.ts";
import { makeAccess, NOW, openTestDb, tempDir, testApp } from "./helpers.ts";
import type { TestApp } from "./helpers.ts";

let ctx: TestApp | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

describe("authentication", () => {
  it("leaves /api/health open", async () => {
    ctx = await testApp();
    const res = await ctx.app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("answers every other /api route with a bodiless 401 without a valid owner token", async () => {
    ctx = await testApp();
    const intruder = await ctx.auth.token({ email: "intruder@example.com" });
    for (const headers of [{}, { "cf-access-jwt-assertion": "garbage" }, { "cf-access-jwt-assertion": intruder }]) {
      const res = await ctx.app.inject({ method: "GET", url: "/api/anything", headers });
      expect(res.statusCode).toBe(401);
      expect(res.body).toBe("");
    }
  });

  it("lets the owner through to a JSON 404 for unknown API routes", async () => {
    ctx = await testApp();
    const res = await ctx.app.inject({ method: "GET", url: "/api/anything", headers: ctx.headers });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found" });
  });

  it("does not let a query string borrow the health exemption", async () => {
    ctx = await testApp();
    expect((await ctx.app.inject({ method: "GET", url: "/api/anything?next=/api/health" })).statusCode).toBe(401);
  });
});

describe("authentication, however the request spells the path", () => {
  // The router decodes percent-escapes and strips an absolute-form "http://host"
  // prefix before matching, so these spellings must not slip past the auth hook.
  async function appWithSecret() {
    const auth = await makeAccess();
    const database = openTestDb();
    const app = buildApp({ db: database.db, verifier: auth.verifier, now: () => NOW, webDist: null });
    const probe = {
      app,
      auth,
      served: 0,
      close: async () => {
        await app.close();
        database.close();
      },
    };
    app.get("/api/secret", async () => {
      probe.served += 1;
      return { secret: true };
    });
    return probe;
  }

  it("guards API routes reached through percent-escapes", async () => {
    const probe = await appWithSecret();
    try {
      for (const url of ["/%61pi/secret", "/a%70i/secret", "/api/%73ecret"]) {
        const res = await probe.app.inject({ method: "GET", url });
        expect([401, 404], url).toContain(res.statusCode);
      }
      expect(probe.served).toBe(0);
      const owner = { "cf-access-jwt-assertion": await probe.auth.token() };
      expect((await probe.app.inject({ method: "GET", url: "/api/secret", headers: owner })).statusCode).toBe(200);
      expect(probe.served).toBe(1);
    } finally {
      await probe.close();
    }
  });

  it("guards API routes reached through an absolute-form request target", async () => {
    const probe = await appWithSecret();
    try {
      const address = await probe.app.listen({ host: "127.0.0.1", port: 0 });
      const get = (headers: Record<string, string>) =>
        new Promise<number | undefined>((resolve, reject) => {
          http
            .get({ agent: false, host: "127.0.0.1", port: new URL(address).port, path: `${address}/api/secret`, headers }, (res) => {
              res.resume();
              resolve(res.statusCode);
            })
            .on("error", reject);
        });
      expect([401, 404]).toContain(await get({}));
      expect(probe.served).toBe(0);
      expect(await get({ "cf-access-jwt-assertion": await probe.auth.token() })).toBe(200);
      expect(probe.served).toBe(1);
    } finally {
      await probe.close();
    }
  });

  it("guards a route at exactly /api", async () => {
    const probe = await appWithSecret();
    try {
      probe.app.get("/api", async () => {
        probe.served += 1;
        return {};
      });
      for (const url of ["/api", "/api?x=1", "/%61pi"]) {
        expect([401, 404], url).toContain((await probe.app.inject({ method: "GET", url })).statusCode);
      }
      expect(probe.served).toBe(0);
    } finally {
      await probe.close();
    }
  });
});

describe("serving the PWA", () => {
  function webDist(): string {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "index.html"), '<!doctype html><div id="root"></div>');
    fs.mkdirSync(path.join(dir, "assets"));
    fs.writeFileSync(path.join(dir, "assets", "app-abc123.js"), "console.log(1)");
    return dir;
  }

  it("answers app routes with index.html, never cached", async () => {
    ctx = await testApp({ webDist: webDist() });
    const res = await ctx.app.inject({ method: "GET", url: "/day/today" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("serves hashed assets as immutable", async () => {
    ctx = await testApp({ webDist: webDist() });
    const res = await ctx.app.inject({ method: "GET", url: "/assets/app-abc123.js" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("still guards the API when a web build is mounted", async () => {
    ctx = await testApp({ webDist: webDist() });
    const anonymous = await ctx.app.inject({ method: "GET", url: "/api/anything" });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.body).toBe("");
    const owner = await ctx.app.inject({ method: "GET", url: "/api/anything", headers: ctx.headers });
    expect(owner.statusCode).toBe(404);
    expect(owner.json()).toEqual({ error: "not_found" });
    expect((await ctx.app.inject({ method: "GET", url: "/day/today" })).statusCode).toBe(200);
  });

  it("answers 404 when there is no web build", async () => {
    ctx = await testApp();
    expect((await ctx.app.inject({ method: "GET", url: "/" })).statusCode).toBe(404);
  });
});

describe("cacheControlFor", () => {
  it("caches only hashed build assets", () => {
    expect(cacheControlFor("/app/web/dist/assets/index-abc.js")).toBe("public, max-age=31536000, immutable");
    expect(cacheControlFor("/app/web/dist/sw.js")).toBe("no-cache");
    expect(cacheControlFor("/app/web/dist/index.html")).toBe("no-cache");
  });
});
