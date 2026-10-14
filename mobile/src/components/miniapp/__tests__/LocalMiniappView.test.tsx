import {act, fireEvent, render} from "@testing-library/react-native"
import {Platform} from "react-native"

import LocalMiniappView from "../LocalMiniappView"
import {useNavigationStore} from "@/stores/navigation"
import {useRegisterCapsule} from "@/stores/capsule"
import {miniappLauncher} from "@mentra/engine-host-internal"
import {getMentraJS} from "@/services/mentraJsBootstrap"
import {MentraUIRouter} from "../../../../modules/engine/src/services/MentraUIRouter"

jest.mock("expo-router", () => ({router: {push: jest.fn(), replace: jest.fn(), back: jest.fn()}}))
jest.mock("react-native-webview", () => {
  const React = require("react")
  const {View} = require("react-native")
  const instances: {injectJavaScript: jest.Mock}[] = []
  return {
    instances,
    WebView: React.forwardRef((props: object, ref: unknown) => {
      const instance = React.useMemo(() => {
        const handle = {injectJavaScript: jest.fn(), reload: jest.fn()}
        instances.push(handle)
        return handle
      }, [])
      React.useImperativeHandle(ref, () => instance, [instance])
      return <View {...props} testID="webview" />
    }),
  }
})
jest.mock("@/contexts/ThemeContext", () => ({
  useAppTheme: () => ({theme: {isDark: false, colors: {background: "white"}}}),
}))
jest.mock("@/contexts/SaferAreaContext", () => ({
  useSaferAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}))
jest.mock("@/services/mentraJsBootstrap", () => ({getMentraJS: jest.fn()}))
jest.mock("@/components/ignite", () => ({Text: "Text"}))
jest.mock("@/effects/CapsuleMenu", () => () => {
  const {View} = require("react-native")
  return <View testID="capsule" />
})
jest.mock("@/stores/capsule", () => ({useRegisterCapsule: jest.fn()}))
jest.mock("@/i18n", () => ({translate: (key: string) => key}))
jest.mock("../MiniappSplash", () => (props: {error?: string}) => {
  const {Text} = require("react-native")
  return <Text testID="splash-error">{props.error}</Text>
})
jest.mock("@mentra/engine-host-internal", () => ({
  miniappLauncher: {ensureRunning: jest.fn()},
  localMiniappRuntime: {hasManifestPermission: () => false},
  buildMiniappGlobalsScript: () => "",
  buildMentraUiShim: () => "",
}))

jest.mock("@mentra/engine", () => ({
  BgTimer: {
    setTimeout: jest.fn((cb, ms) => setTimeout(cb, ms)),
    setInterval: jest.fn(), clearInterval: jest.fn(), clearTimeout: jest.fn(),
  },
  SETTINGS: {dev_mode: {key: "dev_mode"}},
  useSetting: () => [false],
  engine: {miniapps: {clearForeground: jest.fn()}},
}))
jest.mock("@mentra/engine-host-internal/devtools", () => ({devServerBridge: {onReload: jest.fn()}}))
jest.mock("@/services/streamPreview", () => {
  const coordinator = {
    bindView: jest.fn(),
    documentEnded: jest.fn(),
    noteInstallReload: jest.fn(),
    viewDestroyed: jest.fn(),
  }
  return {STREAM_PREVIEW_BIND_TIMEOUT_MS: 0, getStreamPreviewCoordinator: () => coordinator}
})

const props = {
  packageName: "com.mentra.test",
  onExit: jest.fn(),
  onClose: jest.fn(),
  onMinimize: jest.fn(),
  showCapsule: true,
  openingComplete: true,
}

async function finishLaunch() {
  await act(async () => {
    jest.advanceTimersByTime(40)
    await Promise.resolve()
  })
}

beforeEach(() => {
  jest.useFakeTimers()
  jest.clearAllMocks()
  jest.requireMock("react-native-webview").instances.length = 0
  jest.mocked(getMentraJS).mockReturnValue(null)
  jest.replaceProperty(Platform, "OS", "android")
  useNavigationStore.setState({interceptor: null})
  jest.mocked(miniappLauncher.ensureRunning).mockResolvedValue({uiUri: null, uiBaseDir: null} as never)
})
afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
})

