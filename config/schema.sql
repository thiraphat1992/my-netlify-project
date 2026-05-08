-- ============================================
-- BizFlow Database Schema for Supabase
-- รันใน Supabase SQL Editor
-- ============================================

-- ========== AUTH / USERS ==========
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'staff', -- admin, manager, staff, accountant
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========== รายรับ-รายจ่าย ==========
CREATE TABLE IF NOT EXISTS transaction_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense')),
  code VARCHAR(50), -- รหัสบัญชี สำหรับสรรพากร
  tax_category VARCHAR(100), -- หมวดหมู่ภาษี
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  parent_id UUID REFERENCES transaction_categories(id),
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense')),
  category_id UUID REFERENCES transaction_categories(id),
  amount DECIMAL(15,2) NOT NULL,
  vat_amount DECIMAL(15,2) DEFAULT 0,
  wht_amount DECIMAL(15,2) DEFAULT 0, -- ภาษีหัก ณ ที่จ่าย
  net_amount DECIMAL(15,2) NOT NULL,
  description TEXT NOT NULL,
  reference_no VARCHAR(100), -- เลขที่เอกสารอ้างอิง
  transaction_date DATE NOT NULL,
  payment_method VARCHAR(50), -- cash, transfer, check, credit
  bank_account VARCHAR(100),
  document_url TEXT, -- ไฟล์แนบ
  tax_invoice_no VARCHAR(100), -- เลขที่ใบกำกับภาษี
  vendor_name VARCHAR(255),
  vendor_tax_id VARCHAR(20),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========== สินค้า ==========
CREATE TABLE IF NOT EXISTS product_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(100) UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category_id UUID REFERENCES product_categories(id),
  unit VARCHAR(50) DEFAULT 'ชิ้น',
  cost_price DECIMAL(15,2) DEFAULT 0,     -- ราคาต้นทุน
  retail_price DECIMAL(15,2) DEFAULT 0,   -- ราคาขายปลีก
  wholesale_price DECIMAL(15,2) DEFAULT 0, -- ราคาขายส่ง
  vat_type VARCHAR(20) DEFAULT 'vat7',    -- vat7, vat0, exempt
  stock_qty DECIMAL(15,3) DEFAULT 0,
  min_stock DECIMAL(15,3) DEFAULT 0,
  image_url TEXT,
  barcode VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========== ลูกค้า ==========
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(100),
  name VARCHAR(255) NOT NULL,
  tax_id VARCHAR(20),
  branch_name VARCHAR(100) DEFAULT 'สำนักงานใหญ่',
  branch_code VARCHAR(10) DEFAULT '00000',
  address TEXT,
  province VARCHAR(100),
  postal_code VARCHAR(10),
  phone VARCHAR(50),
  email VARCHAR(255),
  contact_person VARCHAR(255),
  credit_days INT DEFAULT 0,
  credit_limit DECIMAL(15,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========== การขาย / บิล ==========
CREATE TABLE IF NOT EXISTS sale_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no VARCHAR(100) UNIQUE NOT NULL,
  doc_type VARCHAR(50) NOT NULL, -- receipt, invoice, delivery_note, billing_note, po
  doc_date DATE NOT NULL,
  due_date DATE,
  customer_id UUID REFERENCES customers(id),
  customer_name VARCHAR(255), -- snapshot
  customer_address TEXT,       -- snapshot
  customer_tax_id VARCHAR(20),
  subtotal DECIMAL(15,2) DEFAULT 0,
  discount_amount DECIMAL(15,2) DEFAULT 0,
  vat_amount DECIMAL(15,2) DEFAULT 0,
  total DECIMAL(15,2) DEFAULT 0,
  wht_amount DECIMAL(15,2) DEFAULT 0,
  net_payable DECIMAL(15,2) DEFAULT 0,
  payment_method VARCHAR(50),
  payment_status VARCHAR(50) DEFAULT 'pending', -- pending, paid, partial, cancelled
  print_size VARCHAR(20) DEFAULT 'a4', -- a4, 9x11, 9x5.5, thermal
  notes TEXT,
  internal_notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sale_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES sale_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  product_code VARCHAR(100),
  product_name VARCHAR(255) NOT NULL,
  unit VARCHAR(50),
  qty DECIMAL(15,3) NOT NULL,
  unit_price DECIMAL(15,2) NOT NULL,
  price_type VARCHAR(20) DEFAULT 'retail', -- retail, wholesale, custom
  discount_pct DECIMAL(5,2) DEFAULT 0,
  discount_amount DECIMAL(15,2) DEFAULT 0,
  vat_type VARCHAR(20) DEFAULT 'vat7',
  line_total DECIMAL(15,2) NOT NULL,
  sort_order INT DEFAULT 0
);

