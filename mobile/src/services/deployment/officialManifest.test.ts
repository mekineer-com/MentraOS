import {APP_STORE_REVIEW_URL, APP_STORE_URL, PLAY_STORE_URL} from "@/constants/appConfig"
import {OPENALMA_HOST_RELEASES_URL} from "@/services/openAlmaHostUpdate"

import {createOfficialManifest} from "./officialManifest"

let mockApplicationId: string | null = "com.mentra.mentra"
jest.mock("expo-application", () => ({
  get applicationId() {
    return mockApplicationId
  },
}))

test.each(["com.mentra.mentra", "com.mentra.mentra.cn", "com.mentra.mentra.dev", null])(
  "preserves upstream update/review URLs for %s",
  (applicationId) => {
    mockApplicationId = applicationId
    const {appUpdates, telemetry} = createOfficialManifest()
    expect(telemetry).toBe(true)
    expect(appUpdates.storeUrls).toEqual({android: PLAY_STORE_URL, ios: APP_STORE_URL})
    expect(appUpdates.reviewUrls).toEqual({android: PLAY_STORE_URL, ios: APP_STORE_REVIEW_URL})
    expect(appUpdates.mode).toBe("store")
  },
)

test("fork boot Update leads to fork releases, not stock Play Store", () => {
  mockApplicationId = "com.mentra.mentra.openalma"
  const {appUpdates, telemetry} = createOfficialManifest()
  expect(telemetry).toBe(false)
  expect(appUpdates.storeUrls).toEqual({android: OPENALMA_HOST_RELEASES_URL, ios: APP_STORE_URL})
  expect(appUpdates.reviewUrls).toEqual({android: null, ios: APP_STORE_REVIEW_URL})
})
