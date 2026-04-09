import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, "../../../../.env"), override: true });

import { db } from "./index.js";
import { menuItems, orderItems, orders, calls } from "./schema.js";

const MENU_URL =
  "https://apis.magilhub.com/magilhub-data-services/api/customers/locations/88cc107b-bc75-4d1a-9b35-9199e69d3b3d/menu?orderType=Pickup";

async function importMenu() {
  console.log("Fetching menu from A2B API...");
  const res = await fetch(MENU_URL);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = (await res.json()) as { menu: any[] };
  const enabled = data.menu.filter((i) => i.enable === true);
  console.log(`Fetched ${data.menu.length} items, ${enabled.length} enabled`);

  // Pick 2 items per category, cap at 30 total
  const cats: Record<string, any[]> = {};
  for (const i of enabled) {
    const cat = i.subCategory || i.category || "Other";
    if (!cats[cat]) cats[cat] = [];
    cats[cat].push(i);
  }
  const items: any[] = [];
  for (const cat of Object.keys(cats).sort()) {
    items.push(...cats[cat].slice(0, 2));
    if (items.length >= 30) break;
  }
  const selected = items.slice(0, 30);
  console.log(`Selected ${selected.length} items across ${Object.keys(cats).length} categories`);

  // Clear dependent data first (FK constraints)
  console.log("Clearing existing data...");
  await db.delete(orderItems);
  await db.delete(calls);
  await db.delete(orders);
  await db.delete(menuItems);

  // Insert in batches of 50
  const BATCH = 50;
  let inserted = 0;
  for (let i = 0; i < selected.length; i += BATCH) {
    const batch = selected.slice(i, i + BATCH).map((item) => ({
      id: item.itemId,
      name: item.itemName as string,
      description: item.description || null,
      price: String(item.price),
      category: (item.subCategory || item.category || "Other") as string,
      available: true,
    }));
    await db.insert(menuItems).values(batch);
    inserted += batch.length;
    console.log(`  Inserted ${inserted}/${selected.length}`);
  }

  console.log(`\nDone! ${inserted} menu items loaded from A2B.`);
  process.exit(0);
}

importMenu().catch((e) => {
  console.error(e);
  process.exit(1);
});
