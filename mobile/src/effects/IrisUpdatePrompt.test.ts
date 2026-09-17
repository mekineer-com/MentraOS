import {createElement} from "react"
import {AppState} from "react-native"
import {render, waitFor} from "@testing-library/react-native"

import {showAlert} from "@/contexts/ModalContext"
import {engine} from "@mentra/engine"
import {appRegistry, localMiniappRuntime} from "@mentra/engine-host-internal"
import {IrisUpdatePrompt} from "./IrisUpdatePrompt"
import {isIrisOffer, parseIrisSetupOffer} from "./irisUpdateOffer"

jest.mock("expo-application", () => ({
  applicationId: "com.mentra.mentra.openalma",
  nativeApplicationVersion: "3.2.0",
}))
jest.mock("@/contexts/ModalContext", () => ({showAlert: jest.fn()}))
jest.mock("@/i18n", () => ({translate: (key: string) => key}))
jest.mock("@mentra/engine", () => ({
  engine: {miniapps: {refresh: jest.fn(), setForeground: jest.fn()}},
}))
jest.mock("@mentra/engine-host-internal", () => ({
  appRegistry: {
    getActiveVersion: jest.fn(), getReleaseIdentity: jest.fn(), installFromJsonUrl: jest.fn(),
  },
  localMiniappRuntime: {getSimpleStorage: jest.fn(), setSimpleStorage: jest.fn()},
}))

beforeEach(() => jest.clearAllMocks())

test("accepts the launcher-selected Iris release regardless of version ordering", () => {
  expect(isIrisOffer({packageName: "com.openalma.mentra", version: "0.1.9"}, "offer-2", null)).toBe(true)
  expect(isIrisOffer({packageName: "com.openalma.mentra", version: "0.1.8"}, "offer-2", "offer-1")).toBe(true)
  expect(isIrisOffer({packageName: "wrong", version: "0.1.9"}, "offer-2", null)).toBe(false)
  expect(isIrisOffer({packageName: "com.openalma.mentra", version: "invalid"}, "offer-2", null)).toBe(false)
  expect(isIrisOffer({packageName: "com.openalma.mentra", version: "0.1.9"}, "offer-1", "offer-1")).toBe(false)
})

test("accepts only a complete private profile", () => {
  const profile = {
    baseUrl: "http://10.77.0.1",
    bearer: "fictional",
    userId: "Test User",
    soulId: "Test Soul",
    deviceSessionId: "test-phone",
  }
  expect(parseIrisSetupOffer({offerId: "offer-1", profile})).toEqual({offerId: "offer-1", profile})
  expect(parseIrisSetupOffer({offerId: "offer-1", profile: {...profile, bearer: ""}})).toBeNull()
})

test("retries acknowledgement without reinstalling Iris", async () => {
  const profile = {
    baseUrl: "http://10.77.0.1", bearer: "fictional", userId: "Test User",
    soulId: "Test Soul", deviceSessionId: "test-phone",
  }
  let acknowledgements = 0
  ;(appRegistry.getActiveVersion as jest.Mock).mockResolvedValue(null)
  ;(appRegistry.installFromJsonUrl as jest.Mock).mockResolvedValue({is_error: () => false})
  global.fetch = jest.fn(async (url: string) => {
    if (url.endsWith("/miniapp.json")) {
      return {ok: true, json: async () => ({packageName: "com.openalma.mentra", version: "0.1.10"})}
    }
    if (url.endsWith("/openalma-profile.json")) {
      return {ok: true, json: async () => ({offerId: "offer-1", profile})}
    }
    if (url.endsWith("/integration/mentra/host/seen")) return {ok: false, status: 503}
    acknowledgements += 1
    return {ok: acknowledgements > 1, status: 503}
  }) as unknown as typeof fetch

  const view = render(createElement(IrisUpdatePrompt))
  await waitFor(() => expect(showAlert).toHaveBeenCalledWith(expect.objectContaining({
    title: "irisUpdate:completionFailedTitle",
  })))
  const onAppState = (AppState.addEventListener as jest.Mock).mock.calls[0][1]
  onAppState("active")
  await waitFor(() => expect(acknowledgements).toBe(2))

  expect(appRegistry.installFromJsonUrl).toHaveBeenCalledTimes(1)
  expect(global.fetch).toHaveBeenCalledWith(
    "http://10.77.0.1/integration/mentra/host/seen",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({Authorization: "Bearer fictional"}),
      body: JSON.stringify({
        user_id: "Test User",
        device_session_id: "test-phone",
        host_package: "com.mentra.mentra.openalma",
        host_version: "3.2.0",
        protocol_version: 1,
        capabilities: ["automatic_iris_install", "iris_profile_handoff", "iris_install_ack"],
      }),
    }),
  )
  expect(localMiniappRuntime.setSimpleStorage).toHaveBeenCalledWith(
    "com.openalma.mentra", "openalma.connection-profile", JSON.stringify(profile),
  )
  expect(engine.miniapps.setForeground).toHaveBeenCalledTimes(2)
  view.unmount()
})

