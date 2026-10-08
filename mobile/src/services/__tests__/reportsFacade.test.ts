import {reports, submitAutomaticReport} from "../../../modules/engine/src/facades/reports"
import {configure, resetForTests} from "../../../modules/engine/src/runtime/bootstrap"
import {collectDiagnosticContext} from "../../../modules/engine/src/utils/diagnosticContext"
import {pairing} from "../../../modules/engine/src/facades/pairing"
import {startMentraJSCrashloopReportService, stopMentraJSCrashloopReportService} from "../../../modules/engine/src/services/MentraJSCrashloopReportService"
import {islandNotifications} from "../../../modules/engine/src/services/NotificationsEmitter"
import {MentraJSCrashController} from "../../../modules/engine/src/services/MentraJSCrashController"

jest.mock("../../../modules/engine/src/services/MiniappEngine", () => ({getMiniappEngine: () => null}))
import {cloudClientService} from "../../../modules/engine/src/services/CloudClientService"
import {logBuffer} from "../../../modules/engine/src/utils/devLogging"

jest.mock("../../../modules/engine/src/services/CloudClientService", () => ({
  cloudClientService: {
    core: {
      reports: {
        submit: jest.fn(),
        addLogs: jest.fn(),
        addScreenshots: jest.fn(),
        complete: jest.fn(),
      },
    },
    hasCore: jest.fn(() => true),
    getCoreUrl: jest.fn(() => "https://core.example"),
    syncCoreTokenToBluetooth: jest.fn(),
  },
}))

jest.mock("../../../modules/engine/src/utils/diagnosticContext", () => ({
  collectDiagnosticContext: jest.fn(async (context) => context ?? {}),
}))

jest.mock("../../../modules/engine/src/utils/devLogging", () => ({
  logBuffer: {
    getRecentLogs: jest.fn(() => []),
  },
}))

const submitMock = cloudClientService.core.reports.submit as jest.Mock
const addLogsMock = cloudClientService.core.reports.addLogs as jest.Mock
const completeMock = cloudClientService.core.reports.complete as jest.Mock
const hasCoreMock = cloudClientService.hasCore as jest.Mock
const getRecentLogsMock = logBuffer.getRecentLogs as jest.Mock

const automaticInput = (throttleKey: string) => ({
  kind: "automatic" as const,
  trigger: {type: "automatic" as const, source: "system", reason: "test"},
  report: {
    actualBehavior: "Test report",
    systemPriority: "medium" as const,
  },
  throttleKey,
  throttleWindowMs: 60_000,
})

