export const HOLIDAYS = {
  // 2025 Selangor Public Holidays
  '2025-01-01': "New Year's Day",
  '2025-01-29': "Chinese New Year",
  '2025-01-30': "Chinese New Year (Day 2)",
  '2025-02-11': "Thaipusam",
  '2025-03-18': "Nuzul Al-Quran",
  '2025-03-31': "Hari Raya Aidilfitri",
  '2025-04-01': "Hari Raya Aidilfitri (Day 2)",
  '2025-05-01': "Labour Day",
  '2025-05-12': "Wesak Day",
  '2025-06-02': "Agong's Birthday",
  '2025-06-07': "Hari Raya Haji",
  '2025-06-27': "Awal Muharram",
  '2025-08-31': "National Day",
  '2025-09-01': "National Day Replacement",
  '2025-09-05': "Maulidur Rasul",
  '2025-09-16': "Malaysia Day",
  '2025-10-20': "Deepavali",
  '2025-12-11': "Sultan of Selangor's Birthday",
  '2025-12-25': "Christmas Day",

  // 2026 Selangor Public Holidays
  '2026-01-01': "New Year's Day",
  '2026-02-01': "Thaipusam",
  '2026-02-02': "Thaipusam Holiday",
  '2026-02-17': "Chinese New Year",
  '2026-02-18': "Chinese New Year Holiday",
  '2026-03-07': "Nuzul Al-Quran",
  '2026-03-20': "Hari Raya Aidilfitri Holiday",
  '2026-03-21': "Hari Raya Aidilfitri",
  '2026-03-22': "Hari Raya Aidilfitri Holiday",
  '2026-03-23': "Hari Raya Aidilfitri Holiday",
  '2026-05-01': "Labour Day",
  '2026-05-27': "Hari Raya Haji",
  '2026-05-31': "Wesak Day",
  '2026-06-01': "Agong's Birthday",
  '2026-06-02': "Wesak Day Holiday",
  '2026-06-17': "Awal Muharram",
  '2026-08-25': "Maulidur Rasul",
  '2026-08-31': "National Day",
  '2026-09-16': "Malaysia Day",
  '2026-11-08': "Deepavali",
  '2026-11-09': "Deepavali Holiday",
  '2026-12-11': "Sultan of Selangor's Birthday",
  '2026-12-25': "Christmas Day",
};

export const getHolidayName = (dateStr) => {
  if (!dateStr) return '';
  return HOLIDAYS[dateStr] || '';
};
