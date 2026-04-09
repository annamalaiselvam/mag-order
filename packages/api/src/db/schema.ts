import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  integer,
  boolean,
  timestamp,
  pgEnum,
  date,
} from "drizzle-orm/pg-core";

export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "served",
  "cancelled",
]);

export const reservationStatusEnum = pgEnum("reservation_status", [
  "pending",
  "confirmed",
  "seated",
  "completed",
  "cancelled",
  "no_show",
]);

export const callStatusEnum = pgEnum("call_status", [
  "ringing",
  "in_progress",
  "completed",
  "failed",
  "transferred",
]);

export const menuItems = pgTable("menu_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  available: boolean("available").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const orders = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  status: orderStatusEnum("status").default("pending").notNull(),
  total: numeric("total", { precision: 10, scale: 2 }),
  notes: text("notes"),
  callerPhone: varchar("caller_phone", { length: 100 }),
  callSid: varchar("call_sid", { length: 64 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const orderItems = pgTable("order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .references(() => orders.id)
    .notNull(),
  menuItemId: uuid("menu_item_id")
    .references(() => menuItems.id)
    .notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
});

export const tables = pgTable("tables", {
  id: uuid("id").defaultRandom().primaryKey(),
  number: integer("number").unique().notNull(),
  capacity: integer("capacity").notNull(),
  location: varchar("location", { length: 100 }),
  available: boolean("available").default(true).notNull(),
});

export const reservations = pgTable("reservations", {
  id: uuid("id").defaultRandom().primaryKey(),
  tableId: uuid("table_id")
    .references(() => tables.id)
    .notNull(),
  guestName: varchar("guest_name", { length: 255 }).notNull(),
  guestPhone: varchar("guest_phone", { length: 20 }).notNull(),
  partySize: integer("party_size").notNull(),
  date: date("date").notNull(),
  timeSlot: varchar("time_slot", { length: 10 }).notNull(),
  durationMinutes: integer("duration_minutes").default(90).notNull(),
  status: reservationStatusEnum("status").default("pending").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const calls = pgTable("calls", {
  id: uuid("id").defaultRandom().primaryKey(),
  callSid: varchar("call_sid", { length: 64 }).unique().notNull(),
  callerPhone: varchar("caller_phone", { length: 100 }),
  status: callStatusEnum("status").default("ringing").notNull(),
  orderId: uuid("order_id").references(() => orders.id),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
});
