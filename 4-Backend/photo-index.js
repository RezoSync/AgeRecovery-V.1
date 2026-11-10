import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDirectory = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(backendDirectory, 'fotos-index.json');
const photoIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const routePattern = /^uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$/i;

let photos = [];
let writeQueue = Promise.resolve();

function isPhotoRecord(record) {
  return record !== null
    && typeof record === 'object'
    && photoIdPattern.test(record.id_api)
    && Number.isSafeInteger(record.id_paciente)
    && record.id_paciente > 0
    && Number.isSafeInteger(record.id_plan)
    && record.id_plan > 0
    && typeof record.ruta === 'string'
    && routePattern.test(record.ruta)
    && typeof record.fecha === 'string';
}

export async function initializePhotoIndex() {
  let contents;
  try {
    contents = await readFile(indexPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      photos = [];
      return;
    }
    throw error;
  }

  try {
    const parsed = JSON.parse(contents);
    if (!Array.isArray(parsed) || !parsed.every(isPhotoRecord)) {
      throw new Error('Invalid photo index structure');
    }
    photos = parsed;
  } catch {
    console.warn('El índice de fotos está dañado; se iniciará vacío.');
    photos = [];
  }
}

export function listPhotosForPatient(patientId) {
  return photos
    .filter((photo) => photo.id_paciente === patientId && existsSync(getPhotoFilePath(photo)))
    .map(({ id_api, id_plan, fecha }) => ({ id: id_api, id_plan, fecha }));
}

export function findPhotoForPatient(photoId, patientId) {
  if (!photoIdPattern.test(photoId)) return undefined;
  return photos.find((photo) => photo.id_api === photoId && photo.id_paciente === patientId);
}

export function getPhotoFilePath(photo) {
  if (!isPhotoRecord(photo)) return undefined;
  return path.join(backendDirectory, 'uploads', path.basename(photo.ruta));
}

export function addPhotoToIndex(photo) {
  if (!isPhotoRecord(photo)) {
    return Promise.reject(new Error('Invalid photo metadata'));
  }

  const operation = writeQueue.then(async () => {
    const nextPhotos = [...photos, photo];
    const temporaryPath = `${indexPath}.${randomUUID()}.tmp`;

    try {
      await writeFile(temporaryPath, JSON.stringify(nextPhotos, null, 2), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600
      });
      await rename(temporaryPath, indexPath);
      photos = nextPhotos;
    } catch (error) {
      try {
        await unlink(temporaryPath);
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') {
          console.error('No se pudo limpiar el archivo temporal del índice de fotos.');
        }
      }
      throw error;
    }
  });

  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}
