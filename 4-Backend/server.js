import 'dotenv/config';

import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { fileTypeFromBuffer } from 'file-type';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import mysql from 'mysql2/promise';
import nodemailer from 'nodemailer';
import {
  addPhotoToIndex,
  findPhotoForPatient,
  getPhotoFilePath,
  initializePhotoIndex,
  listPhotosForPatient
} from './photo-index.js';

const backendDirectory = path.dirname(fileURLToPath(import.meta.url));
const uploadsDirectory = path.join(backendDirectory, 'uploads');

function readConfig() {
  const required = ['DB_HOST', 'DB_USER', 'DB_NAME', 'JWT_SECRET', 'CORS_ORIGIN', 'ADMIN_KEY'];
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Faltan valores requeridos en .env: ${missing.join(', ')}`);
  }

  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT debe ser un entero entre 1 y 65535.');
  }
  if (Buffer.byteLength(process.env.JWT_SECRET, 'utf8') < 32) {
    throw new Error('JWT_SECRET debe tener al menos 32 caracteres.');
  }
  if (process.env.ADMIN_KEY.length < 16) {
    throw new Error('ADMIN_KEY debe tener al menos 16 caracteres.');
  }

  return {
    dbHost: process.env.DB_HOST,
    dbPort: Number(process.env.DB_PORT || 3306),
    dbUser: process.env.DB_USER,
    dbPassword: process.env.DB_PASSWORD ?? '',
    dbName: process.env.DB_NAME,
    jwtSecret: process.env.JWT_SECRET,
    adminKey: process.env.ADMIN_KEY,
    smtpUser: process.env.SMTP_USER?.trim() || null,
    smtpPass: process.env.SMTP_PASS || null,
    mailCopyTo: process.env.MAIL_COPY_TO?.trim() || null,
    port,
    corsOrigins: process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
  };
}

class HttpError extends Error {
  constructor(status, publicMessage) {
    super(publicMessage);
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function isAdminAuthorized(req, adminKey) {
  const suppliedKey = req.get('x-admin-key');
  if (typeof suppliedKey !== 'string') return false;

  const suppliedBuffer = Buffer.from(suppliedKey, 'utf8');
  const adminBuffer = Buffer.from(adminKey, 'utf8');
  return suppliedBuffer.length === adminBuffer.length
    && timingSafeEqual(suppliedBuffer, adminBuffer);
}

function isDuplicateFor(error, column) {
  if (error?.code !== 'ER_DUP_ENTRY') return false;
  const detail = `${error.message ?? ''} ${error.sqlMessage ?? ''}`.toLowerCase();
  return detail.includes(column);
}

async function sendPatientCodeEmail(config, { email, name, code }) {
  if (!config.smtpUser || !config.smtpPass) return false;

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: config.smtpUser,
        pass: config.smtpPass
      }
    });
    await transporter.sendMail({
      from: config.smtpUser,
      to: email,
      ...(config.mailCopyTo ? { bcc: config.mailCopyTo } : {}),
      subject: 'Age Recovery: tu código de acceso',
      text: `Hola ${name},\n\nTu código de acceso a Age Recovery es: ${code}.\nÚsalo para iniciar sesión en la app.\n\nAge Recovery`
    });
    return true;
  } catch (error) {
    const errorCode = typeof error?.code === 'string' ? error.code : 'MAIL_SEND_FAILED';
    console.error(`No se pudo enviar el correo de acceso: ${errorCode}`);
    return false;
  }
}

function validatePatientInput(body) {
  if (typeof body.nombre !== 'string'
    || /[\u0000-\u001f\u007f-\u009f]/.test(body.nombre)
    || body.nombre.trim().length < 2
    || body.nombre.trim().length > 100) {
    throw new HttpError(400, 'Nombre inválido.');
  }
  if (typeof body.correo !== 'string'
    || body.correo.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.correo.trim())) {
    throw new HttpError(400, 'Correo inválido.');
  }

  return { name: body.nombre.trim(), email: body.correo.trim() };
}

async function findActivePatientByEmail(pool, email) {
  const [patients] = await pool.execute(
    `SELECT id_paciente, nombre, email, codigo_paciente
     FROM paciente
     WHERE email = ? AND activo = 1
     LIMIT 1`,
    [email]
  );
  return patients[0] ?? null;
}

async function createPatientWithDemoPlan(pool, { name, email }) {
  let createdPatient;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = String(randomInt(100000, 1000000));
    const connection = await pool.getConnection();
    let transactionStarted = false;
    let retryWithNewCode = false;

    try {
      await connection.beginTransaction();
      transactionStarted = true;

      const [treatments] = await connection.execute(
        'SELECT id_tratamiento FROM tratamiento WHERE id_tratamiento = ? LIMIT 1',
        [1]
      );
      if (treatments.length === 0) {
        throw new HttpError(500, 'No se encontró el tratamiento demo.');
      }

      const [patientResult] = await connection.execute(
        `INSERT INTO paciente (nombre, email, codigo_paciente, acepto_consentimiento)
         VALUES (?, ?, ?, NOW())`,
        [name, email, code]
      );
      const patientId = patientResult.insertId;
      await connection.execute(
        `INSERT INTO plan_paciente (id_paciente, id_tratamiento, id_medico, fecha_procedimiento)
         VALUES (?, ?, NULL, CURDATE() - INTERVAL 1 DAY)`,
        [patientId, 1]
      );

      await connection.commit();
      transactionStarted = false;
      createdPatient = { id_paciente: patientId, nombre: name, correo: email, codigo: code };
    } catch (error) {
      if (transactionStarted) {
        await connection.rollback();
        transactionStarted = false;
      }

      if (isDuplicateFor(error, 'email')) {
        throw new HttpError(409, 'Ese correo ya está registrado.');
      }
      if (isDuplicateFor(error, 'codigo_paciente')) {
        if (attempt === 4) {
          throw new HttpError(500, 'No se pudo generar un código único.');
        }
        retryWithNewCode = true;
      } else {
        throw error;
      }
    } finally {
      connection.release();
    }

    if (createdPatient) break;
    if (!retryWithNewCode) throw new Error('No se pudo crear el paciente.');
  }

  return createdPatient;
}

function rowsFromCall(result) {
  const procedureResults = Array.isArray(result) ? result[0] : undefined;
  if (!Array.isArray(procedureResults)) return [];
  return procedureResults.find(Array.isArray) ?? [];
}

function parsePositiveId(value, label) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new HttpError(400, `${label} inválido.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 4294967295) {
    throw new HttpError(400, `${label} inválido.`);
  }
  return parsed;
}

