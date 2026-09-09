import {useEffect, useRef} from "react"
import {AppState} from "react-native"
import * as Application from "expo-application"

import {showAlert} from "@/contexts/ModalContext"
import {translate} from "@/i18n"
import {engine} from "@mentra/engine"
import {appRegistry} from "@mentra/engine-host-internal"
import {IRIS_PACKAGE, isIrisOffer} from "./irisUpdateOffer"

const HOST_PACKAGE = "com.mentra.mentra.openalma"
const DEFAULT_IRIS_SOURCE = "http://10.77.0.1:6789"

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
        const sourceUrl = (installed && appRegistry.getReleaseIdentity(IRIS_PACKAGE, installed)?.sourceUrl) ||
          DEFAULT_IRIS_SOURCE

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
        if (!isIrisOffer(manifest, offered.current)) return

        offered.current = manifest.version
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
