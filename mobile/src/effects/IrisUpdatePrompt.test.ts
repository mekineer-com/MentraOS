import {createElement} from "react"
import {AppState} from "react-native"
import {render, waitFor} from "@testing-library/react-native"

import {showAlert} from "@/contexts/ModalContext"
import {engine} from "@mentra/engine"
import {appRegistry, localMiniappRuntime} from "@mentra/engine-host-internal"
import {IrisUpdatePrompt} from "./IrisUpdatePrompt"
import {isIrisOffer, parseIrisSetupOffer} from "./irisUpdateOffer"

jest.mock("expo-application", () => ({applicationId: "com.mentra.mentra.openalma"}))
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
  ;(global.fetch as jest.Mock) = jest.fn(async (url: string) => {
    if (url.endsWith("/miniapp.json")) {
      return {ok: true, json: async () => ({packageName: "com.openalma.mentra", version: "0.1.10"})}
    }
    if (url.endsWith("/openalma-profile.json")) {
      return {ok: true, json: async () => ({offerId: "offer-1", profile})}
    }
    acknowledgements += 1
    return {ok: acknowledgements > 1, status: 503}
  })

  const view = render(createElement(IrisUpdatePrompt))
  await waitFor(() => expect(showAlert).toHaveBeenCalledWith(expect.objectContaining({
    title: "irisUpdate:completionFailedTitle",
  })))
  const onAppState = (AppState.addEventListener as jest.Mock).mock.calls[0][1]
  onAppState("active")
  await waitFor(() => expect(acknowledgements).toBe(2))

  expect(appRegistry.installFromJsonUrl).toHaveBeenCalledTimes(1)
  expect(localMiniappRuntime.setSimpleStorage).toHaveBeenCalledTimes(1)
  expect(engine.miniapps.setForeground).toHaveBeenCalledTimes(2)
  view.unmount()
})
