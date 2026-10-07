import * as Application from "expo-application"
import {View} from "react-native"

import {Text} from "@/components/ignite"
import {OpenAlmaAddressEditor} from "@/components/settings/OpenAlmaAddressEditor"
import {Group} from "@/components/ui/Group"
import {useFirstConnection} from "@/effects/IrisUpdatePrompt"
import {OPENALMA_HOST_PACKAGE} from "@/effects/irisUpdateOffer"
import {useDeployment} from "@/services/deployment"

export function FirstConnectionBanner() {
  const {activeDeployment} = useDeployment()
  const {error, irisInstalled} = useFirstConnection()
  if (
    Application.applicationId !== OPENALMA_HOST_PACKAGE ||
    activeDeployment.kind !== "consumer" ||
    irisInstalled !== false ||
    !error
  )
    return null

  return (
    <Group>
      <View className="gap-3 p-4 bg-primary-foreground mb-4">
        <Text tx="firstconnection:title" preset="bold" />
        <Text tx="firstconnection:guidance" />
        <OpenAlmaAddressEditor probeOnMount={false} error={error} />
      </View>
    </Group>
  )
}
