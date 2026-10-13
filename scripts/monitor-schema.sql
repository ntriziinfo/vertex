-- NEBULA only; additive migration. A single latest frame per machine, no history.
BEGIN;
ALTER TABLE vertex_nebula.machine_states ADD COLUMN IF NOT EXISTS monitor_requested_until_ms bigint NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS vertex_nebula.machine_monitors (
  machine_id text PRIMARY KEY REFERENCES vertex_nebula.machine_states(machine_id),
  session_id text NOT NULL,
  updated_at_ms bigint NOT NULL,
  screen jsonb NOT NULL
);
ALTER TABLE vertex_nebula.machine_monitors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vertex_nebula.machine_monitors FROM PUBLIC, anon, authenticated;
GRANT ALL ON vertex_nebula.machine_monitors TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
