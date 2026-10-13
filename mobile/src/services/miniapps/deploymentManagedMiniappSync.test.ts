import {Directory, File, Paths} from "expo-file-system"
import {engine, SETTINGS} from "@mentra/engine"
import {createMMKV} from "react-native-mmkv"
import {LogoutUtils} from "@/utils/LogoutUtils"
import {storage} from "@/utils/storage"
import registry from "../../../modules/engine/src/services/AppRegistry"
import {createConsumerDeployment} from "@/services/deployment/officialManifest"
import {deploymentStore} from "@/services/deployment/store"
import type {WorkspaceDeployment} from "@/services/deployment/types"
import {deploymentManagedMiniappSync} from "./deploymentManagedMiniappSync"
import {shouldHideMiniapp} from "./miniappVisibility"

let mockDigest = "a".repeat(64)
let mockScript = "verified call"
let mockVersion = "2.1.29"
let mockPackageName = "com.mentra.call"
const mockDownload = jest.fn()
const mockCancelDownload = jest.fn()
const mockUnzip = jest.fn()
const mockMove = jest.fn()
const mockDirectoryDelete = jest.fn()
const mockGetPreinstalledRegistry = jest.fn()

jest.mock("@/services/MantleManager", () => ({__esModule: true, default: {cleanup: jest.fn(async () => {})}}))
jest.mock("@/services/cloudClient", () => ({
  cloudClient: {
    clearAuthSession: jest.fn(async () => {}),
    getPreinstalledMiniappRegistry: (...args: unknown[]) => mockGetPreinstalledRegistry(...args),
  },
}))
jest.mock("@/utils/auth/authClient", () => ({
  __esModule: true,
  default: {signOut: jest.fn(async () => ({is_error: () => false}))},
}))
jest.mock("@/utils/settleFrame", () => ({settleFrame: jest.fn(async () => {})}))
jest.mock("react-native-mmkv", () => {
  const stores = new Map<string, Map<string, string>>()
  return {
    createMMKV: ({id = "default"} = {}) => {
      if (!stores.has(id)) stores.set(id, new Map())
      const values = stores.get(id)!
      return {
        getString: (key: string) => values.get(key),
        set: (key: string, value: string) => values.set(key, value),
        remove: (key: string) => values.delete(key),
        clearAll: () => values.clear(),
        getAllKeys: () => [...values.keys()],
      }
    },
  }
})

