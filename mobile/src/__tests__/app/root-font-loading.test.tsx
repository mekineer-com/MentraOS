import {act, render} from "@testing-library/react-native"
import {useFonts} from "expo-font"
import * as SplashScreen from "expo-splash-screen"
import type {ReactNode} from "react"

import Root from "@/app/_layout"
import {useNavigationStore} from "@/stores/navigation"
import {useOpenAlmaHostUpdate} from "@/services/openAlmaHostUpdate"

jest.mock("expo-application", () => ({applicationId: "com.mentra.mentra.openalma",
  nativeApplicationVersion: "3.2.1", nativeBuildVersion: "54000001"}))
jest.mock("@/services/deployment", () => ({useDeployment: () => ({activeDeployment: {kind: "consumer"}})}))

jest.mock("react-native-get-random-values", () => ({}))
jest.mock("@/utils/polyfills/event", () => ({}))
jest.mock("@/global.css", () => ({}))
jest.mock("@sentry/react-native", () => ({wrap: (component: unknown) => component}))
jest.mock("expo-font", () => ({useFonts: jest.fn()}))
jest.mock("expo-router", () => ({useNavigationContainerRef: () => null}))
jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: jest.fn(),
  setOptions: jest.fn(),
  hideAsync: jest.fn(),
}))
jest.mock("@/effects/SentrySetup", () => ({SentrySetup: jest.fn(), SentryNavigationIntegration: {}}))
jest.mock("@/theme", () => ({customFontsToLoad: {redHatDisplayRegular: 1}}))
jest.mock("@/i18n", () => ({initI18n: jest.fn().mockResolvedValue(undefined)}))
jest.mock("@/utils/formatDate", () => ({loadDateFnsLocale: jest.fn().mockResolvedValue(undefined)}))
jest.mock("@mentra/engine", () => ({engine: {settings: {loadAll: jest.fn()}}}))
jest.mock("@mentra/engine-host-internal", () => ({logBuffer: {startConsoleInterception: jest.fn()}}))
jest.mock("@/stores/navigation", () => ({useNavigationStore: {getState: jest.fn()}}))
jest.mock("@/contexts/AllProviders", () => ({AllProviders: ({children}: {children: ReactNode}) => children}))
jest.mock("@/effects/AllEffects", () => ({
  AllEffects: ({launch}: {launch: object}) => {
    const React = require("react")
    const {Text} = require("react-native")
    const {OpenAlmaHostUpdateChecker} = require("@/effects/OpenAlmaHostUpdateChecker")
    return React.createElement(React.Fragment, null,
      React.createElement(OpenAlmaHostUpdateChecker, {launch}), React.createElement(Text, null, "App content"))
  },
}))

it("waits for fonts before showing content or resetting navigation on a warm relaunch", async () => {
  const originalFetch = global.fetch
  global.fetch = jest.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue({ok: true, json: async () => ({
    tag_name: "v3.2.1", draft: false, prerelease: false, assets: [{
      name: "OpenAlma-Mentra-3.2.1-54000002.apk", state: "uploaded", size: 100,
      browser_download_url: "https://github.com/mekineer-com/MentraOS/releases/download/v3.2.1/OpenAlma-Mentra-3.2.1-54000002.apk",
    }],
  })})
  const replaceAll = jest.fn()
  ;(useNavigationStore.getState as jest.Mock).mockReturnValue({replaceAll})
  jest.mocked(useFonts).mockReturnValue([false, null])
  const cold = render(<Root />)
  await act(async () => {})
  expect(cold.queryByText("App content")).toBeNull()
  expect(SplashScreen.hideAsync).not.toHaveBeenCalled()

  jest.mocked(useFonts).mockReturnValue([true, null])
  cold.rerender(<Root />)
  await act(async () => {})
  expect(cold.getByText("App content")).toBeTruthy()
  expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1)
  expect(replaceAll).not.toHaveBeenCalled()
  expect(global.fetch).toHaveBeenCalledTimes(1)
  expect(useOpenAlmaHostUpdate.getState().release).toBeNull()
  cold.unmount()

  jest.mocked(useFonts).mockReturnValue([false, null])
  const warm = render(<Root />)
  await act(async () => {})
  expect(warm.queryByText("App content")).toBeNull()
  expect(replaceAll).not.toHaveBeenCalled()
  expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1)

  jest.mocked(useFonts).mockReturnValue([true, null])
  warm.rerender(<Root />)
  await act(async () => {})
  expect(warm.getByText("App content")).toBeTruthy()
  expect(replaceAll).toHaveBeenCalledWith("/")
  expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(2)
  expect(global.fetch).toHaveBeenCalledTimes(2)
  expect(useOpenAlmaHostUpdate.getState().release?.buildNumber).toBe(54000002)
  warm.unmount()
  global.fetch = originalFetch
})
