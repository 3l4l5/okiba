-- RDS に 1 度だけ流す。パスワードは Secrets Manager の okiba/db/okiba_cp と okiba/db/okiba_app から取って
-- <CP_PASSWORD> と <APP_PASSWORD> を置き換える(Terraform ではユーザーを作れないため)。
-- 権限は docker/mysql-init/001_databases.sql(ローカル開発用)と同じ。

CREATE DATABASE IF NOT EXISTS okiba_platform CHARACTER SET utf8mb4;
CREATE DATABASE IF NOT EXISTS okiba_tools CHARACTER SET utf8mb4;

-- CP は両方に、ツールアプリは tools にだけ権限を持つ
CREATE USER IF NOT EXISTS 'okiba_cp'@'%' IDENTIFIED BY '<CP_PASSWORD>';
GRANT ALL PRIVILEGES ON okiba_platform.* TO 'okiba_cp'@'%';
GRANT ALL PRIVILEGES ON okiba_tools.* TO 'okiba_cp'@'%';

CREATE USER IF NOT EXISTS 'okiba_app'@'%' IDENTIFIED BY '<APP_PASSWORD>';
GRANT SELECT, INSERT, UPDATE, DELETE ON okiba_tools.* TO 'okiba_app'@'%';

FLUSH PRIVILEGES;
