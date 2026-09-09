import semver from "semver"

export const IRIS_PACKAGE = "com.openalma.mentra"

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
