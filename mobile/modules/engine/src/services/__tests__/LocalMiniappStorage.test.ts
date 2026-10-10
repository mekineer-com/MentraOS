import {describe, expect, it} from "bun:test"
import {readFileSync} from "node:fs"

import {LocalMiniappStorage, type LocalMiniappStorageBackend} from "../LocalMiniappStorage"

class MemoryBackend implements LocalMiniappStorageBackend {
  readonly values = new Map<string, unknown>()

  get(key: string): unknown | null {
    return this.values.get(key) ?? null
  }

  has(key: string): boolean {
    return this.values.has(key)
  }

  set(key: string, value: unknown): void {
    this.values.set(key, value)
  }

  remove(key: string): void {
    this.values.delete(key)
  }

  keys(): string[] {
    return [...this.values.keys()]
  }
}

describe("LocalMiniappStorage", () => {
  it("survives a host restart because the namespace uses the stable user id", async () => {
    const backend = new MemoryBackend()
    const firstRuntime = new LocalMiniappStorage({backend, getUserId: async () => "mu_123"})
    await firstRuntime.set("com.mentra.translation", "targetLanguage", "fr")

    // A new runtime represents a force-stopped/relaunched host. Its Core access
    // token will be different, but the identity exposed by CloudClient remains
    // the same Mentra user id.
    const restartedRuntime = new LocalMiniappStorage({backend, getUserId: async () => "mu_123"})
    expect(await restartedRuntime.get("com.mentra.translation", "targetLanguage")).toBe("fr")
  })

  it("isolates values by user and package", async () => {
    const backend = new MemoryBackend()
    const userOne = new LocalMiniappStorage({backend, getUserId: async () => "mu_1"})
    const userTwo = new LocalMiniappStorage({backend, getUserId: async () => "mu_2"})

    await userOne.set("com.mentra.translation", "targetLanguage", "de")
    await userOne.set("com.mentra.captions", "targetLanguage", "en")

    expect(await userOne.get("com.mentra.translation", "targetLanguage")).toBe("de")
    expect(await userOne.get("com.mentra.captions", "targetLanguage")).toBe("en")
    expect(await userTwo.get("com.mentra.translation", "targetLanguage")).toBeNull()
  })

  it("refuses to create an anonymous namespace when identity is unavailable", async () => {
    const backend = new MemoryBackend()
    const storage = new LocalMiniappStorage({backend, getUserId: async () => ""})

    await expect(storage.set("com.mentra.translation", "targetLanguage", "es")).rejects.toThrow(
      "Mentra user identity is unavailable",
    )
    expect(backend.keys()).toEqual([])
  })

  it("supports list, bulk read, delete, and clear within one scope", async () => {
    const backend = new MemoryBackend()
    const storage = new LocalMiniappStorage({backend, getUserId: async () => "mu_123"})

    await storage.setMultiple("com.example.app", {alpha: "one", beta: "two", empty: null})
    expect((await storage.keys("com.example.app")).sort()).toEqual(["alpha", "beta", "empty"])
    expect(await storage.getAll("com.example.app")).toEqual({alpha: "one", beta: "two", empty: ""})
    expect(await storage.has("com.example.app", "alpha")).toBe(true)
    expect(await storage.has("com.example.app", "empty")).toBe(true)

    await storage.delete("com.example.app", "alpha")
    expect(await storage.has("com.example.app", "alpha")).toBe(false)
    await storage.clear("com.example.app")
    expect(await storage.keys("com.example.app")).toEqual([])
  })
})

describe("LocalMiniappRuntime storage adapter", () => {
  // Run the shipped boundary without initializing the Expo/native runtime.
  const runtime = readFileSync(new URL("../LocalMiniappRuntime.ts", import.meta.url), "utf8")
  const storage = readFileSync(new URL("../../utils/storage/storage.ts", import.meta.url), "utf8")
  const adapter = runtime.match(/^const localMiniappStorageBackend = \{[\s\S]*?^}/m)?.[0]
  const missingError = storage.match(/^export class StorageValueNotFoundError extends Error \{[\s\S]*?^}/m)?.[0]
  if (!adapter || !missingError) throw new Error("Missing host storage adapter or missing-value error")
  const compiled = new Bun.Transpiler({loader: "ts"}).transformSync(
    `${missingError.replace("export ", "")}\n${adapter}`,
  )
  const createBackend = new Function(
    "mmkvStorage",
    `${compiled}; return {backend: localMiniappStorageBackend, StorageValueNotFoundError}`,
  )

  it.each(["stored", "missing", "invalid JSON", "I/O failure", "lookalike missing error"])(
    "distinguishes %s from an absent key",
    async (outcome) => {
      const value = "fictional recovery journal"
      let error: Error | undefined
      const {backend, StorageValueNotFoundError} = createBackend({
        load: () => ({is_ok: () => error === undefined, value, error}),
      }) as {backend: LocalMiniappStorageBackend; StorageValueNotFoundError: new (key: string) => Error}
      if (outcome === "missing") error = new StorageValueNotFoundError("journal")
      if (outcome === "invalid JSON") error = new SyntaxError("Invalid fictional JSON")
      if (outcome === "I/O failure") error = new Error("Fictional MMKV read failed")
      if (outcome === "lookalike missing error") {
        error = new Error("No value found for journal")
        error.name = "StorageValueNotFoundError"
      }
      const local = new LocalMiniappStorage({backend, getUserId: async () => "mu_test"})
      const read = local.get("com.example.app", "journal")
      if (outcome === "stored") expect(await read).toBe(value)
      else if (outcome === "missing") expect(await read).toBeNull()
      else await expect(read).rejects.toBe(error)
    },
  )
})
