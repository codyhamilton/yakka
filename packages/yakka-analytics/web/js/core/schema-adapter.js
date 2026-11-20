// One boundary for the heterogeneous `/schema` wire shape (DESIGN.md:84).
// Time measures arrive as `{name,unit,dims}` objects, other measures as names,
// and artifact lenses as a keyed metadata object. Every grain leaves here with
// `measures` and `lenses` as arrays of names plus `measure_metadata` /
// `lens_metadata` maps, so no consumer has to guess the shape. The adapter is
// pure, idempotent and never throws on an unexpected section; it names what it
// could not read in `warnings`.

const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// Read-only helper for callers that hold a raw (unadapted) grain value.
export function publishedNames(value) {
  if (Array.isArray(value)) {
    return value
      .map(item => (typeof item === 'string' ? item : isPlainObject(item) ? item.name : ''))
      .filter(name => typeof name === 'string' && name);
  }
  if (isPlainObject(value)) return Object.keys(value);
  return [];
}

function metadataOf(item) {
  if (!isPlainObject(item)) return null;
  const { name, ...rest } = item;
  return Object.keys(rest).length ? rest : null;
}

function readNames(value, metadata, warnings, path, label) {
  const names = [];
  const add = (name, meta) => {
    if (typeof name !== 'string' || !name) {
      warnings.push({ path, reason: `${label} entry has no name` });
      return;
    }
    if (!names.includes(name)) names.push(name);
    if (meta) metadata[name] = { ...(metadata[name] || {}), ...meta };
  };
  if (Array.isArray(value)) {
    for (const item of value) {
      add(typeof item === 'string' ? item : isPlainObject(item) ? item.name : '', metadataOf(item));
    }
    return names;
  }
  if (isPlainObject(value)) {
    for (const [name, meta] of Object.entries(value)) add(name, isPlainObject(meta) ? meta : null);
    return names;
  }
  if (value !== undefined && value !== null) warnings.push({ path, reason: `${label} list is not an array or object` });
  return names;
}

export function adaptSchema(raw) {
  const warnings = [];
  if (!isPlainObject(raw)) {
    if (raw !== undefined && raw !== null) warnings.push({ path: '', reason: 'schema is not an object' });
    return { schema: {}, warnings };
  }

  const schema = { ...raw };
  const measureMetadata = isPlainObject(raw.measure_metadata) ? { ...raw.measure_metadata } : {};
  if (Array.isArray(raw.measures)) {
    for (const item of raw.measures) {
      if (!isPlainObject(item) || typeof item.name !== 'string' || !item.name) continue;
      const { name, ...meta } = item;
      measureMetadata[name] = { ...meta, ...(measureMetadata[name] || {}) };
    }
  }
  schema.measure_metadata = measureMetadata;

  if (isPlainObject(raw.grains)) {
    const grains = {};
    for (const [grainName, grain] of Object.entries(raw.grains)) {
      if (!isPlainObject(grain)) {
        grains[grainName] = grain;
        continue;
      }
      const next = { ...grain };
      const grainMeasures = isPlainObject(grain.measure_metadata) ? { ...grain.measure_metadata } : {};
      next.measures = readNames(grain.measures, grainMeasures, warnings, `grains.${grainName}.measures`, 'measure');
      next.measure_metadata = grainMeasures;
      for (const [name, meta] of Object.entries(grainMeasures)) {
        measureMetadata[name] = { ...meta, ...(measureMetadata[name] || {}) };
      }
      const lensMetadata = isPlainObject(grain.lens_metadata) ? { ...grain.lens_metadata } : {};
      next.lenses = readNames(grain.lenses, lensMetadata, warnings, `grains.${grainName}.lenses`, 'lens');
      next.lens_metadata = lensMetadata;
      grains[grainName] = next;
    }
    schema.grains = grains;
  } else if (raw.grains !== undefined && raw.grains !== null) {
    warnings.push({ path: 'grains', reason: 'grains is not an object' });
  }

  return { schema, warnings };
}
