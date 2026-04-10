import { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { orders, orderItems, menuItems, reservations } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";

export async function orderRoutes(app: FastifyInstance) {
  app.get("/api/orders", async () => {
    const allOrders = await db.select().from(orders).orderBy(desc(orders.createdAt));
    return Promise.all(allOrders.map(async (order) => {
      const items = await db
        .select({ id: orderItems.id, quantity: orderItems.quantity, unitPrice: orderItems.unitPrice, name: menuItems.name })
        .from(orderItems)
        .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
        .where(eq(orderItems.orderId, order.id));
      return { ...order, items };
    }));
  });

  app.get<{ Params: { id: string } }>("/api/orders/:id", async (request) => {
    const [order] = await db.select().from(orders).where(eq(orders.id, request.params.id));
    if (!order) throw { statusCode: 404, message: "Order not found" };
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    return { ...order, items };
  });

  app.patch<{ Params: { id: string }; Body: { status: string } }>(
    "/api/orders/:id",
    async (request) => {
      const [updated] = await db
        .update(orders)
        .set({ status: request.body.status as any, updatedAt: new Date() })
        .where(eq(orders.id, request.params.id))
        .returning();
      if (!updated) throw { statusCode: 404, message: "Order not found" };
      return updated;
    }
  );

  // Reservations
  app.get("/api/reservations", async () => {
    return db.select().from(reservations).orderBy(desc(reservations.createdAt));
  });
}
