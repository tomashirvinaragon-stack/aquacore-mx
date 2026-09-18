import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dbConfigured, upsertOrder, updateOrderByFolio, getInventoryByIds } from './_db.js';

const FREE_SHIPPING = 5000;

function loadProducts(){
  const file=path.join(process.cwd(),'data','products.json');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}

function getBaseUrl(req){
  const proto=req.headers['x-forwarded-proto']||'https';
  const host=req.headers['x-forwarded-host']||req.headers.host;
  return `${proto}://${host}`;
}

function providerDetail(data){
  const parts=[];
  if(data?.error) parts.push(String(data.error));
  if(data?.message) parts.push(String(data.message));
  if(Array.isArray(data?.details)){
    for(const d of data.details.slice(0,3)){
      const code=d?.code||d?.error||d?.type;
      const desc=d?.description||d?.message||d?.detail;
      if(code||desc) parts.push([code,desc].filter(Boolean).join(': '));
    }
  }
  return parts.join(' | ')||'Respuesta inválida del proveedor de pago';
}

export default async function handler(req,res){
  const accessToken=process.env.MERCADOPAGO_ACCESS_TOKEN;

  if(req.method==='GET'){
    try{
      const products=loadProducts();
      return res.status(200).json({
        ok:true,
        paymentsConfigured:Boolean(accessToken),
        catalogLoaded:Array.isArray(products)&&products.length>0,
        productCount:Array.isArray(products)?products.length:0,
        ordersDatabaseConfigured:dbConfigured()
      });
    }catch(err){
      console.error('Healthcheck catalog error:',err);
      return res.status(500).json({ok:false,paymentsConfigured:Boolean(accessToken),catalogLoaded:false});
    }
  }

  if(req.method!=='POST')return res.status(405).json({error:'Método no permitido'});

  try{
    if(!accessToken)return res.status(503).json({error:'Pago en línea aún no activado',code:'PAYMENTS_NOT_CONFIGURED'});

    const {orderId,customer,lines}=req.body||{};
    if(!orderId||!customer?.email||!Array.isArray(lines)||!lines.length){
      return res.status(400).json({error:'Pedido incompleto'});
    }

    const invoiceRequired=customer?.invoice_required==='yes'||customer?.invoice_required===true;
    const invoice=invoiceRequired?{
      rfc:String(customer.invoice_rfc||'').trim().toUpperCase(),
      name:String(customer.invoice_name||'').trim(),
      tax_regime:String(customer.invoice_tax_regime||'').trim(),
      cfdi_use:String(customer.invoice_cfdi_use||'').trim(),
      zip:String(customer.invoice_zip||'').trim()
    }:null;
    if(invoiceRequired&&(!invoice.rfc||!invoice.name||!invoice.tax_regime||!invoice.cfdi_use||!invoice.zip)){
      return res.status(400).json({error:'Faltan datos de facturación'});
    }

    const byId=new Map(loadProducts().map(p=>[Number(p.id),p]));
    const clean=[];

    for(const line of lines){
      const id=Number(line.id);
      const qty=Math.max(1,Math.min(99,Number(line.qty)||1));
      const p=byId.get(id);
      if(!p)return res.status(400).json({error:`Producto inválido: ${id}`});
      clean.push({p,qty});
    }

    if(dbConfigured()){
      try{
        const inventory=await getInventoryByIds(clean.map(x=>x.p.id));
        const byInventory=new Map((Array.isArray(inventory)?inventory:[]).map(x=>[Number(x.product_id),x]));
        for(const {p,qty} of clean){
          const inv=byInventory.get(Number(p.id));
          if(inv?.managed && Number(inv.stock||0)<qty){
            return res.status(409).json({
              error:`No hay suficiente existencia de ${p.name}.`,
              code:'OUT_OF_STOCK',
              productId:Number(p.id),
              available:Number(inv.stock||0),
              requested:qty
            });
          }
        }
      }catch(inventoryErr){
        console.error('No se pudo validar inventario antes del checkout',inventoryErr);
        return res.status(503).json({
          error:'No se pudo confirmar la existencia en este momento. Intenta nuevamente.',
          code:'STOCK_VALIDATION_UNAVAILABLE'
        });
      }
    }

    const subtotal=Number(clean.reduce((s,x)=>s+Number(x.p.price)*x.qty,0).toFixed(2));

    if(subtotal<FREE_SHIPPING){
      return res.status(409).json({
        error:'El pedido requiere cálculo de envío antes de cobrar.',
        code:'SHIPPING_REQUIRED',
        subtotal,
        missingForFreeShipping:Number((FREE_SHIPPING-subtotal).toFixed(2))
      });
    }

    const baseUrl=getBaseUrl(req);
    const items=clean.map(({p,qty})=>({
      title:String(p.name).slice(0,120),
      quantity:qty,
      unit_price:Number(p.price).toFixed(2)
    }));

    const body={
      type:'online',
      processing_mode:'manual',
      total_amount:subtotal.toFixed(2),
      external_reference:String(orderId).slice(0,64),
      payer:{email:String(customer.email).trim()},
      items,
      config:{
        online:{
          success_url:`${baseUrl}/success.html?folio=${encodeURIComponent(orderId)}`,
          failure_url:`${baseUrl}/failure.html?folio=${encodeURIComponent(orderId)}`,
          pending_url:`${baseUrl}/pending.html?folio=${encodeURIComponent(orderId)}`,
          auto_return:'approved'
        }
      }
    };

    const mpResponse=await fetch('https://api.mercadopago.com/v1/orders',{
      method:'POST',
      headers:{
        accept:'application/json',
        'content-type':'application/json',
        authorization:`Bearer ${accessToken}`,
        'x-idempotency-key':randomUUID()
      },
      body:JSON.stringify(body)
    });

    const data=await mpResponse.json().catch(()=>({}));

    if(!mpResponse.ok||!data.checkout_url){
      const details=providerDetail(data);
      console.error('Mercado Pago create-order error',{status:mpResponse.status,details});
      if(dbConfigured()){
        updateOrderByFolio(orderId,{payment_status:'failed',payment_status_detail:details}).catch(()=>{});
      }
      return res.status(502).json({
        error:'No fue posible iniciar el pago con Mercado Pago.',
        providerStatus:mpResponse.status,
        providerCode:data?.error||data?.code||null,
        details
      });
    }

    if(dbConfigured()){
      const orderRecord={
        folio:String(orderId),
        mp_order_id:String(data.id||'')||null,
        customer_name:String(customer.name||'').trim()||null,
        customer_email:String(customer.email||'').trim()||null,
        customer_phone:String(customer.phone||'').trim()||null,
        address:String(customer.address||'').trim()||null,
        city:String(customer.city||'').trim()||null,
        state:String(customer.state||'').trim()||null,
        zip:String(customer.zip||'').trim()||null,
        reference:String(customer.reference||'').trim()||null,
        items:[
          ...clean.map(({p,qty})=>({
            id:Number(p.id),
            name:p.name,
            code:p.code||null,
            qty,
            unit_price:Number(p.price),
            total:Number((Number(p.price)*qty).toFixed(2))
          })),
          ...(invoice?[{_type:'invoice',required:true,...invoice}]:[])
        ],
        subtotal,
        shipping_amount:0,
        shipping_status:'free',
        payment_status:'pending',
        payment_status_detail:'checkout_created',
        currency:'MXN',
        updated_at:new Date().toISOString()
      };
      try{
        await upsertOrder(orderRecord);
      }catch(dbErr){
        console.error('No se pudo guardar el pedido en Supabase',dbErr);
      }
    }

    return res.status(200).json({
      checkoutUrl:data.checkout_url,
      mercadoPagoOrderId:data.id,
      externalReference:orderId,
      subtotal
    });
  }catch(err){
    console.error('Checkout error:',err);
    return res.status(500).json({error:'Error interno al generar el pago',details:err?.message||'Error desconocido'});
  }
}