jest.mock("expo-file-system", () => {
  const fs = require("node:fs")
  const path = require("node:path")
  const root = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "managed-call-test-"))
  const uri = (parts: Array<string | {uri: string}>) =>
    path.join(...parts.map((p) => (typeof p === "string" ? p : p.uri)))
  class TestFile {
    uri: string
    constructor(...parts: Array<string | {uri: string}>) {
      this.uri = uri(parts)
    }
    get name() {
      return path.basename(this.uri)
    }
    get exists() {
      return fs.existsSync(this.uri)
    }
    get size() {
      return fs.statSync(this.uri).size
    }
    textSync() {
      return fs.readFileSync(this.uri, "utf8")
    }
    async bytes() {
      return Uint8Array.from(fs.readFileSync(this.uri))
    }
    write(value: string) {
      fs.mkdirSync(path.dirname(this.uri), {recursive: true})
      fs.writeFileSync(this.uri, value)
    }
    delete() {
      fs.rmSync(this.uri)
    }
    move(target: TestDirectory) {
      mockMove(this.uri, target.uri)
      const dest = path.join(target.uri, this.name)
      fs.renameSync(this.uri, dest)
      this.uri = dest
    }
    static async downloadFileAsync(url: string, target: TestFile | TestDirectory) {
      await mockDownload(url)
      const file = target instanceof TestDirectory ? new TestFile(target, "bundle.zip") : target
      file.write("archive")
      return file
    }
  }
  class TestDirectory {
    uri: string
    constructor(...parts: Array<string | {uri: string}>) {
      this.uri = uri(parts)
    }
    get name() {
      return path.basename(this.uri)
    }
    get exists() {
      return fs.existsSync(this.uri)
    }
    create() {
      fs.mkdirSync(this.uri, {recursive: true})
    }
    list() {
      return fs
        .readdirSync(this.uri, {withFileTypes: true})
        .map((entry: {name: string; isDirectory: () => boolean}) =>
          entry.isDirectory() ? new TestDirectory(this.uri, entry.name) : new TestFile(this.uri, entry.name),
        )
    }
    delete() {
      mockDirectoryDelete(this.uri)
      fs.rmSync(this.uri, {recursive: true, force: true})
    }
    move(target: TestDirectory) {
      mockMove(this.uri, target.uri)
      const dest = target.exists ? path.join(target.uri, this.name) : target.uri
      fs.renameSync(this.uri, dest)
      this.uri = dest
    }
  }
  return {
    File: TestFile,
    Directory: TestDirectory,
    Paths: {document: path.join(root, "documents"), cache: path.join(root, "cache")},
  }
})
jest.mock("expo-file-system/legacy", () => ({
  createDownloadResumable: (url: string, fileUri: string) => {
    let cancelled = false
    return {
      downloadAsync: async () => {
        await mockDownload(url)
        if (cancelled) return undefined
        const {File} = require("expo-file-system")
        new File(fileUri).write("archive")
        return {uri: fileUri, status: 200}
      },
      cancelAsync: async () => {
        cancelled = true
        await mockCancelDownload()
      },
    }
  },
}))
jest.mock("react-native-zip-archive", () => ({
  unzip: async (_zip: string, target: string) => {
    await mockUnzip()
    const {File} = require("expo-file-system")
    new File(target, "miniapp.json").write(JSON.stringify({packageName: mockPackageName, version: mockVersion}))
    new File(target, "call.js").write(mockScript)
    new File(target, "ui", "index.js").write("verified nested UI")
  },
}))
jest.mock("../../../modules/engine/src/utils/storage/zip", () => ({printDirectory: jest.fn()}))
jest.mock("@mentra/engine-host-internal", () => ({
  appRegistry: jest.requireActual("../../../modules/engine/src/services/AppRegistry").default,
}))
jest.mock("./preinstalledMiniappSync", () => ({sha256Hex: async () => mockDigest}))
jest.mock("./miniappZipPreflight", () => ({preflightMiniappZip: jest.fn()}))

const pkg = "com.mentra.call"
const version = "2.1.29"
const consumer = createConsumerDeployment()
const workspace: WorkspaceDeployment = {
  kind: "workspace",
  source: "manual",
  activatedAt: "2026-09-22T00:00:00Z",
  workspaceOrigin: "https://enterprise.example",
  manifestUrl: "https://enterprise.example/.well-known/mentra-deployment.json",
  manifest: {
    ...consumer.manifest,
    deploymentId: "enterprise",
    features: {...consumer.manifest.features, nativeMeetings: true},
    miniapps: {
      configuration: {},
      managed: [
        {packageName: pkg, version, bundleUrl: "https://enterprise.example/miniapps/call.zip", sha256: "a".repeat(64)},
      ],
    },
  },
}
const installedScript = () => new File(Paths.document, "lmas", pkg, version, "call.js").textSync()

beforeEach(async () => {
  await deploymentManagedMiniappSync.cancel()
  const fs = require("node:fs")
  for (const dir of [Paths.document, Paths.cache]) fs.rmSync(dir, {recursive: true, force: true})
  mockDownload.mockReset()
  mockCancelDownload.mockReset()
  mockUnzip.mockReset()
  mockMove.mockReset()
  mockDirectoryDelete.mockReset()
  mockGetPreinstalledRegistry.mockReset()
  mockDigest = "a".repeat(64)
  mockScript = "verified call"
  mockVersion = "2.1.29"
  mockPackageName = pkg
  jest.spyOn(deploymentStore, "getActive").mockReturnValue(workspace)
  expect((await registry.installFromLocalZip("consumer.zip")).is_ok()).toBe(true)
  expect(registry.getReleaseIdentity(pkg, version)?.source).toBe("bundled_asset")
})
afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})
afterAll(() => require("node:fs").rmSync(require("node:path").dirname(Paths.document), {recursive: true, force: true}))

