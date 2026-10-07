export function formatNumber(locale: string, value: number): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function appointmentParts(
  locale: string,
  iso: string,
  timeZone: string,
): { when: string; timeZone: string } {
  return {
    when: new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
    }).format(new Date(iso)),
    timeZone,
  };
}
