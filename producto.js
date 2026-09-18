const PHONE='526442127571';
const FREE_SHIPPING=5000;
const NO_PRODUCT_IMAGE=new Set([78,80,85]);
const catIcon={Blowers:'🌀',Aireadores:'🌊',Difusores:'⚫','Calidad de agua':'🧪','Redes y mallas':'🕸️',Procesamiento:'🔪',Protección:'🦺',Refacciones:'⚙️','Motores Mercury':'🚤'};
const fmt=n=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(n);
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const slugify=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
const imagePath=p=>{
  if(p.image) return p.image.startsWith('/')?p.image:'/'+p.image;
  if(p.cat==='Blowers') return '/assets/products/blower-pulsar.webp';
  return `/api/equipesca-image?name=${encodeURIComponent(p.name)}&code=${encodeURIComponent(p.code||'')}&v=20260917b`;
};
const productUrl=p=>`${location.origin}/productos/${slugify(p.name)}-${p.id}`;
const toast=t=>{const x=document.querySelector('#productToast');x.textContent=t;x.classList.add('show');setTimeout(()=>x.classList.remove('show'),1800)};
function stockInfo(p){
  if(p.stockManaged){
    if(Number(p.stock)<=0)return{className:'stock-out',label:'Agotado'};
    if(Number(p.stock)<=Number(p.lowStockThreshold||0))return{className:'stock-low',label:'Pocas piezas'};
    return{className:'stock-ok',label:'Disponible'};
  }
  if(p.availabilityKnown)return p.shopAvailable
    ?{className:'stock-ok',label:'Disponible'}
    :{className:'stock-out',label:'Agotado'};
  return{className:'stock-unknown',label:'Disponibilidad por confirmar'};
}
function isSoldOut(p){
  return p.stockManaged
    ? Number(p.stock)<=0
    : Boolean(p.availabilityKnown&&!p.shopAvailable);
}

