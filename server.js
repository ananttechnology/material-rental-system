const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
// --- ROBUST CORS CONFIGURATION ---
app.use(cors({
    origin: "*", // This allows all websites (including your GitHub) to access the data
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());

// --- UPDATE YOUR LINK HERE ---
const MONGO_URI = "mongodb+srv://ananttechnology25:Lkg7begZ0WcFIqoC@materialtenting.aczjrep.mongodb.net/?appName=materialtenting"; 

mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ DB Connected Successfully"))
  .catch((err) => console.error("❌ DB Connection Error:", err));

// --- SCHEMAS ---
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

// 1. Updated Transaction Schema
const transactionSchema = new mongoose.Schema({
  type: String, 
  challanNo: String, 
  builderId: mongoose.Schema.Types.ObjectId,
  siteId: mongoose.Schema.Types.ObjectId, 
  itemId: mongoose.Schema.Types.ObjectId,
  quantity: Number, 
  rate: Number, 
  loadingCharges: { type: Number, default: 0 },   // Added
  unloadingCharges: { type: Number, default: 0 }, // Added
  date: { type: Date, default: Date.now }
});
const Transaction = mongoose.model('Transaction', transactionSchema);

// --- ROUTES ---

app.get('/builders', async (req, res) => res.json(await Builder.find()));
app.get('/sites/:builderId', async (req, res) => res.json(await Site.find({builderId: req.params.builderId})));
app.get('/inventory', async (req, res) => res.json(await Inventory.find()));

app.post('/add-builder', async (req, res) => { await new Builder(req.body).save(); res.send("Saved"); });
app.post('/add-site', async (req, res) => { await new Site(req.body).save(); res.send("Saved"); });

app.post('/add-item', async (req, res) => {
    try {
        const { itemName, category, totalStock } = req.body;
        let item = await Inventory.findOne({ itemName, category });
        if (item) {
            item.totalStock += Number(totalStock);
            item.availableStock += Number(totalStock);
            await item.save();
        } else {
            await new Inventory({ itemName, category, totalStock, availableStock: totalStock }).save();
        }
        res.send("Success");
    } catch (e) { res.status(500).send(e.message); }
});

app.post('/dispatch', async (req, res) => {
    const { itemId, quantity } = req.body;
    const item = await Inventory.findById(itemId);
    if (item.availableStock < quantity) return res.status(400).json({message: "Insufficient Stock"});
    item.availableStock -= quantity;
    await item.save();
    const count = await Transaction.countDocuments({type: 'DC'});
    const challanNo = `DC-${1001 + count}`;
    await new Transaction({...req.body, type: 'DC', challanNo}).save();
    res.json({challanNo});
});

app.get('/site-balance/:siteId', async (req, res) => {
    const txns = await Transaction.find({ siteId: req.params.siteId });
    let balance = {};
    txns.forEach(t => {
        const key = t.itemId.toString();
        if (!balance[key]) balance[key] = 0;
        t.type === 'DC' ? balance[key] += t.quantity : balance[key] -= t.quantity;
    });
    let result = [];
    for (let id in balance) {
        if (balance[id] > 0) {
            const item = await Inventory.findById(id);
            result.push({ itemId: id, itemName: item.itemName, category: item.category, currentBalance: balance[id] });
        }
    }
    res.json(result);
});

app.post('/return', async (req, res) => {
    const { itemId, quantity } = req.body;
    const item = await Inventory.findById(itemId);
    item.availableStock += Number(quantity);
    await item.save();
    const count = await Transaction.countDocuments({type: 'RC'});
    const challanNo = `RC-${1001 + count}`;
    await new Transaction({...req.body, type: 'RC', challanNo}).save();
    res.json({challanNo});
});

app.get('/calculate-bill/:siteId', async (req, res) => {
    const txns = await Transaction.find({ siteId: req.params.siteId }).sort({ date: 1 });
    const inventory = await Inventory.find();
    let itemBatches = {};
    let totalServiceCharges = 0;
    txns.forEach(t => {
        // Accumulate all loading and unloading charges for the site
        totalServiceCharges += (t.loadingCharges || 0) + (t.unloadingCharges || 0);

        if (!itemBatches[t.itemId]) itemBatches[t.itemId] = [];
        itemBatches[t.itemId].push({...t._doc}); 
    });
    let bill = [];
    for (let id in itemBatches) {
        let dcs = itemBatches[id].filter(x => x.type === 'DC');
        let rcs = itemBatches[id].filter(x => x.type === 'RC');
        const info = inventory.find(i => i._id.toString() === id);
        rcs.forEach(r => {
            let qty = r.quantity;
            for (let d of dcs) {
                if (d.quantity > 0 && qty > 0) {
                    let take = Math.min(d.quantity, qty);
                    let days = Math.floor((new Date(r.date) - new Date(d.date)) / 86400000) + 1;
                    bill.push({ itemName: info.itemName, category: info.category, qty: take, dDate: new Date(d.date).toLocaleDateString(), rDate: new Date(r.date).toLocaleDateString(), days, rate: d.rate, amount: take * d.rate * days });
                    d.quantity -= take; qty -= take;
                }
            }
        });
        dcs.forEach(d => {
            if (d.quantity > 0) {
                let days = Math.floor((new Date() - new Date(d.date)) / 86400000) + 1;
                bill.push({ itemName: info.itemName, category: info.category, qty: d.quantity, dDate: new Date(d.date).toLocaleDateString(), rDate: "On Site", days, rate: d.rate, amount: d.quantity * d.rate * days });
            }
        });
    }
    // At the end of the matching loop, we add a special object for charges:
    
    // Example of sending the data back:
    res.json({
        billDetails: bill, // Your existing FIFO rows
        serviceCharges: totalServiceCharges
    });
});

app.listen(5000);
