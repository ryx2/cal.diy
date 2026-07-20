import { describe, expect, it } from "vitest";
import { mergeAutoGuestEmails } from "./mergeAutoGuestEmails";

describe("mergeAutoGuestEmails", () => {
  it("returns requested guests unchanged when env is unset", () => {
    expect(
      mergeAutoGuestEmails({
        requestedGuests: ["guest@example.com"],
        bookerEmail: "booker@example.com",
        autoGuestEmailsEnv: undefined,
      })
    ).toEqual(["guest@example.com"]);
  });

  it("returns requested guests unchanged when env is empty", () => {
    expect(
      mergeAutoGuestEmails({
        requestedGuests: [],
        bookerEmail: "booker@example.com",
        autoGuestEmailsEnv: "",
      })
    ).toEqual([]);
  });

  it("appends auto guests to the requested guests", () => {
    expect(
      mergeAutoGuestEmails({
        requestedGuests: ["guest@example.com"],
        bookerEmail: "booker@example.com",
        autoGuestEmailsEnv: "a@example.com, b@example.com",
      })
    ).toEqual(["guest@example.com", "a@example.com", "b@example.com"]);
  });

  it("does not duplicate a guest the booker already added", () => {
    expect(
      mergeAutoGuestEmails({
        requestedGuests: ["a@example.com"],
        bookerEmail: "booker@example.com",
        autoGuestEmailsEnv: "a@example.com,b@example.com",
      })
    ).toEqual(["a@example.com", "b@example.com"]);
  });

  it("does not add the booker as a guest", () => {
    expect(
      mergeAutoGuestEmails({
        requestedGuests: [],
        bookerEmail: "a@example.com",
        autoGuestEmailsEnv: "a@example.com,b@example.com",
      })
    ).toEqual(["b@example.com"]);
  });

  it("dedupes case-insensitively and by base email (plus addressing)", () => {
    expect(
      mergeAutoGuestEmails({
        requestedGuests: ["A+work@example.com"],
        bookerEmail: "booker@example.com",
        autoGuestEmailsEnv: "a@example.com",
      })
    ).toEqual(["A+work@example.com"]);
  });

  it("ignores stray commas and whitespace in the env value", () => {
    expect(
      mergeAutoGuestEmails({
        requestedGuests: [],
        bookerEmail: "booker@example.com",
        autoGuestEmailsEnv: " a@example.com ,, b@example.com ,",
      })
    ).toEqual(["a@example.com", "b@example.com"]);
  });
});