it("adopts an identical verified consumer release and restores consumer installation on workspace exit", async () => {
  storage.save("mentra.account.accessToken", "test-session")
  await LogoutUtils.performCompleteLogout()
  expect(storage.load("mentra.account.accessToken").is_error()).toBe(true)
  expect(registry.getReleaseIdentity(pkg, version)?.source).toBe("bundled_asset")
  expect(shouldHideMiniapp(pkg, version)).toBe(true)
  await deploymentManagedMiniappSync.sync(workspace)
  expect(mockDownload).toHaveBeenCalledTimes(1)
  expect(shouldHideMiniapp(pkg, version)).toBe(false)
  expect(registry.getReleaseIdentity(pkg, version)).toMatchObject({
    source: "deployment_manifest",
    deploymentId: "enterprise",
  })
  expect(installedScript()).toBe("verified call")
  await deploymentManagedMiniappSync.sync(workspace)
  expect(mockDownload).toHaveBeenCalledTimes(1)
  await LogoutUtils.performCompleteLogout()
  expect(registry.getReleaseIdentity(pkg, version)?.source).toBe("deployment_manifest")
  jest.spyOn(deploymentStore, "getActive").mockReturnValue(consumer)
  await deploymentManagedMiniappSync.sync(consumer)
  expect(registry.getInstalledVersions(pkg)).toEqual([])
  expect((await registry.installFromLocalZip("consumer.zip")).is_ok()).toBe(true)
  expect(registry.getReleaseIdentity(pkg, version)?.source).toBe("bundled_asset")
})

it.each(["digest", "contents", "extra file"])(
  "preserves consumer files on %s mismatch and permits a verified retry",
  async (failure) => {
    if (failure === "digest") mockDigest = "b".repeat(64)
    if (failure === "contents") mockScript = "different workspace call"
    const extra = new File(Paths.document, "lmas", pkg, version, "extra.js")
    if (failure === "extra file") extra.write("unexpected code")
    await deploymentManagedMiniappSync.sync(workspace)
    expect(shouldHideMiniapp(pkg, version)).toBe(true)
    expect(registry.getReleaseIdentity(pkg, version)?.source).toBe("bundled_asset")
    expect(installedScript()).toBe("verified call")
    mockDigest = "a".repeat(64)
    mockScript = "verified call"
    if (extra.exists) extra.delete()
    await deploymentManagedMiniappSync.sync(workspace)
    expect(shouldHideMiniapp(pkg, version)).toBe(false)
  },
)

it("does not adopt a same-version release owned by another workspace", async () => {
  await registry.installFromLocalZip("foreign.zip", {
    releaseIdentity: {
      source: "deployment_manifest",
      deploymentId: "other",
      deploymentOrigin: "https://other.example",
      bundleSha256: "a".repeat(64),
    },
  })
  await deploymentManagedMiniappSync.sync(workspace)
  expect(mockDownload).not.toHaveBeenCalled()
  expect(shouldHideMiniapp(pkg, version)).toBe(true)
  expect(registry.getReleaseIdentity(pkg, version)?.deploymentId).toBe("other")
})

it.each(["consumer", "workspace"])(
  "recovers legacy %s files whose ownership was erased by an older logout",
  async (source) => {
    if (source === "workspace") await deploymentManagedMiniappSync.sync(workspace)
    createMMKV({id: "mentra-miniapp-installations"}).remove(`miniapp_release_identity:${pkg}:${version}`)
    await LogoutUtils.performCompleteLogout()
    expect(registry.getReleaseIdentity(pkg, version)).toBeNull()
    mockDigest = "b".repeat(64)
    await deploymentManagedMiniappSync.sync(workspace)
    expect(registry.getReleaseIdentity(pkg, version)).toBeNull()
    expect(installedScript()).toBe("verified call")
    mockDigest = "a".repeat(64)
    await deploymentManagedMiniappSync.sync(workspace)
    expect(shouldHideMiniapp(pkg, version)).toBe(false)
    await LogoutUtils.performCompleteLogout()
    jest.spyOn(deploymentStore, "getActive").mockReturnValue(consumer)
    await deploymentManagedMiniappSync.sync(consumer)
    expect(registry.getInstalledVersions(pkg)).toEqual([])
  },
)

