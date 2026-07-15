import { afterEach, describe, expect, it, vi } from "vitest";
import { formatBytes, getStorageInfo, requestPersistentStorage } from "./storage";

function stubStorage(storage: Partial<StorageManager> | undefined) {
  vi.stubGlobal("navigator", storage === undefined ? {} : { storage });
}

afterEach(() => vi.unstubAllGlobals());

describe("requestPersistentStorage", () => {
  it("API absente → false, sans jeter", async () => {
    stubStorage(undefined);
    expect(await requestPersistentStorage()).toBe(false);
  });

  it("persistance accordée → true", async () => {
    stubStorage({ persist: async () => true });
    expect(await requestPersistentStorage()).toBe(true);
  });

  it("persistance refusée → false", async () => {
    stubStorage({ persist: async () => false });
    expect(await requestPersistentStorage()).toBe(false);
  });

  it("rejet du navigateur → false, avalé", async () => {
    stubStorage({
      persist: async () => {
        throw new Error("nope");
      },
    });
    expect(await requestPersistentStorage()).toBe(false);
  });
});

describe("getStorageInfo", () => {
  it("rapporte persistance + usage/quota", async () => {
    stubStorage({
      persisted: async () => true,
      estimate: async () => ({ usage: 12_000_000, quota: 1_000_000_000 }),
    });
    expect(await getStorageInfo()).toEqual({ persisted: true, usage: 12_000_000, quota: 1_000_000_000 });
  });

  it("API absente → valeurs par défaut", async () => {
    stubStorage(undefined);
    expect(await getStorageInfo()).toEqual({ persisted: false, usage: undefined, quota: undefined });
  });

  it("estimate en échec → persistance rapportée quand même", async () => {
    stubStorage({
      persisted: async () => true,
      estimate: async () => {
        throw new Error("nope");
      },
    });
    expect(await getStorageInfo()).toEqual({ persisted: true });
  });
});

describe("formatBytes", () => {
  it("choisit l'unité lisible", () => {
    expect(formatBytes(1_500)).toBe("2 ko");
    expect(formatBytes(12_000_000)).toBe("12 Mo");
    expect(formatBytes(1_200_000_000)).toBe("1,2 Go");
  });
});
