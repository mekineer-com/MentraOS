import {useEffect, useRef} from "react"
import {AppState} from "react-native"
import * as Application from "expo-application"
import semver from "semver"

import {showAlert} from "@/contexts/ModalContext"
import {translate} from "@/i18n"
import {engine} from "@mentra/engine"
import {appRegistry} from "@mentra/engine-host-internal"

const HOST_PACKAGE = "com.mentra.mentra.openalma"
const IRIS_PACKAGE = "com.openalma.mentra"

export function IrisUpdatePrompt() {
  const checking = useRef(false)
  const offered = useRef<string | null>(null)

  useEffect(() => {
    if (Application.applicationId !== HOST_PACKAGE) return

    const check = async () => {
      if (checking.current) return
      checking.current = true
      try {
        const installed = await appRegistry.getActiveVersion(IRIS_PACKAGE)
        const sourceUrl = appRegistry.getReleaseIdentity(IRIS_PACKAGE, installed)?.sourceUrl
        if (!sourceUrl) return

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 2000)
        let manifest: {packageName?: unknown; version?: unknown}
        try {
          const response = await fetch(`${sourceUrl}/miniapp.json`, {signal: controller.signal})
          if (!response.ok) return
          manifest = await response.json()
        } catch {
          return
        } finally {
          clearTimeout(timeout)
        }
        if (manifest.packageName !== IRIS_PACKAGE || typeof manifest.version !== "string" ||
          !semver.valid(installed) || !semver.valid(manifest.version) || !semver.gt(manifest.version, installed) ||
          offered.current === manifest.version) return

        offered.current = manifest.version
        const choice = await showAlert({
          title: translate("irisUpdate:title"),
          message: translate("irisUpdate:message", {version: manifest.version}),
          buttons: [
            {text: translate("common:cancel"), style: "cancel"},
            {text: translate("irisUpdate:install")},
          ],
        })
        if (choice !== 1) return

        try {
          const result = await appRegistry.installFromJsonUrl(sourceUrl)
          if (result.is_error()) throw result.error
          await engine.miniapps.refresh()
          await engine.miniapps.setForeground(IRIS_PACKAGE)
        } catch (error) {
          offered.current = null
          await showAlert({
            title: translate("irisUpdate:failedTitle"),
            message: error instanceof Error ? error.message : String(error),
          })
        }
      } catch (error) {
        console.warn("IRIS_UPDATE: check failed", error)
      } finally {
        checking.current = false
      }
    }

    void check()
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void check()
    })
    return () => subscription.remove()
  }, [])

  return null
}
