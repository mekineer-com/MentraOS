import {useEffect} from "react"

import {deploymentStore, useDeployment} from "@/services/deployment"
import {disableAnalytics, initAnalytics} from "@/utils/analytics"

export const FirebaseAnalyticsSetup = () => {
  const {selectionResolved} = useDeployment()
  const telemetryEnabled = selectionResolved && deploymentStore.isTelemetryAllowed()

  useEffect(() => {
    const updateCollection = telemetryEnabled ? initAnalytics : disableAnalytics
    updateCollection().catch((err) => console.warn("Firebase Analytics configuration failed:", err))
  }, [telemetryEnabled])

  return null
}
