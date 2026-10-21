// AquaCore MX · Meta Pixel: evento Contact en la página de producto
// Se carga DESPUÉS de producto.js. No modifica nada de la página.
(function(){
  let product=null;

  function productIdFromUrl(){
    const q=new URLSearchParams(location.search);
    const raw=q.get('id')||location.pathname.split('/').pop()||'';
    const m=String(raw).match(/(\d+)$/);
    return m?Number(m[1]):null;
  }

  const id=productIdFromUrl();
  if(id!==null){
    fetch('/data/products.json')
      .then(r=>r.ok?r.json():[])
      .then(list=>{product=(Array.isArray(list)?list:[]).find(p=>Number(p.id)===id)||null})
      .catch(()=>{});
  }

  function sendContact(source){
    const params=product
      ?{content_name:product.name,content_ids:[String(product.id)],content_category:product.cat,content_type:'product',value:Number(product.price),currency:'MXN',source}
      :{content_name:(document.querySelector('h1')?.textContent||'').trim(),content_ids:id!==null?[String(id)]:[],content_type:'product',source};
    try{window.aquaMeta?.('Contact',params)}catch(err){console.debug('Contact event skipped',err)}
  }

  document.addEventListener('click',e=>{
    const t=e.target;
    if(!t||!t.closest)return;
    if(t.closest('#waProduct')){sendContact('producto');return}
    if(t.closest('a[href*="wa.me"]')) sendContact('enlace');
  },true);
})();