it("keeps the retained WebView bound across a version change and ignores its cleanup after replacement", async () => {
  const uiRouter = new MentraUIRouter({mentraJsDispatchToJs: jest.fn()})
  jest.mocked(getMentraJS).mockReturnValue({uiRouter, router: {probeForegroundLiveness: jest.fn()}} as never)
  jest.mocked(miniappLauncher.ensureRunning).mockImplementation(async (_package, hints) => ({
    uiUri: `file:///fictional/${hints?.version}/ui/index.html`,
    uiBaseDir: "file:///fictional/",
  }) as never)
  const instances = jest.requireMock("react-native-webview").instances
  const oldView = render(<LocalMiniappView {...props} version="0.1.12" />)
  await finishLaunch()
  expect(uiRouter.isBound(props.packageName)).toBe(true)

  oldView.rerender(<LocalMiniappView {...props} version="0.1.11" />)
  await finishLaunch()
  expect(instances).toHaveLength(1)
  expect(oldView.getByTestId("webview").props.source.uri).toContain("0.1.11")
  expect(uiRouter.isBound(props.packageName)).toBe(true)
  fireEvent(oldView.getByTestId("webview"), "message", {nativeEvent: {data: '{"type":"ready"}'}})
  uiRouter.routeFromBackground(props.packageName, {channel: "openalma:update", payload: {configured: false}})
  expect(instances[0].injectJavaScript).toHaveBeenCalledWith(expect.stringContaining("openalma:update"))

  const newView = render(<LocalMiniappView {...props} version="0.1.11" />)
  await finishLaunch()
  oldView.unmount()
  expect(uiRouter.isBound(props.packageName)).toBe(true)
  uiRouter.routeFromBackground(props.packageName, {channel: "openalma:update", payload: {configured: false}})
  expect(instances[1].injectJavaScript).toHaveBeenCalledWith(expect.stringContaining("openalma:update"))
  newView.unmount()
  expect(uiRouter.isBound(props.packageName)).toBe(false)
})
it("exposes exit controls above the splash when startup resolves without a UI", async () => {
  const view = render(<LocalMiniappView {...props} />)
  await finishLaunch()
  expect(miniappLauncher.ensureRunning).toHaveBeenCalled()
  expect(view.getByTestId("splash-error").props.children).toBe("common:miniappUiUnavailable")
  // The error capsule is a sibling of the splash, outside the disabled content layer.
  let ancestor = view.getByTestId("capsule").parent
  while (ancestor) {
    expect(ancestor.props.pointerEvents).not.toBe("none")
    ancestor = ancestor.parent
  }
  act(() => jest.mocked(useRegisterCapsule).mock.calls.at(-1)![0].onClosePress!())
  expect(props.onClose).toHaveBeenCalledTimes(1)
})

it("does not reclaim Back after external navigation changes presentation callbacks", () => {
  const view = render(<LocalMiniappView {...props} onShouldCapture={() => undefined} />)
  const interceptor = useNavigationStore.getState().interceptor!
  act(() => {
    interceptor.push("/settings")
  })
  expect(props.onExit).toHaveBeenCalledTimes(1)
  view.rerender(<LocalMiniappView {...props} onShouldCapture={() => undefined} />)
  expect(useNavigationStore.getState().interceptor!.goBack()).toBe(false)
  expect(props.onExit).toHaveBeenCalledTimes(1)
})

it.each(["onClosePress", "onMinimizePress"] as const)("releases Back as soon as %s starts dismissal", (action) => {
  const view = render(<LocalMiniappView {...props} />)
  act(() => jest.mocked(useRegisterCapsule).mock.calls.at(-1)![0][action]!())
  view.rerender(<LocalMiniappView {...props} onShouldCapture={() => undefined} />)
  expect(useNavigationStore.getState().interceptor!.goBack()).toBe(false)
  expect(props.onExit).not.toHaveBeenCalled()
})
