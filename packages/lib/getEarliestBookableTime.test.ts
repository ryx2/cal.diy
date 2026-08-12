import dayjs from "@calcom/dayjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getEarliestBookableTime } from "./getEarliestBookableTime";
import { isTimeOutOfBounds } from "./isOutOfBounds";

const timeZone = "America/Los_Angeles";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("getEarliestBookableTime", () => {
  it.each([
    {
      label: "one minute before the overnight window",
      now: "2026-08-13T04:59:00.000Z",
      cutoff: "2026-08-13T07:59:00.000Z",
    },
    {
      label: "the start of the overnight window",
      now: "2026-08-13T05:00:00.000Z",
      cutoff: "2026-08-13T18:00:00.000Z",
    },
    {
      label: "one minute before the daytime window",
      now: "2026-08-12T14:59:00.000Z",
      cutoff: "2026-08-12T18:00:00.000Z",
    },
    {
      label: "the start of the daytime window",
      now: "2026-08-12T15:00:00.000Z",
      cutoff: "2026-08-12T18:00:00.000Z",
    },
    {
      label: "late at night",
      now: "2026-08-13T06:00:00.000Z",
      cutoff: "2026-08-13T18:00:00.000Z",
    },
    {
      label: "the night before daylight saving time starts",
      now: "2026-03-08T07:00:00.000Z",
      cutoff: "2026-03-08T18:00:00.000Z",
    },
    {
      label: "the night before daylight saving time ends",
      now: "2026-11-01T06:00:00.000Z",
      cutoff: "2026-11-01T19:00:00.000Z",
    },
    {
      label: "the first repeated 1:30 AM when daylight saving time ends",
      now: "2026-11-01T08:30:00.000Z",
      cutoff: "2026-11-01T19:00:00.000Z",
    },
    {
      label: "the second repeated 1:30 AM when daylight saving time ends",
      now: "2026-11-01T09:30:00.000Z",
      cutoff: "2026-11-01T19:00:00.000Z",
    },
  ])("uses the deployment cutoff at $label", ({ now, cutoff }) => {
    const currentTime = dayjs(now);
    const earliestBookableTime = getEarliestBookableTime({
      now: currentTime,
      policyEnabled: true,
      policyTimeZone: timeZone,
    });

    expect(earliestBookableTime.toISOString()).toBe(cutoff);

    vi.useFakeTimers();
    vi.setSystemTime(currentTime.toDate());
    vi.stubEnv("TALKSHI_DYNAMIC_BOOKING_NOTICE_ENABLED", "1");
    vi.stubEnv("TALKSHI_DYNAMIC_BOOKING_NOTICE_TIMEZONE", timeZone);

    expect(
      isTimeOutOfBounds({ time: earliestBookableTime.subtract(1, "millisecond"), minimumBookingNotice: 0 })
    ).toBe(true);
    expect(isTimeOutOfBounds({ time: earliestBookableTime, minimumBookingNotice: 0 })).toBe(false);
  });

  it("preserves an event type notice that is stricter than the deployment cutoff", () => {
    expect(
      getEarliestBookableTime({
        now: "2026-08-12T15:00:00.000Z",
        minimumBookingNotice: 300,
        policyEnabled: true,
        policyTimeZone: timeZone,
      }).toISOString()
    ).toBe("2026-08-12T20:00:00.000Z");
  });

  it("uses only the event type notice when the deployment policy is disabled", () => {
    expect(
      getEarliestBookableTime({
        now: "2026-08-12T15:00:00.000Z",
        minimumBookingNotice: 120,
        policyEnabled: false,
        policyTimeZone: timeZone,
      }).toISOString()
    ).toBe("2026-08-12T17:00:00.000Z");
  });
});
