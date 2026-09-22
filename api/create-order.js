import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dbConfigured, upsertOrder, updateOrderByFolio, getInventoryByIds, getShippingProfilesByIds, getOrderByFolio } from './_db.js';
import { skydropxConfigured, createQuotation, getCompletedQuotation, normalizeRates, validateRate } from '../lib/skydropx.js';

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

function cleanZip(value){
  return String(value||'').replace(/\D/g,'').slice(0,5);
}

function buildParcels(lines,products,profiles){
  const byId=new Map(products.map(p=>[Number(p.id),p]));
  const parcels=[];
  const missing=[];

  for(const line of lines||[]){
    const id=Number(line.id);
    const qty=Math.max(1,Math.min(99,Number(line.qty)||1));
    const product=byId.get(id);
    if(!product) throw Object.assign(new Error(`Producto inválido: ${id}`),{code:'INVALID_PRODUCT'});
    const profile=profiles[String(id)];

    if(!profile){
      missing.push({id,name:product.name,code:product.code||null});
      continue;
    }

    const unitsPerParcel=Math.max(1,Number(profile.units_per_parcel)||1);
    const unitWeight=Number(profile.weight_kg)||0;
    const length=Math.ceil(Number(profile.length_cm)||0);
    const width=Math.ceil(Number(profile.width_cm)||0);
    const height=Math.ceil(Number(profile.height_cm)||0);

    if(!(unitWeight>0&&length>0&&width>0&&height>0)){
      missing.push({id,name:product.name,code:product.code||null});
      continue;
    }

    let remaining=qty;
    while(remaining>0){
      const packed=Math.min(unitsPerParcel,remaining);
      parcels.push({
        length,
        width,
        height,
        weight:Number((unitWeight*packed).toFixed(3)),
        package_protected:false,
        declared_value:Number((Number(product.price||0)*packed).toFixed(2))
      });
      remaining-=packed;
    }
  }
  return {parcels,missing};
}

