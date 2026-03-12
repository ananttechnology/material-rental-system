const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// --- 1. CONNECT TO YOUR DATABASE ---
const MONGO_URI = "mongodb+srv://ananttechnology25:Lkg7begZ0WcFIqoC@materialtenting.aczjrep.mongodb.net/?appName=materialtenting"; // <--- UPDATE THIS!

mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected!"))
  .catch(err => console.log("❌ Connection Error: ", err));

// --- 2. DATABASE SCHEMAS ---

// Builder & Site Schema
const siteSchema = new mongoose.Schema({
  builderName: { type: String, required: true },
  mobile: String,
  email: String,
  address: String,
  gstNumber: String, // Can be empty if not applicable
  siteName: { type: String, required: true },
  siteAddress: String,
  useGST: { type: Boolean, default: false } // The GST Toggle
});

const inventorySchema = new mongoose.Schema({
  itemName: String,
  category: String,
  totalStock: Number,
  availableStock: Number
});

const Site = mongoose.model('Site', siteSchema);
const Inventory = mongoose.model('Inventory', inventorySchema);

// --- 3. ROUTES ---

app.get('/', (req, res) => res.send("Rental System API is Running..."));

// Add New Site & Builder
app.post('/add-site', async (req, res) => {
  try {
    const newSite = new Site(req.body);
    await newSite.save();
    res.status(200).send("Builder & Site added successfully!");
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Add Inventory Item
app.post('/add-item', async (req, res) => {
  try {
    const newItem = new Inventory(req.body);
    await newItem.save();
    res.status(200).send("Item added!");
  } catch (err) {
    res.status(500).send(err.message);
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
