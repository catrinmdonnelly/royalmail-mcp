import { PDFDocument } from 'pdf-lib';
import { appendFile, mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { resolve, join, sep } from 'path';
import { cleanText } from './text.js';

const EXTENSIONS = ['pdf', 'zpl', 'png'];

function labelsDir() {
  if (process.env.PARCEL_TOOLKIT_LABELS_DIR) {
    return resolve(process.env.PARCEL_TOOLKIT_LABELS_DIR);
  }
  const downloads = join(homedir(), 'Downloads');
  const base = existsSync(downloads) ? downloads : homedir();
  return join(base, 'parcel-toolkit');
}

export function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// For a format the carrier reports: use it if it is one we save, otherwise the one that was asked for.
export function safeExtension(candidate, fallback = 'pdf') {
  const extension = String(candidate ?? '').toLowerCase();
  return EXTENSIONS.includes(extension) ? extension : fallback;
}

function safeStem(stem) {
  const cleaned = String(stem ?? '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.-]+/, '')
    .slice(0, 100);
  return cleaned || 'label';
}

// Never overwrites a file, and never writes outside the labels folder.
async function writeInsideLabelsFolder(stem, extension, data) {
  if (!EXTENSIONS.includes(extension)) {
    throw new Error(`Labels can only be saved as ${EXTENSIONS.join(', ')} files.`);
  }
  const dir = labelsDir();
  await mkdir(dir, { recursive: true });
  const cleanStem = safeStem(stem);
  for (let n = 0; n < 100; n++) {
    const name = n === 0 ? `${cleanStem}.${extension}` : `${cleanStem}-${n}.${extension}`;
    const fullPath = join(dir, name);
    if (!resolve(fullPath).startsWith(dir + sep)) {
      throw new Error('That file name would fall outside the labels folder.');
    }
    try {
      await writeFile(fullPath, data, { flag: 'wx', mode: 0o600 });
      return fullPath;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  throw new Error('Could not find a free file name in the labels folder.');
}

export async function saveLabelToDisk({ labelBase64, filenameStem, extension = 'pdf' }) {
  const buffer = Buffer.from(String(labelBase64 ?? ''), 'base64');
  if (buffer.length === 0) throw new Error('The carrier sent an empty label.');
  return writeInsideLabelsFolder(filenameStem, extension, buffer);
}

// Merges what can be read and reports the rest, so one bad label does not lose the others.
// labels: [{ id, labelBase64 }]. Throws only if none of them could be merged.
export async function mergeLabelsTolerant({ labels, filenameStem }) {
  const merged = await PDFDocument.create();
  const included = [];
  const skipped = [];
  for (const { id, labelBase64 } of labels) {
    try {
      const src = await PDFDocument.load(Buffer.from(String(labelBase64 ?? ''), 'base64'), { ignoreEncryption: true });
      const pages = await merged.copyPages(src, src.getPageIndices());
      for (const p of pages) merged.addPage(p);
      included.push(id);
    } catch (err) {
      skipped.push({ id, error: `could not be read as a PDF (${cleanText(err.message, 120)})` });
    }
  }
  if (included.length === 0) {
    throw new Error(`No label could be merged. ${skipped[0] ? `The first ${skipped[0].error}.` : ''}`.trim());
  }
  const path = await writeInsideLabelsFolder(filenameStem, 'pdf', await merged.save());
  return { path, included, skipped };
}

export async function mergeLabelsToPdf({ labelsBase64, filenameStem }) {
  const labels = labelsBase64.map((labelBase64, i) => ({ id: i + 1, labelBase64 }));
  const result = await mergeLabelsTolerant({ labels, filenameStem });
  if (result.skipped.length > 0) {
    throw new Error(`Label ${result.skipped[0].id} ${result.skipped[0].error}.`);
  }
  return result.path;
}

// A running record of what has been booked, written as each booking happens. If a batch is cut
// short by the client, this file still shows what was booked. Failing to write it never stops a booking.
export async function recordBooking(entry) {
  try {
    const dir = labelsDir();
    await mkdir(dir, { recursive: true });
    const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
    await appendFile(join(dir, 'bookings.jsonl'), `${line}\n`, { mode: 0o600 });
  } catch {
    // Best effort only.
  }
}
