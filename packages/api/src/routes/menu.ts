import { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { menuItems } from "../db/schema.js";
import { eq } from "drizzle-orm";

export async function menuRoutes(app: FastifyInstance) {
  app.get("/api/menu", async () => {
    return db.select().from(menuItems).where(eq(menuItems.available, true));
  });

  app.get<{ Params: { id: string } }>("/api/menu/:id", async (request) => {
    const [item] = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.id, request.params.id));
    if (!item) throw { statusCode: 404, message: "Menu item not found" };
    return item;
  });
}
