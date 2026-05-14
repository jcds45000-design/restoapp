-- ============================================
-- MIGRATION 2 : Adaptation au modèle de l'app
-- ============================================

-- 1. Corriger la contrainte status des tâches
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('todo', 'doing', 'done', 'in_progress'));

-- 2. Colonnes supplémentaires pour les tâches
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_name text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_by_name text;

-- 3. Colonnes supplémentaires pour les produits
ALTER TABLE products ADD COLUMN IF NOT EXISTS qty numeric DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS seuil numeric DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS seuil_orange numeric DEFAULT 0;

-- 4. Remplacer les produits par des données compatibles avec l'app
DELETE FROM products;
INSERT INTO products (name, category, unit, qty, seuil, seuil_orange, stock_current, stock_min) VALUES
  ('Poulet (cuisses désossées)', 'Viandes & Poissons', 'kg', 3.5, 5, 8, 3.5, 5),
  ('Porc haché', 'Viandes & Poissons', 'kg', 2, 3, 5, 2, 3),
  ('Crevettes décortiquées', 'Viandes & Poissons', 'kg', 1.5, 2, 3, 1.5, 2),
  ('Huile de friture', 'Sec & Féculents', 'L', 2, 5, 8, 2, 5),
  ('Chapelure panko', 'Sec & Féculents', 'kg', 0.8, 2, 3, 0.8, 2),
  ('Riz à sushi', 'Sec & Féculents', 'kg', 4, 5, 8, 4, 5),
  ('Farine de blé', 'Sec & Féculents', 'kg', 3, 2, 4, 3, 2),
  ('Sauce gochujang', 'Sauces & Condiments', 'kg', 1.2, 2, 3, 1.2, 2),
  ('Sauce soja', 'Sauces & Condiments', 'L', 2.5, 1.5, 3, 2.5, 1.5),
  ('Vinaigre de riz', 'Sauces & Condiments', 'L', 1, 0.5, 1.5, 1, 0.5),
  ('Huile de sésame', 'Sauces & Condiments', 'L', 0.3, 0.5, 1, 0.3, 0.5),
  ('Oignons verts', 'Légumes & Frais', 'bottes', 15, 5, 10, 15, 5),
  ('Chou chinois', 'Légumes & Frais', 'pièces', 3, 4, 6, 3, 4),
  ('Carottes', 'Légumes & Frais', 'kg', 2, 2, 4, 2, 2),
  ('Coca-Cola 33cl', 'Boissons', 'canettes', 24, 12, 24, 24, 12),
  ('Eau plate 50cl', 'Boissons', 'bouteilles', 18, 12, 20, 18, 12),
  ('Barquettes kraft M', 'Emballages & Consommables', 'pièces', 80, 50, 100, 80, 50),
  ('Baguettes jetables', 'Emballages & Consommables', 'paires', 200, 100, 200, 200, 100),
  ('Serviettes', 'Emballages & Consommables', 'pièces', 150, 100, 250, 150, 100),
  ('Gobelets 40cl', 'Emballages & Consommables', 'pièces', 45, 50, 80, 45, 50);

-- 5. Remplacer les employés par les noms de l'app
DELETE FROM employees;
INSERT INTO employees (name, role, color, phone, email) VALUES
  ('Yuna', 'Cuisine', '#FF6B2B', '06 12 34 56 78', 'yuna@kimiko.fr'),
  ('Lucas', 'Caisse', '#FF4757', '06 23 45 67 89', 'lucas@kimiko.fr'),
  ('Mina', 'Cuisine', '#FFD93D', '06 34 56 78 90', 'mina@kimiko.fr'),
  ('Théo', 'Salle', '#2ED573', '06 45 67 89 01', 'theo@kimiko.fr'),
  ('Sofia', 'Plonge', '#1E90FF', '06 56 78 90 12', 'sofia@kimiko.fr');
