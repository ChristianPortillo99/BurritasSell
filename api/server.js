import http from 'node:http';
import { existsSync, symlinkSync } from 'node:fs';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { createToken, hashPassword, readToken, verifyPassword } from './auth.js';

const port = Number(process.env.API_PORT || 3001);
const origin = process.env.CORS_ORIGIN || 'http://localhost:5173';
const apiDir=dirname(fileURLToPath(import.meta.url));
function ensureSpreadsheetRuntime(){const link=join(apiDir,'node_modules');if(existsSync(link))return;const target=process.env.ARTIFACT_NODE_MODULES||join(homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','node','node_modules');if(!existsSync(target))throw httpError(503,'El generador de Excel no está disponible');symlinkSync(target,link,'junction');}
const send = (res, status, value) => { res.writeHead(status, {'content-type':'application/json; charset=utf-8','access-control-allow-origin':origin}); res.end(JSON.stringify(value)); };
const parseBody = async req => { const chunks=[]; for await (const chunk of req) chunks.push(chunk); if(!chunks.length) return {}; try{return JSON.parse(Buffer.concat(chunks));}catch{throw httpError(400,'JSON inválido');} };
const httpError = (status,message) => Object.assign(new Error(message),{status});
const required = (data,keys) => { const missing=keys.filter(k=>data[k]===undefined||data[k]===''); if(missing.length) throw httpError(400,`Campos requeridos: ${missing.join(', ')}`); };
const currentUser = req => { const payload=readToken(req.headers.authorization?.replace(/^Bearer /i,'')); return payload && db.prepare('SELECT id,name,email,role,point_of_sale_id,status FROM users WHERE id=?').get(payload.sub); };
const permit = (user,roles) => { if(!user||user.status!=='active'||!roles.includes(user.role)) throw httpError(403,'Sin permiso'); };
const audit=(userId,action,entityType,entityId,detail='')=>db.prepare('INSERT INTO audit_logs (user_id,action,entity_type,entity_id,detail) VALUES (?,?,?,?,?)').run(userId,action,entityType,entityId==null?null:String(entityId),detail);

async function route(req,res){
  if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':origin,'access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS'});return res.end();}
  const url=new URL(req.url,`http://${req.headers.host}`); const parts=url.pathname.split('/').filter(Boolean);
  if(url.pathname==='/api/health') return send(res,200,{status:'ok'});
  if(url.pathname==='/api/auth/login'&&req.method==='POST'){
    const data=await parseBody(req); required(data,['email','password']);
    const user=db.prepare('SELECT * FROM users WHERE email=?').get(data.email.toLowerCase());
    if(!user||user.status!=='active'||!verifyPassword(data.password,user.password_hash)) return send(res,401,{error:'Credenciales incorrectas'});
    audit(user.id,'LOGIN','session',user.id,'Inicio de sesión en el sistema');
    return send(res,200,{token:createToken(user),user:{id:user.id,name:user.name,email:user.email,role:user.role,pointOfSaleId:user.point_of_sale_id,image:user.image||''}});
  }
  const user=currentUser(req); if(!user) return send(res,401,{error:'Autenticación requerida'});
  if(url.pathname==='/api/me'&&req.method==='GET') return send(res,200,{data:user});
  if(url.pathname==='/api/me'&&req.method==='PATCH'){
    const d=await parseBody(req); required(d,['name','email']);
    db.prepare('UPDATE users SET name=?,email=?,phone=? WHERE id=?').run(d.name,d.email.toLowerCase(),d.phone||'',user.id);
    audit(user.id,'UPDATE','profile',user.id,'Actualizó su perfil personal');
    return send(res,200,{updated:true});
  }

  if(url.pathname==='/api/products'&&req.method==='GET') return send(res,200,{data:db.prepare("SELECT p.*,COALESCE(SUM(i.quantity),0) total_stock,COALESCE((SELECT SUM(si.quantity) FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE si.product_id=p.id AND s.status='completed' AND date(s.created_at,'-6 hours')=date('now','-6 hours')),0) sold_today FROM products p LEFT JOIN inventory i ON i.product_id=p.id GROUP BY p.id ORDER BY p.name").all()});
  if(url.pathname==='/api/products'&&req.method==='POST'){
    permit(user,['admin','manager']); const d=await parseBody(req); required(d,['sku','name','priceCents']);
    const result=db.prepare('INSERT INTO products (sku,name,description,price_cents,image) VALUES (?,?,?,?,?)').run(d.sku,d.name,d.description||'',Number(d.priceCents),d.image||'');
    audit(user.id,'CREATE','product',result.lastInsertRowid,`Creó el producto ${d.name} (${d.sku})`);
    return send(res,201,{id:Number(result.lastInsertRowid)});
  }
  if(parts[0]==='api'&&parts[1]==='products'&&parts.length===3&&req.method==='PATCH'){
    permit(user,['admin','manager']); const d=await parseBody(req); required(d,['name','priceCents']);
    db.prepare("UPDATE products SET name=?,description=?,price_cents=?,image=?,status=COALESCE(?,status),updated_at=CURRENT_TIMESTAMP WHERE id=?").run(d.name,d.description||'',Number(d.priceCents),d.image||'',d.status||null,Number(parts[2]));
    audit(user.id,'UPDATE','product',parts[2],`Modificó el producto ${d.name}`);
    return send(res,200,{updated:true});
  }
  if(parts[0]==='api'&&parts[1]==='products'&&parts.length===3&&req.method==='DELETE'){
    permit(user,['admin']); db.prepare("UPDATE products SET status='inactive',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(Number(parts[2]));audit(user.id,'DEACTIVATE','product',parts[2],'Desactivó un producto');return send(res,200,{inactive:true});
  }
  if(url.pathname==='/api/points-of-sale'&&req.method==='GET') return send(res,200,{data:db.prepare('SELECT * FROM points_of_sale ORDER BY name').all()});
  if(url.pathname==='/api/points-of-sale'&&req.method==='POST'){
    permit(user,['admin']); const d=await parseBody(req); required(d,['name','address']);
    const result=db.prepare('INSERT INTO points_of_sale (name,address) VALUES (?,?)').run(d.name,d.address);audit(user.id,'CREATE','point_of_sale',result.lastInsertRowid,`Creó el punto de venta ${d.name}`);return send(res,201,{id:Number(result.lastInsertRowid)});
  }
  if(parts[0]==='api'&&parts[1]==='points-of-sale'&&parts.length===3&&req.method==='PATCH'){
    permit(user,['admin']); const d=await parseBody(req); required(d,['name','address']);
    db.prepare('UPDATE points_of_sale SET name=?,address=?,status=COALESCE(?,status) WHERE id=?').run(d.name,d.address,d.status||null,Number(parts[2]));
    audit(user.id,'UPDATE','point_of_sale',parts[2],`Modificó el punto de venta ${d.name}`);
    return send(res,200,{updated:true});
  }
  if(parts[0]==='api'&&parts[1]==='points-of-sale'&&parts.length===3&&req.method==='DELETE'){
    permit(user,['admin']);db.prepare("UPDATE points_of_sale SET status='inactive' WHERE id=?").run(Number(parts[2]));audit(user.id,'DEACTIVATE','point_of_sale',parts[2],'Cerró un punto de venta');return send(res,200,{inactive:true});
  }
  if(url.pathname==='/api/users'&&req.method==='GET'){
    permit(user,['admin','manager']); return send(res,200,{data:db.prepare('SELECT id,employee_code,name,email,role,point_of_sale_id,status,shift,image,phone,created_at FROM users ORDER BY name').all()});
  }
  if(url.pathname==='/api/users'&&req.method==='POST'){
    permit(user,['admin']); const d=await parseBody(req); required(d,['employeeCode','name','email','password','role']);
    const result=db.prepare('INSERT INTO users (employee_code,name,email,password_hash,role,point_of_sale_id,shift,image) VALUES (?,?,?,?,?,?,?,?)').run(d.employeeCode,d.name,d.email.toLowerCase(),hashPassword(d.password),d.role,d.pointOfSaleId||null,d.shift||'',d.image||'');
    audit(user.id,'CREATE','user',result.lastInsertRowid,`Creó el empleado ${d.name} (${d.employeeCode})`);
    return send(res,201,{id:Number(result.lastInsertRowid)});
  }
  if(parts[0]==='api'&&parts[1]==='users'&&parts.length===3&&req.method==='PATCH'){
    permit(user,['admin']); const d=await parseBody(req); required(d,['name','email','role']);
    const passwordSql=d.password?',password_hash=?':''; const values=[d.name,d.email.toLowerCase(),d.role,d.pointOfSaleId||null,d.status||'active',d.shift||'',d.image||''];
    if(d.password) values.push(hashPassword(d.password)); values.push(Number(parts[2]));
    db.prepare(`UPDATE users SET name=?,email=?,role=?,point_of_sale_id=?,status=?,shift=?,image=?${passwordSql} WHERE id=?`).run(...values);
    audit(user.id,'UPDATE','user',parts[2],`Modificó el empleado ${d.name}`);
    return send(res,200,{updated:true});
  }
  if(parts[0]==='api'&&parts[1]==='users'&&parts.length===3&&req.method==='DELETE'){
    permit(user,['admin']);const target=Number(parts[2]);if(target===user.id)throw httpError(409,'No puedes desactivar tu propia cuenta');db.prepare("UPDATE users SET status='inactive' WHERE id=?").run(target);audit(user.id,'DEACTIVATE','user',target,'Desactivó un empleado');return send(res,200,{inactive:true});
  }
  if(parts[0]==='api'&&parts[1]==='inventory'&&parts.length===3&&req.method==='GET'){
    const pointId=Number(parts[2]); if(user.role==='seller'&&user.point_of_sale_id!==pointId) throw httpError(403,'Sin permiso');
    const data=db.prepare(`SELECT p.id,p.sku,p.name,p.price_cents,COALESCE(i.quantity,0) quantity,COALESCE(i.min_quantity,0) min_quantity FROM products p LEFT JOIN inventory i ON i.product_id=p.id AND i.point_of_sale_id=? WHERE p.status='active' ORDER BY p.name`).all(pointId);
    return send(res,200,{data});
  }
  if(url.pathname==='/api/inventory/adjustments'&&req.method==='POST'){
    permit(user,['admin','manager']); const d=await parseBody(req); required(d,['pointOfSaleId','productId','quantityDelta']); const delta=Number(d.quantityDelta);
    db.exec('BEGIN'); try{
      const current=db.prepare('SELECT quantity FROM inventory WHERE point_of_sale_id=? AND product_id=?').get(d.pointOfSaleId,d.productId)?.quantity||0;
      if(!Number.isInteger(delta)||current+delta<0) throw httpError(409,'El ajuste dejaría inventario negativo');
      db.prepare('INSERT OR IGNORE INTO inventory (point_of_sale_id,product_id,quantity) VALUES (?,?,0)').run(d.pointOfSaleId,d.productId);
      const inventory=db.prepare('UPDATE inventory SET quantity=quantity+? WHERE point_of_sale_id=? AND product_id=? RETURNING quantity').get(delta,d.pointOfSaleId,d.productId);
      db.prepare('INSERT INTO inventory_movements (point_of_sale_id,product_id,user_id,type,quantity_delta,note) VALUES (?,?,?,?,?,?)').run(d.pointOfSaleId,d.productId,user.id,delta>=0?'entry':'adjustment',delta,d.note||null);
      audit(user.id,'ADJUST','inventory',`${d.pointOfSaleId}:${d.productId}`,`Ajustó inventario en ${delta>0?'+':''}${delta}. ${d.note||''}`);
      db.exec('COMMIT'); return send(res,201,{quantity:inventory.quantity});
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  if(url.pathname==='/api/sales'&&req.method==='POST'){
    const d=await parseBody(req); required(d,['pointOfSaleId','items']); const pointId=Number(d.pointOfSaleId);
    if(user.role!=='admin'&&user.point_of_sale_id!==pointId) throw httpError(403,'Solo puedes reportar ventas en tu punto asignado');
    if(!Array.isArray(d.items)||!d.items.length) throw httpError(400,'La venta requiere productos');
    db.exec('BEGIN'); try{
      let total=0; const items=d.items.map(item=>{const product=db.prepare("SELECT id,price_cents FROM products WHERE id=? AND status='active'").get(item.productId); const stock=db.prepare('SELECT quantity FROM inventory WHERE point_of_sale_id=? AND product_id=?').get(pointId,item.productId); const quantity=Number(item.quantity); if(!product||!Number.isInteger(quantity)||quantity<=0) throw httpError(400,'Producto o cantidad inválida'); if(!stock||stock.quantity<quantity) throw httpError(409,`Inventario insuficiente para producto ${item.productId}`); total+=product.price_cents*quantity; return {product,quantity};});
      const saleNumber=`V-${Date.now()}`; const sale=db.prepare('INSERT INTO sales (sale_number,point_of_sale_id,seller_id,total_cents) VALUES (?,?,?,?)').run(saleNumber,pointId,user.id,total);
      for(const item of items){db.prepare('INSERT INTO sale_items (sale_id,product_id,quantity,unit_price_cents,subtotal_cents) VALUES (?,?,?,?,?)').run(sale.lastInsertRowid,item.product.id,item.quantity,item.product.price_cents,item.quantity*item.product.price_cents);db.prepare('UPDATE inventory SET quantity=quantity-? WHERE point_of_sale_id=? AND product_id=?').run(item.quantity,pointId,item.product.id);db.prepare('INSERT INTO inventory_movements (point_of_sale_id,product_id,user_id,type,quantity_delta,reference_type,reference_id) VALUES (?,?,?,?,?,?,?)').run(pointId,item.product.id,user.id,'sale',-item.quantity,'sale',sale.lastInsertRowid);}
      audit(user.id,'REPORT','sale',sale.lastInsertRowid,`Generó el reporte ${saleNumber} por ${items.reduce((sum,item)=>sum+item.quantity,0)} unidades`);
      db.exec('COMMIT'); return send(res,201,{id:Number(sale.lastInsertRowid),saleNumber,totalCents:total});
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  if(url.pathname==='/api/sales'&&req.method==='GET'){
    const base='SELECT s.*,u.name seller_name,p.name point_of_sale_name FROM sales s JOIN users u ON u.id=s.seller_id JOIN points_of_sale p ON p.id=s.point_of_sale_id';
    const data=user.role==='seller'?db.prepare(`${base} WHERE s.point_of_sale_id=? ORDER BY s.created_at DESC`).all(user.point_of_sale_id):db.prepare(`${base} ORDER BY s.created_at DESC`).all(); return send(res,200,{data});
  }
  if(url.pathname==='/api/notifications'&&req.method==='GET'){
    permit(user,['admin']);
    const data=db.prepare("SELECT s.id,s.sale_number,s.total_cents,s.created_at,u.name user_name,p.name point_name,(SELECT COALESCE(SUM(si.quantity),0) FROM sale_items si WHERE si.sale_id=s.id) units FROM sales s JOIN users u ON u.id=s.seller_id JOIN points_of_sale p ON p.id=s.point_of_sale_id WHERE s.status='completed' ORDER BY s.created_at DESC,s.id DESC LIMIT 15").all();
    return send(res,200,{data});
  }
  if(url.pathname==='/api/audit-logs'&&req.method==='GET'){
    permit(user,['admin']);const data=db.prepare("SELECT a.id,a.action,a.entity_type,a.entity_id,a.detail,a.created_at,COALESCE(u.name,'Usuario eliminado') user_name,COALESCE(u.employee_code,'—') employee_code FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC,a.id DESC LIMIT 300").all();return send(res,200,{data});
  }
  if(url.pathname==='/api/reports/sales.xlsx'&&req.method==='GET'){
    ensureSpreadsheetRuntime();const scoped=user.role==='admin'?'':' WHERE s.point_of_sale_id=?';const params=user.role==='admin'?[]:[user.point_of_sale_id];
    const sales=db.prepare(`SELECT s.sale_number,s.created_at,p.name point_name,u.name user_name,pr.name product_name,si.quantity,si.unit_price_cents,si.subtotal_cents FROM sales s JOIN sale_items si ON si.sale_id=s.id JOIN products pr ON pr.id=si.product_id JOIN points_of_sale p ON p.id=s.point_of_sale_id JOIN users u ON u.id=s.seller_id${scoped} AND s.status='completed' ORDER BY s.created_at DESC,s.id DESC`).all(...params);
    const pointWhere=user.role==='admin'?'':' WHERE p.id=?';const points=db.prepare(`SELECT p.name,p.status,COALESCE(SUM(i.quantity),0) stock,COALESCE((SELECT SUM(si.quantity) FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.point_of_sale_id=p.id AND s.status='completed'),0) units,COALESCE((SELECT SUM(s.total_cents) FROM sales s WHERE s.point_of_sale_id=p.id AND s.status='completed'),0) revenue_cents FROM points_of_sale p LEFT JOIN inventory i ON i.point_of_sale_id=p.id${pointWhere} GROUP BY p.id ORDER BY p.name`).all(...params);
    const weekWhere=user.role==='admin'?'':" AND point_of_sale_id=?";const week=db.prepare(`SELECT date(created_at,'-6 hours') day,SUM(total_cents) revenue_cents FROM sales WHERE status='completed' AND date(created_at,'-6 hours')>=date('now','-6 hours','-6 days')${weekWhere} GROUP BY day ORDER BY day`).all(...params);
    const {exportSalesReport}=await import('./export-report.mjs');const file=await exportSalesReport({generatedAt:new Intl.DateTimeFormat('es-HN',{dateStyle:'full',timeStyle:'short',timeZone:'America/Tegucigalpa'}).format(new Date()),reportCount:new Set(sales.map(row=>row.sale_number)).size,sales:sales.map(row=>({saleNumber:row.sale_number,createdAt:`${row.created_at.replace(' ','T')}Z`,pointName:row.point_name,userName:row.user_name,productName:row.product_name,quantity:row.quantity,unitPriceCents:row.unit_price_cents,subtotalCents:row.subtotal_cents})),points:points.map(row=>({name:row.name,status:row.status,units:row.units,stock:row.stock,revenueCents:row.revenue_cents})),week:week.map(row=>({day:row.day,revenueCents:row.revenue_cents}))});
    const exportDir=join(apiDir,'data','exports');await mkdir(exportDir,{recursive:true});const tempPath=join(exportDir,`reporte-${Date.now()}.xlsx`);await file.save(tempPath);const bytes=await readFile(tempPath);await unlink(tempPath);const filename=`reporte-ventas-${new Date().toISOString().slice(0,10)}.xlsx`;res.writeHead(200,{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','content-disposition':`attachment; filename="${filename}"`,'content-length':bytes.length,'access-control-allow-origin':origin});return res.end(bytes);
  }
  if(url.pathname==='/api/dashboard'&&req.method==='GET'){
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Tegucigalpa'}).format(new Date());
    const totals=db.prepare("SELECT COALESCE(SUM(total_cents),0) revenue_cents,COUNT(*) sales_count FROM sales WHERE status='completed' AND date(created_at,'-6 hours')=?").get(today);
    const units=db.prepare("SELECT COALESCE(SUM(si.quantity),0) units FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.status='completed' AND date(s.created_at,'-6 hours')=?").get(today).units;
    const stock=db.prepare('SELECT COALESCE(SUM(quantity),0) quantity FROM inventory').get().quantity;
    const points=db.prepare("SELECT COUNT(*) total,SUM(status='active') active FROM points_of_sale").get();
    const topProducts=db.prepare("SELECT p.id,p.sku,p.name,p.price_cents,COALESCE(SUM(si.quantity),0) sold,COALESCE(SUM(si.subtotal_cents),0) revenue_cents FROM products p LEFT JOIN sale_items si ON si.product_id=p.id LEFT JOIN sales s ON s.id=si.sale_id AND s.status='completed' AND date(s.created_at,'-6 hours')=? GROUP BY p.id ORDER BY sold DESC,p.name LIMIT 4").all(today);
    const byPoint=db.prepare("SELECT p.id,p.name,p.address,p.status,COALESCE(SUM(i.quantity),0) stock,COALESCE((SELECT SUM(si.quantity) FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.point_of_sale_id=p.id AND s.status='completed' AND date(s.created_at,'-6 hours')=?),0) sold FROM points_of_sale p LEFT JOIN inventory i ON i.point_of_sale_id=p.id GROUP BY p.id ORDER BY p.name").all(today);
    const week=db.prepare("SELECT date(created_at,'-6 hours') day,SUM(total_cents) revenue_cents FROM sales WHERE status='completed' AND date(created_at,'-6 hours')>=date(?,'-6 days') GROUP BY day ORDER BY day").all(today);
    return send(res,200,{data:{date:today,revenueCents:totals.revenue_cents,salesCount:totals.sales_count,unitsSold:units,remainingStock:stock,pointsActive:points.active||0,pointsTotal:points.total,topProducts,points:byPoint,week}});
  }
  return send(res,404,{error:'Ruta no encontrada'});
}

http.createServer((req,res)=>route(req,res).catch(error=>{console.error(error);const conflict=/UNIQUE|CHECK|FOREIGN KEY/.test(error.message);send(res,error.status||(conflict?409:500),{error:error.status?error.message:'No se pudo procesar la solicitud'});})).listen(port,()=>console.log(`API Burrita lista en http://localhost:${port}`));
