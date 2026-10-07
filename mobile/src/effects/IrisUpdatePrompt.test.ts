import {createElement} from "react"
import {AppState} from "react-native"
import {act, render, waitFor} from "@testing-library/react-native"

import {showAlert} from "@/contexts/ModalContext"
import {TextField} from "@/components/ignite"
import {storage} from "@/utils/storage/storage"
import {engine} from "@mentra/engine"
import {appRegistry, localMiniappRuntime, miniappLauncher} from "@mentra/engine-host-internal"
import {IrisUpdatePrompt} from "./IrisUpdatePrompt"
import MainSettingsPage from "@/app/miniapps/settings/main"
import {isIrisOffer, openAlmaAddresses, parseIrisSetupOffer} from "./irisUpdateOffer"

let mockApplicationId = "com.mentra.mentra.openalma"
let mockDeploymentKind = "consumer"
jest.mock("@/services/deployment", () => ({
  deploymentStore: {getActive: () => ({kind: mockDeploymentKind})},
  useDeployment: () => ({activeDeployment: {kind: mockDeploymentKind}}),
}))
jest.mock("expo-application", () => ({
  get applicationId() {
    return mockApplicationId
  },
  nativeApplicationVersion: "3.2.0",
  getAndroidId: () => "test-phone",
}))
jest.mock("expo-device", () => ({deviceName: "Test Phone", modelName: "Test Model"}))
jest.mock("@/utils/storage/storage", () => ({storage: {
  load: jest.fn(() => ({is_ok: () => false})), save: jest.fn(() => ({is_error: () => false})),
}}))
jest.mock("@/contexts/ModalContext", () => ({showAlert: jest.fn()}))
jest.mock("@/i18n", () => ({translate: (key: string) => key}))
jest.mock("@mentra/engine", () => ({
  engine: {miniapps: {refresh: jest.fn(), setForeground: jest.fn()}},
  SETTINGS: {debug_mode: {key: "debug"}, super_mode: {key: "super"}, appearance_menu_enabled: {key: "appearance"}},
  useSetting: () => [false],
}))
jest.mock("@/components/dev/VersionInfo", () => ({VersionInfo: () => null}))
jest.mock("@/components/settings/DeviceSettingsSection", () => ({DeviceSettingsSection: () => null}))
jest.mock("@/components/ui/RouteButton", () => ({RouteButton: () => null}))
jest.mock("@/components/ui/Spacer", () => ({Spacer: () => null}))
jest.mock("@/components/ui/Group", () => ({Group: require("react-native").View}))
jest.mock("@/components/ignite", () => ({
  Screen: require("react-native").View, Icon: () => null,
  TextField: jest.fn(({helper}: {helper: string}) => require("react").createElement(require("react-native").Text, null, helper)),
}))
jest.mock("@/contexts/ThemeContext", () => ({useAppTheme: () => ({theme: {
  spacing: {s2: 2, s6: 6, s10: 10}, colors: {secondary_foreground: "white"},
}})}))
jest.mock("@/stores/navigation", () => ({useNavigationStore: {getState: () => ({push: jest.fn()})}}))
jest.mock("@/stores/capsule", () => ({useRegisterCapsule: jest.fn()}))
jest.mock("@mentra/engine-host-internal", () => ({
  appRegistry: {
     installFromJsonUrl: jest.fn(),
  },
  miniappLauncher: {stop: jest.fn(), ensureConnected: jest.fn()},
  localMiniappRuntime: {getSimpleStorage: jest.fn(), setSimpleStorage: jest.fn()},
}))

beforeEach(() => {
  jest.clearAllMocks()
  ;(localMiniappRuntime.getSimpleStorage as jest.Mock).mockReset()
  mockApplicationId = "com.mentra.mentra.openalma"
  mockDeploymentKind = "consumer"
  Object.defineProperty(AppState, "currentState", {configurable: true, value: "active"})
  global.fetch = jest.fn()
})

