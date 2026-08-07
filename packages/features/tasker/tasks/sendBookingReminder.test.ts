import { getTranslation } from "@calcom/i18n/server";
import { Prisma } from "@calcom/prisma/client";
import { BookingStatus } from "@calcom/prisma/enums";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  getBooking: vi.fn(),
  buildCalendarEvent: vi.fn(),
  getUser: vi.fn(),
  sendReminderEmails: vi.fn(),
}));

vi.mock("@calcom/features/tasker/tasker-factory", () => ({
  getTasker: () => ({ create: mocks.createTask }),
}));
vi.mock("@calcom/features/bookings/repositories/BookingRepository", () => ({
  BookingRepository: class {
    getBookingForCalEventBuilder = mocks.getBooking;
  },
}));
vi.mock("@calcom/features/CalendarEventBuilder", () => ({
  CalendarEventBuilder: { fromBooking: mocks.buildCalendarEvent },
}));
vi.mock("@calcom/prisma", () => ({ default: { user: { findUnique: mocks.getUser } } }));
vi.mock("@calcom/features/bookings/lib/sendUpcomingMeetingReminderEmails", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@calcom/features/bookings/lib/sendUpcomingMeetingReminderEmails")
  >()),
  sendUpcomingMeetingReminderEmails: mocks.sendReminderEmails,
}));

import { scheduleBookingReminder } from "@calcom/features/bookings/lib/handleNewBooking/scheduleBookingReminder";
import { UpcomingMeetingReminderEmail } from "@calcom/features/bookings/lib/sendUpcomingMeetingReminderEmails";
import { sendBookingReminder } from "./sendBookingReminder";

class TestReminderEmail extends UpcomingMeetingReminderEmail {
  getPayload(): Promise<Record<string, unknown>> {
    return this.getNodeMailerPayload();
  }
}

const now = new Date("2026-08-07T17:00:00.000Z");
const startTime = new Date("2026-08-07T20:00:00.000Z");

describe("booking reminders", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    mocks.createTask.mockReset().mockResolvedValue("task-id");
  });

  afterEach(() => vi.useRealTimers());

  it("schedules a unique task one hour before the booking", async () => {
    await scheduleBookingReminder({
      booking: { id: 42, uid: "booking-uid", startTime },
    });

    expect(mocks.createTask).toHaveBeenCalledWith(
      "sendBookingReminder",
      {
        bookingId: 42,
        expectedStartTime: startTime.toISOString(),
      },
      {
        scheduledAt: new Date("2026-08-07T19:00:00.000Z"),
        referenceUid: `booking-uid:${startTime.toISOString()}`,
      }
    );

    mocks.createTask.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      })
    );
    await expect(
      scheduleBookingReminder({ booking: { id: 42, uid: "booking-uid", startTime } })
    ).resolves.toBeUndefined();
  });

  it("skips dry runs and meetings less than one hour away", async () => {
    await scheduleBookingReminder({ booking: { id: 1, uid: "dry", startTime }, isDryRun: true });
    await scheduleBookingReminder({
      booking: { id: 1, uid: "platform", startTime },
      platformClientId: "platform-client",
    });
    await scheduleBookingReminder({
      booking: { id: 2, uid: "soon", startTime: new Date("2026-08-07T17:30:00.000Z") },
    });
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it("sends only when the accepted booking still has the expected start time", async () => {
    const booking = {
      id: 42,
      status: BookingStatus.ACCEPTED,
      startTime,
      eventType: { metadata: {}, title: "Intro call" },
      user: { id: 1 },
    };
    const calendarEvent = { uid: "booking-uid", title: "Intro call" };
    mocks.getBooking.mockReset().mockResolvedValue(booking);
    mocks.getUser.mockReset().mockResolvedValue({ isPlatformManaged: false });
    mocks.buildCalendarEvent.mockReset().mockResolvedValue({ build: () => calendarEvent });
    mocks.sendReminderEmails.mockReset().mockResolvedValue(undefined);

    await sendBookingReminder(
      JSON.stringify({ bookingId: booking.id, expectedStartTime: startTime.toISOString() })
    );
    expect(mocks.sendReminderEmails).toHaveBeenCalledWith(calendarEvent, expect.any(Object), "Intro call");

    mocks.getBooking.mockResolvedValue({
      ...booking,
      eventType: { ...booking.eventType, seatsPerTimeSlot: 10 },
    });
    await sendBookingReminder(
      JSON.stringify({ bookingId: booking.id, expectedStartTime: startTime.toISOString() })
    );
    mocks.getBooking.mockResolvedValue(booking);
    mocks.getUser.mockResolvedValue({ isPlatformManaged: true });
    await sendBookingReminder(
      JSON.stringify({ bookingId: booking.id, expectedStartTime: startTime.toISOString() })
    );
    expect(mocks.sendReminderEmails).toHaveBeenCalledTimes(1);
  });

  it("redacts private seated-booking data and uses a stable delivery key", async () => {
    const t = await getTranslation("en", "common");
    const organizer: Person = {
      name: "Host",
      email: "host@example.com",
      timeZone: "America/Los_Angeles",
      language: { translate: t, locale: "en" },
    };
    const attendee: Person = {
      name: "Guest",
      email: "guest@example.com",
      timeZone: "America/New_York",
      language: { translate: t, locale: "en" },
    };
    const otherAttendee = { ...attendee, name: "Other Guest", email: "other@example.com" };
    const calEvent: CalendarEvent = {
      uid: "booking-uid",
      type: "intro-call",
      title: "Intro call with original-booker Alice",
      startTime: startTime.toISOString(),
      endTime: "2026-08-07T20:30:00.000Z",
      organizer,
      attendees: [attendee, otherAttendee],
      seatsPerTimeSlot: 10,
      seatsShowAttendees: false,
      additionalNotes: "private note",
      userFieldsResponses: { secret: { label: "Secret", value: "private answer" } },
    };

    const payload = await new TestReminderEmail(calEvent, attendee, false, "Intro call").getPayload();
    const html = String(payload.html);
    const headers = payload.headers as Record<string, string>;

    expect(html).not.toContain(otherAttendee.email);
    expect(html).not.toContain("original-booker Alice");
    expect(html).not.toContain("private note");
    expect(html).not.toContain("private answer");
    expect(html).not.toContain(t("need_to_make_a_change"));
    expect(headers["Resend-Idempotency-Key"]).toMatch(/^booking-reminder\/[a-f0-9]{64}$/);
  });
});
