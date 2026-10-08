import {useEffect, useRef, useState} from "react"
import {useForegroundApp} from "@mentra/engine"

import {TextField} from "@/components/ignite"
import {reportOpenAlmaHost, savedOpenAlmaAddress, useFirstConnection} from "@/effects/IrisUpdatePrompt"
import {OPENALMA_ADDRESS_KEY, openAlmaAddresses} from "@/effects/irisUpdateOffer"
import {translate} from "@/i18n"
import {storage} from "@/utils/storage/storage"

export function OpenAlmaAddressEditor({probeOnMount = true, error}: {probeOnMount?: boolean; error?: string}) {
  const [openAlmaAddress, setOpenAlmaAddress] = useState(savedOpenAlmaAddress)
  const [addressPending, setAddressPending] = useState(false)
  const [addressError, setAddressError] = useState<string | null>(null)
  const foregroundApp = useForegroundApp()
  const edited = useRef(false)
  useEffect(() => {
    if (edited.current) return
    setOpenAlmaAddress(savedOpenAlmaAddress())
    setAddressError(null)
    edited.current = false
  }, [foregroundApp?.packageName])
  const saveAddress = async (save = true) => {
    setAddressPending(true)
    setAddressError(null)
    let reportingAddress: string | undefined
    try {
      const {baseUrl} = openAlmaAddresses(openAlmaAddress)
      if (save) {
        const saved = storage.save(OPENALMA_ADDRESS_KEY, baseUrl)
        if (saved.is_error()) throw saved.error
      }
      setOpenAlmaAddress(baseUrl)
      reportingAddress = baseUrl
      await reportOpenAlmaHost(baseUrl)
      if (baseUrl === savedOpenAlmaAddress()) useFirstConnection.setState({error: null})
    } catch (error) {
      if (!reportingAddress || reportingAddress === savedOpenAlmaAddress()) {
        setAddressError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      setAddressPending(false)
    }
  }
  useEffect(() => {
    if (probeOnMount) void saveAddress(false)
  }, [])

  const helperError = addressError ?? error
  return (
    <TextField
      labelTx="firstconnection:serverAddress"
      value={openAlmaAddress}
      onChangeText={(value) => { edited.current = true; setOpenAlmaAddress(value) }}
      onEndEditing={() => { if (edited.current) { edited.current = false; void saveAddress() } }}
      autoCapitalize="none"
      autoCorrect={false}
      returnKeyType="done"
      editable={!addressPending}
      status={helperError ? "error" : undefined}
      helper={helperError ?? translate("firstconnection:addressHint")}
    />
  )
}
