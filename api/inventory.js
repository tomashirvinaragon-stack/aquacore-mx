import { dbConfigured, listInventory } from './_db.js';

export default async function handler(req,res){
  res.setHeader('cache-control','no-store');
  if(req.method!=='GET') return res.status(405).json({error:'Método no permitido'});

  if(!dbConfigured()){
    return res.status(200).json({ok:true,configured:false,inventory:[]});
  }

  try{
    const rows=await listInventory();
    return res.status(200).json({
      ok:true,
      configured:true,
      inventory:(Array.isArray(rows)?rows:[]).map(x=>({
        product_id:Number(x.product_id),
        stock:Number(x.stock||0),
        low_stock_threshold:Number(x.low_stock_threshold||0),
        managed:Boolean(x.managed),
        updated_at:x.updated_at||null
      }))
    });
  }catch(err){
    console.error('Public inventory error',err);
    return res.status(200).json({ok:true,configured:false,inventory:[]});
  }
}