test("opening fork Settings shows an unreachable default without editing the address", async () => {
  global.fetch = jest.fn(async () => {throw new Error("Network unavailable")}) as unknown as typeof fetch
  const view = render(createElement(MainSettingsPage))
  await waitFor(() => expect(view.getByText("Network unavailable")).toBeTruthy())
  expect((TextField as jest.Mock).mock.calls.every(([props]) =>
    props.labelTx === "irisUpdate:serverAddress" && props.value === "http://10.77.0.1")).toBe(true)
  expect(storage.load).toHaveBeenCalledTimes(1)
  expect(storage.load).toHaveBeenCalledWith("openalma.server-address")
  expect(storage.save).toHaveBeenCalledTimes(1)
  expect(storage.save).toHaveBeenCalledWith("openalma.server-address", "http://10.77.0.1")
  view.unmount()
})

test("does nothing in the stock Mentra build", () => {
  mockApplicationId = "com.mentra.mentra"
  const view = render(createElement(IrisUpdatePrompt))
  expect(global.fetch).not.toHaveBeenCalled()
  expect(AppState.addEventListener).not.toHaveBeenCalled()
  view.unmount()
})

test("workspace mode neither starts the private updater nor accepts a waiting offer", async () => {
  mockDeploymentKind = "workspace"
  const view = render(createElement(IrisUpdatePrompt))
  expect(global.fetch).not.toHaveBeenCalled()
  expect(appRegistry.installFromJsonUrl).not.toHaveBeenCalled()
  expect(AppState.addEventListener).not.toHaveBeenCalled()
  view.unmount()

  mockDeploymentKind = "consumer"
  global.fetch = jest.fn(async (url: string) => {
    if (url.includes("/integration/mentra/status?")) return {ok: true, json: async () => ({active: false, starting: false})}
    if (url.endsWith("/owner")) return {ok: true, json: async () => ({user_id: "Test User"})}
    if (url.endsWith("/miniapp.json")) return {ok: true, json: async () => ({packageName: "com.openalma.mentra", version: "0.1.10"})}
    if (url.endsWith("/openalma-offer.json")) return {ok: true, json: async () => ({offerId: "pending", deviceSessionId: "android-test-phone"})}
    return {ok: true}
  }) as unknown as typeof fetch
  ;(localMiniappRuntime.getSimpleStorage as jest.Mock).mockImplementation(async () => {
    mockDeploymentKind = "workspace"
    return null
  })
  const pending = render(createElement(IrisUpdatePrompt))
  await waitFor(() => expect(localMiniappRuntime.getSimpleStorage).toHaveBeenCalled())
  expect(appRegistry.installFromJsonUrl).not.toHaveBeenCalled()
  pending.unmount()
})

test("accepts the launcher-selected Iris release regardless of version ordering", () => {
  expect(isIrisOffer({packageName: "com.openalma.mentra", version: "0.1.9"}, "offer-2", null)).toBe(true)
  expect(isIrisOffer({packageName: "com.openalma.mentra", version: "0.1.8"}, "offer-2", "offer-1")).toBe(true)
  expect(isIrisOffer({packageName: "wrong", version: "0.1.9"}, "offer-2", null)).toBe(false)
  expect(isIrisOffer({packageName: "com.openalma.mentra", version: "invalid"}, "offer-2", null)).toBe(false)
  expect(isIrisOffer({packageName: "com.openalma.mentra", version: "0.1.9"}, "offer-1", "offer-1")).toBe(false)
})

