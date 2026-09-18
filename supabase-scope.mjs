// One paid Supabase project may host several stores. Only server configuration
// chooses the schema; callers cannot select a neighbouring store's data.
export const STORE_SCHEMAS = Object.freeze({
  "store-jag-one": "vertex_main",
  "store-las-vegas": "vertex_las_vegas",
  "store-debug": "vertex_debug"
});

export function resolveDatabaseSchema(env = process.env) {
  const schema = String(env.VERTEX_DB_SCHEMA || "public").trim();
  if (schema === "public") return schema; // Existing independent deployments.
  const expected = STORE_SCHEMAS[String(env.VERTEX_STORE_ID || "").trim()];
  if (!expected || schema !== expected) {
    throw new Error("VERTEX_DB_SCHEMA does not match VERTEX_STORE_ID");
  }
  return schema;
}

export function scopeHeaders(headers = {}, env = process.env) {
  const schema = resolveDatabaseSchema(env);
  const scoped = Object.fromEntries(Object.entries(headers).filter(([key]) =>
    !["accept-profile", "content-profile"].includes(key.toLowerCase())
  ));
  // PostgREST uses Accept-Profile for reads and Content-Profile for writes/RPCs.
  return {...scoped, "Accept-Profile": schema, "Content-Profile": schema};
}
