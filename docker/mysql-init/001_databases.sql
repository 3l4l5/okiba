-- ローカル開発用。platform(台帳)と tools(ツールのテーブル)を分ける。
CREATE DATABASE IF NOT EXISTS okiba_platform CHARACTER SET utf8mb4;
CREATE DATABASE IF NOT EXISTS okiba_tools CHARACTER SET utf8mb4;

-- CP は両方に、ツールアプリは tools にだけ権限を持つ
CREATE USER IF NOT EXISTS 'okiba_cp'@'%' IDENTIFIED BY 'okiba_cp';
GRANT ALL PRIVILEGES ON okiba_platform.* TO 'okiba_cp'@'%';
GRANT ALL PRIVILEGES ON okiba_tools.* TO 'okiba_cp'@'%';

CREATE USER IF NOT EXISTS 'okiba_app'@'%' IDENTIFIED BY 'okiba_app';
GRANT SELECT, INSERT, UPDATE, DELETE ON okiba_tools.* TO 'okiba_app'@'%';

FLUSH PRIVILEGES;
