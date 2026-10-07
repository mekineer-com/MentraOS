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

export function parseIrisSetupOffer(value: unknown): {offerId: string; deviceSessionId: string} | null {
  if (!value || typeof value !== "object") return null
  const offer = value as {offerId?: unknown; deviceSessionId?: unknown}
  if (typeof offer.offerId !== "string" || !offer.offerId.trim() ||
      typeof offer.deviceSessionId !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(offer.deviceSessionId)) return null
  return {offerId: offer.offerId, deviceSessionId: offer.deviceSessionId}
}

export function isIrisOffer(
  manifest: {packageName?: unknown; version?: unknown},
  offerId: string,
  attempted: string | null,
): manifest is {packageName: typeof IRIS_PACKAGE; version: string} {
  return manifest.packageName === IRIS_PACKAGE && typeof manifest.version === "string" &&
    Boolean(semver.valid(manifest.version)) && offerId !== attempted
}
