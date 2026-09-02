const RESOURCE_GROUPS = ["skills", "mcp", "extensions", "packages"] as const;

export function validatePresetConfig(value: unknown, source: string): asserts value is {
  version: number;
  resources?: Record<string, unknown>;
  base?: { enable?: Record<string, string[]>; settings?: Record<string, unknown> };
  presets?: Record<string, { enable?: Record<string, string[]>; settings?: Record<string, unknown> }>;
} {
  if (!value || typeof value !== "object") throw new Error(`${source} root must be an object`);
  const record = value as Record<string, unknown>;
  if (record.version !== 1) throw new Error(`${source} version must be 1`);
  for (const section of [record.base, record.presets]) {
    if (section === undefined) continue;
    if (!section || typeof section !== "object") throw new Error(`${source} preset section must be an object`);
    const enable = (section as Record<string, unknown>).enable;
    if (enable === undefined) continue;
    if (!enable || typeof enable !== "object") throw new Error(`${source} enable must be an object`);
    for (const [group, entries] of Object.entries(enable as Record<string, unknown>)) {
      if (!(RESOURCE_GROUPS as readonly string[]).includes(group)) throw new Error(`${source} unknown resource group: ${group}`);
      if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string")) {
        throw new Error(`${source} ${group} must be an array of strings`);
      }
    }
  }
}
