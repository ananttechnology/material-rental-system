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
// SMART INVENTORY: Adds to existing stock if item exists
app.post('/add-item', async (req, res) => {
    try {
        const { itemName, category, totalStock } = req.body;
        
        // 1. Check if this exact item/size already exists
        let existingItem = await Inventory.findOne({ itemName, category });

        if (existingItem) {
            // 2. If it exists, add to the numbers
            existingItem.totalStock += Number(totalStock);
            existingItem.availableStock += Number(totalStock);
            await existingItem.save();
            res.send("Stock Updated (Added to existing)");
        } else {
            // 3. If it's new, create it
            const newItem = new Inventory({
                itemName,
                category,
                totalStock: Number(totalStock),
                availableStock: Number(totalStock)
            });
            await newItem.save();
            res.send("New Item Created");
        }
    } catch (err) {
        res.status(500).send(err.message);
    }
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
// NEW: Get current balance of items at a specific site
app.get('/site-balance/:siteId', async (req, res) => {
    try {
        const txns = await Transaction.find({ siteId: req.params.siteId });
        let balance = {};

        txns.forEach(t => {
            const key = t.itemId.toString();
            if (!balance[key]) balance[key] = 0;
            if (t.type === 'DC') balance[key] += t.quantity;
            if (t.type === 'RC') balance[key] -= t.quantity;
        });

        // Convert the balance object into a list of items with names
        let result = [];
        for (let itemId in balance) {
            if (balance[itemId] > 0) {
                const item = await Inventory.findById(itemId);
                result.push({
                    itemId: itemId,
                    itemName: item.itemName,
                    category: item.category,
                    currentBalance: balance[itemId]
                });
            }
        }
        res.json(result);
    } catch (err) {
        res.status(500).send(err.message);
    }
});
app.listen(5000);
