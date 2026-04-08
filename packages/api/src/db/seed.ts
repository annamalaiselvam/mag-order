import "dotenv/config";
import { db } from "./index.js";
import { menuItems, tables } from "./schema.js";

async function seed() {
  console.log("Seeding database...");

  await db.insert(menuItems).values([
    { name: "Spring Rolls", description: "Crispy vegetable spring rolls with sweet chili dip", price: "8.99", category: "appetizers" },
    { name: "Bruschetta", description: "Toasted bread with tomato, basil, and mozzarella", price: "9.49", category: "appetizers" },
    { name: "Soup of the Day", description: "Chef's daily fresh soup", price: "7.99", category: "appetizers" },
    { name: "Grilled Salmon", description: "Atlantic salmon with lemon butter sauce and vegetables", price: "24.99", category: "mains" },
    { name: "Chicken Parmesan", description: "Breaded chicken with marinara and melted mozzarella", price: "18.99", category: "mains" },
    { name: "Ribeye Steak", description: "12oz USDA prime ribeye with garlic mashed potatoes", price: "34.99", category: "mains" },
    { name: "Margherita Pizza", description: "Classic tomato, mozzarella, and fresh basil", price: "15.99", category: "mains" },
    { name: "Pasta Carbonara", description: "Spaghetti with pancetta, egg, and parmesan", price: "16.99", category: "mains" },
    { name: "Veggie Burger", description: "House-made black bean patty with avocado", price: "14.99", category: "mains" },
    { name: "Sparkling Water", description: "San Pellegrino 500ml", price: "3.99", category: "drinks" },
    { name: "House Red Wine", description: "Glass of Cabernet Sauvignon", price: "11.99", category: "drinks" },
    { name: "Craft IPA", description: "Local brewery IPA on draft", price: "7.99", category: "drinks" },
    { name: "Tiramisu", description: "Classic Italian coffee-flavored dessert", price: "10.99", category: "desserts" },
    { name: "Chocolate Lava Cake", description: "Warm chocolate cake with molten center", price: "11.99", category: "desserts" },
  ]);

  await db.insert(tables).values([
    { number: 1, capacity: 2, location: "window" },
    { number: 2, capacity: 2, location: "window" },
    { number: 3, capacity: 4, location: "main" },
    { number: 4, capacity: 4, location: "main" },
    { number: 5, capacity: 6, location: "main" },
    { number: 6, capacity: 6, location: "main" },
    { number: 7, capacity: 8, location: "private" },
    { number: 8, capacity: 8, location: "private" },
    { number: 9, capacity: 4, location: "patio" },
    { number: 10, capacity: 2, location: "patio" },
  ]);

  console.log("Seeding complete!");
  process.exit(0);
}

seed().catch((e) => { console.error(e); process.exit(1); });
