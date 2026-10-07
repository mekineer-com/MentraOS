import semver from "semver"

export const IRIS_PACKAGE = "com.openalma.mentra"
export const OPENALMA_HOST_PACKAGE = "com.mentra.mentra.openalma"
export const OPENALMA_HOST_KEY = "openalma.host"
export const OPENALMA_ADDRESS_KEY = "openalma.server-address"
export const DEFAULT_OPENALMA_ADDRESS = "http://10.77.0.1"

export function openAlmaAddresses(value: string): {baseUrl: string; installerUrl: string} {
  const baseUrl = value.trim().replace(/\/+$/, "")
  const match = /^(https?):\/\/(\[[^\]\s]+\]|[^\/:@?#\s]+)(?::(\d+))?$/.exec(baseUrl)
  if (!match || (match[3] && (Number(match[3]) < 1 || Number(match[3]) > 65535))) {
    throw new Error("Enter a valid OpenAlma address")
  }
  return {baseUrl, installerUrl: `http://${match[2]}:6789`}
}

type IrisProfile = {
  baseUrl: string
  bearer: string
  userId: string
  soulId: string
  deviceSessionId: string
}

export function parseIrisSetupOffer(value: unknown): {offerId: string; profile: IrisProfile} | null {
  if (!value || typeof value !== "object") return null
  const offer = value as {offerId?: unknown; profile?: unknown}
  if (typeof offer.offerId !== "string" || !offer.offerId || !offer.profile || typeof offer.profile !== "object") return null
  const profile = offer.profile as Record<keyof IrisProfile, unknown>
  if (!["baseUrl", "bearer", "userId", "soulId", "deviceSessionId"].every(
    (key) => typeof profile[key as keyof IrisProfile] === "string" && String(profile[key as keyof IrisProfile]).trim(),
  )) return null
  return {offerId: offer.offerId, profile: offer.profile as IrisProfile}
}

export function isIrisOffer(
  manifest: {packageName?: unknown; version?: unknown},
  offerId: string,
  attempted: string | null,
): manifest is {packageName: typeof IRIS_PACKAGE; version: string} {
  return manifest.packageName === IRIS_PACKAGE && typeof manifest.version === "string" &&
    Boolean(semver.valid(manifest.version)) && offerId !== attempted
}
