import crypto from 'node:crypto';
import { dbConfigured, listOrders, updateOrderByFolio } from './_db.js';

function getAdminPassword(){
  return (
    process.env.AQUACORE_ADMIN_PASSWORD ||
    process.env['CONTRASEÑA_DE_ADMINISTRADOR_DE_AQUACORE'] ||
    process.env['CONTRASENA_DE_ADMINISTRADOR_DE_AQUACORE'] ||
    process.env['CONTRASEÑA_DE_ADMINISTRADOR_DE_AQUACORE_MX'] ||
    process.env['CONTRASENA_DE_ADMINISTRADOR_DE_AQUACORE_MX'] ||
    ''
  );
}

function same(a,b){
  const ha=crypto.createHash('sha256').update(String(a||'')).digest();
  const hb=crypto.createHash('sha256').update(String(b||'')).digest();
  return crypto.timingSafeEqual(ha,hb);
}

function authorized(req){
  const expected=getAdminPassword();
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

function adminState(o){
  return String(o?.admin_status||'active').toLowerCase();
}

export default async function handler(req,res){
  res.setHeader('cache-control','no-store');
  if(!getAdminPassword()) return res.status(503).json({error:'Panel administrativo no configurado'});
  if(!authorized(req)) return res.status(401).json({error:'Contraseña incorrecta'});
  if(!dbConfigured()) return res.status(503).json({error:'Base de datos de pedidos no configurada'});

  if(req.method==='POST'){
    try{
      const {folio,action}=req.body||{};
      if(!folio||!action) return res.status(400).json({error:'Acción incompleta'});
      const now=new Date().toISOString();
      let patch;

      if(action==='fulfillment'){
        const status=String(req.body?.fulfillment_status||'to_fulfill').toLowerCase();
        const allowed=['to_fulfill','preparing','shipped','delivered'];
        if(!allowed.includes(status)) return res.status(400).json({error:'Estado de entrega no válido'});
        const all=await listOrders(500);
        const current=(Array.isArray(all)?all:[]).find(o=>String(o.folio)===String(folio));
        if(!current) return res.status(404).json({error:'Pedido no encontrado'});
        const items=Array.isArray(current.items)?current.items.filter(x=>!x||x._type!=='fulfillment'):[];
        const fulfillment={
          _type:'fulfillment',
          status,
          carrier:String(req.body?.carrier||'').trim().slice(0,120),
          tracking_number:String(req.body?.tracking_number||'').trim().slice(0,180),
          updated_at:now
        };
        patch={items:[...items,fulfillment]};
      }else if(action==='cancel'){
        patch={admin_status:'canceled',canceled_at:now};
      }else if(action==='archive'){
        patch={admin_status:'archived',archived_at:now};
      }else if(action==='restore'){
        patch={admin_status:'active',archived_at:null,canceled_at:null};
      }else{
        return res.status(400).json({error:'Acción no válida'});
      }

      const rows=await updateOrderByFolio(String(folio),patch);
      if(!rows||!rows.length) return res.status(404).json({error:'Pedido no encontrado'});
      return res.status(200).json({ok:true,order:rows[0]});
    }catch(err){
      console.error('Admin order action error',err);
      return res.status(500).json({
        error:'No se pudo actualizar el pedido',
        details:String(err?.message||'Error de base de datos desconocido').slice(0,500)
      });
    }
  }

  if(req.method!=='GET') return res.status(405).json({error:'Método no permitido'});

  try{
    const all=await listOrders(500);
    const status=String(req.query?.status||'all').toLowerCase();
    const q=String(req.query?.q||'').trim().toLowerCase();
    const rows=(Array.isArray(all)?all:[]).filter(o=>{
      const status=String(o.payment_status||'').toLowerCase();
      const folio=String(o.folio||'');
      return status!=='inventory'&&status!=='shipping_profile'&&!folio.startsWith('INV-')&&!folio.startsWith('SHIP-');
    });
    const active=rows.filter(o=>adminState(o)!=='archived');
    const activeNotCanceled=active.filter(o=>adminState(o)!=='canceled');
    let orders;

    if(status==='archived'){
      orders=rows.filter(o=>adminState(o)==='archived');
    }else if(status==='canceled'){
      orders=rows.filter(o=>adminState(o)==='canceled');
    }else if(status==='all'){
      orders=active;
    }else{
      orders=activeNotCanceled.filter(o=>normalizeStatus(o.payment_status)===status);
    }

    if(q){
      orders=orders.filter(o=>[
        o.folio,o.customer_name,o.customer_email,o.customer_phone,o.city,o.state,o.mp_order_id,o.payment_id
      ].some(v=>String(v||'').toLowerCase().includes(q)));
    }

    const approved=activeNotCanceled.filter(o=>normalizeStatus(o.payment_status)==='approved');
    const pending=activeNotCanceled.filter(o=>normalizeStatus(o.payment_status)==='pending');
    const failed=activeNotCanceled.filter(o=>normalizeStatus(o.payment_status)==='failed');
    const refunded=activeNotCanceled.filter(o=>normalizeStatus(o.payment_status)==='refunded');
    const canceled=active.filter(o=>adminState(o)==='canceled');
    const archived=rows.filter(o=>adminState(o)==='archived');
    const approvedSales=approved.reduce((s,o)=>s+Number(o.subtotal||0)+Number(o.shipping_amount||0),0);

    return res.status(200).json({
      ok:true,
      stats:{
        totalOrders:active.length,
        approvedOrders:approved.length,
        pendingOrders:pending.length,
        failedOrders:failed.length,
        refundedOrders:refunded.length,
        canceledOrders:canceled.length,
        archivedOrders:archived.length,
        approvedSales:Number(approvedSales.toFixed(2))
      },
      orders
    });
  }catch(err){
    console.error('Admin orders error',err);
    return res.status(500).json({
      error:'No se pudieron cargar los pedidos',
      details:String(err?.message||'Error de base de datos desconocido').slice(0,500)
    });
  }
}
