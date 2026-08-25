SET NAMES utf8mb4 COLLATE utf8mb4_bin;

CREATE TABLE accounts (
  id bigint NOT NULL AUTO_INCREMENT,
  email varchar(255) COLLATE utf8mb4_bin NOT NULL,
  state varchar(16) COLLATE utf8mb4_bin NOT NULL DEFAULT 'open',
  PRIMARY KEY (id),
  UNIQUE KEY accounts_email_key (email),
  CONSTRAINT accounts_state_check CHECK (state IN ('open', 'closed'))
) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin COMMENT='Fixture accounts';

CREATE TABLE `případy` (
  tenant_id bigint NOT NULL,
  case_id bigint NOT NULL,
  account_id bigint NULL,
  title varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT 'Nový případ',
  PRIMARY KEY (tenant_id, case_id),
  CONSTRAINT cases_account_fk FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

CREATE TABLE case_events (
  tenant_id bigint NOT NULL,
  case_id bigint NOT NULL,
  sequence_no integer NOT NULL,
  payload json,
  PRIMARY KEY (tenant_id, case_id, sequence_no),
  CONSTRAINT events_case_fk FOREIGN KEY (tenant_id, case_id) REFERENCES `případy`(tenant_id, case_id) ON DELETE CASCADE
) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
