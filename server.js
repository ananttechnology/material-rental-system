const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST", "PUT", "DELETE"], allowedHeaders: ["Content-Type", "Authorization"] }));
app.use(express.json());

const MONGO_URI = "mongodb+srv://ananttechnology25:Lkg7begZ0WcFIqoC@materialtenting.aczjrep.mongodb.net/?appName=materialtenting"; 

mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ DB Connected Successfully"))
  .catch((err) => console.error("❌ DB Connection Error:", err));

// --- SCHEMAS ---
const Builder = mongoose.model('Builder', new mongoose.Schema({
  companyName: { type: String, required: true },
  mobile: String, email: String, gstNumber: String, address: String
}));

const Site = mongoose.model('Site', new mongoose.Schema({
  builderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Builder' },
  siteName: String, siteAddress: String
}));

// --- UPDATED SCHEMAS FOR GODOWN ---
const Inventory = mongoose.model('Inventory', new mongoose.Schema({
  itemName: String, 
  category: String, 
  godown: String, // Added: 'Ankleshwar' or 'Dahej'
  totalStock: Number, 
  availableStock: Number
}));

const Transaction = mongoose.model('Transaction', new mongoose.Schema({
  type: String, 
  challanNo: String, 
  builderId: mongoose.Schema.Types.ObjectId,
  siteId: mongoose.Schema.Types.ObjectId, 
  itemId: mongoose.Schema.Types.ObjectId,
  godown: String, // Added to track which godown the material left/entered
  quantity: Number, 
  rate: Number, 
  loadingCharges: { type: Number, default: 0 },
  unloadingCharges: { type: Number, default: 0 }, 
  date: { type: Date, default: Date.now }
}));

const Payment = mongoose.model('Payment', new mongoose.Schema({
  builderId: mongoose.Schema.Types.ObjectId, amountPaid: Number,
  paymentMode: String, referenceNo: String, date: { type: Date, default: Date.now }
}));

// --- ROUTES ---
app.get('/builders', async (req, res) => res.json(await Builder.find()));
app.get('/sites/:builderId', async (req, res) => res.json(await Site.find({builderId: req.params.builderId})));
app.get('/inventory', async (req, res) => res.json(await Inventory.find()));

app.post('/add-builder', async (req, res) => { await new Builder(req.body).save(); res.send("Saved"); });
app.post('/add-site', async (req, res) => { await new Site(req.body).save(); res.send("Saved"); });

// --- UPDATED ROUTES FOR GODOWN ---
app.post('/add-item', async (req, res) => {
    const { itemName, category, totalStock, godown } = req.body;
    // Look for item matching name, category AND godown
    let item = await Inventory.findOne({ itemName, category, godown });
    if (item) {
        item.totalStock += Number(totalStock);
        item.availableStock += Number(totalStock);
        await item.save();
    } else {
        await new Inventory({ itemName, category, godown, totalStock, availableStock: totalStock }).save();
    }
    res.send("Success");
});

