import { getTasker } from "@calcom/features/tasker/tasker-factory";
import { Prisma } from "@calcom/prisma/client";

const ONE_HOUR_IN_MS: number = 60 * 60 * 1000;
const tasker: ReturnType<typeof getTasker> = getTasker();

export async function scheduleBookingReminder({
  booking,
  isDryRun = false,
  platformClientId,
}: {
  booking: { id: number; uid: string; startTime: Date };
  isDryRun?: boolean;
  platformClientId?: string;
}): Promise<void> {
  if (isDryRun || platformClientId) return;

  const scheduledAt = new Date(booking.startTime.getTime() - ONE_HOUR_IN_MS);
  if (scheduledAt <= new Date()) return;

  const expectedStartTime = booking.startTime.toISOString();

  try {
    await tasker.create(
      "sendBookingReminder",
      {
        bookingId: booking.id,
        expectedStartTime,
      },
      {
        scheduledAt,
        referenceUid: `${booking.uid}:${expectedStartTime}`,
      }
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
    throw error;
  }
}