test("derives one installer address without losing IPv6 or hostnames", () => {
  for (const [baseUrl, installerUrl] of [
    ["http://10.77.0.1:8099", "http://10.77.0.1:6789"],
    ["https://[fd00::1]:8099", "http://[fd00::1]:6789"],
    ["https://openalma.example", "http://openalma.example:6789"],
    ["http://100.64.0.1:8099", "http://100.64.0.1:6789"],
    ["http://127.0.0.1:8099", "http://127.0.0.1:6789"],
    ["https://203.0.113.1:8099", "http://203.0.113.1:6789"],
  ]) expect(openAlmaAddresses(baseUrl)).toEqual({baseUrl, installerUrl})
  for (const invalid of ["http://user:password@example", "ftp://openalma.example",
    "http://openalma.example:0", "http://openalma.example:65536", "http://openalma.example/path"]) {
    expect(() => openAlmaAddresses(invalid)).toThrow()
  }
})

test("accepts only a targeted offer", () => {
  const deviceSessionId = "android-test-phone"
  expect(parseIrisSetupOffer({offerId: "offer-1", deviceSessionId: deviceSessionId})).toEqual({offerId: "offer-1", deviceSessionId: deviceSessionId})
  expect(parseIrisSetupOffer({offerId: "offer-1", deviceSessionId: "bad id"})).toBeNull()
  expect(parseIrisSetupOffer({offerId: "offer-1", profile: {deviceSessionId}})).toBeNull()
})

test("retries acknowledgement without reinstalling Iris", async () => {
  const timers = jest.spyOn(global, "setTimeout")
  let firstAckSignal: AbortSignal | undefined
  const deviceSessionId = "android-test-phone"
  let acknowledgements = 0
  let active = false
  let offerId = "offer-1"
  let activate!: () => void
  ;(miniappLauncher.ensureConnected as jest.Mock).mockReturnValueOnce(new Promise<void>((resolve) => {activate = resolve}))
  ;(appRegistry.installFromJsonUrl as jest.Mock).mockResolvedValue({is_error: () => false})
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/integration/mentra/status?")) return {ok: true, json: async () => ({active, starting: active})}
    if (url.endsWith("/owner")) return {ok: true, json: async () => ({user_id: "Test User"})}
    if (url.endsWith("/miniapp.json")) {
      return {ok: true, json: async () => ({packageName: "com.openalma.mentra", version: "0.1.10"})}
    }
    if (url.endsWith("/openalma-offer.json")) {
      return {ok: true, json: async () => ({offerId, deviceSessionId: deviceSessionId})}
    }
    if (url.endsWith("/integration/mentra/host/seen")) return {ok: true}
    acknowledgements += 1
    if (acknowledgements === 1) {
      firstAckSignal = init!.signal!
      return await new Promise((_resolve, reject) => {
        firstAckSignal!.addEventListener("abort", () => reject(new Error("ACK timeout")), {once: true})
      })
    }
    return {ok: acknowledgements > 2, status: 503}
  }) as unknown as typeof fetch

  const view = render(createElement(IrisUpdatePrompt))
  await waitFor(() => expect(miniappLauncher.ensureConnected).toHaveBeenCalled())
  expect(acknowledgements).toBe(0)
  expect(engine.miniapps.setForeground).not.toHaveBeenCalled()
  activate()
  await waitFor(() => expect(firstAckSignal).toBeDefined())
  const timeout = timers.mock.calls.filter(([, delay]) => delay === 2000).at(-1)![0] as () => void
  timeout()
  await waitFor(() => expect(showAlert).toHaveBeenCalledWith(expect.objectContaining({
    title: "irisUpdate:completionFailedTitle",
  })))
  const onAppState = (AppState.addEventListener as jest.Mock).mock.calls[0][1]
  active = true
  ;(localMiniappRuntime.getSimpleStorage as jest.Mock).mockImplementation(async (_package, key) =>
    key === "openalma:gemini-session-v1" ? "new sitting journal" : null)
  onAppState("active")
  await waitFor(() => expect(acknowledgements).toBe(2))
  expect(showAlert).toHaveBeenCalledTimes(1)
  onAppState("active")
  await waitFor(() => expect(acknowledgements).toBe(3))

  expect(appRegistry.installFromJsonUrl).toHaveBeenCalledTimes(1)
  expect(appRegistry.installFromJsonUrl).toHaveBeenCalledWith("http://10.77.0.1:6789/offer-1")
  expect(
    (global.fetch as jest.Mock).mock.calls.filter(([url]) => url.endsWith("/integration/mentra/host/seen")),
  ).toHaveLength(3)
  expect(global.fetch).toHaveBeenCalledWith(
    "http://10.77.0.1/integration/mentra/host/seen",
    expect.objectContaining({
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        user_id: "Test User",
        device_session_id: "android-test-phone",
        host_package: "com.mentra.mentra.openalma",
        host_version: "3.2.0",
        default_name: "Test Phone",
      }),
    }),
  )
  expect(localMiniappRuntime.setSimpleStorage).not.toHaveBeenCalledWith(
    "com.openalma.mentra", "openalma.connection-profile", expect.anything(),
  )
  expect(miniappLauncher.ensureConnected).toHaveBeenCalledTimes(1)
  expect(miniappLauncher.stop).toHaveBeenCalledTimes(1)
  expect(engine.miniapps.setForeground).toHaveBeenCalledTimes(1)
  expect((global.fetch as jest.Mock).mock.calls.filter(([url]) => url.includes("/status?"))).toHaveLength(2)
  for (const [url, init] of (global.fetch as jest.Mock).mock.calls) {
    expect(init.headers ?? {}).toEqual(url.endsWith("/host/seen") || url.endsWith("/__mentra_release/installed")
      ? {"Content-Type": "application/json"} : {})
    if (url.endsWith("/host/seen")) expect(JSON.parse(init.body)).toEqual({
      user_id: "Test User", device_session_id: deviceSessionId,
      host_package: "com.mentra.mentra.openalma", host_version: "3.2.0", default_name: "Test Phone",
    })
  }
  offerId = "offer-2"
  await act(async () => {onAppState("active"); await new Promise((resolve) => setTimeout(resolve, 0))})
  expect(acknowledgements).toBe(3)
  expect(appRegistry.installFromJsonUrl).toHaveBeenCalledTimes(1)
  view.unmount()
  timers.mockRestore()
})

