export default async function handler(req,res){
  const token=process.env.MERCADOPAGO_ACCESS_TOKEN;
  if(!token){
    return res.status(503).json({ok:false,tokenConfigured:false,message:'MERCADOPAGO_ACCESS_TOKEN no está disponible en este despliegue.'});
  }
  const info={
    ok:false,
    tokenConfigured:true,
    tokenPrefix:token.slice(0,8),
    tokenLength:token.length,
    environment:process.env.VERCEL_ENV||'unknown'
  };
  try{
    const r=await fetch('https://api.mercadolibre.com/users/me',{headers:{authorization:`Bearer ${token}`,accept:'application/json'}});
    const data=await r.json().catch(()=>({}));
    info.authStatus=r.status;
    if(r.ok){
      info.ok=true;
      info.siteId=data.site_id||null;
      info.userType=data.user_type||null;
      info.message='Access Token reconocido por Mercado Pago/Mercado Libre.';
      return res.status(200).json(info);
    }
    info.message=data.message||data.error||'El proveedor rechazó el Access Token.';
    return res.status(502).json(info);
  }catch(e){
    info.message='No se pudo validar la credencial con el proveedor.';
    return res.status(500).json(info);
  }
}
