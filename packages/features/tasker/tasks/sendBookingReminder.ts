import { sendUpcomingMeetingReminderEmails } from "@calcom/features/bookings/lib/sendUpcomingMeetingReminderEmails";
import { BookingRepository } from "@calcom/features/bookings/repositories/BookingRepository";
import { CalendarEventBuilder } from "@calcom/features/CalendarEventBuilder";
import logger from "@calcom/lib/logger";
import { safeStringify } from "@calcom/lib/safeStringify";
import prisma from "@calcom/prisma";
import { BookingStatus } from "@calcom/prisma/enums";
import { EventTypeMetaDataSchema } from "@calcom/prisma/zod-utils";
import { z } from "zod";

const log: ReturnType<typeof logger.getSubLogger> = logger.getSubLogger({
  prefix: ["sendBookingReminder"],
});

export const sendBookingReminderPayloadSchema: z.ZodType<{
  bookingId: number;
  expectedStartTime: string;
  platformClientId?: string;
}> = z.object({
  bookingId: z.number(),
  expectedStartTime: z.string().datetime(),
  platformClientId: z.string().optional(),
});

export async function sendBookingReminder(payload: string): Promise<void> {
  try {
    const { bookingId, expectedStartTime, platformClientId } = sendBookingReminderPayloadSchema.parse(
      JSON.parse(payload)
    );
    if (platformClientId) return;
    const bookingRepository = new BookingRepository(prisma);
    const booking = await bookingRepository.getBookingForCalEventBuilder(bookingId);

    if (!booking || booking.status !== BookingStatus.ACCEPTED) return;
    if (booking.startTime.toISOString() !== expectedStartTime || booking.startTime <= new Date()) return;
    if (!booking.eventType || !booking.user || booking.eventType.seatsPerTimeSlot) return;
    const platformManagedUser = await prisma.user.findUnique({
      where: { id: booking.user.id },
      select: { isPlatformManaged: true },
    });
    if (platformManagedUser?.isPlatformManaged) return;

    const calEvent = (await CalendarEventBuilder.fromBooking(booking, { platformClientId })).build();
    const eventTypeMetadata = EventTypeMetaDataSchema.parse(booking.eventType.metadata ?? {});

    await sendUpcomingMeetingReminderEmails(calEvent, eventTypeMetadata, booking.eventType.title);
  } catch (error) {
    let errorMessage = String(error);
    if (error instanceof Error) errorMessage = error.message;
    log.error("Failed to send upcoming meeting reminder", safeStringify({ payload, error: errorMessage }));
    throw error;
  }
}
