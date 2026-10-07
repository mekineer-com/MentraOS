import * as Application from "expo-application"
import {Linking} from "react-native"
import semver from "semver"
import {create} from "zustand"

import {OPENALMA_HOST_PACKAGE} from "@/effects/irisUpdateOffer"

export const OPENALMA_HOST_RELEASES_URL = "https://github.com/mekineer-com/MentraOS/releases/latest"
const RELEASE_API_URL = "https://api.github.com/repos/mekineer-com/MentraOS/releases/latest"
const DOWNLOAD_BASE_URL = "https://github.com/mekineer-com/MentraOS/releases/download/"

export type OpenAlmaHostRelease = {version: string; downloadUrl: string}

export const useOpenAlmaHostUpdate = create<{
  release: OpenAlmaHostRelease | null
}>(() => ({release: null}))

export function isOpenAlmaHost(): boolean {
  return Application.applicationId === OPENALMA_HOST_PACKAGE
}

/** Accept only fork-named uploaded APKs and their supplied release download URLs. */
export function parseOpenAlmaHostRelease(value: unknown): OpenAlmaHostRelease | null {
  if (!value || typeof value !== "object") return null
  const release = value as Record<string, unknown>
  if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== "string") return null
  const version = semver.valid(release.tag_name)
  if (!version || semver.prerelease(version) || !Array.isArray(release.assets)) return null

  const prefix = `${DOWNLOAD_BASE_URL}${encodeURIComponent(release.tag_name)}/`
  const apk = release.assets.find((value: unknown) => {
    if (!value || typeof value !== "object") return false
    const asset = value as Record<string, unknown>
    return (
      typeof asset.name === "string" &&
      /openalma/i.test(asset.name) &&
      /\.apk$/i.test(asset.name) &&
      asset.state === "uploaded" &&
      typeof asset.size === "number" &&
      asset.size > 0 &&
      asset.browser_download_url === `${prefix}${encodeURIComponent(asset.name)}`
    )
  }) as {browser_download_url: string} | undefined
  return apk ? {version, downloadUrl: apk.browser_download_url} : null
}

// Kept for the JS process lifetime, including failed checks and effect remounts.
let launchCheck: Promise<OpenAlmaHostRelease | null> | undefined

export function checkOpenAlmaHostUpdate(): Promise<OpenAlmaHostRelease | null> {
  if (!isOpenAlmaHost()) return Promise.resolve(null)
  return (launchCheck ??= checkRelease())
}

async function checkRelease(): Promise<OpenAlmaHostRelease | null> {
  const currentVersion = semver.valid(Application.nativeApplicationVersion ?? "")
  if (!currentVersion) return null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch(RELEASE_API_URL, {
      headers: {Accept: "application/vnd.github+json"},
      signal: controller.signal,
    })
    const release = response.ok ? parseOpenAlmaHostRelease(await response.json()) : null
    const newer = release && semver.gt(release.version, currentVersion) ? release : null
    useOpenAlmaHostUpdate.setState({release: newer})
    return newer
  } catch (error) {
    console.warn("OpenAlma Mentra release check unavailable:", error)
    useOpenAlmaHostUpdate.setState({release: null})
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/** Browser failures reject so the Settings action can use its existing alert. */
export async function openOpenAlmaHostUpdate(): Promise<boolean> {
  const {release} = useOpenAlmaHostUpdate.getState()
  if (!isOpenAlmaHost() || !release) return false
  await Linking.openURL(release.downloadUrl)
  return true
}
