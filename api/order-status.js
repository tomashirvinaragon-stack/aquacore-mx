import crypto from 'node:crypto';
import {dbConfigured,getOrderByFolio} from './_db.js';
import {customerOrder} from './_order-view.js';

export default async function handler(req,res){
  res.setHeader('cache-control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Método no permitido'});
  if(!dbConfigured())return res.status(503).json({error:'Seguimiento temporalmente no disponible'});
  const folio=String(req.body?.folio||'').trim();
  const email=String(req.body?.email||'').trim().toLowerCase();
  if(!/^ACMX-[A-Z0-9-]{8,60}$/i.test(folio)||!/^\S+@\S+\.\S+$/.test(email)||email.length>254){
    return res.status(400).json({error:'Captura un folio válido y el correo usado en la compra'});
  }
  try{
    const order=await getOrderByFolio(folio);
    const expected=crypto.createHash('sha256').update(String(order?.customer_email||'').trim().toLowerCase()).digest();
    const supplied=crypto.createHash('sha256').update(email).digest();
    if(!order||!crypto.timingSafeEqual(expected,supplied)||['inventory','shipping_profile'].includes(order.payment_status)){
      return res.status(404).json({error:'No encontramos un pedido con esos datos'});
    }
    return res.status(200).json({ok:true,order:customerOrder(order)});
  }catch{
    console.error('Customer order lookup failed');
    return res.status(503).json({error:'No pudimos consultar el pedido. Intenta nuevamente.'});
  }
}
