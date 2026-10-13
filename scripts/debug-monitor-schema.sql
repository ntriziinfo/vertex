-- Shared debug / NEBULA customer seats; additive migration. A single latest frame per machine, no history.
BEGIN;
ALTER TABLE vertex_debug.machine_states ADD COLUMN IF NOT EXISTS monitor_requested_until_ms bigint NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS vertex_debug.machine_monitors (
  machine_id text PRIMARY KEY REFERENCES vertex_debug.machine_states(machine_id),
  session_id text NOT NULL,
  updated_at_ms bigint NOT NULL,
  screen jsonb NOT NULL
);
ALTER TABLE vertex_debug.machine_monitors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vertex_debug.machine_monitors FROM PUBLIC, anon, authenticated;
GRANT ALL ON vertex_debug.machine_monitors TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
