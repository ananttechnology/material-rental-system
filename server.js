const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Replace the line below with your MongoDB link later
const MONGO_URI = "mongodb+srv://ananttechnology25:Lkg7begZ0WcFIqoC@materialtenting.aczjrep.mongodb.net/?appName=materialtenting";

mongoose.connect(MONGO_URI)
  .then(() => console.log("MongoDB Connected Successfully!"))
  .catch(err => console.log("Database Connection Error: ", err));

// Basic Schema for your Inventory (Item Name and Category logic)
const inventorySchema = new mongoose.Schema({
  itemName: String, // e.g., Vertical
  category: String, // e.g., 2 mtr
  stock: Number
});

const Inventory = mongoose.model('Inventory', inventorySchema);

app.get('/', (req, res) => {
  res.send("Material Rental System API is Running...");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