function currentDateForMySql() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createApplication(config, pool) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new HttpError(403, 'Origen no permitido.'));
    }
  }));
  app.use(express.json({ limit: '32kb' }));
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false
  });
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true
  });
  const adminPatientLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false
  });
  const registrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler(req, res) {
      res.status(429).json({ error: 'Has alcanzado el límite de registros. Intenta de nuevo más tarde.' });
    }
  });

  app.get('/api/salud', (req, res) => res.json({ ok: true }));
  app.use('/api', apiLimiter);

  app.post('/api/registro', registrationLimiter, asyncHandler(async (req, res) => {
    const { name, email } = validatePatientInput(req.body ?? {});
    let patient = await findActivePatientByEmail(pool, email);

    if (!patient) {
      try {
        patient = await createPatientWithDemoPlan(pool, { name, email });
      } catch (error) {
        if (error.status !== 409) throw error;
        patient = await findActivePatientByEmail(pool, email);
        if (!patient) throw error;
      }
    }

    const correoEnviado = await sendPatientCodeEmail(config, {
      email: patient.correo ?? patient.email,
      name: patient.nombre,
      code: patient.codigo ?? patient.codigo_paciente
    });
    if (!correoEnviado) {
      throw new HttpError(502, 'No se pudo enviar el correo. Intenta de nuevo.');
    }

    res.status(200).json({
      ok: true,
      mensaje: 'Si el correo es válido, recibirás tu código en unos minutos.'
    });
  }));

  app.post('/api/admin/pacientes', adminPatientLimiter, (req, res, next) => {
    if (!isAdminAuthorized(req, config.adminKey)) {
      next(new HttpError(401, 'No autorizado.'));
      return;
    }
    next();
  }, asyncHandler(async (req, res) => {
    const { name, email } = validatePatientInput(req.body ?? {});
    const createdPatient = await createPatientWithDemoPlan(pool, { name, email });
    const correoEnviado = await sendPatientCodeEmail(config, {
      email: createdPatient.correo,
      name: createdPatient.nombre,
      code: createdPatient.codigo
    });
    res.status(201).json({
      id_paciente: createdPatient.id_paciente,
      nombre: createdPatient.nombre,
      correo: createdPatient.correo,
      codigo: createdPatient.codigo,
      correo_enviado: correoEnviado
    });
  }));

  function authenticate(req, res, next) {
    const header = req.get('authorization');
    const match = typeof header === 'string' && header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      next(new HttpError(401, 'Autenticación requerida.'));
      return;
    }

    try {
      const payload = jwt.verify(match[1], config.jwtSecret, { algorithms: ['HS256'] });
      if (typeof payload !== 'object' || typeof payload.sub !== 'string' || !/^[1-9]\d*$/.test(payload.sub)) {
        throw new Error('Invalid token subject');
      }
      const patientId = Number(payload.sub);
      if (!Number.isSafeInteger(patientId) || patientId > 4294967295) {
        throw new Error('Invalid token subject');
      }
      req.patientId = patientId;
      next();
    } catch {
      next(new HttpError(401, 'Token inválido o expirado.'));
    }
  }

  async function getActivePlan(patientId) {
    const result = await pool.execute('CALL sp_mi_plan(?)', [patientId]);
    const plan = rowsFromCall(result)[0];
    if (!plan) throw new HttpError(404, 'El paciente no tiene un plan activo.');
    return plan;
  }

  app.post('/api/login', loginLimiter, asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const hasCode = Object.hasOwn(body, 'codigo');
    const hasEmail = Object.hasOwn(body, 'correo');
    if (hasCode === hasEmail) {
      throw new HttpError(400, 'Envía exactamente uno de estos campos: codigo o correo.');
    }

    let code = null;
    let email = null;
    if (hasCode) {
      if (typeof body.codigo !== 'string' || !/^\d{6}$/.test(body.codigo)) {
        throw new HttpError(400, 'El código debe contener seis dígitos.');
      }
      code = body.codigo;
    } else {
      if (typeof body.correo !== 'string' || body.correo.length > 254) {
        throw new HttpError(400, 'Correo inválido.');
      }
      email = body.correo.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new HttpError(400, 'Correo inválido.');
      }
    }

    let patient;
    try {
      const result = await pool.execute(
        'CALL sp_login_paciente(?, ?, ?)',
        [code, email, req.ip]
      );
      patient = rowsFromCall(result)[0];
    } catch (error) {
      if (error.code === 'ER_SIGNAL_EXCEPTION' || error.errno === 1644) {
        throw new HttpError(401, 'No se pudo iniciar sesión. Revisa tus datos o espera si hubo varios intentos.');
      }
      throw error;
    }
    if (!patient) {
      throw new HttpError(401, 'No se pudo iniciar sesión.');
    }

    const token = jwt.sign(
      { sub: String(patient.id_paciente) },
      config.jwtSecret,
      { algorithm: 'HS256', expiresIn: '8h' }
    );
    res.json({
      token,
      paciente: {
        id_paciente: patient.id_paciente,
        nombre: patient.nombre,
        idioma: patient.idioma,
        hora_recordatorio_1: patient.hora_recordatorio_1,
        hora_recordatorio_2: patient.hora_recordatorio_2,
        notif_importantes: patient.notif_importantes
      }
    });
  }));

  app.get('/api/plan', authenticate, asyncHandler(async (req, res) => {
    const plan = await getActivePlan(req.patientId);
    res.json(plan);
  }));

  app.get('/api/cuidados/hoy', authenticate, asyncHandler(async (req, res) => {
    const plan = await getActivePlan(req.patientId);
    const fecha = currentDateForMySql();
    const result = await pool.execute('CALL sp_cuidados_del_dia(?, ?)', [plan.id_plan, fecha]);
    res.json({ fecha, cuidados: rowsFromCall(result) });
  }));

  app.post('/api/cuidados/:id/marcar', authenticate, asyncHandler(async (req, res) => {
    const origin = req.body?.origen === undefined ? 'telefono' : req.body.origen;
    if (typeof origin !== 'string' || !['telefono', 'reloj'].includes(origin)) {
      throw new HttpError(400, 'Origen inválido.');
    }

    const careId = parsePositiveId(req.params.id, 'Id de cuidado');
    const plan = await getActivePlan(req.patientId);
    const fecha = currentDateForMySql();
    const dailyCareResult = await pool.execute(
      'CALL sp_cuidados_del_dia(?, ?)',
      [plan.id_plan, fecha]
    );
    const todaysCare = rowsFromCall(dailyCareResult);
    if (!todaysCare.some((care) => Number(care.id_cuidado) === careId)) {
      throw new HttpError(404, 'Cuidado no encontrado para hoy.');
    }

    await pool.execute(
      'CALL sp_marcar_cuidado(?, ?, ?, ?)',
      [plan.id_plan, careId, fecha, origin]
    );
    res.json({ ok: true });
  }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 5 * 1024 * 1024,
      files: 1,
      fields: 2,
      parts: 3,
      fieldNameSize: 100,
      fieldSize: 2000
    }
  });

  app.post('/api/fotos', authenticate, upload.single('foto'), asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Falta el archivo en el campo foto.');
    const detectedType = await fileTypeFromBuffer(req.file.buffer);
    if (!detectedType || !['image/jpeg', 'image/png'].includes(detectedType.mime)) {
      throw new HttpError(415, 'Solo se permiten imágenes JPEG o PNG.');
    }

    const note = req.body?.nota;
    if (note !== undefined && (typeof note !== 'string' || note.length > 500)) {
      throw new HttpError(400, 'La nota debe ser texto de hasta 500 caracteres.');
    }
    // TODO_MEDICO: confirmar con el equipo clínico el ánimo neutral predeterminado.
    let mood = 3;
    if (req.body?.animo !== undefined) {
      if (typeof req.body.animo !== 'string' || !/^[1-5]$/.test(req.body.animo)) {
        throw new HttpError(400, 'Ánimo debe ser un entero entre 1 y 5.');
      }
      mood = Number(req.body.animo);
    }

    const plan = await getActivePlan(req.patientId);
    const photoId = randomUUID();
    const extension = detectedType.mime === 'image/jpeg' ? 'jpg' : 'png';
    const filename = `${photoId}.${extension}`;
    const relativePath = `uploads/${filename}`;
    const absolutePath = path.join(uploadsDirectory, filename);
    await mkdir(uploadsDirectory, { recursive: true });
    await writeFile(absolutePath, req.file.buffer, { flag: 'wx', mode: 0o600 });

    try {
      await pool.execute(
        'CALL sp_guardar_foto(?, ?, ?, ?)',
        [plan.id_plan, relativePath, mood, note?.trim() || null]
      );
    } catch (error) {
      try {
        await unlink(absolutePath);
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') {
          console.error('No se pudo limpiar una foto cuyo registro en MySQL falló.');
        }
      }
      throw error;
    }

    const fecha = new Date().toISOString();
    await addPhotoToIndex({
      id_api: photoId,
      id_paciente: req.patientId,
      id_plan: Number(plan.id_plan),
      ruta: relativePath,
      fecha
    });
    res.status(201).json({ id: photoId, fecha });
  }));

  app.get('/api/fotos', authenticate, (req, res) => {
    res.json({ fotos: listPhotosForPatient(req.patientId) });
  });

  app.get('/api/fotos/:id', authenticate, asyncHandler(async (req, res, next) => {
    const photo = findPhotoForPatient(req.params.id, req.patientId);
    const filePath = photo && getPhotoFilePath(photo);
    if (!filePath) throw new HttpError(404, 'Foto no encontrada.');

    res.set('Cache-Control', 'private, no-store');
    res.type(photo.ruta.endsWith('.png') ? 'image/png' : 'image/jpeg');
    res.sendFile(filePath, (error) => {
      if (error) {
        if (res.headersSent) {
          next(error);
          return;
        }
        next(new HttpError(404, 'Foto no encontrada.'));
      }
    });
  }));

  app.post('/api/alarmas', authenticate, asyncHandler(async (req, res) => {
    const rawSymptom = req.body?.sintoma;
    if (rawSymptom !== undefined && typeof rawSymptom !== 'string') {
      throw new HttpError(400, 'El síntoma debe ser texto.');
    }
    const symptom = typeof rawSymptom === 'string'
      ? rawSymptom.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
      : '';

    await pool.execute(
      'CALL sp_notificar_alarma(?, ?, ?)',
      [req.patientId, null, symptom || null]
    );
    res.status(201).json({ ok: true });
  }));

  app.use((req, res, next) => next(new HttpError(404, 'Recurso no encontrado.')));

  app.use((error, req, res, next) => {
    let status = error.status ?? 500;
    let message = error.publicMessage ?? 'Ocurrió un error interno.';
    if (error instanceof multer.MulterError) {
      status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      message = error.code === 'LIMIT_FILE_SIZE'
        ? 'La imagen supera el máximo de 5 MB.'
        : 'No se pudo procesar la carga del archivo.';
    } else if (error.type === 'entity.too.large') {
      status = 413;
      message = 'El cuerpo de la solicitud supera el tamaño permitido.';
    } else if (error.type === 'entity.parse.failed') {
      status = 400;
      message = 'JSON inválido.';
    }

    if (status >= 500) {
      console.error(`Error interno al atender ${req.method} ${req.path}: ${error.code ?? 'INTERNAL_ERROR'}`);
    }
    if (res.headersSent) {
      next(error);
      return;
    }
    res.status(status).json({ error: message });
  });

  return app;
}

async function start() {
  let config;
  try {
    config = readConfig();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const pool = mysql.createPool({
    host: config.dbHost,
    port: config.dbPort,
    user: config.dbUser,
    password: config.dbPassword,
    database: config.dbName,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  try {
    await initializePhotoIndex();
    const connection = await pool.getConnection();
    connection.release();

    const app = createApplication(config, pool);
    app.listen(config.port, '0.0.0.0', () => {
      console.log(`Backend escuchando en 0.0.0.0:${config.port}`);
    });
  } catch (error) {
    console.error(`No se pudo iniciar el backend: ${error.code ?? 'STARTUP_ERROR'}`);
    await pool.end();
    process.exitCode = 1;
  }
}

await start();
