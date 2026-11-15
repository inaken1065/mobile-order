-- U0: スキーマと書き込み担当の強制(トリガー)。変更は B0 に差し戻すこと。
-- 書き込み担当表の正本: aidlc-docs/inception/02-units.md
-- トリガーのエラーメッセージは 'contract:' で始める(契約テストが判定に使う)。

CREATE TABLE IF NOT EXISTS menu_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  category     TEXT    NOT NULL,
  price        INTEGER NOT NULL CHECK (price >= 0),
  is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  call_number  INTEGER NOT NULL,
  status       TEXT    NOT NULL CHECK (status IN ('PLACED', 'COOKING', 'READY')),
  total        INTEGER NOT NULL CHECK (total >= 0),
  created_at   TEXT    NOT NULL,
  completed_at TEXT
);

-- menu_item_id は外部キーにしない: 注文後にメニューが削除されても注文は残る(スナップショット)
CREATE TABLE IF NOT EXISTS order_lines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id),
  menu_item_id INTEGER NOT NULL,
  name         TEXT    NOT NULL,
  unit_price   INTEGER NOT NULL CHECK (unit_price >= 0),
  qty          INTEGER NOT NULL CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders (status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_completed ON orders (completed_at);
CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_lines (order_id);

-- ---- orders ----

-- INSERT は PLACED かつ completed_at NULL のみ(UA)
CREATE TRIGGER IF NOT EXISTS orders_insert_guard
BEFORE INSERT ON orders
WHEN NEW.status <> 'PLACED' OR NEW.completed_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'contract: orders must be inserted with status=PLACED and completed_at NULL');
END;

-- status / completed_at 以外の列は不変
CREATE TRIGGER IF NOT EXISTS orders_immutable_columns
BEFORE UPDATE ON orders
WHEN NEW.id IS NOT OLD.id
  OR NEW.call_number IS NOT OLD.call_number
  OR NEW.total IS NOT OLD.total
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'contract: only status and completed_at of orders may be updated');
END;

-- status は PLACED→COOKING→READY の隣接遷移のみ(UB)
CREATE TRIGGER IF NOT EXISTS orders_status_transition
BEFORE UPDATE ON orders
WHEN NEW.status IS NOT OLD.status
  AND NOT (
    (OLD.status = 'PLACED' AND NEW.status = 'COOKING')
    OR (OLD.status = 'COOKING' AND NEW.status = 'READY')
  )
BEGIN
  SELECT RAISE(ABORT, 'contract: invalid order status transition');
END;

-- completed_at は READY への遷移と同時にのみ設定される
--   1) READY になる UPDATE では必ず非 NULL
--   2) READY 以外では必ず NULL
--   3) 既に READY の行の completed_at は変更不可
CREATE TRIGGER IF NOT EXISTS orders_completed_at_only_on_ready
BEFORE UPDATE ON orders
WHEN (NEW.status = 'READY' AND NEW.completed_at IS NULL)
  OR (NEW.status <> 'READY' AND NEW.completed_at IS NOT NULL)
  OR (OLD.status = 'READY' AND NEW.completed_at IS NOT OLD.completed_at)
BEGIN
  SELECT RAISE(ABORT, 'contract: completed_at must be set only when transitioning to READY');
END;

CREATE TRIGGER IF NOT EXISTS orders_no_delete
BEFORE DELETE ON orders
BEGIN
  SELECT RAISE(ABORT, 'contract: orders cannot be deleted');
END;

-- ---- order_lines: INSERT のみ ----

CREATE TRIGGER IF NOT EXISTS order_lines_no_update
BEFORE UPDATE ON order_lines
BEGIN
  SELECT RAISE(ABORT, 'contract: order_lines are immutable');
END;

CREATE TRIGGER IF NOT EXISTS order_lines_no_delete
BEFORE DELETE ON order_lines
BEGIN
  SELECT RAISE(ABORT, 'contract: order_lines cannot be deleted');
END;