test("foreground ticks do not repeat a failed install or its alert", async () => {
  const interval = jest.spyOn(global, "setInterval")
  let available = true
  ;(appRegistry.installFromJsonUrl as jest.Mock).mockResolvedValue({is_error: () => true, error: new Error("ZIP failed")})
  global.fetch = jest.fn(async (url: string) => {
    if (url.endsWith("/owner")) return {ok: true, json: async () => ({user_id: "Test User"})}
    if (url.endsWith("/miniapp.json")) return {ok: true, json: async () => ({packageName: "com.openalma.mentra", version: "0.1.10"})}
    if (url.endsWith("/openalma-offer.json")) return {ok: available, json: async () => ({offerId: "failed", deviceSessionId: "android-test-phone"})}
    if (url.includes("/status?")) return {ok: true, json: async () => ({active: false, starting: false})}
    return {ok: true}
  }) as unknown as typeof fetch
  const view = render(createElement(IrisUpdatePrompt))
  try {
    await waitFor(() => expect(showAlert).toHaveBeenCalledTimes(1))
    const tick = interval.mock.calls[0][0] as () => void
    available = false
    await act(async () => {tick(); await new Promise((resolve) => setTimeout(resolve, 0))})
    available = true
    for (let n = 0; n < 3; n++) {
      await act(async () => {tick(); await new Promise((resolve) => setTimeout(resolve, 0))})
    }
    expect(appRegistry.installFromJsonUrl).toHaveBeenCalledTimes(1)
    expect(showAlert).toHaveBeenCalledTimes(1)
  } finally {
    view.unmount()
    interval.mockRestore()
  }
})

