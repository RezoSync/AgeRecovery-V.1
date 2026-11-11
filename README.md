# Age Recovery

Age Recovery es un proyecto para una clínica de medicina estética en San Luis Río Colorado, Sonora. Incluye una aplicación móvil para acompañar la recuperación postratamiento, servicios de backend, una aplicación Wear OS y un chatbot informativo en Azure.

> El contenido del chatbot es informativo y no sustituye la valoración de un profesional de la salud. Ante una emergencia, contacta a la clínica o a los servicios de emergencia.

## Componentes

- **Aplicación móvil:** Expo y React Native; permite iniciar sesión, consultar el plan y los cuidados, registrar fotos y notificar alarmas.
- **Backend principal:** Node.js, Express y MySQL; expone la API de pacientes, planes, cuidados, fotos y alarmas.
- **Aplicación Wear OS:** Kotlin y Jetpack Compose; permite consultar el plan y los cuidados desde un reloj y comunicarse con el backend.
- **Chatbot:** asistente informativo alojado en Azure App Service e integrado con Microsoft Foundry.
- **Base de datos:** [`recuperacion_app.sql`](./recuperacion_app.sql) crea la base `recuperacion_app`, tablas, procedimientos y datos de demostración.

## Estructura del repositorio

```text
EXAMEN/
├── 3-AppMovil-Expo/                  Aplicación móvil Expo/React Native
├── 4-Backend/                        API principal Express y acceso a MySQL
├── agerecovery-chatbot-foundry-main/ Chatbot Azure y cliente web
├── sos-wear-os-main/                 Aplicación Wear OS en Kotlin/Compose
├── Documentacion/                    Documentación del proyecto
├── recuperacion_app.sql              Esquema, procedimientos y datos demo
└── README.md
```

`sos-wear-os-main/backend/` contiene además un backend de demostración para la función SOS con ubicación. La aplicación de recuperación del reloj usa el backend principal de `4-Backend/`.

## Requisitos

- Node.js 20 o posterior y npm.
- MySQL 8 y MySQL Workbench.
- Expo Go compatible con la versión de Expo del proyecto.
- Android Studio, Android SDK y JDK 21.
- Emulador **Wear OS Small Round, API 34**.
- Para el chatbot alojado: acceso al servicio de Azure configurado para el proyecto.

## Instalación y ejecución

### 1. Crear la base de datos

Abre `recuperacion_app.sql` en MySQL Workbench y ejecútalo con un usuario que tenga permisos para crear bases de datos y procedimientos.

> **Atención:** el script empieza con `DROP DATABASE IF EXISTS recuperacion_app`. Si ya existe una base con ese nombre, se eliminará y se volverá a crear. Respalda primero cualquier información que necesites conservar.

### 2. Configurar y ejecutar el backend

En PowerShell, desde la raíz del repositorio:

```powershell
cd 4-Backend
if (-not (Test-Path .env)) {
    Copy-Item .env.example .env
} else {
    Write-Output ".env ya existe; se conserva sin sobrescribir."
}
```

Edita `4-Backend/.env` con los datos de tu entorno. Estos valores son ejemplos y deben reemplazarse; no uses secretos reales en documentación ni los subas al repositorio:

```dotenv
DB_HOST=localhost
DB_PORT=3306
DB_USER=age_recovery
DB_PASSWORD=CAMBIA_ESTA_CONTRASENA
DB_NAME=recuperacion_app
JWT_SECRET=REEMPLAZA_POR_UN_SECRETO_ALEATORIO_DE_32_CARACTERES
ADMIN_KEY=REEMPLAZA_POR_UNA_CLAVE_ALEATORIA_DE_16_CARACTERES
SMTP_USER=tu_correo@gmail.com
SMTP_PASS=tu_contrasena_de_aplicacion
MAIL_COPY_TO=opcional@example.com
PORT=3000
CORS_ORIGIN=http://localhost:8081
```

`JWT_SECRET` debe tener al menos 32 caracteres y `ADMIN_KEY` al menos 16. Para enviar códigos de acceso por correo, configura `SMTP_USER` y una contraseña de aplicación válida en `SMTP_PASS`. `MAIL_COPY_TO` es opcional. Ajusta `CORS_ORIGIN` a los orígenes que realmente utilices.

Instala dependencias e inicia el servicio:

```powershell
npm install
npm start
```

El backend escucha en el puerto `3000`. Puedes comprobarlo en `http://localhost:3000/api/salud`.

### 3. Ejecutar la aplicación móvil

