-- platform database(台帳)。src/db/schema.ts と同じ形を保つこと。

CREATE TABLE IF NOT EXISTS tools (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(32) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  owner VARCHAR(255) NOT NULL,
  status ENUM('live', 'stopped', 'deleted') NOT NULL DEFAULT 'live',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  delete_scheduled_at TIMESTAMP NULL,
  deleted_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS tool_editors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tool_id INT NOT NULL,
  email VARCHAR(255) NOT NULL,
  UNIQUE KEY uq_tool_editors (tool_id, email)
);

CREATE TABLE IF NOT EXISTS releases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tool_id INT NULL,
  op ENUM('replace', 'remove', 'reconcile') NOT NULL,
  reason VARCHAR(32) NOT NULL,
  status ENUM('queued', 'building', 'migrating', 'deploying', 'succeeded', 'failed') NOT NULL DEFAULT 'queued',
  base_sha VARCHAR(64) NULL,
  commit_sha VARCHAR(64) NULL,
  branch VARCHAR(128) NULL,
  build_id VARCHAR(255) NULL,
  image_uri VARCHAR(512) NULL,
  payload LONGTEXT NULL,
  log MEDIUMTEXT NULL,
  log_url VARCHAR(1024) NULL,
  dump_url VARCHAR(1024) NULL,
  created_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP NULL,
  finished_at TIMESTAMP NULL,
  KEY idx_releases_tool (tool_id, id),
  KEY idx_releases_status (status, id)
);

CREATE TABLE IF NOT EXISTS migrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tool_id INT NOT NULL,
  filename VARCHAR(255) NOT NULL,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_migrations (tool_id, filename)
);

CREATE TABLE IF NOT EXISTS upload_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tool_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_by VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tool_secrets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tool_id INT NOT NULL,
  key_name VARCHAR(64) NOT NULL,
  updated_by VARCHAR(255) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tool_secrets (tool_id, key_name)
);

CREATE TABLE IF NOT EXISTS tool_stats_daily (
  tool_id INT NOT NULL,
  date DATE NOT NULL,
  requests INT NOT NULL DEFAULT 0,
  errors INT NOT NULL DEFAULT 0,
  unique_users INT NOT NULL DEFAULT 0,
  PRIMARY KEY (tool_id, date)
);
