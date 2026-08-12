import type { ConfigType, Dayjs } from "@calcom/dayjs";
import dayjs from "@calcom/dayjs";
import { isSupportedTimeZone } from "@calcom/lib/dayjs";

const DEFAULT_POLICY_TIME_ZONE = "America/Los_Angeles";
const DAYTIME_NOTICE_MINUTES = 180;
const OVERNIGHT_START_HOUR = 22;
const OVERNIGHT_END_HOUR = 8;
const OVERNIGHT_EARLIEST_HOUR = 11;

function isPolicyEnabled(): boolean {
  if (typeof process === "undefined") return false;
  return ["1", "true"].includes((process.env.TALKSHI_DYNAMIC_BOOKING_NOTICE_ENABLED ?? "").toLowerCase());
}

function getPolicyTimeZone(): string | undefined {
  if (typeof process === "undefined") return undefined;
  return process.env.TALKSHI_DYNAMIC_BOOKING_NOTICE_TIMEZONE;
}

export function getEarliestBookableTime({
  now = dayjs(),
  minimumBookingNotice = 0,
  policyEnabled = isPolicyEnabled(),
  policyTimeZone = getPolicyTimeZone(),
}: {
  now?: ConfigType;
  minimumBookingNotice?: number;
  policyEnabled?: boolean;
  policyTimeZone?: string;
} = {}): Dayjs {
  const currentTime = dayjs(now);
  const eventTypeCutoff = currentTime.add(Math.max(0, minimumBookingNotice), "minute");

  if (!policyEnabled) return eventTypeCutoff;

  let timeZone = DEFAULT_POLICY_TIME_ZONE;
  if (policyTimeZone && isSupportedTimeZone(policyTimeZone)) {
    timeZone = policyTimeZone;
  }
  const localNow = currentTime.tz(timeZone);
  const isOvernight = localNow.hour() >= OVERNIGHT_START_HOUR || localNow.hour() < OVERNIGHT_END_HOUR;

  let policyCutoff = currentTime.add(DAYTIME_NOTICE_MINUTES, "minute");
  if (isOvernight) {
    let cutoffDate = localNow;
    if (localNow.hour() >= OVERNIGHT_START_HOUR) {
      cutoffDate = cutoffDate.add(1, "day");
    }
    policyCutoff = dayjs.tz(`${cutoffDate.format("YYYY-MM-DD")}T${OVERNIGHT_EARLIEST_HOUR}:00:00`, timeZone);
  }

  if (eventTypeCutoff.isAfter(policyCutoff)) return eventTypeCutoff;
  return policyCutoff;
}