describe("reports facade automatic throttling", () => {
  beforeEach(() => {
    resetForTests()
    jest.mocked(collectDiagnosticContext).mockClear()
    submitMock.mockReset()
    addLogsMock.mockReset()
    completeMock.mockReset()
    hasCoreMock.mockReset().mockReturnValue(true)
    getRecentLogsMock.mockReset()
    addLogsMock.mockResolvedValue({stored: 1})
    completeMock.mockResolvedValue({status: "complete"})
    getRecentLogsMock.mockReturnValue([])
  })

  afterEach(() => {
    stopMentraJSCrashloopReportService()
    resetForTests()
    jest.useRealTimers()
  })

  it("blocks real repeated crash-loop notifications and pairing timeouts before collecting or uploading", async () => {
    configure({auth: {}, config: {automaticReportsEnabled: false}})
    jest.useFakeTimers()
    startMentraJSCrashloopReportService()
    const crashes = new MentraJSCrashController({maxRetries: 3})
    const packageName = "com.openalma.mentra"
    for (let attempt = 0; attempt < 5; attempt++) {
      crashes.onSpawn(packageName)
      if (crashes.onCrash(packageName, "missed_ping").surfaceCrashloopBanner) {
        islandNotifications.emit({kind: "miniapp_crashloop", packageName, reason: "missed_ping", timestamp: Date.now()})
      }
    }
    expect(crashes.stateFor(packageName)?.kind).toBe("CRASHLOOP_DISABLED")
    for (let attempt = 0; attempt < 2; attempt++) {
      const ready = pairing.waitForReady({deviceModel: "Mentra Live", deviceName: "TEST_GLASSES", timeoutMs: 1000})
      jest.advanceTimersByTime(1000)
      await expect(ready).resolves.toBe(false)
    }
    await Promise.resolve()
    expect(collectDiagnosticContext).not.toHaveBeenCalled()
    expect(getRecentLogsMock).not.toHaveBeenCalled()
    expect(submitMock).not.toHaveBeenCalled()
    expect(addLogsMock).not.toHaveBeenCalled()
    expect(cloudClientService.core.reports.addScreenshots).not.toHaveBeenCalled()
    expect(completeMock).not.toHaveBeenCalled()
    expect(cloudClientService.syncCoreTokenToBluetooth).not.toHaveBeenCalled()
    await expect(submitAutomaticReport(automaticInput("disabled"))).resolves.toEqual({status: "skipped", reason: "automatic_reports_disabled"})
  })

  it("allows manual bug and feedback reports with automatic reports disabled", async () => {
    configure({auth: {}, config: {automaticReportsEnabled: false}})
    submitMock.mockResolvedValue({reportId: "manual", status: "open"})
    getRecentLogsMock.mockReturnValue([{timestamp: 1, level: "info", message: "diagnostic lengths"}])
    await expect(reports.submit({kind: "bug", trigger: {type: "manual", source: "settings", reason: "user_report"}, report: {actualBehavior: "Fictional bug"}})).resolves.toMatchObject({status: "submitted"})
    await expect(reports.submit({kind: "feedback", feedback: {text: "Fictional feedback"}})).resolves.toMatchObject({status: "submitted"})
    expect(submitMock).toHaveBeenCalledTimes(2)
    expect(addLogsMock).toHaveBeenCalledTimes(1)
  })

  it("keeps automatic reports enabled for Stock/OEM hosts", async () => {
    configure({auth: {}, config: {automaticReportsEnabled: true}})
    submitMock.mockResolvedValue({reportId: "stock", status: "open"})
    await expect(submitAutomaticReport(automaticInput("stock"))).resolves.toMatchObject({status: "submitted"})
    expect(submitMock).toHaveBeenCalledTimes(1)
  })

  it("does not collect or submit reports when Core is unavailable", async () => {
    hasCoreMock.mockReturnValue(false)

    await expect(submitAutomaticReport(automaticInput(`core-free-${Date.now()}`))).resolves.toEqual({
      status: "failed",
      error: "Reports are unavailable in this deployment",
    })

    expect(submitMock).not.toHaveBeenCalled()
    expect(getRecentLogsMock).not.toHaveBeenCalled()
  })

  it("does not throttle a later automatic report after Cloud V2 submit fails", async () => {
    const key = `failure-retry-${Date.now()}`
    submitMock
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({reportId: "report-1", status: "open"})

    await expect(submitAutomaticReport(automaticInput(key))).resolves.toEqual({
      status: "failed",
      error: "network down",
    })
    await expect(submitAutomaticReport(automaticInput(key))).resolves.toEqual({
      status: "submitted",
      reportId: "report-1",
      reportStatus: "complete",
    })

    expect(submitMock).toHaveBeenCalledTimes(2)
  })

  it("throttles repeated automatic reports after Cloud V2 accepts one", async () => {
    const key = `success-throttle-${Date.now()}`
    submitMock.mockResolvedValueOnce({reportId: "report-2", status: "open"})

    await expect(submitAutomaticReport(automaticInput(key))).resolves.toMatchObject({
      status: "submitted",
      reportId: "report-2",
    })
    await expect(submitAutomaticReport(automaticInput(key))).resolves.toEqual({
      status: "skipped",
      reason: "throttled_within_window",
    })

    expect(submitMock).toHaveBeenCalledTimes(1)
  })

  it("does not throttle a later automatic report after log upload fails", async () => {
    const key = `artifact-retry-${Date.now()}`
    getRecentLogsMock.mockReturnValue([{timestamp: 1, level: "info", message: "diagnostic"}])
    submitMock
      .mockResolvedValueOnce({reportId: "report-log-1", status: "open"})
      .mockResolvedValueOnce({reportId: "report-log-2", status: "open"})
    addLogsMock.mockRejectedValueOnce(new Error("upload failed")).mockResolvedValueOnce({stored: 1})

    await expect(submitAutomaticReport(automaticInput(key))).resolves.toMatchObject({
      status: "submitted",
      reportId: "report-log-1",
    })
    await expect(submitAutomaticReport(automaticInput(key))).resolves.toMatchObject({
      status: "submitted",
      reportId: "report-log-2",
    })

    expect(submitMock).toHaveBeenCalledTimes(2)
    expect(addLogsMock).toHaveBeenCalledTimes(2)
  })
})
