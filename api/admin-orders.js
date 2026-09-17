import crypto from 'node:crypto';
import { dbConfigured, listOrders } from './_db.js';

function same(a,b){
  const ha=crypto.createHash('sha256').update(String(a||'')).digest();
  const hb=crypto.createHash('sha256').update(String(b||'')).digest();
  return crypto.timingSafeEqual(ha,hb);
}

function authorized(req){
  const expected=process.env.AQUACORE_ADMIN_PASSWORD;
  const supplied=req.headers['x-admin-password'];
  return Boolean(expected&&supplied&&same(expected,supplied));
}

function normalizeStatus(s){
  const x=String(s||'').toLowerCase();
  if(['approved','paid','processed'].includes(x)) return 'approved';
  if(['failed','canceled','cancelled','rejected'].includes(x)) return 'failed';
  if(['refunded','charged_back'].includes(x)) return x;
  if(['pending','created','action_required','in_process'].includes(x)) return 'pending';
  return x||'pending';
}

export default async function handler(req,res){
  res.setHeader('cache-control','no-store');
  if(req.method!=='GET') return res.status(405).json({error:'Método no permitido'});
  if(!process.env.AQUACORE_ADMIN_PASSWORD) return res.status(503).json({error:'Panel administrativo no configurado'});
  if(!authorized(req)) return res.status(401).json({error:'Contraseña incorrecta'});
  if(!dbConfigured()) return res.status(503).json({error:'Base de datos de pedidos no configurada'});

  try{
    const all=await listOrders(500);
    const status=String(req.query?.status||'all').toLowerCase();
    const q=String(req.query?.q||'').trim().toLowerCase();
    let orders=Array.isArray(all)?all:[];

    if(status!=='all') orders=orders.filter(o=>normalizeStatus(o.payment_status)===status);
    if(q){
      orders=orders.filter(o=>[
        o.folio,o.customer_name,o.customer_email,o.customer_phone,o.city,o.state,o.mp_order_id,o.payment_id
      ].some(v=>String(v||'').toLowerCase().includes(q)));
    }

    const approved=all.filter(o=>normalizeStatus(o.payment_status)==='approved');
    const pending=all.filter(o=>normalizeStatus(o.payment_status)==='pending');
    const failed=all.filter(o=>normalizeStatus(o.payment_status)==='failed');
    const refunded=all.filter(o=>normalizeStatus(o.payment_status)==='refunded');
    const approvedSales=approved.reduce((s,o)=>s+Number(o.subtotal||0)+Number(o.shipping_amount||0),0);

    return res.status(200).json({
      ok:true,
      stats:{
        totalOrders:all.length,
        approvedOrders:approved.length,
        pendingOrders:pending.length,
        failedOrders:failed.length,
        refundedOrders:refunded.length,
        approvedSales:Number(approvedSales.toFixed(2))
      },
      orders
    });
  }catch(err){
    console.error('Admin orders error',err);
    return res.status(500).json({error:'No se pudieron cargar los pedidos'});
  }
}