it("migrates legacy ownership before the session store is cleared", async () => {
  const key = `miniapp_release_identity:${pkg}:${version}`
  createMMKV({id: "mentra-miniapp-installations"}).remove(key)
  storage.save(key, {source: "bundled_asset"})
  expect(registry.getReleaseIdentity(pkg, version)?.source).toBe("bundled_asset")
  await LogoutUtils.performCompleteLogout()
  expect(registry.getReleaseIdentity(pkg, version)?.source).toBe("bundled_asset")
})

it("adopts a byte-identical consumer registry release after logout", async () => {
  await registry.installFromLocalZip("consumer-registry.zip", {
    releaseIdentity: {source: "preinstalled_registry", releaseId: "consumer-release"},
  })
  await LogoutUtils.performCompleteLogout()
  await deploymentManagedMiniappSync.sync(workspace)
  expect(shouldHideMiniapp(pkg, version)).toBe(false)
  expect(registry.getReleaseIdentity(pkg, version)?.source).toBe("deployment_manifest")
})

it("refreshes cached app metadata when recovering the workspace pin over a newer installed consumer version", async () => {
  await deploymentManagedMiniappSync.sync(workspace)
  mockVersion = "2.1.30"
  expect((await registry.installFromLocalZip("newer-consumer.zip")).is_ok()).toBe(true)
  expect((await registry.getInstalledMiniapps()).find((app) => app.packageName === pkg)?.version).toBe("2.1.30")
  mockVersion = version
  await deploymentManagedMiniappSync.sync(workspace)
  expect(await registry.getActiveVersion(pkg)).toBe(version)
  expect((await registry.getInstalledMiniapps()).find((app) => app.packageName === pkg)?.version).toBe(version)
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return {promise, resolve}
}

it("keeps workspace B's verified Call when A's older download finishes later", async () => {
  await registry.uninstall(pkg, version)
  const started = deferred()
  const download = deferred()
  mockDownload.mockImplementationOnce(() => {
    started.resolve()
    return download.promise
  })
  const oldSync = deploymentManagedMiniappSync.sync(workspace)
  await started.promise
  const other: WorkspaceDeployment = {
    ...workspace,
    workspaceOrigin: "https://other.example",
    manifest: {...workspace.manifest, deploymentId: "other"},
  }
  jest.spyOn(deploymentStore, "getActive").mockReturnValue(other)
  await deploymentManagedMiniappSync.sync(other)
  expect(shouldHideMiniapp(pkg, version)).toBe(false)
  expect(registry.getReleaseIdentity(pkg, version)?.deploymentId).toBe("other")
  download.resolve()
  await oldSync
  // Let the cancelled native download finish writing its private cache file.
  await new Promise((resolve) => setImmediate(resolve))
  expect(shouldHideMiniapp(pkg, version)).toBe(false)
  expect(installedScript()).toBe("verified call")
  expect(JSON.parse(new File(Paths.document, "deployment-managed-miniapps.json").textSync()).deploymentId).toBe("other")
})

it.each(["workspace exit", "logout"])(
  "cancels a download on %s without changing the consumer bundle",
  async (reason) => {
    const started = deferred()
    const download = deferred()
    mockDownload.mockImplementationOnce(() => {
      started.resolve()
      return download.promise
    })
    const oldSync = deploymentManagedMiniappSync.sync(workspace)
    await started.promise
    if (reason === "workspace exit") {
      jest.spyOn(deploymentStore, "getActive").mockReturnValue(consumer)
      await deploymentManagedMiniappSync.sync(consumer)
    } else {
      await deploymentManagedMiniappSync.cancel()
    }
    await oldSync
    download.resolve()
    await new Promise((resolve) => setImmediate(resolve))
    expect(registry.getReleaseIdentity(pkg, version)?.source).toBe("bundled_asset")
    expect(installedScript()).toBe("verified call")
    expect(new File(Paths.document, "deployment-managed-miniapps.json").exists).toBe(false)
  },
)

it("finishes and records an in-flight unzip before workspace exit cleans its ownership", async () => {
  await registry.uninstall(pkg, version)
  const started = deferred()
  const unzip = deferred()
  mockUnzip.mockImplementationOnce(() => {
    started.resolve()
    return unzip.promise
  })
  const oldSync = deploymentManagedMiniappSync.sync(workspace)
  await started.promise
  jest.spyOn(deploymentStore, "getActive").mockReturnValue(consumer)
  const exit = deploymentManagedMiniappSync.sync(consumer)
  unzip.resolve()
  await Promise.all([oldSync, exit])
  expect(registry.getInstalledVersions(pkg)).toEqual([])
  expect(new File(Paths.document, "deployment-managed-miniapps.json").exists).toBe(false)
})

it("rolls back only its own partially moved bundle and permits a retry", async () => {
  await registry.uninstall(pkg, version)
  mockMove.mockImplementationOnce(() => {
    throw new Error("disk write failed")
  })
  await deploymentManagedMiniappSync.sync(workspace)
  expect(registry.getInstalledVersions(pkg)).toEqual([])
  await deploymentManagedMiniappSync.sync(workspace)
  expect(shouldHideMiniapp(pkg, version)).toBe(false)
})

it("does not let a late consumer registry download overwrite a verified workspace release", async () => {
  await engine.settings.set(SETTINGS.show_mentra_call_ios.key, true)
  await registry.uninstall(pkg, version)
  const started = deferred()
  const download = deferred()
  mockDownload.mockImplementationOnce(() => {
    started.resolve()
    return download.promise
  })
  const consumerSync = jest.requireActual<typeof import("./preinstalledMiniappSync")>("./preinstalledMiniappSync")
  mockGetPreinstalledRegistry.mockResolvedValue({
    entries: [
      {
        packageName: pkg,
        version,
        bundleUrl: "https://consumer.example/call.zip",
        bundleSha256: require("node:crypto").createHash("sha256").update("archive").digest("hex"),
        channel: "dev",
        installPolicy: "keep_updated",
      },
    ],
  })
  jest.spyOn(deploymentStore, "getActive").mockReturnValue(consumer)
  const oldSync = consumerSync.preinstalledMiniappSync.sync()
  await started.promise
  jest.spyOn(deploymentStore, "getActive").mockReturnValue(workspace)
  await deploymentManagedMiniappSync.sync(workspace)
  expect(shouldHideMiniapp(pkg, version)).toBe(false)
  download.resolve()
  await oldSync
  expect(registry.getReleaseIdentity(pkg, version)?.deploymentId).toBe("enterprise")
  expect(shouldHideMiniapp(pkg, version)).toBe(false)
  await engine.settings.set(SETTINGS.show_mentra_call_ios.key, false)
})

it("models directory promotion to an absent path and updates the source URI", () => {
  const source = new Directory(Paths.cache, "source")
  source.create()
  new File(source, "nested", "entry.js").write("complete bundle")
  const target = new Directory(Paths.cache, "destination")
  source.move(target)
  expect(source.uri).toBe(target.uri)
  expect(new Directory(Paths.cache, "source").exists).toBe(false)
  expect(new File(target, "nested", "entry.js").textSync()).toBe("complete bundle")
  const parent = new Directory(Paths.cache, "parent")
  parent.create()
  source.move(parent)
  expect(source.uri).toBe(new Directory(parent, "destination").uri)
})

it("retains same-version contents, active pointer and metadata when promotion fails", async () => {
  const identity = registry.getReleaseIdentity(pkg, version)
  const active = storage.load<string>(`${pkg}_active_version`)
  const oldManifest = new File(Paths.document, "lmas", pkg, version, "miniapp.json").textSync()
  const extra = new File(Paths.document, "lmas", pkg, version, "old-only.js")
  extra.write("keep on failed repair")
  mockScript = "replacement call"
  mockMove.mockImplementation((source: string) => {
    if (source.startsWith(new Directory(Paths.cache, "lma_unzip").uri)) {
      throw new Error("promotion failed")
    }
  })
  const result = await registry.installFromLocalZip("repair.zip", {releaseIdentity: {source: "direct_download"}})
  expect(result.is_error()).toBe(true)
  expect(installedScript()).toBe("verified call")
  expect(extra.textSync()).toBe("keep on failed repair")
  expect(new File(Paths.document, "lmas", pkg, version, "miniapp.json").textSync()).toBe(oldManifest)
  expect(new File(Paths.document, "lmas", pkg, version, "ui", "index.js").textSync()).toBe("verified nested UI")
  expect(storage.load<string>(`${pkg}_active_version`)).toEqual(active)
  expect(registry.getReleaseIdentity(pkg, version)).toEqual(identity)
  expect(registry.getInstalledVersions(pkg)).toEqual([version])
})

it("replaces a complete same-version bundle and removes obsolete files", async () => {
  const extra = new File(Paths.document, "lmas", pkg, version, "old-only.js")
  extra.write("obsolete")
  mockScript = "replacement call"
  const result = await registry.installFromLocalZip("repair.zip", {releaseIdentity: {source: "direct_download"}})
  expect(result.is_ok()).toBe(true)
  expect(installedScript()).toBe("replacement call")
  expect(extra.exists).toBe(false)
  expect(new File(Paths.document, "lmas", pkg, version, "ui", "index.js").textSync()).toBe("verified nested UI")
  expect(await registry.getActiveVersion(pkg)).toBe(version)
  expect(registry.getReleaseIdentity(pkg, version)?.source).toBe("direct_download")
  expect(registry.getInstalledVersions(pkg)).toEqual([version])
})

it("does not promote the replacement when moving the old version to backup fails", async () => {
  const failure = new Error("backup move failed")
  const errors = jest.spyOn(console, "error").mockImplementation(() => {})
  const identity = registry.getReleaseIdentity(pkg, version)
  const active = storage.load<string>(`${pkg}_active_version`)
  mockMove.mockClear()
  mockMove.mockImplementationOnce(() => {throw failure})
  mockScript = "replacement call"
  expect((await registry.installFromLocalZip("repair.zip")).is_error()).toBe(true)
  expect(mockMove).toHaveBeenCalledTimes(1)
  expect(installedScript()).toBe("verified call")
  expect(storage.load<string>(`${pkg}_active_version`)).toEqual(active)
  expect(registry.getReleaseIdentity(pkg, version)).toEqual(identity)
  expect(errors).toHaveBeenCalledWith(expect.any(String), failure)
})

it("logs promotion and cleanup failures without reporting a successful repair", async () => {
  const promotionFailure = new Error("partial promotion failed")
  const cleanupFailure = new Error("partial destination cleanup failed")
  const errors = jest.spyOn(console, "error").mockImplementation(() => {})
  const identity = registry.getReleaseIdentity(pkg, version)
  const active = storage.load<string>(`${pkg}_active_version`)
  const target = new Directory(Paths.document, "lmas", pkg, version)
  mockMove.mockClear()
  mockMove.mockImplementation((source: string, destination: string) => {
    if (source === new Directory(Paths.cache, "lma_unzip").uri) {
      new Directory(destination).create()
      new File(destination, "partial.js").write("partial replacement")
      throw promotionFailure
    }
  })
  mockDirectoryDelete.mockImplementation((uri: string) => {
    if (uri === target.uri) throw cleanupFailure
  })
  expect((await registry.installFromLocalZip("repair.zip")).is_error()).toBe(true)
  expect(errors).toHaveBeenCalledWith(expect.any(String), promotionFailure)
  expect(errors).toHaveBeenCalledWith(expect.any(String), cleanupFailure)
  expect(mockMove).toHaveBeenCalledTimes(2)
  expect(storage.load<string>(`${pkg}_active_version`)).toEqual(active)
  expect(registry.getReleaseIdentity(pkg, version)).toEqual(identity)
  const backups = new Directory(Paths.cache).list().filter((item) => item.name.startsWith("lma_backup-"))
  expect(backups).toHaveLength(1)
  expect(new File(backups[0], "call.js").textSync()).toBe("verified call")
})

it.each(["package", "version"])("rejects a ZIP whose %s differs from the fetched manifest", async (mismatch) => {
  jest.spyOn(global, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({packageName: pkg, version, name: "Test miniapp"}),
  } as Response)
  const identity = registry.getReleaseIdentity(pkg, version)
  const active = storage.load<string>(`${pkg}_active_version`)
  if (mismatch === "package") mockPackageName = "com.example.wrong"
  else mockVersion = "9.9.9"
  mockScript = "wrong identity"
  const result = await registry.installFromJsonUrl("https://example.test/release")
  expect(result.is_error()).toBe(true)
  expect(installedScript()).toBe("verified call")
  expect(storage.load<string>(`${pkg}_active_version`)).toEqual(active)
  expect(registry.getReleaseIdentity(pkg, version)).toEqual(identity)
  expect(registry.getInstalledVersions(pkg)).toEqual([version])
  expect(registry.getInstalledVersions("com.example.wrong")).toEqual([])
})

