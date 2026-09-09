import {isIrisOffer, parseIrisSetupOffer} from "./irisUpdateOffer"

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