app.post('/dispatch', async (req, res) => {
    const { itemId, quantity } = req.body;
    const item = await Inventory.findById(itemId);
    if (!item || item.availableStock < quantity) {
        return res.status(400).json({message: Insufficient Stock in ${item ? item.godown : 'Godown'}});
    }
    item.availableStock -= Number(quantity);
    await item.save();
    const count = await Transaction.countDocuments({type: 'DC'});
    const challanNo = DC-${1001 + count};
    await new Transaction({...req.body, type: 'DC', challanNo, godown: item.godown}).save();
    res.json({challanNo});
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

app.get('/site-balance/:siteId', async (req, res) => {
    const txns = await Transaction.find({ siteId: req.params.siteId });
    let bal = {};
    txns.forEach(t => {
        const k = t.itemId.toString();
        if (!bal[k]) bal[k] = 0;
        t.type === 'DC' ? bal[k] += t.quantity : bal[k] -= t.quantity;
    });
    let result = [];
    for (let id in bal) {
        if (bal[id] > 0) {
            const item = await Inventory.findById(id);
            result.push({ itemId: id, itemName: item.itemName, category: item.category, currentBalance: bal[id] });
        }
    }
    res.json(result);
});

app.get('/calculate-bill/:siteId', async (req, res) => {
    try {
        const txns = await Transaction.find({ siteId: req.params.siteId }).sort({ date: 1 });
        const inv = await Inventory.find();
        let batches = {}, service = 0, bill = [];
        txns.forEach(t => {
            service += (Number(t.loadingCharges) || 0) + (Number(t.unloadingCharges) || 0);
            if (!batches[t.itemId]) batches[t.itemId] = [];
            batches[t.itemId].push({ ...t._doc });
        });
        for (let id in batches) {
            let dcs = batches[id].filter(x => x.type === 'DC'), rcs = batches[id].filter(x => x.type === 'RC');
            const info = inv.find(i => i._id.toString() === id) || { itemName: "Item", category: "N/A" };
            rcs.forEach(r => {
                let q = r.quantity;
                for (let d of dcs) {
                    if (d.quantity > 0 && q > 0) {
                        let take = Math.min(d.quantity, q);
                        let days = Math.floor((new Date(r.date) - new Date(d.date)) / 86400000) + 1;
                        bill.push({ itemName: info.itemName, category: info.category, qty: take, dDate: new Date(d.date).toLocaleDateString(), rDate: new Date(r.date).toLocaleDateString(), days: days < 1 ? 1 : days, rate: d.rate, amount: take * d.rate * (days < 1 ? 1 : days) });
                        d.quantity -= take; q -= take;
                    }
                }
            });
            dcs.forEach(d => {
                if (d.quantity > 0) {
                    let days = Math.floor((new Date() - new Date(d.date)) / 86400000) + 1;
                    bill.push({ itemName: info.itemName, category: info.category, qty: d.quantity, dDate: new Date(d.date).toLocaleDateString(), rDate: "On Site", days: days < 1 ? 1 : days, rate: d.rate, amount: d.quantity * d.rate * (days < 1 ? 1 : days) });
                }
            });
        }
        res.json({ billDetails: bill, serviceCharges: service });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/add-payment', async (req, res) => { await new Payment(req.body).save(); res.send("Saved"); });

app.get('/statement/:builderId', async (req, res) => {
    try {
        const payments = await Payment.find({ builderId: req.params.builderId }).sort({ date: 1 });
        const sites = await Site.find({ builderId: req.params.builderId });
        let totalBilled = 0;
        const inv = await Inventory.find();

        for (let site of sites) {
            const txns = await Transaction.find({ siteId: site._id });
            let batches = {};
            txns.forEach(t => {
                totalBilled += (Number(t.loadingCharges) || 0) + (Number(t.unloadingCharges) || 0);
                if (!batches[t.itemId]) batches[t.itemId] = [];
                batches[t.itemId].push({...t._doc});
            });
            for (let id in batches) {
                let dcs = batches[id].filter(x => x.type === 'DC'), rcs = batches[id].filter(x => x.type === 'RC');
                rcs.forEach(r => {
                    let q = r.quantity;
                    for (let d of dcs) {
                        if (d.quantity > 0 && q > 0) {
                            let take = Math.min(d.quantity, q);
                            let days = Math.floor((new Date(r.date) - new Date(d.date)) / 86400000) + 1;
                            totalBilled += (take * d.rate * (days < 1 ? 1 : days));
                            d.quantity -= take; q -= take;
                        }
                    }
                });
                dcs.forEach(d => {
                    if (d.quantity > 0) {
                        let days = Math.floor((new Date() - new Date(d.date)) / 86400000) + 1;
                        totalBilled += (d.quantity * d.rate * (days < 1 ? 1 : days));
                    }
                });
            }
        }
        res.json({ payments, totalBilled, totalPaid: payments.reduce((s, p) => s + p.amountPaid, 0) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(5000, () => console.log("Server running on port 5000"));
