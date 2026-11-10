-- LetsGetFit migration 002: email-code login, optional passwords, admin roles, settings, audit log.
-- MySQL 8 / MariaDB 10.6+. All DATETIME values are UTC.

ALTER TABLE users
  MODIFY password_hash VARCHAR(255) NULL,
  ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'user',
  ADD COLUMN disabled_at DATETIME NULL,
  ADD COLUMN last_login_at DATETIME NULL;

-- One-time login codes. Only keyed hashes are stored: never the email or the code itself.
CREATE TABLE IF NOT EXISTS login_codes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email_hash CHAR(64) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  KEY login_codes_email (email_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Admin-managed settings (API keys are encrypted before they are stored).
CREATE TABLE IF NOT EXISTS settings (
  name VARCHAR(64) NOT NULL PRIMARY KEY,
  value TEXT NOT NULL,
  is_secret TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL,
  updated_by CHAR(36) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- What admins changed, without personal details.
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_id CHAR(36) NULL,
  action VARCHAR(48) NOT NULL,
  detail VARCHAR(255) NULL,
  created_at DATETIME NOT NULL,
  KEY audit_log_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Link-based confirmation and reset tokens are replaced by login codes.
DROP TABLE IF EXISTS auth_tokens;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('002_passwordless_admin', UTC_TIMESTAMP());
