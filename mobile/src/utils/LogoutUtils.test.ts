import * as Application from "expo-application"
import {OPENALMA_ADDRESS_KEY, OPENALMA_HOST_PACKAGE} from "@/effects/irisUpdateOffer"
import {LogoutUtils} from "./LogoutUtils"
import {storage} from "@/utils/storage"

jest.mock("expo-application", () => ({applicationId: "com.mentra.mentra.openalma"}))
jest.mock("@mentra/cloud-client", () => ({SessionRevocationError: class extends Error {}}))
jest.mock("@mentra/engine", () => ({engine: {
  glasses: {disconnect: jest.fn(async () => {}), forget: jest.fn(async () => {})},
  settings: {resetAllLocal: jest.fn()},
  stop: jest.fn(async () => {}),
}}))
jest.mock("@/utils/GlobalEventEmitter", () => ({__esModule: true, default: {emit: jest.fn()}}))
jest.mock("@/services/MantleManager", () => ({__esModule: true, default: {cleanup: jest.fn(async () => {})}}))
jest.mock("@/services/cloudClient", () => ({cloudClient: {clearAuthSession: jest.fn(async () => {})}}))
jest.mock("@/utils/auth/authClient", () => ({
  __esModule: true,
  default: {signOut: jest.fn(async () => ({is_error: () => false}))},
}))
jest.mock("@/utils/settleFrame", () => ({settleFrame: jest.fn(async () => {})}))

beforeEach(() => {
  storage.clearAll()
  jest.spyOn(console, "log").mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

it.each([false, true])("keeps only the fork address through logout (skipAuthSignOut=%s)", async (skipAuthSignOut) => {
  Object.assign(Application, {applicationId: OPENALMA_HOST_PACKAGE})
  storage.save(OPENALMA_ADDRESS_KEY, "http://192.0.2.10:8099")
  for (const key of ["mentra.account.accessToken", "mentra.account.refreshToken", "openalma.installed-offer",
    "openalma.connection-profile", "openalma:gemini-session-v1", "chosen-soul", "camera-enabled"]) {
    storage.save(key, "disposable-test-value")
  }
  await LogoutUtils.performCompleteLogout({skipAuthSignOut})
  expect(storage.load<string>(OPENALMA_ADDRESS_KEY).value).toBe("http://192.0.2.10:8099")
  expect(storage.getAllKeys()).toEqual([OPENALMA_ADDRESS_KEY])
  expect(await LogoutUtils.verifyLogoutSuccess()).toBe(true)
})

it.each([OPENALMA_HOST_PACKAGE, "com.mentra.mentra"])("does not seed an absent address for %s", async (applicationId) => {
  Object.assign(Application, {applicationId})
  await LogoutUtils.performCompleteLogout()
  expect(storage.getAllKeys()).toEqual([])
})

it("still clears an address in Stock Mentra", async () => {
  Object.assign(Application, {applicationId: "com.mentra.mentra"})
  storage.save(OPENALMA_ADDRESS_KEY, "http://192.0.2.10")
  await LogoutUtils.performCompleteLogout()
  expect(storage.getAllKeys()).toEqual([])
})