function getRequestedId(){
  const path=location.pathname.split('/').filter(Boolean).pop()||'';
  const q=new URLSearchParams(location.search);
  const raw=q.get('id')||q.get('slug')||path;
  const m=String(raw).match(/(?:^|-)(\d+)$/);
  return m?Number(m[1]):null;
}
function productImage(p){
  const fallback=`<span class="single-product-fallback">${p.icon||catIcon[p.cat]||'•'}</span>`;
  if(NO_PRODUCT_IMAGE.has(Number(p.id))) return fallback;
  return `<img class="single-product-photo" src="${esc(imagePath(p))}" alt="${esc(p.name)}" decoding="async" onerror="this.style.display='none'">${fallback}`;
}
function addToCart(p){
  const cart=JSON.parse(localStorage.getItem('aquacore-cart-v2')||'{}');
  const current=Number(cart[p.id]||0);
  if(isSoldOut(p)){toast('Producto agotado');return}
  if(p.stockManaged&&current>=Number(p.stock||0)){toast('No hay más piezas disponibles');return}
  cart[p.id]=current+1;
  localStorage.setItem('aquacore-cart-v2',JSON.stringify(cart));
  window.aquaMeta?.('AddToCart',{content_ids:[String(p.id)],content_name:p.name,content_type:'product',value:Number(p.price),currency:'MXN'});
  toast('Producto agregado al carrito');
}
function whatsapp(p){
  const msg=`Hola AquaCore MX. Me interesa: ${p.name} (${p.code||'sin código'}) - ${fmt(p.price)}.\n${productUrl(p)}`;
  window.open(`https://wa.me/${PHONE}?text=${encodeURIComponent(msg)}`,'_blank','noopener');
}
async function init(){
  const root=document.querySelector('#singleProduct');
  try{
    const [products,inventoryOut,mercuryOut]=await Promise.all([
      fetch('/data/products.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('catalog');return r.json()}),
      fetch('/api/inventory',{cache:'no-store'}).then(r=>r.ok?r.json():({inventory:[]})).catch(()=>({inventory:[]})),
      fetch('/api/equipesca-mercury',{cache:'no-store'}).then(r=>r.ok?r.json():({availability:[]})).catch(()=>({availability:[]}))
    ]);
    const id=getRequestedId();
    const base=products.find(x=>Number(x.id)===id);
    const inv=(Array.isArray(inventoryOut?.inventory)?inventoryOut.inventory:[]).find(x=>Number(x.product_id)===id);
    const mercury=(Array.isArray(mercuryOut?.availability)?mercuryOut.availability:[]).find(x=>Number(x.product_id)===id);
    const stockManaged=Boolean(inv?.managed);
    const availabilityKnown=!stockManaged&&typeof mercury?.available==='boolean';
    const p=base?{
      ...base,
      stockManaged,
      stock:Number(inv?.stock||0),
      lowStockThreshold:Number(inv?.low_stock_threshold||0),
      availabilityKnown,
      shopAvailable:availabilityKnown?Boolean(mercury.available):null
    }:null;
    if(!p){
      document.title='Producto no encontrado | AquaCore MX';
      root.innerHTML='<div class="single-product-error"><h1>Producto no encontrado</h1><p>Este enlace no corresponde a un producto disponible.</p><a class="btn primary" href="/#productos">Volver al catálogo</a></div>';
      return;
    }
    document.title=`${p.name} | AquaCore MX`;
    document.querySelector('meta[name="description"]').setAttribute('content',p.description||`${p.name}. Precio neto y envíos a todo México.`);
    document.querySelector('meta[property="og:title"]').setAttribute('content',p.name+' | AquaCore MX');
    document.querySelector('meta[property="og:description"]').setAttribute('content',p.description||'Consulta precio, ficha técnica y disponibilidad.');
    document.querySelector('#breadcrumbName').textContent=p.name;
    window.aquaMeta?.('ViewContent',{content_ids:[String(p.id)],content_name:p.name,content_category:p.cat,content_type:'product',value:Number(p.price),currency:'MXN'});

    const specs=Array.isArray(p.specs)?p.specs:[];
    const uses=Array.isArray(p.uses)?p.uses:[];
    const st=stockInfo(p),soldOut=isSoldOut(p);
    root.innerHTML=`
      <div class="single-product-visual">${productImage(p)}</div>
      <div class="single-product-info">
        <span class="detail-kicker">${esc(p.cat)}</span>
        <h1>${esc(p.name)}</h1>
        ${p.code?`<div class="detail-code">Código / modelo: ${esc(p.code)}</div>`:''}
        <div class="single-product-price">${fmt(p.price)}</div>
        <div class="net-price">Precio neto</div>
        <div class="stock-pill ${st.className}">${st.label}</div>
        <div class="single-product-benefits"><span>✓ Envíos a todo México</span><span>✓ Envío gratis desde ${fmt(FREE_SHIPPING)}</span></div>
        ${p.description?`<p class="single-product-description">${esc(p.description)}</p>`:''}
        ${specs.length?`<section class="detail-section"><h2>Ficha técnica</h2><div class="spec-grid">${specs.map(s=>`<div class="spec-item">${esc(s)}</div>`).join('')}</div></section>`:''}
        ${uses.length?`<section class="detail-section"><h2>Aplicaciones</h2><ul class="detail-list compact">${uses.map(s=>`<li>${esc(s)}</li>`).join('')}</ul></section>`:''}
        <div class="single-product-actions">
          <button class="btn primary" id="addProduct" ${soldOut?'disabled':''}>${soldOut?'Agotado':'Agregar al carrito'}</button>
          <button class="btn secondary" id="waProduct">Consultar por WhatsApp</button>
          <button class="btn ghost" id="shareProduct">Compartir enlace</button>
        </div>
      </div>`;
    document.querySelector('#addProduct').onclick=()=>addToCart(p);
    document.querySelector('#waProduct').onclick=()=>whatsapp(p);
    document.querySelector('#shareProduct').onclick=async()=>{
      const data={title:p.name,text:`${p.name} - ${fmt(p.price)} | AquaCore MX`,url:productUrl(p)};
      try{
        if(navigator.share) await navigator.share(data);
        else {await navigator.clipboard.writeText(data.url);toast('Enlace copiado');}
      }catch(e){}
    };
  }catch(e){
    root.innerHTML='<div class="single-product-error"><h1>No pudimos cargar el producto</h1><p>Intenta nuevamente o vuelve al catálogo.</p><a class="btn primary" href="/#productos">Volver al catálogo</a></div>';
  }
}
init();