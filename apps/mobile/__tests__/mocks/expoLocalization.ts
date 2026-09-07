// Vitest stub for expo-localization (a native module). The i18n store reads the
// device's languages at creation time; tests drive resolveLocale directly with
// explicit tags, so this only has to keep the import from loading native code.
export const getLocales = () => [
  { languageTag: "en-GB", languageCode: "en", textDirection: "ltr", regionCode: "GB" },
];
export const getCalendars = () => [{ calendar: "gregory", timeZone: "UTC", uses24hourClock: true, firstWeekday: 1 }];
