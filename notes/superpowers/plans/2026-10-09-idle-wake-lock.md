---
status: draft
owner: Aster / OpenAlma team
---

# Allow Idle Sleep Without Breaking Background Work

## Goal And Acceptance

Stop Mentra from keeping the phone CPU awake merely to wait for housekeeping
or retry timers. Preserve genuinely active background audio, glasses/phone-only
miniapps, calls and transfers. Sleeping is not the same as killing the app.

Done: an idle, screen-off phone releases Mentra's sustained wake lock; active
background work still functions; work recovers correctly on wake/network return.
Do not promise a battery percentage from one run or treat a successful build as
proof of those behaviors.

## Evidence And Limits

- Android timer dependency `react-native-nitro-bg-timer` 0.1.0 acquires the
  `NitroBackgroundTimer` partial wake lock when scheduling a timer. It releases
  only when both timeout and interval collections are empty. A long interval
  therefore keeps the CPU awake throughout the wait.
- `SupportProfileSync.ts:38` schedules a six-hour native heartbeat whenever the
  engine has a Core client. `MantleManager.ts:901` schedules hourly calendar
  sync. Their cleanup is at runtime teardown, not ordinary inactivity.
- `CloudClientService.ts` supplies the same timers to connection retry/watchdog/
  ping paths; `LocalMiniappRuntime.ts` uses them for miniapp liveness. Fixing
  one heartbeat alone cannot establish idle sleep.
- Device records since October 6 show about 50 hours attributed to this lock
  for our host, and hours for stock Mentra. Termux has no active lock and low
  recorded use. These aggregates do not isolate the reported overnight drain.
- Source mechanism is inherited from imported Mentra v3.2.0, not proven to be
  a new fork regression. Check installed APK/source correspondence before
  attributing any particular JS timer to the overnight run.
- Private capture and package mapping, not for publication:
  `~/gemini-cli/_debug/phone-battery-20261009/README.md`.

## Review Before Implementation

Read `~/apps-codex/_agents/auditing.md` and `mentra-os/AGENTS.md`, then mobile's
instructions. Review the whole affected lifecycle, not only the named timers.

What is the simplest design that lets an idle phone sleep while preserving
needed background behavior? Explore alternatives independently; the mechanisms
below are candidates, not a prescribed solution.

Proposed product boundary: support snapshots and calendar housekeeping may be
late while asleep; active user-facing work must not silently freeze. Ask Marcos
before changing offline reconnection, incoming-event latency, or phone-only
background behavior. Do not equate screen-off or glasses-disconnected with idle.

Possible mechanisms: ordinary timers for deferrable work, existing lifecycle
cleanup for inactive services, or narrower native wake ownership for active work.
Inspect existing platform facilities before adding a scheduler, dependency,
foreground service, timer-policy framework or custom native timer fork.
A blanket JS substitution, disabling all wake locks, or re-enabling Huawei's
aggressive killers is not an acceptable unreviewed shortcut.

## Implementation Steps

1. **Map actual owners and review the design.** Trace timer creation, cancellation
   and restart through startup, disconnect, airplane mode, backgrounding, logout
   and active-work transitions. Include native media/service wake locks and
   miniapp timers. Identify which services run in this fork's configured mode.
   If caller attribution remains necessary, add only bounded temporary diagnostics.
   Team reviews the findings and design; record unresolved product choices here.

2. **Apply one coherent source batch.** Use the selected minimal approach at the
   existing ownership boundaries. Release unnecessary timers/locks when their work
   becomes inactive and resume correctly later. Preserve active-work deadlines,
   payloads, retries and failure visibility. Keep multiple host apps in mind:
   patching our fork does not fix the installed stock Mentra app.
   Do not edit node_modules as the durable fix; use existing checked-in dependency
   patching only if a dependency defect actually requires it.

3. **Self-audit and independent review before the APK build.** Follow affected
   callers end to end, especially concurrent activities, cancellation, logout/
   relaunch and reconnection. Address concrete defects together; don't turn
   coverage suggestions or cosmetic cleanup into a new project. Use focused
   existing checks where useful; no broad test/build loop.

4. **Build and install once at a safe point.** Obtain Marcos's approval for a
   resource-heavy build/install. Preserve the existing APK and app data; keep
   package identity, signing and settings. Batch fixes before compilation.
   Do not stop live audio, log out, clear data or alter stock Mentra implicitly.

5. **Verify on device, then publish.** Compare equivalent screen-off idle periods
   with wake-lock records before/after, not just estimated mAh. Check active
   phone-only/glasses audio or miniapps, calls/transfers where affected, ordinary
   wake, network loss/return and app relaunch. Confirm no duplicate work, stuck
   recovery or missed active-work deadlines. If stock Mentra confounds the idle
   measurement, ask Marcos to close it temporarily; do not silently force-stop it.
   Commit the fix and review evidence. Propose upstream work after local acceptance.

## State

Investigation only; no implementation, phone settings change or APK build.
This file owns the agreed design and next steps. Revise it when findings change
those steps; keep raw evidence in the diagnostic capture, not repeated journals.
