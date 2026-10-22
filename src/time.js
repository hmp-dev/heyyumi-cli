"use strict";

const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;
const LOCAL = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Reservation times are Korea time. Accept "2026-10-25 19:00" / "2026-10-25T19:00" (read as KST)
 * or a full ISO string with an offset. A bare "19:00" is rejected: guessing the date books the wrong day.
 */
function normalizeReservationTime(input) {
  const raw = String(input ?? "").trim();
  if (!raw) throw new TypeError("--time is required, e.g. --time \"2026-10-25 19:00\" (Korea time)");

  if (HAS_OFFSET.test(raw)) {
    if (Number.isNaN(Date.parse(raw))) throw new TypeError(`--time "${raw}" is not a valid ISO 8601 time`);
    return raw;
  }

  const m = LOCAL.exec(raw);
  if (!m) {
    throw new TypeError(
      `--time "${raw}" needs a date and time, e.g. "2026-10-25 19:00" (Korea time) or "2026-10-25T19:00:00+09:00"`,
    );
  }
  const [, date, hh, mm, ss = "00"] = m;
  const iso = `${date}T${hh.padStart(2, "0")}:${mm}:${ss}+09:00`;
  if (Number.isNaN(Date.parse(iso))) throw new TypeError(`--time "${raw}" is not a valid date/time`);
  return iso;
}

module.exports = { normalizeReservationTime };
