-- __TOOL_NAME__ の初期テーブル。テーブル名は必ず __PREFIX__ で始める。
CREATE TABLE IF NOT EXISTS __PREFIX__memos (
  id INT NOT NULL AUTO_INCREMENT,
  title VARCHAR(200) NOT NULL,
  body TEXT NULL,
  created_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx___PREFIX__memos_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
