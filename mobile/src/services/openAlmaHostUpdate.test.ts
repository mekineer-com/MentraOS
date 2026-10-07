let mockApplicationId = "com.mentra.mentra.openalma"
let mockNativeVersion: string | null = "3.2.1"
jest.mock("expo-application", () => ({
  get applicationId() {
    return mockApplicationId
  },
  get nativeApplicationVersion() {
    return mockNativeVersion
  },
}))

const downloadUrl = "https://github.com/mekineer-com/MentraOS/releases/download/v3.2.2/OpenAlma-Mentra-3.2.2.apk"
const asset = {
  name: "OpenAlma-Mentra-3.2.2.apk",
  state: "uploaded",
  size: 100,
  browser_download_url: downloadUrl,
}
const release = {tag_name: "v3.2.2", draft: false, prerelease: false, assets: [asset]}
const originalFetch = global.fetch
let service: typeof import("./openAlmaHostUpdate")
let mockFetch: jest.Mock

beforeEach(() => {
  jest.resetModules()
  mockApplicationId = "com.mentra.mentra.openalma"
  mockNativeVersion = "3.2.1"
  service = require("./openAlmaHostUpdate")
  mockFetch = jest.fn().mockResolvedValue({ok: true, json: async () => release})
  global.fetch = mockFetch
})
afterEach(() => {
  global.fetch = originalFetch
  jest.restoreAllMocks()
  jest.useRealTimers()
})

test("uses the native version and shares exactly one check across callers/remounts", async () => {
  const first = service.checkOpenAlmaHostUpdate()
  expect(service.checkOpenAlmaHostUpdate()).toBe(first)
  await expect(first).resolves.toEqual({version: "3.2.2", downloadUrl})
  await service.checkOpenAlmaHostUpdate()
  expect(mockFetch).toHaveBeenCalledTimes(1)
  expect(mockFetch).toHaveBeenCalledWith(
    "https://api.github.com/repos/mekineer-com/MentraOS/releases/latest",
    expect.objectContaining({signal: expect.any(Object)}),
  )
  expect(service.useOpenAlmaHostUpdate.getState().release).toEqual({version: "3.2.2", downloadUrl})
})

test.each(["3.2.2", "3.3.0"])("does not offer equal or older releases to native %s", async (version) => {
  mockNativeVersion = version
  await expect(service.checkOpenAlmaHostUpdate()).resolves.toBeNull()
  expect(service.useOpenAlmaHostUpdate.getState()).toEqual({release: null})
})

test.each([null, "unknown"])("cannot compare an unknown native version %s", async (version) => {
  mockNativeVersion = version
  await expect(service.checkOpenAlmaHostUpdate()).resolves.toBeNull()
  expect(mockFetch).not.toHaveBeenCalled()
})

test("stock never checks or opens the fork update", async () => {
  mockApplicationId = "com.mentra.mentra"
  await expect(service.checkOpenAlmaHostUpdate()).resolves.toBeNull()
  const open = jest.spyOn(require("react-native").Linking, "openURL")
  await expect(service.openOpenAlmaHostUpdate()).resolves.toBe(false)
  expect(mockFetch).not.toHaveBeenCalled()
  expect(open).not.toHaveBeenCalled()
})

test.each([404, 403, 500])("HTTP %s never advertises an update or retries automatically", async (status) => {
  mockFetch.mockResolvedValue({ok: false, status})
  await service.checkOpenAlmaHostUpdate()
  await service.checkOpenAlmaHostUpdate()
  expect(service.useOpenAlmaHostUpdate.getState()).toEqual({release: null})
  expect(mockFetch).toHaveBeenCalledTimes(1)
})

test.each(["network", "json"])("%s failure is unavailable, not an update", async (failure) => {
  jest.spyOn(console, "warn").mockImplementation(() => {})
  if (failure === "network") mockFetch.mockRejectedValue(new Error("offline"))
  else
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("invalid JSON")
      },
    })
  await service.checkOpenAlmaHostUpdate()
  expect(service.useOpenAlmaHostUpdate.getState()).toEqual({release: null})
})

test("bounds the launch fetch and does not poll after a timeout", async () => {
  jest.useFakeTimers()
  jest.spyOn(console, "warn").mockImplementation(() => {})
  mockFetch.mockImplementation(
    (_url, {signal}: {signal: AbortSignal}) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")))
      }),
  )
  const check = service.checkOpenAlmaHostUpdate()
  jest.advanceTimersByTime(5000)
  await expect(check).resolves.toBeNull()
  jest.advanceTimersByTime(60000)
  await service.checkOpenAlmaHostUpdate()
  expect(mockFetch).toHaveBeenCalledTimes(1)
  expect(service.useOpenAlmaHostUpdate.getState().release).toBeNull()
})

test("opens the verified APK and surfaces browser failures", async () => {
  const open = jest.spyOn(require("react-native").Linking, "openURL").mockResolvedValue(undefined)
  await expect(service.openOpenAlmaHostUpdate()).resolves.toBe(false)
  await service.checkOpenAlmaHostUpdate()
  await expect(service.openOpenAlmaHostUpdate()).resolves.toBe(true)
  expect(open).toHaveBeenCalledWith(downloadUrl)
  open.mockRejectedValue(new Error("browser unavailable"))
  await expect(service.openOpenAlmaHostUpdate()).rejects.toThrow("browser unavailable")
})

test("accepts plain full-version tags but not upstream's old major/minor release bucket", () => {
  const tag = "3.2.2"
  expect(
    service.parseOpenAlmaHostRelease({
      ...release,
      tag_name: tag,
      assets: [{...asset, browser_download_url: downloadUrl.replace("v3.2.2/", `${tag}/`)}],
    })?.version,
  ).toBe("3.2.2")
  expect(service.parseOpenAlmaHostRelease({...release, tag_name: "v3.2"})).toBeNull()
})

test.each([
  null,
  {},
  [],
  {...release, draft: true},
  {...release, prerelease: true},
  {...release, tag_name: "v3.2.2-beta.1"},
  {...release, tag_name: "asg-v3.2.2"},
  {...release, tag_name: "mentra-v3.2.2"},
  {...release, assets: []},
  {...release, assets: [null]},
  {...release, assets: [{...asset, name: "Mentra_3p2-beta-1.apk"}]},
  {...release, assets: [{...asset, name: "OpenAlma.aab"}]},
  {...release, assets: [{...asset, state: "new"}]},
  {...release, assets: [{...asset, size: 0}]},
  {...release, assets: [{...asset, browser_download_url: "http://example.com/OpenAlma.apk"}]},
  {...release, assets: [{...asset, browser_download_url: downloadUrl.replace("mekineer-com", "Mentra-Community")}]},
  {...release, assets: [{...asset, browser_download_url: downloadUrl.replace("v3.2.2/", "v3.2.1/")}]},
])("rejects unusable or unrelated release metadata: %j", (value) => {
  expect(service.parseOpenAlmaHostRelease(value)).toBeNull()
})

test("an unusable published release does not set availability", async () => {
  mockFetch.mockResolvedValue({ok: true, json: async () => ({...release, assets: []})})
  await service.checkOpenAlmaHostUpdate()
  expect(service.useOpenAlmaHostUpdate.getState()).toEqual({release: null})
})
