import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const FREE_SHIPPING = 5000;
function loadProducts(){const file=path.join(process.cwd(),'data','products.json');return JSON.parse(fs.readFileSync(file,'utf8'));}
function getBaseUrl(req){const proto=req.headers['x-forwarded-proto']||'https';const host=req.headers['x-forwarded-host']||req.headers.host;return `${proto}://${host}`;}
export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Método no permitido'});
  try{
    const accessToken=process.env.MERCADOPAGO_ACCESS_TOKEN;
    if(!accessToken)return res.status(503).json({error:'Pago en línea aún no activado',code:'PAYMENTS_NOT_CONFIGURED'});
    const {orderId,customer,lines}=req.body||{};
    if(!orderId||!customer?.email||!Array.isArray(lines)||!lines.length)return res.status(400).json({error:'Pedido incompleto'});
    const byId=new Map(loadProducts().map(p=>[Number(p.id),p])),clean=[];
    for(const line of lines){const id=Number(line.id),qty=Math.max(1,Math.min(99,Number(line.qty)||1)),p=byId.get(id);if(!p)return res.status(400).json({error:`Producto inválido: ${id}`});clean.push({p,qty});}
    const subtotal=Number(clean.reduce((s,x)=>s+Number(x.p.price)*x.qty,0).toFixed(2));
    if(subtotal<FREE_SHIPPING)return res.status(409).json({error:'El pedido requiere cálculo de envío antes de cobrar.',code:'SHIPPING_REQUIRED',subtotal,missingForFreeShipping:Number((FREE_SHIPPING-subtotal).toFixed(2))});
    const baseUrl=getBaseUrl(req),items=clean.map(({p,qty})=>({title:String(p.name).slice(0,120),description:p.code?`Código: ${p.code}`:undefined,unit_price:Number(p.price).toFixed(2),quantity:qty,unit_measure:'unit',total_amount:Number(Number(p.price)*qty).toFixed(2)}));
    const body={type:'online',processing_mode:'manual',total_amount:subtotal.toFixed(2),external_reference:String(orderId).slice(0,64),description:`Pedido ${orderId} - AquaCore MX`,payer:{email:customer.email,first_name:customer.name||undefined},items,config:{online:{success_url:`${baseUrl}/success.html?folio=${encodeURIComponent(orderId)}`,failure_url:`${baseUrl}/failure.html?folio=${encodeURIComponent(orderId)}`,pending_url:`${baseUrl}/pending.html?folio=${encodeURIComponent(orderId)}`,auto_return:'all'}}};
    const mpResponse=await fetch('https://api.mercadopago.com/v1/orders',{method:'POST',headers:{accept:'application/json','content-type':'application/json',authorization:`Bearer ${accessToken}`,'x-idempotency-key':randomUUID()},body:JSON.stringify(body)});
    const data=await mpResponse.json().catch(()=>({}));
    if(!mpResponse.ok||!data.checkout_url)return res.status(502).json({error:'No fue posible iniciar el pago con Mercado Pago.',details:data?.message||data?.error||'Respuesta inválida del proveedor de pago'});
    return res.status(200).json({checkoutUrl:data.checkout_url,mercadoPagoOrderId:data.id,externalReference:orderId,subtotal});
  }catch(err){console.error(err);return res.status(500).json({error:'Error interno al generar el pago'});}
}
