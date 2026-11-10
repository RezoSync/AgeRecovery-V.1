# Backend de seguimiento de tratamientos

API Node.js + Express conectada a MySQL. Las operaciones de negocio usan exclusivamente `CALL` parametrizados a los procedimientos existentes. Las fotos se guardan en `uploads/`, que no se sirve como contenido estático.

## Requisitos

- Node.js 20 o posterior.
- MySQL 8 y la base de datos/procedimientos de `recuperacion_app.sql`.

## Configuración y arranque

1. Ejecuta `recuperacion_app.sql` en MySQL Workbench para crear la base de datos, los procedimientos y el paciente demo.
2. En esta carpeta, instala dependencias:

   ```powershell
   npm install
   ```

3. Edita `.env` y completa:
   - `DB_HOST`: host MySQL accesible desde la computadora que ejecuta el backend.
   - `DB_USER`: usuario MySQL que pueda ejecutar los procedimientos.
   - `DB_PASSWORD`: contraseña de ese usuario (puede quedar vacía si MySQL no usa contraseña).
   - `DB_NAME`: `recuperacion_app`, salvo que hayas usado otro nombre.
   - `JWT_SECRET`: secreto aleatorio propio de al menos 32 caracteres.
   - `ADMIN_KEY`: clave administrativa aleatoria de al menos 16 caracteres.
   - `SMTP_USER` y `SMTP_PASS`: usuario Gmail y contraseña de aplicación para habilitar el envío del código por correo. Si faltan o SMTP falla, el paciente se crea y la respuesta indica `correo_enviado: false`.
   - `MAIL_COPY_TO`: correo opcional que recibe una copia oculta de los mensajes enviados.
   - `PORT`: puerto del servidor, por ejemplo `3000`.
   - `CORS_ORIGIN`: origen(es) permitidos, separados por comas si son varios. Usa `*` solo si realmente necesitas permitir cualquier origen.
4. Inicia el servicio:

   ```powershell
   npm start
   ```

El servidor escucha en `0.0.0.0` y muestra el puerto al arrancar. Para acceder desde el celular, usa en la app la dirección IP local de la computadora, por ejemplo `http://192.168.1.20:3000`. Permite ese puerto en el firewall de Windows y configura `CORS_ORIGIN` con el origen de la app si el cliente envía encabezado `Origin`.

## Ejemplos PowerShell

Los ejemplos usan `curl.exe` (no el alias `curl` de algunas versiones de PowerShell). Ejecuta primero:

```powershell
$base = "http://localhost:3000"
```

### Salud

```powershell
curl.exe "$base/api/salud"
```

### Login por código

```powershell
$login = curl.exe -sS -X POST "$base/api/login" -H "Content-Type: application/json" --data-raw '{"codigo":"123456"}' | ConvertFrom-Json
$token = $login.token
```

También se puede usar correo en lugar del código:

```powershell
curl.exe -X POST "$base/api/login" -H "Content-Type: application/json" --data-raw '{"correo":"demo@example.com"}'
```

### Registro público

La ruta no requiere `x-admin-key`. Acepta el mismo `nombre` y `correo` que el alta administrativa, limita a 5 solicitudes por hora por IP y nunca devuelve el código. Si el correo ya pertenece a un paciente activo, reenvía el código existente; si no, crea el paciente y su plan demo. El envío del correo debe estar configurado; si falla, la ruta responde con `502` y se puede reintentar para reenviar el código.

```powershell
curl.exe -X POST "$base/api/registro" `
  -H "Content-Type: application/json" `
  --data-raw '{"nombre":"Paciente Demo","correo":"paciente@example.com"}'
```

### Crear paciente y plan demo (administración)

La ruta requiere el header `x-admin-key` con el valor configurado en `ADMIN_KEY`. Genera un código de seis dígitos, crea el paciente y le asigna el tratamiento demo. El código solo se incluye en esta respuesta administrativa y, si SMTP está habilitado, se envía al correo indicado.

```powershell
curl.exe -X POST "$base/api/admin/pacientes" `
  -H "x-admin-key: $env:ADMIN_KEY" `
  -H "Content-Type: application/json" `
  --data-raw '{"nombre":"Paciente Demo","correo":"paciente@example.com"}'
```

### Plan del paciente

```powershell
curl.exe "$base/api/plan" -H "Authorization: Bearer $token"
```

### Cuidados de hoy

```powershell
curl.exe "$base/api/cuidados/hoy" -H "Authorization: Bearer $token"
```

### Marcar un cuidado

Usa el `id_cuidado` que aparece en cuidados de hoy:

```powershell
curl.exe -X POST "$base/api/cuidados/2/marcar" -H "Authorization: Bearer $token"
```

### Guardar una foto

`nota` y `animo` son opcionales; `animo` debe ser entero de 1 a 5 y, si falta, se guarda `3`.

```powershell
curl.exe -X POST "$base/api/fotos" -H "Authorization: Bearer $token" -F "foto=@C:\ruta\foto.jpg;type=image/jpeg" -F "nota=Seguimiento de hoy" -F "animo=4"
```

### Listar fotos

```powershell
curl.exe "$base/api/fotos" -H "Authorization: Bearer $token"
```

### Obtener una foto

Usa el `id` devuelto al guardar o al listar:

```powershell
curl.exe "$base/api/fotos/ID_DE_FOTO" -H "Authorization: Bearer $token" --output foto-descargada.jpg
```

### Notificar una alarma

```powershell
curl.exe -X POST "$base/api/alarmas" -H "Authorization: Bearer $token" -H "Content-Type: application/json" --data-raw '{"sintoma":"Hinchazón que me preocupa"}'
```

### Ejemplos de errores

Código incorrecto (además, `sp_login_paciente` aplica su bloqueo de 60 segundos tras cinco fallos):

```powershell
curl.exe -i -X POST "$base/api/login" -H "Content-Type: application/json" --data-raw '{"codigo":"000000"}'
```

Token inválido:

```powershell
curl.exe -i "$base/api/plan" -H "Authorization: Bearer token-invalido"
```

Tipo de archivo no permitido (la API también valida la firma del contenido):

```powershell
curl.exe -i -X POST "$base/api/fotos" -H "Authorization: Bearer $token" -F "foto=@C:\ruta\archivo.txt;type=text/plain"
```

## Seguridad y almacenamiento de fotos

- El token firmado con HS256 vence a las 8 horas. El ID de paciente se toma únicamente del token.
- `helmet`, CORS configurable, límite general de solicitudes, límite más estricto de login y cuerpos de hasta 32 KB.
- Se aceptan solo JPEG/PNG verificados por firma y hasta 5 MB. Se asigna un nombre UUID aleatorio y no hay ruta estática pública.
- Cada foto válida se registra con `sp_guardar_foto`; el índice `fotos-index.json` es un complemento local para listar/servirlas y se escribe mediante archivo temporal y renombrado serializado. Si falta o está dañado, inicia vacío.
- `sp_guardar_foto` requiere ánimo: si no se envía, la API usa `3` como valor neutral, pendiente de confirmación clínica (`TODO_MEDICO`).
