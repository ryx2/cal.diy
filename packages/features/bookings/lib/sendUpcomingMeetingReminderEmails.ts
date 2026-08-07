import { createHash } from "node:crypto";
import dayjs from "@calcom/dayjs";
import renderEmail from "@calcom/emails/src/renderEmail";
import BaseEmail from "@calcom/emails/templates/_base-email";
import { getLocation } from "@calcom/lib/CalEventParser";
import { EMAIL_FROM_NAME } from "@calcom/lib/constants";
import { formatCalEvent } from "@calcom/lib/formatCalendarEvent";
import { getReplyToHeader } from "@calcom/lib/getReplyToHeader";
import { TimeFormat } from "@calcom/lib/timeFormat";
import type { EventTypeMetadata } from "@calcom/prisma/zod-utils";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";
import cloneDeep from "lodash/cloneDeep";

export class UpcomingMeetingReminderEmail extends BaseEmail {
  protected throwOnSendError = true;

  constructor(
    private readonly calEvent: CalendarEvent,
    private readonly recipient: Person,
    private readonly isHost: boolean,
    private readonly publicEventTitle: string
  ) {
    super();
    this.name = "SEND_UPCOMING_MEETING_REMINDER";
  }

  private getFormattedDate(): string {
    const timeFormat =
      this.recipient.timeFormat || this.calEvent.organizer.timeFormat || TimeFormat.TWELVE_HOUR;

    return dayjs(this.calEvent.startTime)
      .tz(this.recipient.timeZone)
      .locale(this.recipient.language.locale)
      .format(`ddd, MMM D, YYYY ${timeFormat}`);
  }

  private getSubject(): string {
    let otherPerson = this.calEvent.organizer.name;
    if (this.isHost) {
      otherPerson = this.calEvent.attendees[0]?.name || this.recipient.language.translate("guest");
    }

    return this.recipient.language.translate("reminder_email", {
      eventType: this.getEventTitle(),
      name: otherPerson,
      date: this.getFormattedDate(),
      interpolation: { escapeValue: false },
    });
  }

  private getTextBody(): string {
    const t = this.recipient.language.translate;
    const location = getLocation(this.calEvent);
    const lines = [
      t("email_reminder_upcoming_event_notice"),
      `${t("event")}: ${this.getEventTitle()}`,
      `${t("date_and_time")}: ${this.getFormattedDate()} (${this.recipient.timeZone})`,
    ];
    if (location) lines.push(`${t("location")}: ${location}`);
    return lines.join("\n\n");
  }

  private getEventTitle(): string {
    if (!this.isHost && this.calEvent.seatsPerTimeSlot && !this.calEvent.seatsShowAttendees) {
      return this.publicEventTitle;
    }
    return this.calEvent.title;
  }

  private getCalendarEventForRecipient(): CalendarEvent {
    const isPrivateSeatedEvent = Boolean(this.calEvent.seatsPerTimeSlot && !this.calEvent.seatsShowAttendees);
    const shouldHideNotes = !this.isHost && this.calEvent.hideCalendarNotes;
    if (!shouldHideNotes && (this.isHost || !isPrivateSeatedEvent)) return this.calEvent;

    const calEvent = cloneDeep(this.calEvent);
    if (shouldHideNotes || isPrivateSeatedEvent) calEvent.additionalNotes = undefined;
    if (isPrivateSeatedEvent) {
      calEvent.attendees = [this.recipient];
      calEvent.title = this.publicEventTitle;
      calEvent.attendeeSeatId = undefined;
      calEvent.customInputs = undefined;
      calEvent.responses = undefined;
      calEvent.userFieldsResponses = undefined;
    }
    return calEvent;
  }

  protected async getNodeMailerPayload(): Promise<Record<string, unknown>> {
    const subject = this.getSubject();
    const attendeeEmails = this.calEvent.attendees.map(({ email }) => email);
    const calEvent = this.getCalendarEventForRecipient();
    const replyToEmails: string[] = [];
    if (this.isHost && (!calEvent.seatsPerTimeSlot || calEvent.seatsShowAttendees)) {
      replyToEmails.push(...attendeeEmails);
    }
    const idempotencyKey = createHash("sha256")
      .update(
        `${calEvent.uid ?? calEvent.bookingId}|${calEvent.startTime}|${this.recipient.email.toLowerCase()}`
      )
      .digest("hex");

    return {
      to: `${this.recipient.name} <${this.recipient.email}>`,
      from: `${EMAIL_FROM_NAME} <${this.getMailerOptions().from}>`,
      ...getReplyToHeader(this.calEvent, replyToEmails, this.isHost),
      headers: {
        ...this.getMailerOptions().headers,
        "Resend-Idempotency-Key": `booking-reminder/${idempotencyKey}`,
      },
      subject,
      html: await renderEmail("AttendeeScheduledEmail", {
        calEvent,
        attendee: this.recipient,
        headerType: "calendarCircle",
        title: "reminder",
        subtitle: this.recipient.language.translate("email_reminder_upcoming_event_notice"),
        subject,
        callToAction: null,
      }),
      text: this.getTextBody(),
    };
  }
}

export async function sendUpcomingMeetingReminderEmails(
  calEvent: CalendarEvent,
  eventTypeMetadata: EventTypeMetadata,
  publicEventTitle: string
): Promise<void> {
  const formattedCalEvent = formatCalEvent(calEvent);
  const hostEmailDisabled = Boolean(eventTypeMetadata?.disableStandardEmails?.all?.host);
  const attendeeEmailDisabled = Boolean(eventTypeMetadata?.disableStandardEmails?.all?.attendee);
  const platformEmailSuffix = formattedCalEvent.platformClientId
    ? `+${formattedCalEvent.platformClientId}`
    : "";
  const normalizeEmail = (email: string) =>
    (platformEmailSuffix ? email.replace(platformEmailSuffix, "") : email).trim().toLowerCase();
  const hostEmails = new Set(
    [formattedCalEvent.organizer, ...(formattedCalEvent.team?.members ?? [])].map(({ email }) =>
      normalizeEmail(email)
    )
  );
  const recipients: Array<{ person: Person; isHost: boolean }> = [];

  if (!hostEmailDisabled) {
    recipients.push(
      { person: formattedCalEvent.organizer, isHost: true },
      ...(formattedCalEvent.team?.members ?? []).map((person) => ({ person, isHost: true }))
    );
  }

  if (!attendeeEmailDisabled) {
    recipients.push(
      ...formattedCalEvent.attendees
        .filter(({ email }) => !hostEmails.has(normalizeEmail(email)))
        .map((person) => ({ person, isHost: false }))
    );
  }

  const seenEmails = new Set<string>();
  for (const { person, isHost } of recipients) {
    const normalizedEmail = normalizeEmail(person.email);
    if (!normalizedEmail || seenEmails.has(normalizedEmail)) continue;

    seenEmails.add(normalizedEmail);
    await new UpcomingMeetingReminderEmail(formattedCalEvent, person, isHost, publicEventTitle).sendEmail();
  }
}
