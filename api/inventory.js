import { dbConfigured, listInventory } from './_db.js';

// Browsing reads the snapshot. Imports and sync stay in authenticated admin APIs.
export default async function handler(req,res){
  res.setHeader('cache-control','no-store');
  if(req.method!=='GET')return res.status(405).json({error:'Método no permitido'});
  if(!dbConfigured())return res.status(200).json({ok:true,configured:false,inventory:[]});
  try{
    const rows=await listInventory();
    return res.status(200).json({ok:true,configured:true,inventory:rows.map(x=>({
      product_id:Number(x.product_id),stock:Number(x.stock||0),
      low_stock_threshold:2,managed:Boolean(x.managed),updated_at:x.updated_at||null
    }))});
  }catch(err){
    console.error('Inventory snapshot unavailable');
    return res.status(503).json({ok:false,configured:false,inventory:[],error:'Inventario temporalmente no disponible'});
  }
}