async function quoteShipping(customer,lines){
  if(!skydropxConfigured()){
    const err=new Error('El cotizador de envíos todavía no tiene credenciales configuradas.');
    err.code='SHIPPING_NOT_CONFIGURED';
    err.status=503;
    throw err;
  }

  const zip=cleanZip(customer?.zip);
  const state=String(customer?.state||'').trim();
  const city=String(customer?.city||'').trim();
  const neighborhood=String(customer?.neighborhood||'').trim();

  if(zip.length!==5||!state||!city||!neighborhood||!Array.isArray(lines)||!lines.length){
    const err=new Error('Faltan datos de destino para cotizar el envío.');
    err.code='SHIPPING_ADDRESS_INCOMPLETE';
    err.status=400;
    throw err;
  }

  const products=loadProducts();
  const rows=await getShippingProfilesByIds(lines.map(x=>x.id));
  const profiles=Object.fromEntries((Array.isArray(rows)?rows:[]).map(x=>[String(x.product_id),x]));
  const {parcels,missing}=buildParcels(lines,products,profiles);

  if(missing.length){
    const err=new Error('Faltan peso o medidas de empaque para uno o más productos.');
    err.code='MISSING_SHIPPING_PROFILE';
    err.status=409;
    err.products=missing;
    throw err;
  }

  const quotation={
    address_from:{
      address_template_id:String(process.env.SKYDROPX_ORIGIN_TEMPLATE_ID),
      country_code:'MX'
    },
    address_to:{
      country_code:'MX',
      postal_code:zip,
      area_level1:state,
      area_level2:city,
      area_level3:neighborhood
    },
    parcels
  };

  const created=await createQuotation(quotation);
  const quote=await getCompletedQuotation(created.id,created);
  const rates=normalizeRates(quote).slice(0,8);

  if(!rates.length){
    const err=new Error('No encontramos una tarifa disponible para este destino.');
    err.code='NO_SHIPPING_RATES';
    err.status=404;
    throw err;
  }

  return {
    quotationId:String(quote.id||created.id),
    rates,
    completed:Boolean(quote.is_completed)
  };
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
    const {action,orderId,customer,lines,shipping}=req.body||{};

    if(action==='quote_shipping'){
      try{
        const out=await quoteShipping(customer,lines);
        return res.status(200).json(out);
      }catch(err){
        console.error('Shipping quote error',err);
        return res.status(err.status&&err.status<500?err.status:502).json({
          error:err.message||'No fue posible cotizar el envío',
          code:err.code||'SHIPPING_PROVIDER_ERROR',
          products:err.products||[]
        });
      }
    }

    if(action==='track_order'){
      if(!dbConfigured()) return res.status(503).json({error:'Seguimiento temporalmente no disponible'});
      const folio=String(req.body?.folio||'').trim();
      const email=String(req.body?.email||'').trim().toLowerCase();
      if(!folio||!email) return res.status(400).json({error:'Captura folio y correo de compra'});

      const order=await getOrderByFolio(folio);
      const hiddenStatuses=new Set(['inventory','shipping_profile']);
      if(!order||hiddenStatuses.has(String(order.payment_status||'').toLowerCase())){
        return res.status(404).json({error:'No encontramos un pedido con esos datos'});
      }
      if(String(order.customer_email||'').trim().toLowerCase()!==email){
        return res.status(404).json({error:'No encontramos un pedido con esos datos'});
      }

      const rawItems=Array.isArray(order.items)?order.items:[];
      const fulfillment=rawItems.find(x=>x&&x._type==='fulfillment')||{};
      const shippingMeta=rawItems.find(x=>x&&x._type==='shipping')||{};
      const productItems=rawItems.filter(x=>x&&!x._type).map(x=>({
        name:String(x.name||'Producto'),
        code:String(x.code||''),
        qty:Number(x.qty||1)
      }));

      const payment=String(order.payment_status||'pending').toLowerCase();
      const admin=String(order.admin_status||'active').toLowerCase();
      let status=String(fulfillment.status||'').toLowerCase();
      if(admin==='canceled') status='canceled';
      else if(['failed','canceled','cancelled','rejected'].includes(payment)) status='payment_issue';
      else if(['approved','paid','processed'].includes(payment) && !status) status='to_fulfill';
      else if(!status) status='payment_pending';

      return res.status(200).json({
        ok:true,
        order:{
          folio:String(order.folio||''),
          customer_name:String(order.customer_name||''),
          city:String(order.city||''),
          state:String(order.state||''),
          created_at:order.created_at||null,
          paid_at:order.paid_at||null,
          updated_at:order.updated_at||null,
          payment_status:payment,
          status,
          carrier:String(fulfillment.carrier||shippingMeta.carrier||''),
          service:String(shippingMeta.service||''),
          tracking_number:String(fulfillment.tracking_number||''),
          tracking_url:String(fulfillment.tracking_url||''),
          shipping_amount:Number(order.shipping_amount||0),
          shipping_status:String(order.shipping_status||''),
          total:Number((Number(order.subtotal||0)+Number(order.shipping_amount||0)).toFixed(2)),
          items:productItems
        }
      });
    }

    if(!accessToken)return res.status(503).json({error:'Pago en línea aún no activado',code:'PAYMENTS_NOT_CONFIGURED'});
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
          const available=Number(inv?.stock||0);
          if(inv?.managed && available<qty){
            return res.status(409).json({
              error:`No hay suficiente existencia de ${p.name}.`,
              code:'OUT_OF_STOCK',
              productId:Number(p.id),
              available,
              requested:qty
            });
          }
          if(p.cat==='Motores Mercury' && (!inv?.managed || available===1)){
            return res.status(409).json({
              error:`La existencia de ${p.name} debe confirmarse antes del pago.`,
              code:'CONFIRM_AVAILABILITY',
              productId:Number(p.id),
              available:inv?.managed?available:null
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
    }else if(clean.some(x=>x.p.cat==='Motores Mercury')){
      const motor=clean.find(x=>x.p.cat==='Motores Mercury')?.p;
      return res.status(409).json({
        error:`La existencia de ${motor?.name||'este motor Mercury'} debe confirmarse antes del pago.`,
        code:'CONFIRM_AVAILABILITY',
        productId:Number(motor?.id||0)||null
      });
    }

    const subtotal=Number(clean.reduce((s,x)=>s+Number(x.p.price)*x.qty,0).toFixed(2));

    let shippingAmount=0;
    let shippingRate=null;

    if(subtotal<FREE_SHIPPING){
      if(!shipping?.quotationId||!shipping?.rateId){
        return res.status(409).json({
          error:'Selecciona una tarifa de envío antes de pagar.',
          code:'SHIPPING_REQUIRED',
          subtotal,
          missingForFreeShipping:Number((FREE_SHIPPING-subtotal).toFixed(2))
        });
      }
      try{
        shippingRate=await validateRate(String(shipping.quotationId),String(shipping.rateId));
      }catch(err){
        return res.status(409).json({
          error:err.message||'La tarifa de envío ya no está disponible.',
          code:err.code||'SHIPPING_RATE_INVALID'
        });
      }
      if(String(shippingRate.currency||'MXN').toUpperCase()!=='MXN'){
        return res.status(409).json({error:'La tarifa de envío no está en MXN.',code:'SHIPPING_CURRENCY_INVALID'});
      }
      shippingAmount=Number(Number(shippingRate.amount||0).toFixed(2));
      if(!(shippingAmount>0)){
        return res.status(409).json({error:'La tarifa de envío es inválida.',code:'SHIPPING_RATE_INVALID'});
      }
    }

    const grandTotal=Number((subtotal+shippingAmount).toFixed(2));
    const baseUrl=getBaseUrl(req);
    const items=[
      ...clean.map(({p,qty})=>({
        title:String(p.name).slice(0,120),
        quantity:qty,
        unit_price:Number(p.price).toFixed(2)
      })),
      ...(shippingAmount>0?[{
        title:`Envío - ${String(shippingRate?.carrier||'Paquetería').slice(0,60)}`,
        quantity:1,
        unit_price:shippingAmount.toFixed(2)
      }]:[])
    ];

    const body={
      type:'online',
      processing_mode:'manual',
      total_amount:grandTotal.toFixed(2),
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
          ...(shippingRate?[{
            _type:'shipping',
            quotation_id:String(shippingRate.quotationId||shipping?.quotationId||''),
            rate_id:String(shippingRate.rateId||shipping?.rateId||''),
            carrier:shippingRate.carrier||null,
            service:shippingRate.service||null,
            days:shippingRate.days??null,
            amount:shippingAmount
          }]:[]),
          ...(invoice?[{_type:'invoice',required:true,...invoice}]:[])
        ],
        subtotal,
        shipping_amount:shippingAmount,
        shipping_status:shippingAmount>0?'quoted':'free',
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
      subtotal,
      shippingAmount,
      total:grandTotal
    });
  }catch(err){
    console.error('Checkout error:',err);
    return res.status(500).json({error:'Error interno al generar el pago',details:err?.message||'Error desconocido'});
  }
}
