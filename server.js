const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const MONGO_URI = "mongodb+srv://ananttechnology25:Lkg7begZ0WcFIqoC@materialtenting.aczjrep.mongodb.net/?appName=materialtenting"; // <--- UPDATE THIS!

mongoose.connect(MONGO_URI).then(() => console.log("✅ DB Connected"));

// --- SCHEMAS (Builders, Sites, Inventory, Transactions) ---
const builderSchema = new mongoose.Schema({
  companyName: { type: String, required: true },
  mobile: String, email: String, gstNumber: String, address: String
});
const Builder = mongoose.model('Builder', builderSchema);

const siteSchema = new mongoose.Schema({
  builderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Builder' },
  siteName: String, siteAddress: String
});
const Site = mongoose.model('Site', siteSchema);

const inventorySchema = new mongoose.Schema({
  itemName: String, category: String, totalStock: Number, availableStock: Number
});
const Inventory = mongoose.model('Inventory', inventorySchema);

const transactionSchema = new mongoose.Schema({
  type: String, challanNo: String, builderId: mongoose.Schema.Types.ObjectId,
  siteId: mongoose.Schema.Types.ObjectId, itemId: mongoose.Schema.Types.ObjectId,
  quantity: Number, rate: Number, date: { type: Date, default: Date.now }
});
const Transaction = mongoose.model('Transaction', transactionSchema);

// --- ROUTES ---
app.get('/builders', async (req, res) => res.json(await Builder.find()));
app.get('/sites/:builderId', async (req, res) => res.json(await Site.find({builderId: req.params.builderId})));
app.get('/inventory', async (req, res) => res.json(await Inventory.find()));

app.post('/add-builder', async (req, res) => { await new Builder(req.body).save(); res.send("Saved"); });
app.post('/add-site', async (req, res) => { await new Site(req.body).save(); res.send("Saved"); });
app.post('/add-item', async (req, res) => {
    const data = req.body;
    data.availableStock = data.totalStock; 
    await new Inventory(data).save();
    res.send("Item Saved");
});

// DISPATCH LOGIC (DC)
app.post('/dispatch', async (req, res) => {
    try {
        const { itemId, quantity } = req.body;
        const item = await Inventory.findById(itemId);
        if (item.availableStock < quantity) return res.status(400).json({message: `Only ${item.availableStock} left!`});
        item.availableStock -= quantity;
        await item.save();
        const count = await Transaction.countDocuments({type: 'DC'});
        const challanNo = `DC-${1001 + count}`;
        const txn = new Transaction({...req.body, type: 'DC', challanNo});
        await txn.save();
        res.status(200).json({message: "Success", challanNo});
    } catch (err) { res.status(500).json({message: err.message}); }
});

// RETURN LOGIC (RC) - NEW
app.post('/return', async (req, res) => {
    try {
        const { itemId, quantity } = req.body;
        const item = await Inventory.findById(itemId);
        
        // Add back to Yard
        item.availableStock += Number(quantity);
        await item.save();

        const count = await Transaction.countDocuments({type: 'RC'});
        const challanNo = `RC-${1001 + count}`;
        const txn = new Transaction({...req.body, type: 'RC', challanNo});
        await txn.save();
        res.status(200).json({message: "Success", challanNo});
    } catch (err) { res.status(500).json({message: err.message}); }
});

app.listen(5000);
