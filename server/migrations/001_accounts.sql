-- LetsGetFit migration 001: optional accounts and synced records.
-- MySQL 8 / MariaDB 10.6+ (utf8mb4, InnoDB). All DATETIME values are UTC.
-- Run with:  php letsgetfit-private/app/bin/migrate.php
-- Or import this file once in phpMyAdmin; the last statement records it as applied.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) NOT NULL PRIMARY KEY,
  applied_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) NOT NULL PRIMARY KEY,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  email_verified_at DATETIME NULL,
  health_consent_at DATETIME NOT NULL,
  session_version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  purpose VARCHAR(16) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY auth_tokens_hash (token_hash),
  KEY auth_tokens_user (user_id, purpose),
  CONSTRAINT auth_tokens_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per synced record. user_id comes from the session only, never from the client.
CREATE TABLE IF NOT EXISTS records (
  user_id CHAR(36) NOT NULL,
  collection VARCHAR(16) NOT NULL,
  record_id VARCHAR(64) NOT NULL,
  data MEDIUMTEXT NULL,
  deleted TINYINT(1) NOT NULL DEFAULT 0,
  client_updated_at DATETIME(3) NOT NULL,
  server_updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (user_id, collection, record_id),
  KEY records_user_changed (user_id, server_updated_at),
  CONSTRAINT records_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('001_accounts', UTC_TIMESTAMP());