test.each(["active", "starting", "active-after-install", "starting-after-install"])("does not replace Iris with %s work", async (work) => {
  ;(appRegistry.installFromJsonUrl as jest.Mock).mockResolvedValue({is_error: () => false})
  global.fetch = jest.fn(async (url: string) => {
    if (url.endsWith("/owner")) return {ok: true, json: async () => ({user_id: "Test User"})}
    if (url.endsWith("/miniapp.json")) return {ok: true, json: async () => ({packageName: "com.openalma.mentra", version: "0.1.10"})}
    if (url.endsWith("/openalma-offer.json")) return {ok: true, json: async () => ({offerId: "busy", deviceSessionId: "android-test-phone"})}
    if (url.includes("/integration/mentra/status?")) return {ok: true, json: async () => ({
      starting: work === "starting" || (work === "starting-after-install" && (appRegistry.installFromJsonUrl as jest.Mock).mock.calls.length > 0),
      active: work === "active" || (work === "active-after-install" && (appRegistry.installFromJsonUrl as jest.Mock).mock.calls.length > 0),
    })}
    return {ok: true}
  }) as unknown as typeof fetch
  const view = render(createElement(IrisUpdatePrompt))
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/status?"), expect.anything()))
  if (work.endsWith("after-install")) {
    await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.filter(([url]) => url.includes("/status?"))).toHaveLength(2))
    expect(appRegistry.installFromJsonUrl).toHaveBeenCalledTimes(1)
  } else expect(appRegistry.installFromJsonUrl).not.toHaveBeenCalled()
  expect(miniappLauncher.stop).not.toHaveBeenCalled()
  view.unmount()
})

test("a saved phone backup does not block installation and is not cleared", async () => {
  ;(appRegistry.installFromJsonUrl as jest.Mock).mockResolvedValue({is_error: () => false})
  ;(localMiniappRuntime.getSimpleStorage as jest.Mock).mockImplementation(async (_package, key) =>
    key === "openalma:gemini-session-v1" ? "saved backup" : null)
  global.fetch = jest.fn(async (url: string) => {
    if (url.endsWith("/owner")) return {ok: true, json: async () => ({user_id: "Test User"})}
    if (url.endsWith("/miniapp.json")) return {ok: true, json: async () => ({packageName: "com.openalma.mentra", version: "0.1.10"})}
    if (url.endsWith("/openalma-offer.json")) return {ok: true, json: async () => ({offerId: "recover", deviceSessionId: "android-test-phone"})}
    if (url.includes("/status?")) return {ok: true, json: async () => ({active: false, starting: false})}
    return {ok: true}
  }) as unknown as typeof fetch
  const view = render(createElement(IrisUpdatePrompt))
  await waitFor(() => expect(engine.miniapps.setForeground).toHaveBeenCalled())
  expect(appRegistry.installFromJsonUrl).toHaveBeenCalledWith("http://10.77.0.1:6789/recover")
  expect(localMiniappRuntime.setSimpleStorage).not.toHaveBeenCalledWith(
    "com.openalma.mentra", "openalma:gemini-session-v1", expect.anything())
  view.unmount()
})

