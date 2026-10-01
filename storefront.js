export function readCart(storage=localStorage){
  try{
    const input=JSON.parse(storage.getItem('aquacore-cart-v2')||'{}');
    return Object.fromEntries(Object.entries(input||{}).filter(([id,qty])=>
      /^\d+$/.test(id)&&Number.isSafeInteger(qty)&&qty>0&&qty<=99));
  }catch{return {}}
}

export function imagePath(p){
  if(p.image){
    if(/^https:\/\//i.test(p.image)||p.image.startsWith('/'))return p.image;
    return '/'+p.image;
  }
  if(p.cat==='Blowers')return '/assets/products/blower-pulsar.webp';
  return `/api/equipesca-image?name=${encodeURIComponent(p.name)}&code=${encodeURIComponent(p.code||'')}&v=20261001`;
}

export function requiresConfirmation(p){
  return p.stockManaged?Number(p.stock)>0&&Number(p.stock)<=2:!isSoldOut(p);
}

export function stockInfo(p){
  if(p.stockManaged){
    if(Number(p.stock)<=0)return {className:'stock-out',label:'Agotado'};
    if(Number(p.stock)<=2)return {className:'stock-low',label:'Últimas piezas — disponibilidad sujeta a confirmación'};
    return {className:'stock-ok',label:'Disponible'};
  }
  return isSoldOut(p)
    ?{className:'stock-out',label:'Agotado'}
    :{className:'stock-unknown',label:'Consultar disponibilidad'};
}

export function isSoldOut(p){
  return p.stockManaged?Number(p.stock)<=0:Boolean(p.availabilityKnown&&!p.shopAvailable);
}
