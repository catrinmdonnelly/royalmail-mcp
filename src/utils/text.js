// Helpers for text that comes from the carrier or from the person asking.
// Carrier replies end up in front of the AI, so they are cleaned and kept short.

const CONTROL_CHARACTERS = new RegExp(
  "[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2069\\ufeff\\u{e0000}-\\u{e007f}]",
  "gu"
);

export function cleanText(value, max = 300) {
  const text = String(value ?? '').replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function cleanDeep(value, { maxText = 300, maxItems = 50, depth = 4 } = {}) {
  if (typeof value === 'string') return cleanText(value, maxText);
  if (value === null || typeof value !== 'object') return value;
  if (depth <= 0) return undefined;
  const next = { maxText, maxItems, depth: depth - 1 };
  if (Array.isArray(value)) return value.slice(0, maxItems).map((item) => cleanDeep(item, next));
  const out = {};
  for (const [key, item] of Object.entries(value).slice(0, 40)) {
    out[cleanText(key, 60)] = cleanDeep(item, next);
  }
  return out;
}

// Identifiers go into the web address sent to the carrier, so only plain characters are allowed.
export function safeId(value, label) {
  const id = String(value ?? '').trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) {
    throw new Error(`${label} must be 1 to 40 letters, numbers, hyphens or underscores.`);
  }
  return id;
}

// Royal Mail order identifiers are numbers. Anything else, such as a shared reference, is refused.
export function safeDigits(value, label) {
  const id = String(value ?? '').trim();
  if (!/^[0-9]{1,20}$/.test(id)) {
    throw new Error(`${label} must be a number.`);
  }
  return id;
}

// Only accepts a real calendar date written as YYYY-MM-DD or DD/MM/YYYY. Returns { y, m, d }.
export function parseDate(value, label) {
  const text = String(value ?? '').trim();
  let y, m, d;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) [, y, m, d] = match;
  else if ((match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text))) [, d, m, y] = match;
  if (!match) throw new Error(`${label} must be written as YYYY-MM-DD or DD/MM/YYYY.`);
  const date = new Date(Date.UTC(+y, +m - 1, +d));
  if (date.getUTCFullYear() !== +y || date.getUTCMonth() !== +m - 1 || date.getUTCDate() !== +d) {
    throw new Error(`${label} is not a real date.`);
  }
  return { y, m, d };
}
