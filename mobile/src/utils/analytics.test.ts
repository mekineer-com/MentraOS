import {disableAnalytics, initAnalytics, logEvent, logScreenView, setUserId, setUserProperty} from "./analytics"

let mockTelemetryAllowed = false
let mockApplicationId = "com.mentra.mentra.openalma"
jest.mock("expo-application", () => ({get applicationId() {return mockApplicationId}}))
const mockAnalytics = {
  setAnalyticsCollectionEnabled: jest.fn(async () => {}),
  logEvent: jest.fn(),
  logScreenView: jest.fn(),
  setUserId: jest.fn(),
  setUserProperty: jest.fn(),
}

jest.mock("@/services/deployment", () => ({
  deploymentStore: {isTelemetryAllowed: () => mockTelemetryAllowed},
}))
jest.mock("@mentra/engine", () => ({
  SETTINGS: {china_deployment: {key: "china_deployment"}},
  engine: {settings: {get: () => false}},
}))
jest.mock("@react-native-firebase/analytics", () => ({
  __esModule: true,
  default: () => mockAnalytics,
}))

test("cold fork startup explicitly disables persisted native collection and blocks analytics calls", async () => {
  await disableAnalytics()
  expect(mockAnalytics.setAnalyticsCollectionEnabled).toHaveBeenCalledWith(false)
  await initAnalytics()
  await logEvent("test")
  await logScreenView("test")
  await setUserId("fictional-user")
  await setUserProperty("test", "value")
  expect(mockAnalytics.logEvent).not.toHaveBeenCalled()
  expect(mockAnalytics.logScreenView).not.toHaveBeenCalled()
  expect(mockAnalytics.setUserId).not.toHaveBeenCalled()
  expect(mockAnalytics.setUserProperty).not.toHaveBeenCalled()
  expect(mockAnalytics.setAnalyticsCollectionEnabled).not.toHaveBeenCalledWith(true)

  mockTelemetryAllowed = true
  mockApplicationId = "com.mentra.mentra"
  await initAnalytics()
  await logEvent("stock-test")
  expect(mockAnalytics.setAnalyticsCollectionEnabled).toHaveBeenCalledWith(true)
  expect(mockAnalytics.logEvent).toHaveBeenCalledWith("stock-test", undefined)
  mockTelemetryAllowed = false
  await disableAnalytics()
  expect(mockAnalytics.setAnalyticsCollectionEnabled).toHaveBeenLastCalledWith(false)
})
