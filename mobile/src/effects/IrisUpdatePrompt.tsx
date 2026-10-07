import {useEffect, useRef} from "react"
import {AppState} from "react-native"
import * as Application from "expo-application"
import * as Device from "expo-device"

import {showAlert} from "@/contexts/ModalContext"
import {translate} from "@/i18n"
import {engine} from "@mentra/engine"
import {appRegistry, localMiniappRuntime, miniappLauncher} from "@mentra/engine-host-internal"
import {storage} from "@/utils/storage/storage"
import {deploymentStore, useDeployment} from "@/services/deployment"
import {DEFAULT_OPENALMA_ADDRESS, IRIS_PACKAGE, OPENALMA_ADDRESS_KEY, OPENALMA_HOST_KEY,
  OPENALMA_HOST_PACKAGE, isIrisOffer, openAlmaAddresses, parseIrisSetupOffer} from "./irisUpdateOffer"

const IRIS_INSTALLED_OFFER_KEY = "openalma.installed-offer"

export function savedOpenAlmaAddress(): string {
  const saved = storage.load<string>(OPENALMA_ADDRESS_KEY)
  return saved.is_ok() ? saved.value : DEFAULT_OPENALMA_ADDRESS
}

export async function reportOpenAlmaHost(baseUrl: string): Promise<string> {
  const deviceSessionId = `android-${Application.getAndroidId()}`
  const host = {host_package: OPENALMA_HOST_PACKAGE,
    host_version: Application.nativeApplicationVersion || "unknown"}
  await localMiniappRuntime.setSimpleStorage(IRIS_PACKAGE, OPENALMA_HOST_KEY, JSON.stringify({...host, deviceSessionId}))
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2000)
  try {
    const ownerResponse = await fetch(`${baseUrl}/integration/mentra/owner`, {signal: controller.signal})
    if (!ownerResponse.ok) throw new Error("OpenAlma is unavailable")
    const owner = await ownerResponse.json()
    if (typeof owner.user_id !== "string" || !owner.user_id.trim()) {
      throw new Error("Set up the OpenAlma owner in the launcher")
    }
    const response = await fetch(`${baseUrl}/integration/mentra/host/seen`, {
      method: "POST",
      signal: controller.signal,
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        user_id: owner.user_id,
        device_session_id: deviceSessionId,
        ...host,
        default_name: Device.deviceName?.trim() || Device.modelName?.trim() || "Phone",
      }),
    })
    if (!response.ok) throw new Error(`OpenAlma reporting failed (${response.status})`)
    return deviceSessionId
  } finally {
    clearTimeout(timeout)
  }
}

export function IrisUpdatePrompt() {
  const {activeDeployment} = useDeployment()
  const checking = useRef(false)
  const offered = useRef<string | null>(null)
  const installedOffer = useRef<string | null>(null)
  const activatedOffer = useRef<string | null>(null)
  const completionError = useRef<string | null>(null)

  useEffect(() => {
    if (Application.applicationId !== OPENALMA_HOST_PACKAGE || activeDeployment.kind !== "consumer") return

    const check = async () => {
      if (checking.current) return
      checking.current = true
      try {
        const {baseUrl, installerUrl: sourceUrl} = openAlmaAddresses(savedOpenAlmaAddress())
        const deviceSessionId = await reportOpenAlmaHost(baseUrl)

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 2000)
        let manifest: {packageName?: unknown; version?: unknown}
        let setup
        try {
          const [manifestResponse, offerResponse] = await Promise.all([
            fetch(`${sourceUrl}/miniapp.json`, {signal: controller.signal}),
            fetch(`${sourceUrl}/openalma-offer.json`, {signal: controller.signal}),
          ])
          if (!manifestResponse.ok || !offerResponse.ok) {
            return
          }
          manifest = await manifestResponse.json()
          setup = parseIrisSetupOffer(await offerResponse.json())
          if (!setup || setup.deviceSessionId !== deviceSessionId) return
          const statusResponse = await fetch(
            `${baseUrl}/integration/mentra/status?device_session_id=${encodeURIComponent(deviceSessionId)}`,
            {signal: controller.signal},
          )
          if (!statusResponse.ok) return
          const status = await statusResponse.json()
          if (status.active !== false || status.starting !== false) return
        } catch {
          return
        } finally {
          clearTimeout(timeout)
        }
        const persistedOffer = await localMiniappRuntime.getSimpleStorage(IRIS_PACKAGE, IRIS_INSTALLED_OFFER_KEY)
        const completing = installedOffer.current === setup.offerId || persistedOffer === setup.offerId
        if (deploymentStore.getActive().kind !== "consumer") return
        if (!completing && !isIrisOffer(manifest, setup.offerId, offered.current)) return

        offered.current = setup.offerId
        if (!completing) {
          try {
            const result = await appRegistry.installFromJsonUrl(`${sourceUrl}/${encodeURIComponent(setup.offerId)}`)
            if (result.is_error()) throw result.error
            await localMiniappRuntime.setSimpleStorage(IRIS_PACKAGE, IRIS_INSTALLED_OFFER_KEY, setup.offerId)
            installedOffer.current = setup.offerId
          } catch (error) {
            await showAlert({
              title: translate("irisUpdate:failedTitle"),
              message: error instanceof Error ? error.message : String(error),
            })
            return
          }
        }

        try {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 2000)
          try {
            const statusResponse = await fetch(
              `${baseUrl}/integration/mentra/status?device_session_id=${encodeURIComponent(deviceSessionId)}`,
              {signal: controller.signal},
            )
            if (!statusResponse.ok) return
            const status = await statusResponse.json()
            if (status.active !== false || status.starting !== false) return
          } finally {
            clearTimeout(timeout)
          }
          if (activatedOffer.current !== setup.offerId) {
            await miniappLauncher.stop(IRIS_PACKAGE)
            await miniappLauncher.ensureConnected(IRIS_PACKAGE)
            await engine.miniapps.refresh()
            await engine.miniapps.setForeground(IRIS_PACKAGE)
            activatedOffer.current = setup.offerId
          }
          const ackController = new AbortController()
          const ackTimeout = setTimeout(() => ackController.abort(), 2000)
          try {
            const acknowledgement = await fetch(`${sourceUrl}/__mentra_release/installed`, {
              method: "POST",
              headers: {"Content-Type": "application/json"},
              body: JSON.stringify({offerId: setup.offerId}),
              signal: ackController.signal,
            })
            if (!acknowledgement.ok) throw new Error(`Iris installation acknowledgement failed (${acknowledgement.status})`)
          } finally {
            clearTimeout(ackTimeout)
          }
          await localMiniappRuntime.setSimpleStorage(IRIS_PACKAGE, IRIS_INSTALLED_OFFER_KEY, "")
          installedOffer.current = null
        } catch (error) {
          if (completionError.current !== setup.offerId) {
            completionError.current = setup.offerId
            await showAlert({
              title: translate("irisUpdate:completionFailedTitle"),
              message: error instanceof Error ? error.message : String(error),
            })
          }
        }
      } catch {
        // An unavailable server/offer is normal for this foreground probe.
      } finally {
        checking.current = false
      }
    }

    let timer: ReturnType<typeof setInterval> | undefined
    const onState = (state: string) => {
      clearInterval(timer)
      timer = undefined
      if (state === "active") {
        void check()
        timer = setInterval(() => void check(), 5000)
      }
    }
    onState(AppState.currentState)
    const subscription = AppState.addEventListener("change", onState)
    return () => {clearInterval(timer); subscription.remove()}
  }, [activeDeployment.kind])

  return null
}
