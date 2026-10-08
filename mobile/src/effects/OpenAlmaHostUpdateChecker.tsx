import {useEffect} from "react"

import {useDeployment} from "@/services/deployment"
import {checkOpenAlmaHostUpdate} from "@/services/openAlmaHostUpdate"

export function OpenAlmaHostUpdateChecker({launch}: {launch: object}) {
  const {activeDeployment} = useDeployment()
  useEffect(() => {
    if (activeDeployment.kind === "consumer") void checkOpenAlmaHostUpdate(launch)
  }, [activeDeployment.kind, launch])
  return null
}
