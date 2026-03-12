const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// --- 1. CONNECT TO YOUR DATABASE ---
// Make sure to replace <password> with your actual database password!
const MONGO_URI = "mongodb+srv://ananttechnology25:Lkg7begZ0WcFIqoC@materialtenting.aczjrep.mongodb.net/?appName=materialtenting";

mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected Successfully!"))
  .catch(err => console.log("❌ Database Connection Error: ", err));

// --- 2. DATABASE SCHEMAS (Your Business Logic) ---

// Inventory: Item (Vertical) and Category (2 mtr)
const inventorySchema = new mongoose.Schema({
  itemName: { type: String, required: true }, 
  category: { type: String, required: true }, 
  totalStock: { type: Number, default: 0 },
  availableStock: { type: Number, default: 0 }
});

// Transactions: Dispatch & Return with 9-day rule
const transactionSchema = new mongoose.Schema({
  itemName: String,
  category: String,
  dispatchDate: Date,
  returnDate: Date,
  quantity: Number,
  rate: Number,
  loadingCharges: { type: Number, default: 0 }
});

const Inventory = mongoose.model('Inventory', inventorySchema);
const Transaction = mongoose.model('Transaction', transactionSchema);

// --- 3. TEST ROUTES ---

app.get('/', (req, res) => {
  res.send("Rental System Backend is Live and Connected!");
});

// This route will allow us to add an item later
app.post('/add-item', async (req, res) => {
  try {
    const newItem = new Inventory(req.body);
    await newItem.save();
    res.status(200).send("Item added to Inventory!");
  } catch (err) {
    res.status(500).send(err.message);
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
