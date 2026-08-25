CREATE TABLE accounts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed'))
);
COMMENT ON TABLE accounts IS 'Fixture accounts';
COMMENT ON COLUMN accounts.email IS 'UTF-8 email';

CREATE TABLE "případy" (
  tenant_id bigint NOT NULL,
  case_id bigint NOT NULL,
  account_id bigint,
  title text NOT NULL DEFAULT 'Nový případ',
  PRIMARY KEY (tenant_id, case_id),
  CONSTRAINT cases_account_fk FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
);

CREATE TABLE case_events (
  tenant_id bigint NOT NULL,
  case_id bigint NOT NULL,
  sequence integer NOT NULL,
  payload jsonb,
  PRIMARY KEY (tenant_id, case_id, sequence),
  CONSTRAINT events_case_fk FOREIGN KEY (tenant_id, case_id) REFERENCES "případy"(tenant_id, case_id) ON DELETE CASCADE
);
