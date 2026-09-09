import semver from "semver"

export const IRIS_PACKAGE = "com.openalma.mentra"

export function isIrisOffer(
  manifest: {packageName?: unknown; version?: unknown},
  attempted: string | null,
): manifest is {packageName: typeof IRIS_PACKAGE; version: string} {
  return manifest.packageName === IRIS_PACKAGE && typeof manifest.version === "string" &&
    Boolean(semver.valid(manifest.version)) && manifest.version !== attempted
}
