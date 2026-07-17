// Proxy d'articles : matrice SSRF de validateArticleUrl, redirections re-validées,
// content-type, cap de taille. fetch global mocké.
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleArticleFetch, validateArticleUrl } from "./articleProxy";

const CORS = { "Access-Control-Allow-Origin": "*" };
function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS, ...headers },
  });
}

function fetchReq(url: unknown): Request {
  return new Request("https://worker.test/article/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
}

function htmlResponse(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", ...headers },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("validateArticleUrl — matrice SSRF", () => {
  const refused = [
    "not a url",
    "file:///etc/passwd",
    "ftp://example.jp/a",
    "http://user:pass@example.jp/a",
    "http://example.jp:8080/a",
    "http://localhost/admin",
    "http://foo.local/a",
    "http://foo.internal/a",
    "http://foo.localhost/a",
    "http://router.home.arpa/a",
    "http://intranet/a",
    "http://127.0.0.1/a",
    "http://10.0.0.1/a",
    "http://172.16.0.1/a",
    "http://192.168.1.1/a",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1/a",
    "http://0.0.0.0/a",
    "http://2130706433/a", // 127.0.0.1 en décimal, normalisé par URL
    "http://0x7f000001/a", // 127.0.0.1 en hexa
    "http://[::1]/a",
    "http://[fc00::1]/a",
    "http://[fe80::1]/a",
    "http://[::ffff:127.0.0.1]/a",
  ];
  for (const url of refused) {
    it(`refuse ${url}`, () => {
      expect(validateArticleUrl(url)).toHaveProperty("error");
    });
  }

  const accepted = [
    "https://www3.nhk.or.jp/news/easy/article1.html",
    "http://example.jp/article",
    "https://news.yahoo.co.jp/articles/abc123?page=2",
  ];
  for (const url of accepted) {
    it(`accepte ${url}`, () => {
      expect(validateArticleUrl(url)).toHaveProperty("url");
    });
  }
});

describe("handleArticleFetch", () => {
  it("400 si le corps n'a pas d'url", async () => {
    const res = await handleArticleFetch(fetchReq(undefined), json, CORS);
    expect(res.status).toBe(400);
  });

  it("400 si l'URL est refusée, sans aucun fetch sortant", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const res = await handleArticleFetch(fetchReq("http://169.254.169.254/"), json, CORS);
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it("renvoie les octets bruts avec Content-Type et X-Final-Url", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse("<html>猫</html>")));
    const res = await handleArticleFetch(fetchReq("https://example.jp/a"), json, CORS);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("X-Final-Url")).toBe("https://example.jp/a");
    expect(await res.text()).toContain("猫");
  });

  it("suit une redirection valide et expose l'URL finale", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 301, headers: { Location: "https://example.jp/final" } }),
      )
      .mockResolvedValueOnce(htmlResponse("<html>ok</html>"));
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleArticleFetch(fetchReq("https://example.jp/a"), json, CORS);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Final-Url")).toBe("https://example.jp/final");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuse une redirection vers un hôte interne (400, pas de second fetch)", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleArticleFetch(fetchReq("https://example.jp/a"), json, CORS);
    expect(res.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("502 après trop de redirections", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, { status: 302, headers: { Location: "https://example.jp/loop" } }),
      ),
    );
    const res = await handleArticleFetch(fetchReq("https://example.jp/a"), json, CORS);
    expect(res.status).toBe(502);
  });

  it("415 si la réponse n'est pas du HTML", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } })),
    );
    const res = await handleArticleFetch(fetchReq("https://example.jp/data.json"), json, CORS);
    expect(res.status).toBe(415);
  });

  it("413 au-delà du cap de 2 Mo", async () => {
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(big, { status: 200, headers: { "Content-Type": "text/html" } })),
    );
    const res = await handleArticleFetch(fetchReq("https://example.jp/big"), json, CORS);
    expect(res.status).toBe(413);
  });

  it("502 si la page répond en erreur", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404, headers: { "Content-Type": "text/html" } })),
    );
    const res = await handleArticleFetch(fetchReq("https://example.jp/404"), json, CORS);
    expect(res.status).toBe(502);
  });
});
