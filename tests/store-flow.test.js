import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.SUPABASE_URL='https://database.test';
process.env.SUPABASE_SECRET_KEY='test-only';
process.env.MERCADOPAGO_ACCESS_TOKEN='test-only';
process.env.AQUACORE_ADMIN_PASSWORD='test-only';
const {default:createOrder}=await import('../api/create-order.js');
const {default:track}=await import('../api/order-status.js');
const {default:admin}=await import('../api/admin-orders.js');
const {default:inventory}=await import('../api/inventory.js');
const {stockInfo,imagePath,readCart}=await import('../storefront.js');
const products=JSON.parse(fs.readFileSync('data/products.json','utf8'));
let rows,stock,requests,providerCalls,dbFail;
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
function reset(){rows=new Map();stock=5;requests=[];providerCalls=0;dbFail=false}
globalThis.fetch=async(url,options={})=>{
 requests.push({url:String(url),method:options.method||'GET'});
 if(String(url).startsWith('https://api.mercadopago.com/')){
  providerCalls++;
  assert.equal(JSON.parse(options.body).total_amount,'9604.84');
  return reply({id:'ORDER_TEST',checkout_url:'https://www.mercadopago.com.mx/checkout/test-only'});
 }
 assert.ok(String(url).startsWith('https://database.test/'),'No real external requests permitted');
 if(dbFail)return reply({message:'test database failure'},500);
 const u=new URL(url),method=options.method||'GET';
 if(method==='POST'){
  const row=JSON.parse(options.body);rows.set(row.folio,{...row,created_at:new Date().toISOString()});return reply([rows.get(row.folio)]);
 }
 const folio=u.searchParams.get('folio')?.replace(/^eq\./,'');
 if(method==='PATCH'){
  if(!rows.has(folio))return reply([]);
  rows.set(folio,{...rows.get(folio),...JSON.parse(options.body)});return reply([rows.get(folio)]);
 }
 if(u.searchParams.get('payment_status')==='eq.inventory')return reply(stock===null?[]:[{folio:'INV-26',items:[{_type:'inventory',product_id:26,stock,managed:true}],updated_at:new Date().toISOString()}]);
 return reply(folio?(rows.has(folio)?[rows.get(folio)]:[]):[...rows.values()]);
};
async function call(handler,body,extra={}){
 const res={code:200,headers:{},status(n){this.code=n;return this},json(data){this.data=data;return this},setHeader(k,v){this.headers[k]=v}};
 await handler({method:'POST',headers:{host:'private.test','x-admin-password':'test-only'},body,...extra},res);return res;
}
const customer={name:'QA',email:'qa@example.test',phone:'0000000000',address:'Test only',city:'Test',state:'Test',zip:'00000'};
const body=()=>({orderId:'ACMX-20261001-ABCDEF12',customer,lines:[{id:26,qty:1,price:1}],subtotal:1});

test('stock labels use 0, 1–2 and 3+ consistently',()=>{
 assert.equal(stockInfo({stockManaged:true,stock:0}).label,'Agotado');
 for(const n of [1,2])assert.match(stockInfo({stockManaged:true,stock:n}).label,/Últimas piezas/);
 assert.equal(stockInfo({stockManaged:true,stock:3,lowStockThreshold:999}).label,'Disponible');
 assert.equal(stockInfo({stockManaged:false}).label,'Consultar disponibilidad');
 assert.equal(imagePath({image:'https://example.test/photo.jpg'}),'https://example.test/photo.jpg');
 assert.deepEqual(readCart({getItem:()=>'{bad'}),{});
});
test('price comes from catalog, order persists before checkout, retry is idempotent',async()=>{
 reset();const out=await call(createOrder,body());assert.equal(out.code,200);assert.equal(out.data.subtotal,9604.84);
 assert.equal(rows.get(body().orderId).subtotal,9604.84);
 const postDb=requests.findIndex(r=>r.url.includes('database.test')&&r.method==='POST');
 const postMp=requests.findIndex(r=>r.url.includes('mercadopago'));assert.ok(postDb<postMp);
 const again=await call(createOrder,body());assert.equal(again.code,200);assert.equal(providerCalls,1);
});
test('invalid quantities, duplicate stock excess, unknown stock and 0–2 are blocked before payment',async()=>{
 for(const qty of [0,-1,1.5,100]){reset();const b=body();b.lines[0].qty=qty;assert.equal((await call(createOrder,b)).code,400);assert.equal(providerCalls,0)}
 reset();const b=body();b.lines=[{id:26,qty:3},{id:26,qty:3}];assert.equal((await call(createOrder,b)).data.code,'OUT_OF_STOCK');
 for(const available of [0,1,2,null]){reset();stock=available;const out=await call(createOrder,body());assert.equal(out.code,409);assert.equal(providerCalls,0)}
});
test('database failure cannot redirect buyer to payment',async()=>{
 reset();dbFail=true;const out=await call(createOrder,body());assert.equal(out.code,503);assert.equal(providerCalls,0);
});
test('quote under $5000 persists and can be tracked without charging',async()=>{
 reset();const inexpensive=products.find(p=>p.price<5000&&p.price>0);
 const savedFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  if(String(url).includes('payment_status=eq.inventory'))return reply([{folio:'INV-'+inexpensive.id,items:[{_type:'inventory',product_id:inexpensive.id,stock:10,managed:true}]}]);
  return savedFetch(url,options);
 };
 try{const b=body();b.lines=[{id:inexpensive.id,qty:1}];const out=await call(createOrder,b);assert.equal(out.code,200);assert.equal(out.data.shippingRequired,true);assert.equal(providerCalls,0);
 const t=await call(track,{folio:b.orderId,email:customer.email});assert.equal(t.data.order.status,'shipping_quote')}
 finally{globalThis.fetch=savedFetch}
});
test('tracking checks buyer email and hides customer contacts and internal metadata',async()=>{
 reset();await call(createOrder,body());
 assert.equal((await call(track,{folio:body().orderId,email:'wrong@example.test'})).code,404);
 const out=await call(track,{folio:body().orderId,email:customer.email});assert.equal(out.code,200);assert.equal(out.data.order.status,'payment_pending');
 assert.equal(out.data.order.customer_email,undefined);assert.equal(out.data.order.address,undefined);assert.equal(out.data.order.items.length,1);
});
test('admin tracking persists and customer sees shipped status, carrier, guide and safe URL',async()=>{
 reset();await call(createOrder,body());const folio=body().orderId;
 const shipment={folio,action:'fulfillment',fulfillment_status:'shipped',carrier:'QA carrier',tracking_number:'TESTGUIDE',tracking_url:'https://carrier.test/TESTGUIDE'};
 assert.equal((await call(admin,shipment)).code,409);
 rows.get(folio).payment_status='approved';
 assert.equal((await call(admin,{...shipment,tracking_url:'javascript:alert(1)'})).code,400);
 assert.equal((await call(admin,shipment)).code,200);
 const out=await call(track,{folio,email:customer.email});assert.equal(out.data.order.status,'shipped');assert.equal(out.data.order.tracking_number,'TESTGUIDE');assert.equal(out.data.order.tracking_url,'https://carrier.test/TESTGUIDE');
 rows.get(folio).payment_status='refunded';assert.equal((await call(track,{folio,email:customer.email})).data.order.status,'refunded');
});
test('browsing inventory never syncs or writes to external systems',async()=>{
 reset();const out=await call(inventory,undefined,{method:'GET'});assert.equal(out.code,200);assert.ok(requests.every(r=>r.method==='GET'));
});
