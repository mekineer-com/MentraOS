/// <reference types="bun-types" />
// eslint-disable-next-line import/no-unresolved
import {describe, expect, mock, test} from "bun:test"

function fakeEngine() {
  return {
    router: {logRing: {snapshot: () => []}, onCrashloop: null as unknown, onRestartToast: null as unknown},
    uiRouter: {bindWebView() {}, unbindWebView() {}, notifyReopen() {}},
    crashController: {},
  }
}

let current = fakeEngine()
const installed: unknown[] = []
let mockIsOpenAlmaHost = false
const captureMessage = mock(() => {})
const addBreadcrumb = mock(() => {})
const showAlert = mock((..._args: unknown[]) => {})

mock.module("react-native", () => ({Platform: {OS: "android"}}))
mock.module("@sentry/react-native", () => ({captureMessage, addBreadcrumb}))
mock.module("@/services/openAlmaHostUpdate", () => ({isOpenAlmaHost: () => mockIsOpenAlmaHost}))
mock.module("@mentra/engine", () => ({engine: {miniapps: {list: () => []}}}))
mock.module("@mentra/engine-host-internal", () => ({
  ensureMiniappEngine: () => current,
  getMiniappEngine: () => current,
}))
mock.module("@/services/streamPreview", () => ({
  installStreamPreviewCoordinator: (uiRouter: unknown) => installed.push(uiRouter),
}))
mock.module("@/utils/AlertUtils", () => ({default: showAlert}))

const {bootstrapMentraJS} = await import("./mentraJsBootstrap")

describe("bootstrapMentraJS", () => {
  test("wires the stream-preview channel into a rebuilt engine after logout", () => {
    const first = current
    bootstrapMentraJS()
    bootstrapMentraJS()
    expect(installed).toEqual([first.uiRouter])

    // engine.stop() drops the singletons; the next engine.start() builds new routers.
    current = fakeEngine()
    bootstrapMentraJS()
    expect(installed).toEqual([first.uiRouter, current.uiRouter])
    expect(typeof current.router.onCrashloop).toBe("function")
    expect(typeof current.router.onRestartToast).toBe("function")
  })
  test("keeps local crash alerts without Sentry or claiming a fork report was filed", () => {
    bootstrapMentraJS()
    const crashloop = current.router.onCrashloop as (packageName: string, reason: string) => void
    const restart = current.router.onRestartToast as (packageName: string, reason: string) => void
    mockIsOpenAlmaHost = true
    crashloop("com.openalma.mentra", "missed_ping")
    restart("com.openalma.mentra", "missed_ping")
    expect(captureMessage).not.toHaveBeenCalled()
    expect(addBreadcrumb).not.toHaveBeenCalled()
    expect(String(showAlert.mock.calls[0]?.[1])).not.toContain("filed")
    mockIsOpenAlmaHost = false
    crashloop("com.example.stock", "missed_ping")
    restart("com.example.stock", "missed_ping")
    expect(captureMessage).toHaveBeenCalledTimes(1)
    expect(addBreadcrumb).toHaveBeenCalledTimes(1)
  })
})