test("reports its own identity before Iris exists and ignores another installation's offer", async () => {
  global.fetch = jest.fn(async (url: string) => {
    if (url.includes("/integration/mentra/status?")) return {ok: true, json: async () => ({active: false, starting: false})}
    if (url.endsWith("/owner")) return {ok: true, json: async () => ({user_id: "Test User"})}
    if (url.endsWith("/miniapp.json")) return {ok: true, json: async () => ({packageName: "com.openalma.mentra", version: "0.1.10"})}
    if (url.endsWith("/openalma-offer.json")) return {ok: true, json: async () => ({offerId: "foreign", deviceSessionId: "other-installation"})}
    return {ok: true}
  }) as unknown as typeof fetch

  const view = render(createElement(IrisUpdatePrompt))
  await waitFor(() =>
    expect(global.fetch).toHaveBeenCalledWith(
      "http://10.77.0.1/integration/mentra/host/seen",
      expect.objectContaining({method: "POST"}),
    ),
  )
  expect(appRegistry.installFromJsonUrl).not.toHaveBeenCalled()
  const report = (global.fetch as jest.Mock).mock.calls.find(([url]) => url.endsWith("/host/seen"))
  expect(JSON.parse(report[1].body)).toMatchObject({
    device_session_id: "android-test-phone", default_name: "Test Phone",
  })
  expect(localMiniappRuntime.setSimpleStorage).toHaveBeenCalledTimes(1)
  expect(localMiniappRuntime.setSimpleStorage).toHaveBeenCalledWith(
    "com.openalma.mentra", "openalma.host", JSON.stringify({
      host_package: "com.mentra.mentra.openalma", host_version: "3.2.0", deviceSessionId: "android-test-phone",
    }),
  )
  expect((localMiniappRuntime.setSimpleStorage as jest.Mock).mock.invocationCallOrder[0])
    .toBeLessThan((global.fetch as jest.Mock).mock.invocationCallOrder[0])
  expect(localMiniappRuntime.getSimpleStorage).not.toHaveBeenCalled()
  view.unmount()
})

test("does not claim an installer without an automatic offer", async () => {
  ;(localMiniappRuntime.getSimpleStorage as jest.Mock).mockResolvedValue(null)
  global.fetch = jest.fn(async (url: string) =>
    url.endsWith("/owner") ? {ok: true, json: async () => ({user_id: "Test User"})}
    : url.endsWith("/miniapp.json") || url.endsWith("/host/seen") ? {ok: true, status: 200} : {ok: false, status: 404},
  ) as unknown as typeof fetch

  const view = render(createElement(IrisUpdatePrompt))
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    "http://10.77.0.1:6789/openalma-offer.json", expect.anything()))
  expect(showAlert).not.toHaveBeenCalled()
  expect(appRegistry.installFromJsonUrl).not.toHaveBeenCalled()
  view.unmount()
})

test("resumes acknowledgement from a persisted installed offer without reinstalling", async () => {
  const deviceSessionId = "android-test-phone"
  let active = true
  ;(localMiniappRuntime.getSimpleStorage as jest.Mock).mockImplementation(async (_package, key) =>
    key === "openalma.installed-offer" ? "offer-4" : null)
  global.fetch = jest.fn(async (url: string) => {
    if (url.includes("/integration/mentra/status?")) return {ok: true, json: async () => ({active, starting: false})}
    if (url.endsWith("/owner")) return {ok: true, json: async () => ({user_id: "Test User"})}
    if (url.endsWith("/miniapp.json")) return {ok: true, json: async () => ({packageName: "com.openalma.mentra", version: "0.1.10"})}
    if (url.endsWith("/openalma-offer.json")) return {ok: true, json: async () => ({offerId: "offer-4", deviceSessionId: deviceSessionId})}
    if (url.endsWith("/integration/mentra/host/seen")) return {ok: true}
    return {ok: true}
  }) as unknown as typeof fetch

  const view = render(createElement(IrisUpdatePrompt))
  await act(async () => {await new Promise((resolve) => setTimeout(resolve, 0))})
  expect(miniappLauncher.stop).not.toHaveBeenCalled()
  expect(engine.miniapps.setForeground).not.toHaveBeenCalled()
  expect((global.fetch as jest.Mock).mock.calls.some(([url]) => url.endsWith("/__mentra_release/installed"))).toBe(false)
  active = false
  const onAppState = (AppState.addEventListener as jest.Mock).mock.calls[0][1]
  onAppState("active")
  await waitFor(() => expect(engine.miniapps.setForeground).toHaveBeenCalledWith("com.openalma.mentra"))

  expect(appRegistry.installFromJsonUrl).not.toHaveBeenCalled()
  expect(localMiniappRuntime.setSimpleStorage).toHaveBeenCalledWith(
    "com.openalma.mentra", "openalma.installed-offer", "",
  )
  view.unmount()
})
