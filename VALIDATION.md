# Validación privada de AquaCore MX — 1 de octubre de 2026

Cambios preparados para una vista previa protegida de Vercel a partir de `main` (`62e8273`). No se actualiza producción ni la configuración de Mercado Pago, Supabase o Equipesca.

- Los 128 IDs y precios se compararon con el catálogo original y permanecen iguales.
- Splash cuadrados 26 y 27: fotografía completa del fabricante, descargada y decodificada; $9,604.84 MXN por modelo.
- Existencias conocidas: 3+ Disponible; 1–2 Últimas piezas — disponibilidad sujeta a confirmación; 0 Agotado. Existencia desconocida: Consultar disponibilidad.
- Catálogo y ficha de producto comparten las reglas de imagen, disponibilidad y carrito. El carrito conserva cantidades entre ambas páginas.
- El backend agrega líneas repetidas, valida cantidades y existencias, calcula el total desde el catálogo y guarda el pedido antes de crear el checkout.
- Compras menores de $5,000 se registran para cotizar envío sin generar cobro. El pago en línea conserva el envío gratis desde $5,000.
- Mis pedidos consulta por folio y correo. El panel administra preparación, envío, tránsito, entrega, incidencias, paquetería, guía y enlace HTTPS de rastreo.
- El retorno de pago consulta el estado registrado; la URL de retorno por sí sola no confirma el pago ni vacía el carrito.
- Consultar inventario no inicia sincronizaciones ni escribe datos. Meta Pixel no se ejecuta en las vistas previas.

## Evidencia local

`npm test`: 8 pruebas aprobadas. Recorridos de interfaz con DOM: catálogo y dos imágenes Splash, disponibilidad, agregar/cambiar/eliminar del carrito, formulario de checkout, ficha individual, continuidad del carrito, consulta y representación del rastreo, retorno pendiente y aprobado.

Se usan respuestas simuladas para las escrituras de pedidos y Mercado Pago. No se generaron cargos, guías ni registros de prueba en servicios externos. El cobro real y la recepción de webhooks en la vista previa protegida requieren una comprobación autorizada aparte; no se presentan como validados aquí.

Fotografía Splash: https://www.flojett.com/uploads/image/20250408/water-cooling-splash-aerator-fj-wc-series-cost.webp
