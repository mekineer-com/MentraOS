import {useEffect, useRef} from "react"
import {AppState} from "react-native"
import * as Application from "expo-application"

import {showAlert} from "@/contexts/ModalContext"
import {translate} from "@/i18n"
import {engine} from "@mentra/engine"
import {appRegistry, localMiniappRuntime} from "@mentra/engine-host-internal"
import {IRIS_PACKAGE, isIrisOffer, parseIrisSetupOffer} from "./irisUpdateOffer"

const HOST_PACKAGE = "com.mentra.mentra.openalma"
const DEFAULT_IRIS_SOURCE = "http://10.77.0.1:6789"
const IRIS_PROFILE_KEY = "openalma.connection-profile"

export function IrisUpdatePrompt() {
  const checking = useRef(false)
  const offered = useRef<string | null>(null)
  const installedOffer = useRef<string | null>(null)

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
        let setup
        try {
          const [manifestResponse, profileResponse] = await Promise.all([
            fetch(`${sourceUrl}/miniapp.json`, {signal: controller.signal}),
            fetch(`${sourceUrl}/openalma-profile.json`, {signal: controller.signal}),
          ])
          if (!manifestResponse.ok || !profileResponse.ok) {
            offered.current = null
            return
          }
          manifest = await manifestResponse.json()
          setup = parseIrisSetupOffer(await profileResponse.json())
          if (!setup) return
        } catch {
          offered.current = null
          return
        } finally {
          clearTimeout(timeout)
        }
        const completing = installedOffer.current === setup.offerId
        if (!completing && !isIrisOffer(manifest, setup.offerId, offered.current)) return

        offered.current = setup.offerId
        if (!completing) {
          try {
            const existingProfile = await localMiniappRuntime.getSimpleStorage(IRIS_PACKAGE, IRIS_PROFILE_KEY)
            const result = await appRegistry.installFromJsonUrl(sourceUrl)
            if (result.is_error()) throw result.error
            if (existingProfile == null) {
              await localMiniappRuntime.setSimpleStorage(IRIS_PACKAGE, IRIS_PROFILE_KEY, JSON.stringify(setup.profile))
            }
            installedOffer.current = setup.offerId
          } catch (error) {
            offered.current = null
            await showAlert({
              title: translate("irisUpdate:failedTitle"),
              message: error instanceof Error ? error.message : String(error),
            })
            return
          }
        }

        try {
          await engine.miniapps.refresh()
          await engine.miniapps.setForeground(IRIS_PACKAGE)
          const acknowledgement = await fetch(`${sourceUrl}/__mentra_release/installed`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({offerId: setup.offerId}),
          })
          if (!acknowledgement.ok) throw new Error(`Iris installation acknowledgement failed (${acknowledgement.status})`)
          installedOffer.current = null
        } catch (error) {
          await showAlert({
            title: translate("irisUpdate:completionFailedTitle"),
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
