import fs from "node:fs";
import {pathToFileURL} from "node:url";
import {STORE_SCHEMAS} from "../supabase-scope.mjs";

export function sharedSchemaSql(storeId) {
  const schema = STORE_SCHEMAS[storeId];
  if (!schema) throw new Error("Unknown store ID");
  const template = fs.readFileSync(new URL("../supabase_schema.sql", import.meta.url), "utf8");
  // Keep the PostgreSQL PUBLIC role in REVOKE statements. Only schema qualifiers
  // and function search paths are changed; all RPCs stay within their store.
  const ddl = template.replace(/\bpublic\./g, `${schema}.`)
    .replace(/set search_path = public\b/g, `set search_path = ${schema}`);
  return `-- Store: ${storeId}. Run only on the selected existing paid project.
-- Creation fails if this schema already exists. Existing data is never replaced.
BEGIN;
CREATE SCHEMA ${schema};
REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
${ddl}
REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${schema} FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${schema} FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA ${schema} TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA ${schema} TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA ${schema} TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${schema} TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(sharedSchemaSql(process.argv[2]));
}
