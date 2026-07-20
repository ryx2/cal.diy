import { extractBaseEmail } from "@calcom/lib/extract-base-email";

/**
 * Merges instance-wide auto-guest emails (BOOKING_AUTO_GUEST_EMAILS) into the
 * booker-provided guest list. Auto guests receive the attendee confirmation
 * email and are added as attendees on the calendar event, without the booker
 * having to add them manually.
 */
export function mergeAutoGuestEmails({
  requestedGuests,
  bookerEmail,
  autoGuestEmailsEnv,
}: {
  requestedGuests: string[];
  bookerEmail: string;
  autoGuestEmailsEnv: string | undefined;
}): string[] {
  const autoGuestEmails = (autoGuestEmailsEnv ?? "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);

  if (autoGuestEmails.length === 0) return requestedGuests;

  const existingBaseEmails = new Set(
    [bookerEmail, ...requestedGuests].map((email) => extractBaseEmail(email).toLowerCase())
  );

  const merged = [...requestedGuests];
  for (const email of autoGuestEmails) {
    const baseEmail = extractBaseEmail(email).toLowerCase();
    if (existingBaseEmails.has(baseEmail)) continue;
    existingBaseEmails.add(baseEmail);
    merged.push(email);
  }

  return merged;
}
