# AquaCore MX

Tienda AquaCore MX con catálogo, carrito, pedidos y seguimiento. Las correcciones de octubre se preparan en una vista previa protegida de Vercel.

## Vista local
- Sirve el proyecto por HTTP para revisar diseño, módulos y carrito; las APIs requieren Node/Vercel.
- El cobro con Mercado Pago funciona cuando el sitio está desplegado con el backend `/api` y la variable `MERCADOPAGO_ACCESS_TOKEN` configurada.

## Archivos clave
- `index.html`, `styles.css`, `app.js`: tienda.
- `data/products.json`: catálogo de 128 productos usado por el backend.
- `api/create-order.js`: crea la orden de Mercado Pago y valida precios.
- `api/order-status.js`: consulta el estado de una orden.
- `success.html`, `pending.html`, `failure.html`: retornos del pago.
- `DEPLOY.md`: guía para publicar.
- `.env.example`: ejemplo de variable de entorno.

## Validación

- Ejecuta `npm test` para validar precios, existencias, registro de pedidos y rastreo con servicios simulados.
- Consulta `VALIDATION.md` para ver el alcance comprobado y los límites de la prueba.
- `tracking.html` y `api/order-status.js`: seguimiento por folio y correo.
- La foto Splash se sirve localmente desde `assets/products/splash-cuadrado-validado.webp`.
