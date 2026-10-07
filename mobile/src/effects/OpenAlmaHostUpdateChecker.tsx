import {useEffect} from "react"

import {useDeployment} from "@/services/deployment"
import {checkOpenAlmaHostUpdate} from "@/services/openAlmaHostUpdate"

export function OpenAlmaHostUpdateChecker() {
  const {activeDeployment} = useDeployment()
  useEffect(() => {
    if (activeDeployment.kind === "consumer") void checkOpenAlmaHostUpdate()
  }, [activeDeployment.kind])
  return null
}
