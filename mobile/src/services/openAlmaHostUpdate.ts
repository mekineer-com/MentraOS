import * as Application from "expo-application"
import {Linking} from "react-native"
import semver from "semver"
import {create} from "zustand"

import {OPENALMA_HOST_PACKAGE} from "@/effects/irisUpdateOffer"

export const OPENALMA_HOST_RELEASES_URL = "https://github.com/mekineer-com/MentraOS/releases/latest"
const RELEASE_API_URL = "https://api.github.com/repos/mekineer-com/MentraOS/releases/latest"
const DOWNLOAD_BASE_URL = "https://github.com/mekineer-com/MentraOS/releases/download/"

export type OpenAlmaHostRelease = {version: string; buildNumber: number; downloadUrl: string}

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
  let latest: OpenAlmaHostRelease | null = null
  for (const value of release.assets) {
    if (!value || typeof value !== "object") continue
    const asset = value as Record<string, unknown>
    const namePrefix = `OpenAlma-Mentra-${version}-`
    if (typeof asset.name !== "string" || !asset.name.startsWith(namePrefix) || !asset.name.endsWith(".apk")) continue
    const build = asset.name.slice(namePrefix.length, -4)
    const buildNumber = Number(build)
    if (!/^[1-9]\d*$/.test(build) || !Number.isSafeInteger(buildNumber)
        || asset.state !== "uploaded" || typeof asset.size !== "number" || asset.size <= 0
        || asset.browser_download_url !== `${prefix}${encodeURIComponent(asset.name)}`) continue
    if (!latest || buildNumber > latest.buildNumber) {
      latest = {version, buildNumber, downloadUrl: asset.browser_download_url as string}
    }
  }
  return latest
}

let currentLaunch: object | undefined
let launchCheck: Promise<OpenAlmaHostRelease | null> | undefined

export function checkOpenAlmaHostUpdate(launch: object): Promise<OpenAlmaHostRelease | null> {
  if (!isOpenAlmaHost()) return Promise.resolve(null)
  if (currentLaunch !== launch) {
    currentLaunch = launch
    launchCheck = undefined
    useOpenAlmaHostUpdate.setState({release: null})
  }
  return (launchCheck ??= checkRelease(launch))
}

async function checkRelease(launch: object): Promise<OpenAlmaHostRelease | null> {
  const currentVersion = semver.valid(Application.nativeApplicationVersion ?? "")
  const currentBuild = Number(Application.nativeBuildVersion)
  if (!currentVersion || !Number.isSafeInteger(currentBuild) || currentBuild < 1) return null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch(RELEASE_API_URL, {
      headers: {Accept: "application/vnd.github+json"},
      signal: controller.signal,
    })
    const release = response.ok ? parseOpenAlmaHostRelease(await response.json()) : null
    const newer = release && semver.gte(release.version, currentVersion) && release.buildNumber > currentBuild ? release : null
    if (currentLaunch === launch) useOpenAlmaHostUpdate.setState({release: newer})
    return newer
  } catch (error) {
    console.warn("OpenAlma Mentra release check unavailable:", error)
    if (currentLaunch === launch) useOpenAlmaHostUpdate.setState({release: null})
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
