-- ツールのコードを「CP が持つデータ」として扱う。
-- 正本は releases.payload と tools.current_release_id。GitHub へのコミットはやめた。
-- base_sha は base_version(元にしたリリース ID)に、commit_sha / branch は bundle_key / app_ref に置き換える。

ALTER TABLE tools
  ADD COLUMN current_release_id INT NULL AFTER status;

ALTER TABLE releases
  CHANGE COLUMN base_sha base_version VARCHAR(64) NULL,
  DROP COLUMN commit_sha,
  DROP COLUMN branch,
  ADD COLUMN bundle_key VARCHAR(512) NULL AFTER build_id,
  ADD COLUMN app_ref VARCHAR(128) NULL AFTER bundle_key;
