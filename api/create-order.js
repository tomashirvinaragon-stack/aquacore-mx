import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {dbConfigured,upsertOrder,updateOrderByFolio,getOrderByFolio,getInventoryByIds} from './_db.js';

const FREE_SHIPPING=5000;
const loadProducts=()=>JSON.parse(fs.readFileSync(path.join(process.cwd(),'data','products.json'),'utf8'));
const cleanText=(value,max=250)=>String(value||'').trim().slice(0,max);

export default async function handler(req,res){
  res.setHeader('cache-control','no-store');
  const accessToken=process.env.MERCADOPAGO_ACCESS_TOKEN;
  if(req.method==='GET'){
    try{return res.status(200).json({ok:true,paymentsConfigured:Boolean(accessToken),catalogLoaded:true,productCount:loadProducts().length,ordersDatabaseConfigured:dbConfigured()})}
    catch{return res.status(500).json({ok:false,catalogLoaded:false})}
  }
  if(req.method!=='POST')return res.status(405).json({error:'Método no permitido'});
  try{
    const {orderId,customer={},lines}=req.body||{};
    if(!/^ACMX-[A-Z0-9-]{8,60}$/i.test(String(orderId||''))||!Array.isArray(lines)||!lines.length||lines.length>128){
      return res.status(400).json({error:'Pedido incompleto'});
    }
    const d=Object.fromEntries(['name','email','phone','address','city','state','zip','reference'].map(k=>[k,cleanText(customer[k])]));
    d.email=d.email.toLowerCase();
    if(!['name','phone','address','city','state'].every(k=>d[k])||!/^\S+@\S+\.\S+$/.test(d.email)||!/^\d{5}$/.test(d.zip)){
      return res.status(400).json({error:'Revisa los datos de entrega, correo y código postal'});
    }
    const invoiceRequired=customer.invoice_required==='yes'||customer.invoice_required===true;
    const invoice=invoiceRequired?{
      _type:'invoice',required:true,rfc:cleanText(customer.invoice_rfc,13).toUpperCase(),
      name:cleanText(customer.invoice_name),tax_regime:cleanText(customer.invoice_tax_regime),
      cfdi_use:cleanText(customer.invoice_cfdi_use),zip:cleanText(customer.invoice_zip,5)
    }:null;
    if(invoice&&(!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(invoice.rfc)||!invoice.name||!invoice.tax_regime||!invoice.cfdi_use||!/^\d{5}$/.test(invoice.zip))){
      return res.status(400).json({error:'Revisa los datos de facturación'});
    }
    const byId=new Map(loadProducts().map(p=>[Number(p.id),p]));
    const quantities=new Map();
    for(const line of lines){
      const id=Number(line.id),qty=Number(line.qty);
      if(!Number.isSafeInteger(id)||!byId.has(id)||!Number.isSafeInteger(qty)||qty<1||qty>99){
        return res.status(400).json({error:'Producto o cantidad no válidos'});
      }
      const total=(quantities.get(id)||0)+qty;
      if(total>99)return res.status(400).json({error:'Cantidad fuera de límite'});
      quantities.set(id,total);
    }
    const clean=[...quantities].sort((a,b)=>a[0]-b[0]).map(([id,qty])=>({p:byId.get(id),qty}));
    const subtotal=Number(clean.reduce((s,x)=>s+Number(x.p.price)*x.qty,0).toFixed(2));
    if(!dbConfigured())return res.status(503).json({error:'Pedidos temporalmente no disponibles',code:'ORDERS_NOT_CONFIGURED'});
    const fingerprint=createHash('sha256').update(JSON.stringify({d,invoice,lines:clean.map(x=>[x.p.id,x.qty]),subtotal})).digest('hex');
    const existing=await getOrderByFolio(orderId);
    if(existing){
      const checkout=(existing.items||[]).find(x=>x?._type==='checkout');
      if(checkout?.fingerprint!==fingerprint)return res.status(409).json({error:'El folio ya corresponde a otro pedido'});
      if(checkout.url)return res.status(200).json({checkoutUrl:checkout.url,externalReference:orderId,subtotal});
      if(existing.shipping_status==='quote_pending')return res.status(200).json({shippingRequired:true,externalReference:orderId,subtotal});
      return res.status(409).json({error:'Este pedido ya está registrado. Consulta su estatus.',code:'ORDER_EXISTS'});
    }
    let inventory;
    try{inventory=await getInventoryByIds(clean.map(x=>x.p.id))}
    catch{return res.status(503).json({error:'No se pudo confirmar la existencia',code:'STOCK_VALIDATION_UNAVAILABLE'})}
    const byInventory=new Map(inventory.map(x=>[Number(x.product_id),x]));
    for(const {p,qty} of clean){
      const inv=byInventory.get(Number(p.id));
      if(!inv?.managed)return res.status(409).json({error:`Confirma la existencia de ${p.name} antes de comprar.`,code:'CONFIRM_AVAILABILITY',productId:p.id});
      const available=Number(inv.stock||0);
      if(available<qty)return res.status(409).json({error:`No hay suficiente existencia de ${p.name}.`,code:'OUT_OF_STOCK',productId:p.id,available,requested:qty});
      if(available<=2)return res.status(409).json({error:`Quedan últimas piezas de ${p.name}. Confirma disponibilidad antes del pago.`,code:'CONFIRM_AVAILABILITY',productId:p.id,available});
    }
    if(subtotal>=FREE_SHIPPING&&!accessToken)return res.status(503).json({error:'Pago en línea aún no activado',code:'PAYMENTS_NOT_CONFIGURED'});
    const itemRecords=clean.map(({p,qty})=>({id:Number(p.id),name:p.name,code:p.code||null,qty,unit_price:Number(p.price),total:Number((Number(p.price)*qty).toFixed(2))}));
    const checkout={_type:'checkout',fingerprint};
    const items=[...itemRecords,...(invoice?[invoice]:[]),checkout];
    // Persist first: never send the buyer to payment with an unrecorded order.
    await upsertOrder({folio:orderId,customer_name:d.name,customer_email:d.email,customer_phone:d.phone,
      address:d.address,city:d.city,state:d.state,zip:d.zip,reference:d.reference||null,items,subtotal,
      shipping_amount:0,shipping_status:subtotal<FREE_SHIPPING?'quote_pending':'free',
      payment_status:'pending',payment_status_detail:subtotal<FREE_SHIPPING?'shipping_quote_pending':'checkout_initializing',
      currency:'MXN',updated_at:new Date().toISOString()});
    if(subtotal<FREE_SHIPPING)return res.status(200).json({shippingRequired:true,externalReference:orderId,subtotal});
    const baseUrl=`https://${req.headers['x-forwarded-host']||req.headers.host}`;
    const body={type:'online',processing_mode:'manual',total_amount:subtotal.toFixed(2),external_reference:orderId,
      payer:{email:d.email},items:clean.map(({p,qty})=>({title:p.name.slice(0,120),quantity:qty,unit_price:Number(p.price).toFixed(2)})),
      config:{online:{success_url:`${baseUrl}/success?folio=${encodeURIComponent(orderId)}`,
        pending_url:`${baseUrl}/pending?folio=${encodeURIComponent(orderId)}`,
        failure_url:`${baseUrl}/failure?folio=${encodeURIComponent(orderId)}`,auto_return:'approved'}}};
    const r=await fetch('https://api.mercadopago.com/v1/orders',{method:'POST',
      headers:{accept:'application/json','content-type':'application/json',authorization:`Bearer ${accessToken}`,
        'x-idempotency-key':createHash('sha256').update(orderId+fingerprint).digest('hex')},body:JSON.stringify(body)});
    const out=await r.json().catch(()=>({}));
    let validUrl=false;
    try{const url=new URL(out.checkout_url);validUrl=url.protocol==='https:'&&(url.hostname==='mercadopago.com.mx'||url.hostname.endsWith('.mercadopago.com.mx')||url.hostname==='mercadopago.com'||url.hostname.endsWith('.mercadopago.com'))}catch{}
    if(!r.ok||!validUrl){
      await updateOrderByFolio(orderId,{payment_status:'failed',payment_status_detail:'checkout_unavailable'});
      return res.status(502).json({error:'No fue posible iniciar el pago. Tu pedido quedó registrado para seguimiento.'});
    }
    const saved=await updateOrderByFolio(orderId,{mp_order_id:String(out.id),payment_status_detail:'checkout_created',items:[...itemRecords,...(invoice?[invoice]:[]),{...checkout,url:out.checkout_url}]});
    if(!saved?.length)throw new Error('Order persistence failed');
    return res.status(200).json({checkoutUrl:out.checkout_url,mercadoPagoOrderId:out.id,externalReference:orderId,subtotal});
  }catch(err){
    console.error('Checkout could not complete');
    return res.status(503).json({error:'No pudimos completar el pedido. Consulta su estatus antes de reintentar.'});
  }
}
