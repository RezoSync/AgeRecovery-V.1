-- =====================================================================
-- Base de datos: recuperacion_app  (MySQL 8.0 / Workbench)
-- Age Recovery - App de recuperación (teléfono + reloj)
-- Basada en: 3-AppMovil/src/App.tsx y 2-Chatbot/agent/faq-age-recovery.md
-- Ejecutar completo (Ctrl+Shift+Enter) con un usuario con permiso CREATE.
-- =====================================================================

DROP DATABASE IF EXISTS recuperacion_app;
CREATE DATABASE recuperacion_app
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE recuperacion_app;

-- ---------------------------------------------------------------------
-- 1. CATÁLOGOS (los llena la clínica)
-- ---------------------------------------------------------------------
CREATE TABLE clinica (
  id_clinica TINYINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  nombre     VARCHAR(120) NOT NULL,
  direccion  VARCHAR(200) NOT NULL,
  ciudad     VARCHAR(80)  NOT NULL,
  horario    VARCHAR(250) NOT NULL,
  whatsapp   VARCHAR(20)  NULL            -- la app y el chatbot remiten a WhatsApp
) ENGINE=InnoDB;

CREATE TABLE medico (
  id_medico  INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  id_clinica TINYINT UNSIGNED NOT NULL,
  nombre     VARCHAR(100) NOT NULL,
  activo     BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_medico_clinica FOREIGN KEY (id_clinica) REFERENCES clinica(id_clinica)
) ENGINE=InnoDB;

-- Los 6 tratamientos del sitio / FAQ
CREATE TABLE tratamiento (
  id_tratamiento SMALLINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  nombre         VARCHAR(100) NOT NULL UNIQUE,
  duracion_sesion_min SMALLINT UNSIGNED NOT NULL,
  sesiones       VARCHAR(120) NOT NULL,        -- texto tal cual el FAQ
  plan_dias      SMALLINT UNSIGNED NOT NULL    -- largo del plan de recuperación en la app
) ENGINE=InnoDB;

-- Etapas que muestra la pantalla "Mi plan" (Primeras 24 horas, etc.)
CREATE TABLE etapa_plan (
  dia    SMALLINT UNSIGNED PRIMARY KEY,
  titulo VARCHAR(80) NOT NULL
) ENGINE=InnoDB;

-- Cuidados posteriores por tratamiento (salen de "¿Qué cuidados posteriores...?" del FAQ)
CREATE TABLE cuidado_plan (
  id_cuidado     INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  id_tratamiento SMALLINT UNSIGNED NOT NULL,
  dia_desde      SMALLINT UNSIGNED NOT NULL,
  dia_hasta      SMALLINT UNSIGNED NOT NULL,
  titulo         VARCHAR(100) NOT NULL,
  instruccion    VARCHAR(300) NOT NULL,
  CONSTRAINT fk_cuidado_trat FOREIGN KEY (id_tratamiento) REFERENCES tratamiento(id_tratamiento),
  CONSTRAINT ck_cuidado_dias CHECK (dia_hasta >= dia_desde)
) ENGINE=InnoDB;

