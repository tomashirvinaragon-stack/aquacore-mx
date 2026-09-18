const PHONE='526442127571';
const FREE_SHIPPING=5000;
const NO_PRODUCT_IMAGE=new Set([78,80,85]);
const catIcon={Blowers:'🌀',Aireadores:'🌊',Difusores:'⚫','Calidad de agua':'🧪','Redes y mallas':'🕸️',Procesamiento:'🔪',Protección:'🦺',Refacciones:'⚙️'};
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
  cart[p.id]=(cart[p.id]||0)+1;
  localStorage.setItem('aquacore-cart-v2',JSON.stringify(cart));
  toast('Producto agregado al carrito');
}
function whatsapp(p){
  const msg=`Hola AquaCore MX. Me interesa: ${p.name} (${p.code||'sin código'}) - ${fmt(p.price)}.\n${productUrl(p)}`;
  window.open(`https://wa.me/${PHONE}?text=${encodeURIComponent(msg)}`,'_blank','noopener');
}
async function init(){
  const root=document.querySelector('#singleProduct');
  try{
    const products=await fetch('/data/products.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('catalog');return r.json()});
    const id=getRequestedId();
    const p=products.find(x=>Number(x.id)===id);
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

    const specs=Array.isArray(p.specs)?p.specs:[];
    const uses=Array.isArray(p.uses)?p.uses:[];
    root.innerHTML=`
      <div class="single-product-visual">${productImage(p)}</div>
      <div class="single-product-info">
        <span class="detail-kicker">${esc(p.cat)}</span>
        <h1>${esc(p.name)}</h1>
        ${p.code?`<div class="detail-code">Código / modelo: ${esc(p.code)}</div>`:''}
        <div class="single-product-price">${fmt(p.price)}</div>
        <div class="net-price">Precio neto</div>
        <div class="single-product-benefits"><span>✓ Envíos a todo México</span><span>✓ Envío gratis desde ${fmt(FREE_SHIPPING)}</span><span>✓ Disponibilidad sujeta a confirmación</span></div>
        ${p.description?`<p class="single-product-description">${esc(p.description)}</p>`:''}
        ${specs.length?`<section class="detail-section"><h2>Ficha técnica</h2><div class="spec-grid">${specs.map(s=>`<div class="spec-item">${esc(s)}</div>`).join('')}</div></section>`:''}
        ${uses.length?`<section class="detail-section"><h2>Aplicaciones</h2><ul class="detail-list compact">${uses.map(s=>`<li>${esc(s)}</li>`).join('')}</ul></section>`:''}
        <div class="single-product-actions">
          <button class="btn primary" id="addProduct">Agregar al carrito</button>
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