it.each(["headers", "body"])("times out stalled manifest %s and permits the next attempt", async (phase) => {
  jest.useFakeTimers()
  let rejectStall!: (error: Error) => void
  const stall = new Promise<Response>((_resolve, reject) => {rejectStall = reject})
  const fetch = jest.spyOn(global, "fetch").mockImplementationOnce(async (_url, init) => {
    init?.signal?.addEventListener("abort", () => rejectStall(new Error("manifest aborted")), {once: true})
    return phase === "headers" ? stall : {ok: true, json: () => stall} as unknown as Response
  }).mockResolvedValue({
    ok: true,
    json: async () => ({packageName: pkg, version, name: "Test miniapp"}),
  } as Response)
  let settled = false
  const first = Promise.resolve(registry.installFromJsonUrl("https://example.test/stalled"))
  void first.then(() => {settled = true})
  try {
    await jest.advanceTimersByTimeAsync(2000)
    expect(settled).toBe(true)
    expect((await first).is_error()).toBe(true)
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
    expect(mockDownload).not.toHaveBeenCalled()
    expect(installedScript()).toBe("verified call")
    expect((await registry.installFromJsonUrl("https://example.test/next")).is_ok()).toBe(true)
    expect(mockDownload).toHaveBeenCalledTimes(1)
  } finally {
    rejectStall(new Error("test teardown"))
    await first
  }
})

