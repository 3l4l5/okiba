-- 適用済みマイグレーションの内容のハッシュ。同じファイル名で内容が変わったアップロードを拒否するために使う。
-- 既存の行は NULL(内容不明)のままにし、チェックの対象外にする。
ALTER TABLE migrations
  ADD COLUMN checksum CHAR(64) NULL AFTER filename;