La app debe alcanzar el backend desde el dispositivo. En el PC que lo ejecuta, usa `ipconfig` para encontrar la IPv4 de la interfaz de la red local. En `3-AppMovil-Expo/src/config.ts`, cambia `API_BASE_URL` a:

```text
http://IP_LOCAL_DE_TU_PC:3000
```

Por ejemplo, usa `http://192.168.1.20:3000` solo si esa es la IPv4 actual del PC. El teléfono y el PC deben estar en la misma red; permite el puerto `3000` en el firewall de Windows.

Desde la raíz del repositorio:

```powershell
cd 3-AppMovil-Expo
npm install
npx expo start -c
```

Abre el proyecto con Expo Go en el teléfono.

### 4. Ejecutar la aplicación del reloj

1. Abre `sos-wear-os-main/` en Android Studio y espera a que termine la sincronización de Gradle.
2. En la configuración de Gradle, selecciona **JDK 21**.
3. Inicia el emulador **Wear OS Small Round, API 34** y ejecuta la configuración `app`.
4. Con el backend principal iniciado, activa el Wi-Fi del emulador desde PowerShell:

   ```powershell
   adb -s emulator-5554 shell svc wifi enable
   ```

El emulador accede al PC anfitrión mediante `http://10.0.2.2:3000`; la configuración de la app del reloj ya usa esa dirección. Si ADB muestra otro serial, reemplaza `emulator-5554`.

### 5. Chatbot en Azure

La app móvil se conecta al chatbot alojado mediante `CHATBOT_URL` en `3-AppMovil-Expo/src/config.ts`. El proyecto del chatbot está en `agerecovery-chatbot-foundry-main/` y utiliza Microsoft Foundry. Para ejecutar o desplegar una instancia propia se requieren recursos y configuración de Azure; consulta su README antes de configurar credenciales o variables de entorno.

## Inicio de sesión

- **Paciente demo:** usa el código `123456`, insertado por `recuperacion_app.sql`.
- **Cuenta nueva:** registra nombre y correo desde la app. El backend envía un código de seis dígitos al correo; para recibirlo deben estar configurados el servidor SMTP de Gmail y su contraseña de aplicación.

## Endpoints principales

Las rutas de paciente, salvo el registro y el inicio de sesión, requieren autenticación según la API.

| Método | Endpoint | Uso |
|---|---|---|
| `POST` | `/api/registro` | Registrar paciente y solicitar el código por correo |
| `POST` | `/api/login` | Iniciar sesión con código |
| `GET` | `/api/plan` | Consultar el plan del paciente |
| `GET` | `/api/cuidados/hoy` | Consultar los cuidados de hoy |
| `POST` | `/api/cuidados/:id/marcar` | Marcar un cuidado como realizado |
| `GET`, `POST` | `/api/fotos` | Listar y guardar fotos de seguimiento |
| `GET` | `/api/fotos/:id` | Descargar una foto del paciente |
| `POST` | `/api/alarmas` | Notificar una alarma a la clínica |

## Solución de problemas

- **Timeout o “Sin conexión”:** comprueba que el backend siga activo y responde en `http://localhost:3000/api/salud`. Confirma que el teléfono y el PC estén en la misma red y que el firewall permita conexiones entrantes al puerto `3000`.
- **La IP del PC cambió:** vuelve a ejecutar `ipconfig` y actualiza `API_BASE_URL` en `3-AppMovil-Expo/src/config.ts`; después reinicia Expo con `npx expo start -c`. Para el emulador Android del reloj, usa `10.0.2.2` en lugar de la IP local.
- **No llega el correo de registro:** revisa `SMTP_USER` y `SMTP_PASS` en el `.env` local del backend. Gmail requiere una contraseña de aplicación, no la contraseña habitual de la cuenta. Revisa también la carpeta de spam y los registros del backend.
- **El reloj no conecta:** confirma que el backend está en el puerto `3000`, que el emulador tiene Wi-Fi habilitado y que su configuración de red permite alcanzar `10.0.2.2`.
- **Gradle no compila:** configura JDK 21 en Android Studio y sincroniza de nuevo el proyecto.

## Secretos y archivos locales

Los archivos `.env` y `.env.*` no se suben al repositorio. Usa los archivos `.env.example` como plantillas y guarda credenciales, contraseñas y claves únicamente en archivos locales ignorados por Git. **No agregues ni publiques `.env`**, ni incluyas valores reales de `JWT_SECRET`, `ADMIN_KEY` o credenciales de correo.
