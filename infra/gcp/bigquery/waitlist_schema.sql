CREATE TABLE IF NOT EXISTS `PROJECT_ID.analytics.waitlist_entries` (
  id STRING,
  fullName STRING,
  workEmail STRING,
  persona STRING,
  region STRING,
  source STRING,
  createdAt TIMESTAMP,
  userAgent STRING,
  referer STRING
);
