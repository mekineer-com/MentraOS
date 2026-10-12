/// <reference types="bun-types" />

import {describe, expect, test} from "bun:test"

import {CloudAudioSubscriptionSync} from "../CloudAudioSubscriptionSync"

describe("CloudAudioSubscriptionSync", () => {
  test("dedupes an identical subscription write while it is still in flight", () => {
    const sync = new CloudAudioSubscriptionSync()

    expect(sync.begin("transcription:auto")).toBe(1)
    expect(sync.begin("transcription:auto")).toBeNull()
  })

  test("keeps a failed write retryable so reconnect resync can send it again", () => {
    const sync = new CloudAudioSubscriptionSync()

    expect(sync.begin("transcription:auto")).toBe(1)
    sync.failed(1)

    expect(sync.begin("transcription:auto")).toBe(2)
  })

  test("dedupes the same key only after the cloud write succeeds", () => {
    const sync = new CloudAudioSubscriptionSync()

    expect(sync.begin("transcription:auto")).toBe(1)
    sync.succeeded(1)

    expect(sync.begin("transcription:auto")).toBeNull()
    expect(sync.begin("transcription:en-US")).toBe(2)
  })

  test("converges to the final desired set under A -> B -> A -> B churn with all writes in flight", () => {
    const sync = new CloudAudioSubscriptionSync()
    // Every distinct desired set while the prior write is still in flight must
    // be sent; only exact in-flight duplicates are skipped.
    expect(sync.begin("A")).toBe(1) // A in flight
    expect(sync.begin("B")).toBe(2) // B in flight (A not yet done)
    expect(sync.begin("A")).toBe(3) // A again — different from in-flight B
    expect(sync.begin("B")).toBe(4) // B again — different from in-flight A
    expect(sync.begin("B")).toBeNull() // exact duplicate of the in-flight B — skip
    // Writes resolve in arbitrary order; the machine must never wedge.
    sync.succeeded(1)
    sync.succeeded(2)
    sync.succeeded(3)
    sync.succeeded(4)
    // Final desired B, nothing in flight -> deduped.
    expect(sync.begin("B")).toBeNull()
    // A new distinct set still goes.
    expect(sync.begin("C")).toBe(5)
  })

  test("a failed intermediate write does not strand a newer desired set", () => {
    const sync = new CloudAudioSubscriptionSync()
    expect(sync.begin("fr-FR")).toBe(1)
    sync.succeeded(1)
    expect(sync.begin("empty")).toBe(2) // teardown
    expect(sync.begin("fr-FR")).toBe(3) // re-subscribe while empty in flight
    sync.failed(2) // teardown write failed
    sync.succeeded(3) // re-subscribe landed
    // fr-FR is applied and nothing pending -> deduped; cloud has fr-FR.
    expect(sync.begin("fr-FR")).toBeNull()
  })

  test("an older completion cannot suppress the next unsubscribe", () => {
    const sync = new CloudAudioSubscriptionSync()
    expect(sync.begin("A")).toBe(1)
    sync.succeeded(1)
    expect(sync.begin("empty")).toBe(2)
    expect(sync.begin("A")).toBe(3) // A re-desired while empty in flight
    // A completes before empty (out of order):
    sync.succeeded(3)
    sync.succeeded(2) // obsolete empty write cannot replace applied A
    expect(sync.begin("A")).toBeNull()
    expect(sync.begin("empty")).toBe(4)
  })

  test("an older same-key completion cannot settle a newer write", () => {
    const sync = new CloudAudioSubscriptionSync()
    expect(sync.begin("A")).toBe(1)
    expect(sync.begin("B")).toBe(2)
    expect(sync.begin("A")).toBe(3)
    sync.succeeded(1)
    expect(sync.begin("A")).toBeNull()
    sync.failed(3)
    expect(sync.begin("A")).toBe(4)
  })

  test("a failed latest write invalidates the previously applied cache", () => {
    const sync = new CloudAudioSubscriptionSync()
    expect(sync.begin("A")).toBe(1)
    sync.succeeded(1)
    expect(sync.begin("B")).toBe(2)
    expect(sync.begin("A")).toBe(3)
    sync.succeeded(2)
    sync.failed(3)
    expect(sync.begin("A")).toBe(4)
  })

  test("re-sends the applied set when a different write is still in flight (A -> B -> A churn)", () => {
    // Regression: settings change makes captions go fr-FR -> [] -> fr-FR.
    // The [] write is still in flight (pending) when the fr-FR re-subscribe
    // runs, so lastAppliedKey is stale (still fr-FR). The re-subscribe MUST
    // NOT be deduped, or the cloud strands on the empty set and captions die.
    const sync = new CloudAudioSubscriptionSync()

    expect(sync.begin("transcription:fr-FR")).toBe(1)
    sync.succeeded(1) // fr-FR applied

    expect(sync.begin("empty")).toBe(2) // teardown write goes in flight...
    // ...and before it resolves, the re-subscribe recomputes fr-FR:
    expect(sync.begin("transcription:fr-FR")).toBe(3)

    // The empty write lands late; the version counter keeps fr-FR at the cloud.
    sync.succeeded(2)
    sync.succeeded(3)
    // A later identical fr-FR with nothing in flight is still correctly deduped.
    expect(sync.begin("transcription:fr-FR")).toBeNull()
  })
})
