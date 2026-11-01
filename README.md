# Ohm Lab ⚡

Web-juego para practicar la **Ley de Ohm (V = I · R)** en **Tecnologia i Digitalització, 3.º ESO** (Cataluña, Decret 175/2022). Estilo de mundo de bloques pixelados, en **castellano y catalán**.

👉 **Juega:** https://jpamies.com/ohm-lab/ (también https://jpamies.github.io/ohm-lab/, que redirige)
👉 **Verificar un diploma:** https://jpamies.com/ohm-lab/verificar.html

Diseño didáctico: Jordi Pàmies · Desarrollado con asistencia de IA (Claude, Anthropic) · 2026.

## Qué hace

| Nivel | Nombre | Qué practica |
|---|---|---|
| 1 · Explorar | **El agua y la corriente** | Deslizadores de tensión (1–12 V) y resistencia (1–100 Ω), circuito animado y su analogía hidráulica (depósito, tubería estrecha, caudal). Tres retos: conseguir 0,5 A, reducir la corriente a la mitad sin tocar la tensión, y una pregunta de opción múltiple. |
| 2 · Aplicar | **¡Salva el LED!** | 5 rondas: pila de 5, 9 o 12 V y un LED (20 mA, 2 V). Hay que elegir la resistencia E12 **más pequeña** que lo protege. Si se quema, chispa y pista; si es demasiado grande, aviso de que se ve flojo. |
| 3 · Consolidar | **Contrarreloj** | 60 s de preguntas aleatorias (falta V, I o R), con conversiones de mA y kΩ, tolerancia ±2 %, racha, de 1 a 3 estrellas y repaso de fallos con la solución. |

Recompensas: un **badge PNG** por nivel (Explorador/a de la corriente, Salvador/a de LEDs, Maestro/a de Ohm) y un **diploma PDF** (A4 horizontal) con resultados, código de verificación y QR.

Siempre visibles: botón **Ayuda** con el triángulo de Ohm, indicador de progreso y cambio de idioma.

## Privacidad (alumnado menor de edad)

- Sin backend, sin cookies, sin analítica, sin CDNs: todo (incluidas las fuentes y librerías) se sirve desde este repositorio.
- Solo se pide nombre y primer apellido, grupo y, opcionalmente, centro. Se guarda **únicamente en el dispositivo** (`localStorage`, clave `ohmlab:v1`). Botón «Borrar mis datos».
- Si el navegador bloquea `localStorage` (algunos modos incógnito), la app funciona en memoria y avisa.
- Los datos del QR van en el **fragmento** (`#d=…`) de la URL, que el navegador nunca envía al servidor.
- Las páginas llevan una Content-Security-Policy con `connect-src 'none'`: la web no puede hacer peticiones de red.

## Publicar en GitHub Pages

El workflow `.github/workflows/pages.yml` ejecuta los tests en cada push a `main` y, si pasan, publica el sitio.

1. En el repositorio: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Haz un push a `main` (o ve a **Actions → Tests y despliegue en GitHub Pages → Run workflow**).
3. Cuando acabe, la web estará en `https://jpamies.com/ohm-lab/` (el dominio propio de la cuenta; `jpamies.github.io/ohm-lab/` redirige allí).

Si los tests fallan, no se despliega.

## Para el profesor

- **Cambia la clave de firma** en [`js/config.js`](js/config.js) (`CLAVE_SECRETA`) al empezar cada curso. Los diplomas firmados con la clave anterior dejarán de verificarse.
- Idioma por defecto: `IDIOMA_POR_DEFECTO` en el mismo fichero (`'es'` o `'ca'`).
- Para verificar un diploma, escanea el QR con el móvil o abre `verificar.html` y pega el enlace o escribe los datos y el código.

### Cómo se firma el diploma

1. Cadena canónica (campos recortados y en mayúsculas):
   `v1|NOMBRE|GRUPO|CENTRO|fechaISO|n1:pts|n2:pts|n3:pts`
2. `SHA-256(CLAVE_SECRETA + "|" + cadena)` con la Web Crypto API.
3. Los 12 primeros caracteres en base32 (alfabeto sin I, O, 0 ni 1), agrupados: `OHM-XXXX-XXXX-XXXX`.

`verificar.html` recalcula la firma y muestra «✅ Diploma válido» o «❌ No coincide».

## Limitaciones de seguridad

Seamos honestos: **esto no es una firma criptográfica fuerte**. Como no hay servidor, la clave está en `js/config.js`, que se descarga con la web (y el repositorio es público). Un alumno con conocimientos podría leerla y fabricar un diploma «válido».

Es una medida **disuasoria**, adecuada para ESO: evita retocar el PDF a mano y permite al profesor comprobar rápido los datos. Además, se puede saber si un diploma se ha hecho con la clave del curso actual.

Mejora futura: firmar en una función serverless (Cloudflare Workers, Netlify Functions…) con una **clave privada** (por ejemplo, Ed25519) y verificar en el navegador con la **clave pública**. Así nadie podría falsificarlo sin acceso al servidor.

Otra limitación: el PDF usa las fuentes estándar de PDF (Latin-1). Los nombres con letras fuera de ese juego se simplifican (por ejemplo, «ł» → «l»).

## Estructura

```
index.html           juego (una sola página)
verificar.html       verificación de diplomas
css/style.css        estilo de bloques pixelados
js/app.js            interfaz y pantallas
js/levels.js         datos y lógica de los niveles (sin DOM)
js/physics.js        fórmulas y utilidades numéricas (sin DOM)
js/storage.js        localStorage con alternativa en memoria
js/certificate.js    firma, QR, diploma PDF y badges
js/i18n.js           todos los textos (es / ca)
js/config.js         clave de firma e idioma por defecto
js/verify.js         lógica de verificar.html
vendor/              jsPDF, qrcode-generator y fuentes (con sus licencias)
tests/               tests con node --test (sin dependencias)
```

## Desarrollo

No hay paso de compilación. Para probar en local:

```bash
python3 -m http.server 8000   # y abre http://localhost:8000
node --test tests/*.test.js   # tests (Node 20 o superior)
```

(La firma usa `crypto.subtle`, que solo funciona en `https://` o en `localhost`.)

## Licencia

Contenido: **CC BY 4.0**. Código: **MIT**. Ver [LICENSE](LICENSE).