it("waits for cancelled ZIP writer settlement before releasing the install queue", async () => {
  jest.useFakeTimers()
  mockUnzip.mockClear()
  const started = deferred()
  const writer = deferred()
  const cancellation = deferred()
  mockDownload.mockImplementationOnce(() => {
    started.resolve()
    return writer.promise
  })
  mockCancelDownload.mockImplementationOnce(() => cancellation.promise)
  const identity = registry.getReleaseIdentity(pkg, version)
  const active = storage.load<string>(`${pkg}_active_version`)
  let settled = false
  const first = Promise.resolve(registry.installFromUrl("https://example.test/stalled.zip"))
  void first.then(() => {settled = true})
  const next = Promise.resolve(registry.installFromUrl("https://example.test/next.zip"))
  try {
    await started.promise
    await jest.advanceTimersByTimeAsync(60000)
    expect(mockCancelDownload).toHaveBeenCalledTimes(1)
    expect(settled).toBe(false)
    expect(mockDownload).toHaveBeenCalledTimes(1)
    expect(mockUnzip).not.toHaveBeenCalled()
    expect(installedScript()).toBe("verified call")
    expect(storage.load<string>(`${pkg}_active_version`)).toEqual(active)
    expect(registry.getReleaseIdentity(pkg, version)).toEqual(identity)
    writer.resolve()
    await jest.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    expect(mockDownload).toHaveBeenCalledTimes(1)
    cancellation.resolve()
    expect((await first).is_error()).toBe(true)
    expect((await next).is_ok()).toBe(true)
    expect(mockDownload.mock.calls.map(([url]) => url)).toEqual([
      "https://example.test/stalled.zip", "https://example.test/next.zip",
    ])
    expect(mockUnzip).toHaveBeenCalledTimes(1)
    expect(mockCancelDownload).toHaveBeenCalledTimes(1)
  } finally {
    cancellation.resolve()
    writer.resolve()
    await Promise.all([first, next])
  }
})
