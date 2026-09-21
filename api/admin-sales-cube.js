import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { dbConfigured, listOrdersAll } from './_db.js';

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

function loadProducts(){
  const file=path.join(process.cwd(),'data','products.json');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}

function norm(v=''){
  return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
}

function paymentState(s=''){
  const x=norm(s);
  if(['approved','paid','processed'].includes(x)) return 'approved';
  if(['failed','canceled','cancelled','rejected'].includes(x)) return 'failed';
  if(['refunded','charged_back'].includes(x)) return x;
  return 'pending';
}

function customerKey(o){
  const email=norm(o.customer_email);
  if(email) return 'e:'+email;
  const phone=String(o.customer_phone||'').replace(/\D/g,'');
  if(phone) return 'p:'+phone;
  return 'n:'+norm(o.customer_name)+'|'+norm(o.city)+'|'+norm(o.state);
}

function productLines(o,productMap){
  return (Array.isArray(o.items)?o.items:[])
    .filter(x=>x&&!x._type&&Number.isFinite(Number(x.id)))
    .map(x=>{
      const meta=productMap.get(Number(x.id))||{};
      const qty=Math.max(0,Number(x.qty)||0);
      const unit=Number(x.unit_price)||0;
      const total=Number.isFinite(Number(x.total))?Number(x.total):qty*unit;
      return {
        id:Number(x.id),
        product:String(x.name||meta.name||'Producto'),
        code:String(x.code||meta.code||''),
        category:String(meta.cat||'Sin categoría'),
        qty,
        unit_price:Number(unit.toFixed(2)),
        line_total:Number(total.toFixed(2))
      };
    });
}

function matchText(value,filter){
  if(!filter) return true;
  return norm(value).includes(norm(filter));
}

export default async function handler(req,res){
  res.setHeader('cache-control','no-store');
  if(req.method!=='GET') return res.status(405).json({error:'Método no permitido'});
  if(!getAdminPassword()) return res.status(503).json({error:'Panel administrativo no configurado'});
  if(!authorized(req)) return res.status(401).json({error:'Contraseña incorrecta'});
  if(!dbConfigured()) return res.status(503).json({error:'Base de datos de pedidos no configurada'});

  try{
    const from=String(req.query?.from||'').trim()||null;
    const to=String(req.query?.to||'').trim()||null;
    const payment=String(req.query?.payment||'approved').trim().toLowerCase();
    const state=String(req.query?.state||'').trim();
    const city=String(req.query?.city||'').trim();
    const customer=String(req.query?.customer||'').trim();
    const category=String(req.query?.category||'').trim();
    const product=String(req.query?.product||'').trim();

    const productMap=new Map(loadProducts().map(p=>[Number(p.id),p]));
    const all=await listOrdersAll({from,to,max:50000});

    const periodOrders=(Array.isArray(all)?all:[]).filter(o=>
      String(o.payment_status||'').toLowerCase()!=='inventory' &&
      !String(o.folio||'').startsWith('INV-') &&
      String(o.admin_status||'active').toLowerCase()!=='canceled' &&
      (payment==='all' || paymentState(o.payment_status)===payment)
    );

    const facets={
      states:[...new Set(periodOrders.map(o=>String(o.state||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es')),
      cities:[...new Set(periodOrders.map(o=>String(o.city||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es')),
      categories:[...new Set(periodOrders.flatMap(o=>productLines(o,productMap).map(x=>x.category)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'))
    };

    const filtered=[];
    for(const o of periodOrders){
      if(state && !matchText(o.state,state)) continue;
      if(city && !matchText(o.city,city)) continue;
      if(customer && ![
        o.customer_name,o.customer_email,o.customer_phone
      ].some(v=>matchText(v,customer))) continue;

      const lines=productLines(o,productMap);
      const kept=lines.filter(x=>
        (!category || matchText(x.category,category)) &&
        (!product || [x.product,x.code].some(v=>matchText(v,product)))
      );
      if((category||product) && !kept.length) continue;
      filtered.push({order:o,lines:(category||product)?kept:lines});
    }

    const details=[];
    const customers=new Map();
    let units=0;
    let sales=0;

    for(const {order:o,lines} of filtered){
      const orderTotal=Number(o.subtotal||0)+Number(o.shipping_amount||0);
      const filteredTotal=(category||product)
        ? lines.reduce((s,x)=>s+Number(x.line_total||0),0)
        : orderTotal;
      sales+=filteredTotal;
      units+=lines.reduce((s,x)=>s+x.qty,0);

      const key=customerKey(o);
      if(!customers.has(key)){
        customers.set(key,{
          key,
          name:o.customer_name||'Sin nombre',
          email:o.customer_email||'',
          phone:o.customer_phone||'',
          city:o.city||'',
          state:o.state||'',
          first_purchase:o.created_at||null,
          last_purchase:o.created_at||null,
          orders_count:0,
          items_bought:0,
          total_spent:0,
          products:new Set()
        });
      }
      const c=customers.get(key);
      c.orders_count+=1;
      c.items_bought+=lines.reduce((s,x)=>s+x.qty,0);
      c.total_spent+=filteredTotal;
      if(o.created_at && (!c.first_purchase || Date.parse(o.created_at)<Date.parse(c.first_purchase))) c.first_purchase=o.created_at;
      if(o.created_at && (!c.last_purchase || Date.parse(o.created_at)>Date.parse(c.last_purchase))) c.last_purchase=o.created_at;
      for(const x of lines) c.products.add(x.product);

      for(const x of lines){
        details.push({
          folio:o.folio,
          date:o.created_at,
          paid_at:o.paid_at||null,
          customer_name:o.customer_name||'',
          customer_email:o.customer_email||'',
          customer_phone:o.customer_phone||'',
          city:o.city||'',
          state:o.state||'',
          zip:o.zip||'',
          category:x.category,
          product:x.product,
          code:x.code,
          quantity:x.qty,
          unit_price:x.unit_price,
          line_total:x.line_total,
          order_total:Number(orderTotal.toFixed(2)),
          payment_status:paymentState(o.payment_status)
        });
      }
    }

    const customerRows=[...customers.values()].map(c=>({
      ...c,
      total_spent:Number(c.total_spent.toFixed(2)),
      products:[...c.products].sort((a,b)=>a.localeCompare(b,'es'))
    })).sort((a,b)=>b.total_spent-a.total_spent);

    details.sort((a,b)=>Date.parse(b.date||0)-Date.parse(a.date||0));

    return res.status(200).json({
      ok:true,
      filters:{from,to,payment,state,city,customer,category,product},
      facets,
      stats:{
        sales:Number(sales.toFixed(2)),
        orders:filtered.length,
        customers:customerRows.length,
        units:Number(units.toFixed(3)),
        average_ticket:filtered.length?Number((sales/filtered.length).toFixed(2)):0
      },
      customers:customerRows,
      details
    });
  }catch(err){
    console.error('Sales cube error',err);
    return res.status(500).json({
      error:'No se pudo generar el cubo de ventas',
      details:String(err?.message||'Error desconocido').slice(0,500)
    });
  }
}