-- Señales de alarma (las mismas que usa el agente en instrucciones.md)
CREATE TABLE senal_alarma (
  id_senal    SMALLINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  descripcion VARCHAR(200) NOT NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 2. PACIENTES Y PLAN
-- ---------------------------------------------------------------------
CREATE TABLE paciente (
  id_paciente     INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  codigo_paciente CHAR(6) NOT NULL UNIQUE,      -- login por código de 6 dígitos
  email           VARCHAR(254) NULL UNIQUE,     -- login por correo (la app tiene ambos modos)
  nombre          VARCHAR(100) NOT NULL,
  idioma          ENUM('es','en') NOT NULL DEFAULT 'es',      -- Perfil > Idioma
  hora_recordatorio_1 TIME NOT NULL DEFAULT '09:00:00',       -- Perfil > Horario principal
  hora_recordatorio_2 TIME NOT NULL DEFAULT '20:00:00',
  notif_importantes BOOLEAN NOT NULL DEFAULT TRUE,            -- toggle "recordatorios importantes"
  acepto_consentimiento DATETIME NULL,                        -- pantalla Consent (salud + avisos)
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_codigo_6 CHECK (codigo_paciente REGEXP '^[0-9]{6}$')
) ENGINE=InnoDB;

CREATE TABLE plan_paciente (
  id_plan        INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  id_paciente    INT UNSIGNED NOT NULL,
  id_tratamiento SMALLINT UNSIGNED NOT NULL,
  id_medico      INT UNSIGNED NULL,
  fecha_procedimiento DATE NOT NULL,            -- día 1 del plan
  estado ENUM('activo','completado','cancelado') NOT NULL DEFAULT 'activo',
  CONSTRAINT fk_plan_pac  FOREIGN KEY (id_paciente)    REFERENCES paciente(id_paciente) ON DELETE CASCADE,
  CONSTRAINT fk_plan_trat FOREIGN KEY (id_tratamiento) REFERENCES tratamiento(id_tratamiento),
  CONSTRAINT fk_plan_med  FOREIGN KEY (id_medico)      REFERENCES medico(id_medico),
  INDEX idx_plan_paciente (id_paciente, estado)
) ENGINE=InnoDB;
-- Paciente sin fila en plan_paciente = pantalla "Aún no tienes un plan" (emptyPlan).

CREATE TABLE cuidado_realizado (
  id_realizado BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  id_plan      INT UNSIGNED NOT NULL,
  id_cuidado   INT UNSIGNED NOT NULL,
  fecha        DATE NOT NULL,
  hecho_en     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  origen       ENUM('telefono','reloj') NOT NULL DEFAULT 'telefono',
  CONSTRAINT fk_real_plan FOREIGN KEY (id_plan)    REFERENCES plan_paciente(id_plan) ON DELETE CASCADE,
  CONSTRAINT fk_real_cuid FOREIGN KEY (id_cuidado) REFERENCES cuidado_plan(id_cuidado),
  UNIQUE KEY uq_cuidado_dia (id_plan, id_cuidado, fecha)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 3. SEGUIMIENTO
-- ---------------------------------------------------------------------
-- Pantalla "Foto de seguimiento": foto + ánimo (1-5) + comentario
CREATE TABLE foto_progreso (
  id_foto      BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  id_plan      INT UNSIGNED NOT NULL,
  dia_plan     SMALLINT UNSIGNED NOT NULL,
  ruta_archivo VARCHAR(255) NOT NULL,           -- ruta/URL en almacenamiento, no el binario
  estado_animo TINYINT UNSIGNED NOT NULL DEFAULT 3,
  comentario   VARCHAR(500) NULL,
  tomada_en    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_foto_plan FOREIGN KEY (id_plan) REFERENCES plan_paciente(id_plan) ON DELETE CASCADE,
  CONSTRAINT ck_animo CHECK (estado_animo BETWEEN 1 AND 5),
  INDEX idx_foto_plan (id_plan, dia_plan)
) ENGINE=InnoDB;

-- Pantalla "Alarma": el paciente toca "notificar a la clínica"
CREATE TABLE alerta (
  id_alerta   BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  id_paciente INT UNSIGNED NOT NULL,
  id_senal    SMALLINT UNSIGNED NULL,
  mensaje     VARCHAR(300) NULL,
  atendida    BOOLEAN NOT NULL DEFAULT FALSE,
  creada_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_alerta_pac   FOREIGN KEY (id_paciente) REFERENCES paciente(id_paciente) ON DELETE CASCADE,
  CONSTRAINT fk_alerta_senal FOREIGN KEY (id_senal)    REFERENCES senal_alarma(id_senal),
  INDEX idx_alerta_pend (atendida, creada_en)
) ENGINE=InnoDB;

-- Perfil > "Vincular reloj inteligente"
CREATE TABLE reloj_vinculado (
  id_reloj    INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  id_paciente INT UNSIGNED NOT NULL,
  modelo      VARCHAR(80) NOT NULL,
  vinculado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_reloj_pac FOREIGN KEY (id_paciente) REFERENCES paciente(id_paciente) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 4. SEGURIDAD: bloqueo de login (igual que la app: 5 fallos => 60 s)
-- ---------------------------------------------------------------------
CREATE TABLE intento_login (
  id_intento   BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  ip_origen    VARCHAR(45) NOT NULL,
  exitoso      BOOLEAN NOT NULL,
  intentado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_intento_ip (ip_origen, intentado_en)
) ENGINE=InnoDB;                                -- no se guarda el código ni el correo probado

-- ---------------------------------------------------------------------
-- 5. PROCEDIMIENTOS
-- ---------------------------------------------------------------------
DELIMITER $$

-- Login por código (6 dígitos) O por correo. Pasa NULL en el que no uses.
CREATE PROCEDURE sp_login_paciente(IN p_codigo CHAR(6), IN p_email VARCHAR(254), IN p_ip VARCHAR(45))
BEGIN
  DECLARE v_fallos INT DEFAULT 0;
  DECLARE v_id INT UNSIGNED DEFAULT NULL;

  SELECT COUNT(*) INTO v_fallos FROM intento_login
   WHERE ip_origen = p_ip AND exitoso = FALSE
     AND intentado_en > NOW() - INTERVAL 60 SECOND;
  IF v_fallos >= 5 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Demasiados intentos. Espera 60 segundos.';
  END IF;

  SELECT id_paciente INTO v_id FROM paciente
   WHERE activo = TRUE
     AND ((p_codigo IS NOT NULL AND codigo_paciente = p_codigo)
       OR (p_email  IS NOT NULL AND email = p_email))
   LIMIT 1;

  INSERT INTO intento_login (ip_origen, exitoso) VALUES (p_ip, v_id IS NOT NULL);

  IF v_id IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Código o correo incorrecto.';
  END IF;

  SELECT id_paciente, nombre, idioma, hora_recordatorio_1, hora_recordatorio_2, notif_importantes
    FROM paciente WHERE id_paciente = v_id;
END$$

-- Plan del paciente: día actual y etapa (pantalla Mi plan / Home)
CREATE PROCEDURE sp_mi_plan(IN p_id_paciente INT UNSIGNED)
BEGIN
  SELECT p.id_plan, t.nombre AS tratamiento, p.fecha_procedimiento,
         DATEDIFF(CURDATE(), p.fecha_procedimiento) + 1 AS dia_actual, t.plan_dias,
         (SELECT e.titulo FROM etapa_plan e
           WHERE e.dia <= DATEDIFF(CURDATE(), p.fecha_procedimiento) + 1
           ORDER BY e.dia DESC LIMIT 1) AS etapa
    FROM plan_paciente p JOIN tratamiento t USING (id_tratamiento)
   WHERE p.id_paciente = p_id_paciente AND p.estado = 'activo'
   ORDER BY p.fecha_procedimiento DESC LIMIT 1;   -- 0 filas = "Aún no tienes un plan"
END$$

-- Cuidados de un día con su estado (hecho / pendiente)
CREATE PROCEDURE sp_cuidados_del_dia(IN p_id_plan INT UNSIGNED, IN p_fecha DATE)
BEGIN
  SELECT c.id_cuidado, c.titulo, c.instruccion, (r.id_realizado IS NOT NULL) AS hecho
    FROM plan_paciente p
    JOIN cuidado_plan c
      ON c.id_tratamiento = p.id_tratamiento
     AND (DATEDIFF(p_fecha, p.fecha_procedimiento) + 1) BETWEEN c.dia_desde AND c.dia_hasta
    LEFT JOIN cuidado_realizado r
      ON r.id_plan = p.id_plan AND r.id_cuidado = c.id_cuidado AND r.fecha = p_fecha
   WHERE p.id_plan = p_id_plan
   ORDER BY c.id_cuidado;
END$$

CREATE PROCEDURE sp_marcar_cuidado(IN p_id_plan INT UNSIGNED, IN p_id_cuidado INT UNSIGNED,
                                   IN p_fecha DATE, IN p_origen ENUM('telefono','reloj'))
BEGIN
  INSERT IGNORE INTO cuidado_realizado (id_plan, id_cuidado, fecha, origen)
  VALUES (p_id_plan, p_id_cuidado, p_fecha, p_origen);
END$$

CREATE PROCEDURE sp_guardar_foto(IN p_id_plan INT UNSIGNED, IN p_ruta VARCHAR(255),
                                 IN p_animo TINYINT UNSIGNED, IN p_comentario VARCHAR(500))
BEGIN
  INSERT INTO foto_progreso (id_plan, dia_plan, ruta_archivo, estado_animo, comentario)
  SELECT p_id_plan, DATEDIFF(CURDATE(), fecha_procedimiento) + 1, p_ruta, p_animo, p_comentario
    FROM plan_paciente WHERE id_plan = p_id_plan;
END$$

CREATE PROCEDURE sp_notificar_alarma(IN p_id_paciente INT UNSIGNED, IN p_id_senal SMALLINT UNSIGNED,
                                     IN p_mensaje VARCHAR(300))
BEGIN
  INSERT INTO alerta (id_paciente, id_senal, mensaje) VALUES (p_id_paciente, p_id_senal, p_mensaje);
END$$

DELIMITER ;

-- ---------------------------------------------------------------------
-- 6. VISTA PARA LA CLÍNICA
-- ---------------------------------------------------------------------
CREATE VIEW v_resumen_pacientes AS
SELECT pl.id_plan, pa.codigo_paciente, pa.nombre AS paciente, t.nombre AS tratamiento,
       pl.fecha_procedimiento,
       DATEDIFF(CURDATE(), pl.fecha_procedimiento) + 1 AS dia_actual,
       (SELECT COUNT(*) FROM alerta a WHERE a.id_paciente = pa.id_paciente AND a.atendida = FALSE) AS alertas_pendientes,
       (SELECT COUNT(*) FROM foto_progreso f WHERE f.id_plan = pl.id_plan) AS fotos
  FROM plan_paciente pl
  JOIN paciente pa   ON pa.id_paciente = pl.id_paciente
  JOIN tratamiento t ON t.id_tratamiento = pl.id_tratamiento
 WHERE pl.estado = 'activo';

-- ---------------------------------------------------------------------
-- 7. DATOS REALES DEL FAQ / APP
-- ---------------------------------------------------------------------
INSERT INTO clinica (nombre, direccion, ciudad, horario) VALUES
 ('Age Recovery', 'Av. Zaragoza entre calle 6 y 7, lado sur', 'San Luis Río Colorado, Sonora',
  'Lunes a viernes 9:00 a 19:00. Sábado 9:00 a 15:00. Domingo, previa cita.');

INSERT INTO medico (id_clinica, nombre) VALUES (1, 'Médico responsable (completar nombre)');

INSERT INTO tratamiento (nombre, duracion_sesion_min, sesiones, plan_dias) VALUES
 ('Bioestimulación facial',                         45, '3 a 4 sesiones, separadas por 3-4 semanas', 7),
 ('Ácido hialurónico de alta densidad',             50, '1 sesión, posible retoque a las 4 semanas', 14),
 ('Toxina botulínica terapéutica',                  20, '1 sesión cada 4-6 meses',                   14),
 ('Hilos tensores PDO',                             60, '1 sesión, efecto de 12-18 meses',           28),
 ('Skinbooster y mesoterapia',                      30, '3 sesiones mensuales, mantenimiento cada 6 meses', 7),
 ('Rejuvenecimiento con plasma rico en plaquetas',  50, '3 sesiones, separadas por 4 semanas',       7);

INSERT INTO etapa_plan (dia, titulo) VALUES
 (1, 'Primeras 24 horas'), (2, 'Cuidados y observación'), (3, 'Menos inflamación'),
 (4, 'Actividad habitual'), (7, 'Resultado inicial');

INSERT INTO cuidado_plan (id_tratamiento, dia_desde, dia_hasta, titulo, instruccion) VALUES
 -- 1 Bioestimulación facial
 (1,1,1,'Sin maquillaje',       'No apliques maquillaje en las primeras 12 horas.'),
 (1,1,2,'Sin calor ni esfuerzo','Evita sauna, ejercicio intenso y alcohol durante 48 horas.'),
 (1,1,7,'Protector solar',      'Evita el sol directo y usa protector solar SPF 50+.'),
 (1,1,7,'Hidratación',          'Mantén buena hidratación de la piel.'),
 -- 2 Ácido hialurónico
 (2,1,1,'Frío local',           'Aplica frío local las primeras horas si hay inflamación.'),
 (2,1,2,'No masajees',          'Evita masajear la zona tratada durante 48 horas.'),
 (2,1,7,'Evita calor extremo',  'No te expongas a sauna ni sol directo por una semana.'),
 (2,1,3,'Antiinflamatorios',    'Evita antiinflamatorios no indicados por el médico los primeros días.'),
 -- 3 Toxina botulínica
 (3,1,1,'Posición vertical',    'Permanece en posición vertical durante 4 horas tras la aplicación.'),
 (3,1,1,'No toques la zona',    'Evita tocar o masajear la zona tratada el mismo día.'),
 (3,1,1,'Sin ejercicio ni calor','No hagas ejercicio intenso ni te expongas a calor extremo por 24 horas.'),
 (3,1,1,'No boca abajo',        'Evita acostarte boca abajo el día del procedimiento.'),
 -- 4 Hilos tensores PDO
 (4,1,7,'Gestos suaves',        'Evita movimientos amplios de masticación y gestos exagerados por 1 semana.'),
 (4,1,7,'Dormir boca arriba',   'Duerme boca arriba durante los primeros días.'),
 (4,1,28,'Sin masajes ni tratamientos','No te hagas masajes faciales ni tratamientos estéticos en la zona por 3-4 semanas.'),
 (4,1,14,'Sin dentista',        'Evita procedimientos dentales no urgentes durante 2 semanas.'),
 -- 5 Skinbooster y mesoterapia
 (5,1,1,'Sin maquillaje',       'Evita el maquillaje durante las primeras 12 horas.'),
 (5,1,7,'Protector solar',      'Usa protector solar SPF 50+ a diario.'),
 (5,1,7,'Hidratación suave',    'Mantén la piel hidratada con productos suaves.'),
 (5,1,2,'Sin exfoliantes',      'Evita exfoliantes o ácidos fuertes por 48 horas.'),
 -- 6 Plasma rico en plaquetas
 (6,1,1,'Sin maquillaje',       'Evita el maquillaje durante las primeras 24 horas.'),
 (6,1,7,'Protector solar',      'Usa protector solar SPF 50+ estrictamente.'),
 (6,1,4,'Sin ácidos ni retinoides','No apliques productos con ácidos o retinoides por 3-4 días.'),
 (6,1,7,'Hidratación',          'Mantén buena hidratación oral y tópica.');

INSERT INTO senal_alarma (descripcion) VALUES
 ('Dolor intenso'),
 ('Dificultad para respirar o tragar'),
 ('Hinchazón'),
 ('Cambios de color intensos en la piel'),
 ('Fiebre'),
 ('Problemas de visión'),
 ('Otro síntoma que te preocupe');

-- Paciente de prueba para la demo: código 123456 (o correo demo@example.com)
INSERT INTO paciente (codigo_paciente, email, nombre, acepto_consentimiento)
VALUES ('123456', 'demo@example.com', 'Paciente Demo', NOW());
INSERT INTO plan_paciente (id_paciente, id_tratamiento, id_medico, fecha_procedimiento)
VALUES (1, 1, 1, CURDATE() - INTERVAL 1 DAY);     -- hoy = día 2 "Cuidados y observación"

-- ---------------------------------------------------------------------
-- 8. PRUEBAS RÁPIDAS (descomenta)
-- ---------------------------------------------------------------------
-- CALL sp_login_paciente('123456', NULL, '127.0.0.1');
-- CALL sp_login_paciente(NULL, 'demo@example.com', '127.0.0.1');
-- CALL sp_mi_plan(1);
-- CALL sp_cuidados_del_dia(1, CURDATE());
-- CALL sp_marcar_cuidado(1, 2, CURDATE(), 'reloj');   -- el cuidado 2 sí aplica al día 2
-- CALL sp_guardar_foto(1, 'fotos/demo_dia2.jpg', 4, 'Se ve mejor');
-- CALL sp_notificar_alarma(1, 5, 'Tengo fiebre');
-- SELECT * FROM v_resumen_pacientes;
