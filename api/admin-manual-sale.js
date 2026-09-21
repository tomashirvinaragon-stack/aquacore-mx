import crypto from 'node:crypto';
import { dbConfigured, upsertOrder } from './_db.js';

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

function cleanText(v,max=250){
  return String(v??'').trim().slice(0,max);
}

function saleFolio(date){
  const d=new Date(date||Date.now());
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,'0');
  const day=String(d.getDate()).padStart(2,'0');
  const rand=crypto.randomBytes(3).toString('hex').toUpperCase();
  return `MAN-${y}${m}${day}-${rand}`;
}

export default async function handler(req,res){
  res.setHeader('cache-control','no-store');
  if(req.method!=='POST') return res.status(405).json({error:'Método no permitido'});
  if(!getAdminPassword()) return res.status(503).json({error:'Panel administrativo no configurado'});
  if(!authorized(req)) return res.status(401).json({error:'Contraseña incorrecta'});
  if(!dbConfigured()) return res.status(503).json({error:'Base de datos de pedidos no configurada'});

  try{
    const body=req.body||{};
    const customer=body.customer||{};
    const lines=Array.isArray(body.lines)?body.lines:[];
    if(!cleanText(customer.name)||!lines.length){
      return res.status(400).json({error:'Captura cliente y al menos un producto'});
    }

    const cleanLines=[];
    for(const line of lines){
      const name=cleanText(line.name,180);
      const qty=Math.max(0.001,Number(line.qty)||0);
      const unitPrice=Math.max(0,Number(line.unit_price)||0);
      if(!name||!qty) continue;
      cleanLines.push({
        id:Number.isFinite(Number(line.id))?Number(line.id):null,
        name,
        code:cleanText(line.code,100)||null,
        category:cleanText(line.category,120)||'Sin categoría',
        qty,
        unit_price:Number(unitPrice.toFixed(2)),
        total:Number((qty*unitPrice).toFixed(2))
      });
    }
    if(!cleanLines.length) return res.status(400).json({error:'No hay productos válidos en la venta'});

    const subtotal=Number(cleanLines.reduce((s,x)=>s+x.total,0).toFixed(2));
    const shipping=Math.max(0,Number(body.shipping_amount)||0);
    const saleDate=body.sale_date?new Date(body.sale_date+'T12:00:00'):new Date();
    if(Number.isNaN(saleDate.getTime())) return res.status(400).json({error:'Fecha de venta no válida'});

    const folio=saleFolio(saleDate);
    const paymentMethod=cleanText(body.payment_method,80)||'manual';
    const items=[
      ...cleanLines,
      {
        _type:'manual_sale',
        source:cleanText(body.source,100)||'Venta manual',
        notes:cleanText(body.notes,500)||null,
        registered_at:new Date().toISOString()
      }
    ];

    const record={
      folio,
      mp_order_id:null,
      payment_id:null,
      customer_name:cleanText(customer.name),
      customer_email:cleanText(customer.email),
      customer_phone:cleanText(customer.phone,80),
      address:cleanText(customer.address),
      city:cleanText(customer.city,120),
      state:cleanText(customer.state,120),
      zip:cleanText(customer.zip,20),
      reference:cleanText(customer.reference,300),
      items,
      subtotal,
      shipping_amount:Number(shipping.toFixed(2)),
      shipping_status:shipping>0?'manual':'free',
      payment_status:'approved',
      payment_status_detail:'manual_sale',
      payment_method:paymentMethod,
      currency:'MXN',
      paid_at:saleDate.toISOString(),
      created_at:saleDate.toISOString(),
      updated_at:new Date().toISOString()
    };

    const rows=await upsertOrder(record);
    return res.status(200).json({ok:true,folio,order:Array.isArray(rows)?rows[0]:null,total:Number((subtotal+shipping).toFixed(2))});
  }catch(err){
    console.error('Manual sale error',err);
    return res.status(500).json({
      error:'No se pudo registrar la venta manual',
      details:String(err?.message||'Error desconocido').slice(0,500)
    });
  }
}
