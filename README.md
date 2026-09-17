# AquaCore MX

Versión 3 preparada para publicación y checkout con Mercado Pago.

## Vista local
- Abre `index.html` para revisar diseño y carrito.
- El cobro con Mercado Pago funciona cuando el sitio está desplegado con el backend `/api` y la variable `MERCADOPAGO_ACCESS_TOKEN` configurada.

## Archivos clave
- `index.html`, `styles.css`, `app.js`: tienda.
- `data/products.json`: catálogo de 91 productos usado por el backend.
- `api/create-order.js`: crea la orden de Mercado Pago y valida precios.
- `api/order-status.js`: consulta el estado de una orden.
- `success.html`, `pending.html`, `failure.html`: retornos del pago.
- `DEPLOY.md`: guía para publicar.
- `.env.example`: ejemplo de variable de entorno.
