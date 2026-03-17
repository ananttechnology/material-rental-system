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

const Inventory = mongoose.model('Inventory', new mongoose.Schema({
  itemName: String, category: String, godown: String,
  totalStock: Number, availableStock: Number
}));

const Transaction = mongoose.model('Transaction', new mongoose.Schema({
  type: String, challanNo: String, builderId: mongoose.Schema.Types.ObjectId,
  siteId: mongoose.Schema.Types.ObjectId, itemId: mongoose.Schema.Types.ObjectId,
  godown: String, quantity: Number, rate: Number,
  loadingCharges: { type: Number, default: 0 },
  unloadingCharges: { type: Number, default: 0 }, 
  date: { type: Date, default: Date.now }
}));

const Payment = mongoose.model('Payment', new mongoose.Schema({
  builderId: mongoose.Schema.Types.ObjectId, amountPaid: Number,
  paymentMode: String, referenceNo: String, date: { type: Date, default: Date.now }
}));

// --- INTERNAL FINANCIAL LOGIC (Fixes the 0 Dashboard issue) ---
async function calculateFinancials(builderId) {
    const sites = await Site.find({ builderId });
    const payments = await Payment.find({ builderId });
    let totalBilled = 0;

    for (let site of sites) {
        const txns = await Transaction.find({ siteId: site._id }).sort({ date: 1 });
        let itemBatches = {};
        txns.forEach(t => {
            totalBilled += (Number(t.loadingCharges) || 0) + (Number(t.unloadingCharges) || 0);
            if (!itemBatches[t.itemId]) itemBatches[t.itemId] = [];
            itemBatches[t.itemId].push({ ...t._doc });
        });

        for (let id in itemBatches) {
            let dcs = itemBatches[id].filter(x => x.type === 'DC');
            let rcs = itemBatches[id].filter(x => x.type === 'RC');
            rcs.forEach(r => {
                let qty = r.quantity;
                for (let d of dcs) {
                    if (d.quantity > 0 && qty > 0) {
                        let take = Math.min(d.quantity, qty);
                        let days = Math.floor((new Date(r.date) - new Date(d.date)) / 86400000) + 1;
                        totalBilled += (take * d.rate * (days < 1 ? 1 : days));
                        d.quantity -= take; qty -= take;
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
    const totalPaid = payments.reduce((sum, p) => sum + p.amountPaid, 0);
    return { totalBilled, totalPaid, outstanding: totalBilled - totalPaid, payments };
}

// --- ROUTES ---
app.get('/builders', async (req, res) => res.json(await Builder.find()));
app.get('/sites/:builderId', async (req, res) => res.json(await Site.find({builderId: req.params.builderId})));
app.get('/inventory', async (req, res) => res.json(await Inventory.find()));

app.post('/add-builder', async (req, res) => { await new Builder(req.body).save(); res.send("Saved"); });
app.post('/add-site', async (req, res) => { await new Site(req.body).save(); res.send("Saved"); });

// --- DEEP CLEAN ADD ITEM ---
app.post('/add-item', async (req, res) => {
    try {
        // Clean the data: Remove ALL spaces and make Uppercase
        // "3 x 3" becomes "3X3" and "3x3" becomes "3X3"
        const cleanName = req.body.itemName.replace(/\s+/g, '').toUpperCase();
        const cleanCat = req.body.category.replace(/\s+/g, '').toUpperCase();
        const godown = req.body.godown;
        const totalStock = Number(req.body.totalStock);

        // Find existing using a Regex that ignores spaces
        let item = await Inventory.findOne({ 
            itemName: { $regex: new RegExp("^" + req.body.itemName.trim().replace(/\s+/g, '\\s*') + "$", "i") },
            category: { $regex: new RegExp("^" + req.body.category.trim().replace(/\s+/g, '\\s*') + "$", "i") },
            godown: godown 
        });

        if (item) {
            item.totalStock += totalStock;
            item.availableStock += totalStock;
            await item.save();
            res.send("Merged successfully");
        } else {
            await new Inventory({ 
                itemName: req.body.itemName.trim(), 
                category: req.body.category.trim(), 
                godown, 
                totalStock, 
                availableStock: totalStock 
            }).save();
            res.send("Created successfully");
        }
    } catch (e) { res.status(500).send(e.message); }
});

app.post('/dispatch', async (req, res) => {
    const { itemId, quantity } = req.body;
    const item = await Inventory.findById(itemId);
    if (!item || item.availableStock < quantity) return res.status(400).json({message: "No Stock"});
    item.availableStock -= Number(quantity);
    await item.save();
    const count = await Transaction.countDocuments({type: 'DC'});
    const challanNo = `DC-${1001 + count}`;
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
    await new Transaction({...req.body, type: 'RC', challanNo, godown: item.godown}).save();
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
            if(item) result.push({ itemId: id, itemName: item.itemName, category: item.category, godown: item.godown, currentBalance: bal[id] });
        }
    }
    res.json(result);
});

app.get('/statement/:builderId', async (req, res) => {
    const data = await calculateFinancials(req.params.builderId);
    res.json(data);
});

app.get('/company-stats', async (req, res) => {
    const builders = await Builder.find();
    let totalBilled = 0;
    let totalOutstanding = 0;
    for (let b of builders) {
        const stats = await calculateFinancials(b._id);
        totalBilled += stats.totalBilled;
        totalOutstanding += stats.outstanding;
    }
    res.json({ 
        currentMonthBilled: totalBilled, 
        totalOutstanding: totalOutstanding,
        history: [{ month: "March 2026", amount: totalBilled }] 
    });
});

// --- DEEP CLEAN TRANSFER ---
app.post('/transfer-stock', async (req, res) => {
    try {
        const { fromGodown, toGodown } = req.body;
        const qty = Number(req.body.quantity);

        // Smart Find Source: Ignores spaces between numbers/letters
        let src = await Inventory.findOne({ 
            itemName: { $regex: new RegExp("^" + req.body.itemName.trim().replace(/\s+/g, '\\s*') + "$", "i") },
            category: { $regex: new RegExp("^" + req.body.category.trim().replace(/\s+/g, '\\s*') + "$", "i") },
            godown: fromGodown 
        });

        if (!src || src.availableStock < qty) {
            return res.status(400).json({ message: No stock found for this item in ${fromGodown} });
        }

        // Smart Find Destination
        let dst = await Inventory.findOne({ 
            itemName: { $regex: new RegExp("^" + req.body.itemName.trim().replace(/\s+/g, '\\s*') + "$", "i") },
            category: { $regex: new RegExp("^" + req.body.category.trim().replace(/\s+/g, '\\s*') + "$", "i") },
            godown: toGodown 
        });

        if (!dst) {
            dst = new Inventory({ 
                itemName: src.itemName, 
                category: src.category, 
                godown: toGodown, 
                totalStock: 0, 
                availableStock: 0 
            });
        }

        src.availableStock -= qty;
        src.totalStock -= qty;
        dst.availableStock += qty;
        dst.totalStock += qty;

        await src.save();
        await dst.save();
        res.json({ message: "Success" });
    } catch (e) { res.status(500).json({ error: e.message }); }
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
            let dcs = batches[id].filter(x => x.type === 'DC');
            let rcs = batches[id].filter(x => x.type === 'RC');
            
            const info = inv.find(i => i._id.toString() === id) || { itemName: "Material", category: "N/A" };

            rcs.forEach(r => {
                let q = r.quantity;
                for (let d of dcs) {
                    if (d.quantity > 0 && q > 0) {
                        let take = Math.min(d.quantity, q);
                        let days = Math.floor((new Date(r.date) - new Date(d.date)) / 86400000) + 1;
                        bill.push({ 
                            itemName: info.itemName, 
                            qty: take, 
                            dDate: new Date(d.date).toLocaleDateString(), 
                            rDate: new Date(r.date).toLocaleDateString(), 
                            days: days < 1 ? 1 : days, 
                            rate: d.rate, 
                            amount: take * d.rate * (days < 1 ? 1 : days) 
                        });
                        d.quantity -= take; q -= take;
                    }
                }
            });

            dcs.forEach(d => {
                if (d.quantity > 0) {
                    let days = Math.floor((new Date() - new Date(d.date)) / 86400000) + 1;
                    bill.push({ 
                        itemName: info.itemName, 
                        qty: d.quantity, 
                        dDate: new Date(d.date).toLocaleDateString(), 
                        rDate: "On Site", 
                        days: days < 1 ? 1 : days, 
                        rate: d.rate, 
                        amount: d.quantity * d.rate * (days < 1 ? 1 : days) 
                    });
                }
            });
        }
        res.json({ billDetails: bill, serviceCharges: service });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/add-payment', async (req, res) => { await new Payment(req.body).save(); res.send("Saved"); });

app.listen(5000, () => console.log("Server running"));
