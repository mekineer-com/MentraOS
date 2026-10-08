import * as Sentry from "@sentry/react-native"
import {SentrySetup, updateSentryForActiveDeployment} from "./SentrySetup"

let mockTelemetryAllowed = false
jest.mock("@/services/deployment", () => ({
  deploymentStore: {isTelemetryAllowed: () => mockTelemetryAllowed, subscribe: jest.fn()},
}))
jest.mock("@mentra/engine", () => ({
  SETTINGS: {china_deployment: {key: "china_deployment"}},
  engine: {settings: {get: () => false}},
  getAppBuildInfo: () => ({appVersion: "test", buildTime: "test", buildCommit: "test"}),
}))
jest.mock("@sentry/react-native", () => ({
  reactNavigationIntegration: jest.fn(),
  feedbackIntegration: jest.fn(),
  init: jest.fn(),
  setUser: jest.fn(),
  close: jest.fn(async () => {}),
}))

test("fork policy prevents Sentry initialization even with a DSN; Stock remains enabled", async () => {
  const previous = process.env.EXPO_PUBLIC_SENTRY_DSN
  process.env.EXPO_PUBLIC_SENTRY_DSN = "https://test@example.invalid/1"
  try {
    SentrySetup()
    expect(Sentry.init).not.toHaveBeenCalled()
    mockTelemetryAllowed = true
    updateSentryForActiveDeployment()
    expect(Sentry.init).toHaveBeenCalledTimes(1)
    mockTelemetryAllowed = false
    updateSentryForActiveDeployment()
    await Promise.resolve()
    expect(Sentry.setUser).toHaveBeenCalledWith(null)
    expect(Sentry.close).toHaveBeenCalledTimes(1)
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_SENTRY_DSN
    else process.env.EXPO_PUBLIC_SENTRY_DSN = previous
  }
})
