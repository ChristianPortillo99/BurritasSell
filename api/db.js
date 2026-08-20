import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './auth.js';

const dbPath = resolve(process.env.DB_PATH || 'api/data/burritas.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS points_of_sale (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, address TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, employee_code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','manager','seller')),
 point_of_sale_id INTEGER REFERENCES points_of_sale(id), status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
 id INTEGER PRIMARY KEY, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 price_cents INTEGER NOT NULL CHECK(price_cents >= 0), status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS inventory (
 point_of_sale_id INTEGER NOT NULL REFERENCES points_of_sale(id), product_id INTEGER NOT NULL REFERENCES products(id),
 quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0), min_quantity INTEGER NOT NULL DEFAULT 0 CHECK(min_quantity >= 0),
 PRIMARY KEY(point_of_sale_id, product_id)
);
CREATE TABLE IF NOT EXISTS sales (
 id INTEGER PRIMARY KEY, sale_number TEXT NOT NULL UNIQUE, point_of_sale_id INTEGER NOT NULL REFERENCES points_of_sale(id),
 seller_id INTEGER NOT NULL REFERENCES users(id), total_cents INTEGER NOT NULL CHECK(total_cents >= 0),
 status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','voided')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sale_items (
 id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id), product_id INTEGER NOT NULL REFERENCES products(id),
 quantity INTEGER NOT NULL CHECK(quantity > 0), unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0), subtotal_cents INTEGER NOT NULL CHECK(subtotal_cents >= 0)
);
CREATE TABLE IF NOT EXISTS inventory_movements (
 id INTEGER PRIMARY KEY, point_of_sale_id INTEGER NOT NULL REFERENCES points_of_sale(id), product_id INTEGER NOT NULL REFERENCES products(id),
 user_id INTEGER NOT NULL REFERENCES users(id), type TEXT NOT NULL CHECK(type IN ('entry','sale','adjustment','void')),
 quantity_delta INTEGER NOT NULL, reference_type TEXT, reference_id INTEGER, note TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_logs (
 id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), action TEXT NOT NULL, entity_type TEXT NOT NULL,
 entity_id TEXT, detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

const userColumns = db.prepare('PRAGMA table_info(users)').all().map(column => column.name);
if (!userColumns.includes('shift')) db.exec("ALTER TABLE users ADD COLUMN shift TEXT NOT NULL DEFAULT ''");
if (!userColumns.includes('image')) db.exec("ALTER TABLE users ADD COLUMN image TEXT NOT NULL DEFAULT ''");
if (!userColumns.includes('phone')) db.exec("ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''");
const productColumns = db.prepare('PRAGMA table_info(products)').all().map(column => column.name);
if (!productColumns.includes('image')) db.exec("ALTER TABLE products ADD COLUMN image TEXT NOT NULL DEFAULT ''");

if (!db.prepare('SELECT id FROM points_of_sale LIMIT 1').get())
  db.prepare('INSERT INTO points_of_sale (name,address) VALUES (?,?)').run('Oficina Principal', 'Tegucigalpa');
if (!db.prepare('SELECT id FROM users LIMIT 1').get()) {
  const point = db.prepare('SELECT id FROM points_of_sale LIMIT 1').get();
  db.prepare('INSERT INTO users (employee_code,name,email,password_hash,role,point_of_sale_id) VALUES (?,?,?,?,?,?)')
    .run('EMP-001', 'Administrador', 'admin@burrita.hn', hashPassword(process.env.SEED_ADMIN_PASSWORD || 'burrita123'), 'admin', point.id);
}

if (!db.prepare('SELECT id FROM products LIMIT 1').get()) {
  const insertPoint = db.prepare('INSERT OR IGNORE INTO points_of_sale (name,address,status) VALUES (?,?,?)');
  insertPoint.run('Mall Multiplaza', 'Blvd. Juan Pablo II', 'active');
  insertPoint.run('Parque Central', 'Centro de Tegucigalpa', 'active');
  insertPoint.run('UTH Campus', 'Blvd. Centroamérica', 'active');

  const insertProduct = db.prepare('INSERT INTO products (sku,name,description,price_cents) VALUES (?,?,?,?)');
  insertProduct.run('BR-001', 'Burrita Clásica', 'Frijol, queso y crema', 3500);
  insertProduct.run('BR-002', 'Burrita de Pollo', 'Pollo, frijol y queso', 4500);
  insertProduct.run('BR-003', 'Burrita Especial', 'Carne, aguacate y queso', 5500);
  insertProduct.run('EX-004', 'Café de olla', 'Café artesanal 12 oz', 2500);
  insertProduct.run('EX-005', 'Horchata', 'Bebida natural 16 oz', 3000);

  const inventory = db.prepare('INSERT INTO inventory (point_of_sale_id,product_id,quantity,min_quantity) VALUES (?,?,?,?)');
  for (const point of db.prepare("SELECT id FROM points_of_sale WHERE status='active'").all())
    for (const product of db.prepare("SELECT id FROM products WHERE status='active'").all()) inventory.run(point.id, product.id, 20, 5);
}
