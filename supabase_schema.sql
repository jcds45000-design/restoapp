-- ============================================
-- KIMIKO RESTOAPP - Schéma de base de données
-- ============================================

-- Extension UUID
create extension if not exists "uuid-ossp";

-- ============================================
-- TABLE: employees (Équipe)
-- ============================================
create table if not exists employees (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  role text not null,
  color text default '#FF6B2B',
  avatar text default '',
  phone text default '',
  email text default '',
  active boolean default true,
  created_at timestamptz default now()
);

-- ============================================
-- TABLE: schedule (Planning)
-- ============================================
create table if not exists schedule (
  id uuid primary key default uuid_generate_v4(),
  employee_id uuid references employees(id) on delete cascade,
  date date not null,
  shift text not null check (shift in ('matin','midi','soir','repos','conge')),
  start_time text default '',
  end_time text default '',
  note text default '',
  created_at timestamptz default now(),
  unique(employee_id, date)
);

-- ============================================
-- TABLE: tasks (Tâches)
-- ============================================
create table if not exists tasks (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  description text default '',
  assigned_to uuid references employees(id) on delete set null,
  due_date date,
  priority text default 'medium' check (priority in ('low','medium','high','urgent')),
  status text default 'todo' check (status in ('todo','in_progress','done')),
  category text default 'general',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================
-- TABLE: products (Stock)
-- ============================================
create table if not exists products (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  category text not null,
  unit text default 'kg',
  stock_current numeric default 0,
  stock_min numeric default 0,
  stock_max numeric default 100,
  price_unit numeric default 0,
  supplier text default '',
  active boolean default true,
  created_at timestamptz default now()
);

-- ============================================
-- TABLE: stock_movements (Mouvements de stock)
-- ============================================
create table if not exists stock_movements (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references products(id) on delete cascade,
  type text not null check (type in ('in','out','adjustment')),
  quantity numeric not null,
  reason text default '',
  employee_id uuid references employees(id) on delete set null,
  created_at timestamptz default now()
);

-- ============================================
-- TABLE: orders (Commandes / CA)
-- ============================================
create table if not exists orders (
  id uuid primary key default uuid_generate_v4(),
  order_number text not null unique,
  table_number text default '',
  items jsonb default '[]',
  total numeric default 0,
  status text default 'pending' check (status in ('pending','preparing','ready','served','cancelled')),
  payment_method text default 'cash' check (payment_method in ('cash','card','online')),
  notes text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================
-- TABLE: menu_items (Menu)
-- ============================================
create table if not exists menu_items (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text default '',
  category text not null,
  price numeric not null default 0,
  image_url text default '',
  available boolean default true,
  preparation_time int default 10,
  tags text[] default '{}',
  created_at timestamptz default now()
);

-- ============================================
-- DONNÉES INITIALES - Employés
-- ============================================
insert into employees (name, role, color) values
  ('Yuki Tanaka', 'Chef', '#FF6B2B'),
  ('Marie Dupont', 'Service', '#FF4757'),
  ('Jin Park', 'Cuisine', '#FFD93D'),
  ('Sophie Martin', 'Caisse', '#2ED573'),
  ('Kenji Mori', 'Livreur', '#1E90FF')
on conflict do nothing;

-- ============================================
-- DONNÉES INITIALES - Produits
-- ============================================
insert into products (name, category, unit, stock_current, stock_min, price_unit) values
  ('Riz Japonais', 'Céréales', 'kg', 15, 5, 2.50),
  ('Saumon', 'Poissons', 'kg', 3, 2, 18.00),
  ('Sauce Soja', 'Condiments', 'L', 8, 3, 4.50),
  ('Mirin', 'Condiments', 'L', 2, 2, 6.00),
  ('Nori', 'Épicerie', 'paquet', 12, 5, 3.20),
  ('Poulet', 'Viandes', 'kg', 8, 3, 7.50),
  ('Kimchi', 'Fermentés', 'kg', 4, 2, 9.00),
  ('Gochujang', 'Condiments', 'kg', 3, 1, 8.50),
  ('Tofu', 'Végétarien', 'kg', 6, 2, 4.00),
  ('Concombre', 'Légumes', 'kg', 5, 2, 1.80)
on conflict do nothing;

-- ============================================
-- DONNÉES INITIALES - Menu
-- ============================================
insert into menu_items (name, category, price, preparation_time, tags) values
  ('Ramen Tonkotsu', 'Plats', 14.50, 15, '{populaire,chaud}'),
  ('Sushi Saumon x8', 'Sushi', 16.00, 10, '{frais,populaire}'),
  ('Bibimbap', 'Plats', 13.50, 12, '{coréen,végé-option}'),
  ('Gyoza x6', 'Entrées', 7.50, 8, '{frit,populaire}'),
  ('Miso Soupe', 'Entrées', 4.00, 5, '{léger,végé}'),
  ('Chicken Katsu', 'Plats', 15.00, 14, '{croustillant}'),
  ('Tteokbokki', 'Plats', 12.00, 10, '{coréen,épicé}'),
  ('Matcha Latte', 'Boissons', 5.50, 3, '{froid,chaud}'),
  ('Ramune', 'Boissons', 3.50, 1, '{japonais,froid}'),
  ('Mochi x3', 'Desserts', 6.50, 2, '{japonais,sucré}')
on conflict do nothing;

-- ============================================
-- RLS (Row Level Security) - Désactivé pour dev
-- À activer en production avec des policies appropriées
-- ============================================
alter table employees enable row level security;
alter table schedule enable row level security;
alter table tasks enable row level security;
alter table products enable row level security;
alter table stock_movements enable row level security;
alter table orders enable row level security;
alter table menu_items enable row level security;

-- Policies temporaires (accès total pour dev)
create policy "allow all employees" on employees for all using (true) with check (true);
create policy "allow all schedule" on schedule for all using (true) with check (true);
create policy "allow all tasks" on tasks for all using (true) with check (true);
create policy "allow all products" on products for all using (true) with check (true);
create policy "allow all stock_movements" on stock_movements for all using (true) with check (true);
create policy "allow all orders" on orders for all using (true) with check (true);
create policy "allow all menu_items" on menu_items for all using (true) with check (true);