-- ========== HR ==========
CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  manager_id UUID,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(100) UNIQUE NOT NULL,
  title VARCHAR(20), -- นาย, นาง, นางสาว
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  nickname VARCHAR(100),
  national_id VARCHAR(20),
  birth_date DATE,
  gender VARCHAR(10),
  phone VARCHAR(50),
  email VARCHAR(255),
  address TEXT,
  department_id UUID REFERENCES departments(id),
  position VARCHAR(255),
  employment_type VARCHAR(50) DEFAULT 'full_time', -- full_time, part_time, contract
  start_date DATE NOT NULL,
  end_date DATE,
  base_salary DECIMAL(15,2) DEFAULT 0,
  salary_type VARCHAR(20) DEFAULT 'monthly', -- monthly, daily, hourly
  bank_name VARCHAR(100),
  bank_account VARCHAR(50),
  social_security_id VARCHAR(20),
  tax_id VARCHAR(20),
  photo_url TEXT,
  status VARCHAR(20) DEFAULT 'active', -- active, resigned, terminated
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payroll_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_name VARCHAR(100) NOT NULL, -- เช่น "เมษายน 2567"
  year INT NOT NULL,
  month INT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  pay_date DATE,
  status VARCHAR(20) DEFAULT 'draft', -- draft, approved, paid
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payroll_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID REFERENCES payroll_periods(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id),
  working_days INT DEFAULT 0,
  leave_days INT DEFAULT 0,
  base_salary DECIMAL(15,2) DEFAULT 0,
  ot_hours DECIMAL(8,2) DEFAULT 0,
  ot_amount DECIMAL(15,2) DEFAULT 0,
  bonus DECIMAL(15,2) DEFAULT 0,
  allowance DECIMAL(15,2) DEFAULT 0,  -- ค่าเดินทาง, ค่าอาหาร ฯลฯ
  gross_salary DECIMAL(15,2) DEFAULT 0,
  social_security DECIMAL(15,2) DEFAULT 0, -- ประกันสังคม
  income_tax DECIMAL(15,2) DEFAULT 0,      -- ภาษีเงินได้
  other_deductions DECIMAL(15,2) DEFAULT 0,
  net_salary DECIMAL(15,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES employees(id),
  leave_type VARCHAR(50) NOT NULL, -- annual, sick, personal, maternity, ordain
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days DECIMAL(5,1) NOT NULL,
  reason TEXT,
  status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected
  approved_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========== DOCUMENT SEQUENCES ==========
CREATE TABLE IF NOT EXISTS doc_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type VARCHAR(50) UNIQUE NOT NULL,
  prefix VARCHAR(20) NOT NULL,
  last_number INT DEFAULT 0,
  year_month VARCHAR(10), -- YYYYMM
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default sequences
INSERT INTO doc_sequences (doc_type, prefix) VALUES
  ('receipt', 'RC'),
  ('invoice', 'IV'),
  ('delivery_note', 'DN'),
  ('billing_note', 'BN'),
  ('po', 'PO')
ON CONFLICT (doc_type) DO NOTHING;

-- Insert default transaction categories
INSERT INTO transaction_categories (name, type, code, tax_category) VALUES
  ('รายได้จากการขายสินค้า', 'income', '4100', 'รายได้ทั่วไป'),
  ('รายได้จากบริการ', 'income', '4200', 'รายได้ทั่วไป'),
  ('รายได้อื่นๆ', 'income', '4900', 'รายได้อื่น'),
  ('ดอกเบี้ยรับ', 'income', '4300', 'รายได้อื่น'),
  ('ต้นทุนสินค้า', 'expense', '5100', 'ต้นทุนขาย'),
  ('เงินเดือนและค่าแรง', 'expense', '6100', 'ค่าใช้จ่ายบุคลากร'),
  ('ค่าเช่า', 'expense', '6200', 'ค่าใช้จ่ายสำนักงาน'),
  ('ค่าสาธารณูปโภค', 'expense', '6210', 'ค่าใช้จ่ายสำนักงาน'),
  ('ค่าโทรศัพท์/อินเตอร์เน็ต', 'expense', '6220', 'ค่าใช้จ่ายสำนักงาน'),
  ('ค่าซ่อมแซม/บำรุงรักษา', 'expense', '6300', 'ค่าใช้จ่ายทั่วไป'),
  ('ค่าขนส่ง/น้ำมัน', 'expense', '6400', 'ค่าใช้จ่ายทั่วไป'),
  ('ค่าโฆษณา/ประชาสัมพันธ์', 'expense', '6500', 'ค่าใช้จ่ายการตลาด'),
  ('ค่าเสื่อมราคา', 'expense', '6600', 'ค่าใช้จ่ายทั่วไป'),
  ('ภาษีและค่าธรรมเนียม', 'expense', '6700', 'ภาษีอากร'),
  ('ค่าใช้จ่ายอื่นๆ', 'expense', '6900', 'ค่าใช้จ่ายทั่วไป')
ON CONFLICT DO NOTHING;

-- ========== E-COMMERCE / LINE SHOPPING ==========
CREATE TABLE IF NOT EXISTS ecommerce_stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform VARCHAR(50) NOT NULL, -- line_shopping, myshop, shopee, lazada, tiktok
  store_name VARCHAR(255) NOT NULL,
  shop_id VARCHAR(255),
  channel_id VARCHAR(255),
  channel_secret TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  webhook_secret TEXT,
  sender_address TEXT,
  sender_name VARCHAR(255),
  sender_phone VARCHAR(50),
  is_active BOOLEAN DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ecommerce_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES ecommerce_stores(id),
  platform_order_id VARCHAR(255),
  platform VARCHAR(50) NOT NULL DEFAULT 'manual',
  status VARCHAR(50) DEFAULT 'pending',
  -- pending, confirmed, packing, packed, shipped, delivered, cancelled, returned
  customer_name VARCHAR(255),
  customer_phone VARCHAR(50),
  customer_address TEXT,
  customer_district VARCHAR(100),
  customer_province VARCHAR(100),
  customer_postal_code VARCHAR(10),
  shipping_provider VARCHAR(100) DEFAULT 'ไปรษณีย์ไทย',
  tracking_no VARCHAR(255),
  label_printed BOOLEAN DEFAULT false,
  label_printed_at TIMESTAMPTZ,
  subtotal DECIMAL(15,2) DEFAULT 0,
  shipping_fee DECIMAL(15,2) DEFAULT 0,
  discount DECIMAL(15,2) DEFAULT 0,
  total DECIMAL(15,2) DEFAULT 0,
  payment_method VARCHAR(50) DEFAULT 'cod',
  payment_status VARCHAR(30) DEFAULT 'pending',
  notes TEXT,
  ordered_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ecommerce_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES ecommerce_orders(id) ON DELETE CASCADE,
  platform_product_id VARCHAR(255),
  product_name VARCHAR(255) NOT NULL,
  sku VARCHAR(100),
  variant VARCHAR(255),
  qty INT NOT NULL DEFAULT 1,
  unit_price DECIMAL(15,2) DEFAULT 0,
  line_total DECIMAL(15,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ecommerce_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES ecommerce_stores(id),
  platform VARCHAR(50) NOT NULL DEFAULT 'line',
  platform_chat_id VARCHAR(255),
  customer_name VARCHAR(255),
  customer_avatar TEXT,
  customer_line_id VARCHAR(255),
  last_message TEXT,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  unread_count INT DEFAULT 0,
  order_id UUID REFERENCES ecommerce_orders(id),
  status VARCHAR(30) DEFAULT 'open', -- open, resolved, spam
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ecommerce_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID REFERENCES ecommerce_chats(id) ON DELETE CASCADE,
  sender_type VARCHAR(20) NOT NULL DEFAULT 'customer', -- customer, merchant
  message TEXT,
  message_type VARCHAR(20) DEFAULT 'text', -- text, image, sticker, file
  media_url TEXT,
  is_read BOOLEAN DEFAULT false,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ecommerce_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES ecommerce_stores(id) ON DELETE CASCADE,
  platform VARCHAR(50) DEFAULT 'manual',       -- manual, myshop, shopee, lazada
  platform_product_id VARCHAR(255),            -- ID จาก platform
  name VARCHAR(500) NOT NULL,
  sku VARCHAR(255),
  description TEXT,
  price DECIMAL(10,2) DEFAULT 0,
  compare_price DECIMAL(10,2),                 -- ราคาก่อนลด
  cost DECIMAL(10,2),                          -- ราคาต้นทุน
  stock INT DEFAULT 0,
  image_url TEXT,
  category VARCHAR(255),
  status VARCHAR(50) DEFAULT 'active',         -- active, inactive, out_of_stock
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ecommerce_products_platform_uniq
  ON ecommerce_products(store_id, platform_product_id)
  WHERE platform_product_id IS NOT NULL;

-- ========== RLS Policies (Row Level Security) ==========
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
