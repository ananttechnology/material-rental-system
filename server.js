const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const MONGO_URI = "mongodb+srv://ananttechnology25:Lkg7begZ0WcFIqoC@materialtenting.aczjrep.mongodb.net/?appName=materialtenting"; // <--- UPDATE THIS

mongoose.connect(MONGO_URI).then(() => console.log("✅ DB Connected"));

// --- SCHEMAS ---

// 1. Builder Collection (Updated with Email and Address)
const builderSchema = new mongoose.Schema({
  companyName: { type: String, required: true },
  mobile: String,
  email: String,   // Re-added
  gstNumber: String,
  address: String  // Re-added
});
const Builder = mongoose.model('Builder', builderSchema);

// 2. Site Collection (Linked to Builder)
const siteSchema = new mongoose.Schema({
  builderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Builder' },
  siteName: String,
  siteAddress: String
});
const Site = mongoose.model('Site', siteSchema);

// 3. Inventory Collection
const inventorySchema = new mongoose.Schema({
  itemName: String,
  category: String,
  totalStock: Number
});
const Inventory = mongoose.model('Inventory', inventorySchema);

// --- ROUTES ---

// Get all Builders (to fill the dropdown)
app.get('/builders', async (req, res) => {
  const builders = await Builder.find();
  res.json(builders);
});

// Add Builder
app.post('/add-builder', async (req, res) => {
  const newBuilder = new Builder(req.body);
  await newBuilder.save();
  res.send("Builder Saved");
});

// Add Site
app.post('/add-site', async (req, res) => {
  const newSite = new Site(req.body);
  await newSite.save();
  res.send("Site Saved");
});

app.post('/add-item', async (req, res) => {
  const item = new Inventory(req.body);
  await item.save();
  res.send("Item Saved");
});

app.listen(5000);