test("preserves a connection profile changed inside Iris", async () => {
  const profile = {
    baseUrl: "http://10.77.0.1", bearer: "fictional", userId: "Test User",
    soulId: "Test Soul", deviceSessionId: "test-phone",
  }
  let finishInstall!: () => void
  let storedProfile: string | null = null
  const installing = new Promise<{is_error: () => false}>((resolve) => {
    finishInstall = () => resolve({is_error: () => false})
  })
  ;(appRegistry.getActiveVersion as jest.Mock).mockResolvedValue(null)
  ;(appRegistry.installFromJsonUrl as jest.Mock).mockReturnValue(installing)
  ;(localMiniappRuntime.getSimpleStorage as jest.Mock).mockImplementation(async (_package, key) =>
    key === "openalma.connection-profile" ? storedProfile : null)
  global.fetch = jest.fn(async (url: string) => {
    if (url.endsWith("/miniapp.json")) {
      return {ok: true, json: async () => ({packageName: "com.openalma.mentra", version: "0.1.10"})}
    }
    if (url.endsWith("/openalma-profile.json")) {
      return {ok: true, json: async () => ({offerId: "offer-2", profile})}
    }
    if (url.endsWith("/integration/mentra/host/seen")) return {ok: true}
    return {ok: true}
  }) as unknown as typeof fetch

  const view = render(createElement(IrisUpdatePrompt))
  await waitFor(() => expect(appRegistry.installFromJsonUrl).toHaveBeenCalledTimes(1))
  storedProfile = "user-selected-profile"
  finishInstall()
  await waitFor(() => expect(engine.miniapps.setForeground).toHaveBeenCalledWith("com.openalma.mentra"))

  expect(localMiniappRuntime.setSimpleStorage).not.toHaveBeenCalledWith(
    "com.openalma.mentra", "openalma.connection-profile", expect.anything(),
  )
  view.unmount()
})

test("does not restore a profile explicitly cleared inside Iris", async () => {
  const profile = {
    baseUrl: "http://10.77.0.1", bearer: "fictional", userId: "Test User",
    soulId: "Test Soul", deviceSessionId: "test-phone",
  }
  let finishInstall!: () => void
  let profileCleared: string | null = null
  const installing = new Promise<{is_error: () => false}>((resolve) => {
    finishInstall = () => resolve({is_error: () => false})
  })
  ;(appRegistry.getActiveVersion as jest.Mock).mockResolvedValue(null)
  ;(appRegistry.installFromJsonUrl as jest.Mock).mockReturnValue(installing)
  ;(localMiniappRuntime.getSimpleStorage as jest.Mock).mockImplementation(async (_package, key) =>
    key === "openalma.connection-profile-cleared" ? profileCleared : null)
  global.fetch = jest.fn(async (url: string) => {
    if (url.endsWith("/miniapp.json")) return {ok: true, json: async () => ({packageName: "com.openalma.mentra", version: "0.1.10"})}
    if (url.endsWith("/openalma-profile.json")) return {ok: true, json: async () => ({offerId: "offer-3", profile})}
    if (url.endsWith("/integration/mentra/host/seen")) return {ok: true}
    return {ok: true}
  }) as unknown as typeof fetch

  const view = render(createElement(IrisUpdatePrompt))
  await waitFor(() => expect(appRegistry.installFromJsonUrl).toHaveBeenCalledTimes(1))
  profileCleared = "1"
  finishInstall()
  await waitFor(() => expect(engine.miniapps.setForeground).toHaveBeenCalledWith("com.openalma.mentra"))

  expect(localMiniappRuntime.setSimpleStorage).not.toHaveBeenCalledWith(
    "com.openalma.mentra", "openalma.connection-profile", expect.anything(),
  )
  view.unmount()
})

test("resumes acknowledgement from a persisted installed offer without reinstalling", async () => {
  const profile = {
    baseUrl: "http://10.77.0.1", bearer: "fictional", userId: "Test User",
    soulId: "Test Soul", deviceSessionId: "test-phone",
  }
  ;(appRegistry.getActiveVersion as jest.Mock).mockResolvedValue("0.1.10")
  ;(localMiniappRuntime.getSimpleStorage as jest.Mock).mockImplementation(async (_package, key) =>
    key === "openalma.installed-offer" ? "offer-4" : "existing-profile")
  global.fetch = jest.fn(async (url: string) => {
    if (url.endsWith("/miniapp.json")) return {ok: true, json: async () => ({packageName: "com.openalma.mentra", version: "0.1.10"})}
    if (url.endsWith("/openalma-profile.json")) return {ok: true, json: async () => ({offerId: "offer-4", profile})}
    if (url.endsWith("/integration/mentra/host/seen")) return {ok: true}
    return {ok: true}
  }) as unknown as typeof fetch

  const view = render(createElement(IrisUpdatePrompt))
  await waitFor(() => expect(engine.miniapps.setForeground).toHaveBeenCalledWith("com.openalma.mentra"))

  expect(appRegistry.installFromJsonUrl).not.toHaveBeenCalled()
  expect(localMiniappRuntime.setSimpleStorage).toHaveBeenCalledWith(
    "com.openalma.mentra", "openalma.installed-offer", "",
  )
  view.unmount()
})
