import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

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
        productCount:Array.isArray(products)?products.length:0
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

    const byId=new Map(loadProducts().map(p=>[Number(p.id),p]));
    const clean=[];

    for(const line of lines){
      const id=Number(line.id);
      const qty=Math.max(1,Math.min(99,Number(line.qty)||1));
      const p=byId.get(id);
      if(!p)return res.status(400).json({error:`Producto inválido: ${id}`});
      clean.push({p,qty});
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
      return res.status(502).json({
        error:'No fue posible iniciar el pago con Mercado Pago.',
        providerStatus:mpResponse.status,
        providerCode:data?.error||data?.code||null,
        details
      });
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
