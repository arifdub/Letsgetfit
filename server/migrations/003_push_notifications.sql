-- LetsGetFit migration 003: push notifications (reminders and announcements).
-- One row per browser/device that turned notifications on. Holds the push service address and
-- keys the browser gave us, the reminder times the person chose, and their time zone. No health
-- data. user_id is set only when the person is logged in, and the row goes with the account.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  endpoint_hash CHAR(64) NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh VARCHAR(200) NOT NULL,
  auth VARCHAR(64) NOT NULL,
  user_id CHAR(36) NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Dublin',
  reminders TEXT NULL,
  last_sent TEXT NULL,
  failures TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY push_endpoint (endpoint_hash),
  KEY push_user (user_id),
  CONSTRAINT push_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('003_push_notifications', UTC_TIMESTAMP());
