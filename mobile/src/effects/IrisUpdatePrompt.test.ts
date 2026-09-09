import {isIrisOffer} from "./irisUpdateOffer"

test("accepts the launcher-selected Iris release regardless of version ordering", () => {
  expect(isIrisOffer({packageName: "com.openalma.mentra", version: "0.1.9"}, null)).toBe(true)
  expect(isIrisOffer({packageName: "com.openalma.mentra", version: "0.1.8"}, null)).toBe(true)
  expect(isIrisOffer({packageName: "wrong", version: "0.1.9"}, null)).toBe(false)
  expect(isIrisOffer({packageName: "com.openalma.mentra", version: "invalid"}, null)).toBe(false)
  expect(isIrisOffer({packageName: "com.openalma.mentra", version: "0.1.9"}, "0.1.9")).toBe(false)
})
