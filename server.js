const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const MONGO_URI = "mongodb+srv://ananttechnology25:Lkg7begZ0WcFIqoC@materialtenting.aczjrep.mongodb.net/?appName=materialtenting"; 

mongoose.connect(MONGO_URI).then(() => console.log("✅ DB Connected"));

// --- MODELS ---
const Builder = mongoose.model('Builder', new mongoose.Schema({ companyName: String, mobile: String, gstNumber: String, address: String }));
const Site = mongoose.model('Site', new mongoose.Schema({ builderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Builder' }, siteName: String, siteAddress: String }));
const Inventory = mongoose.model('Inventory', new mongoose.Schema({ itemName: String, category: String, godown: String, totalStock: Number, availableStock: Number }));
const Transaction = mongoose.model('Transaction', new mongoose.Schema({ type: String, challanNo: String, builderId: mongoose.Schema.Types.ObjectId, siteId: mongoose.Schema.Types.ObjectId, itemId: mongoose.Schema.Types.ObjectId, godown: String, quantity: Number, rate: { type: Number, default: 0 }, loadingCharges: { type: Number, default: 0 }, unloadingCharges: { type: Number, default: 0 }, date: { type: Date, default: Date.now } }));
const Payment = mongoose.model('Payment', new mongoose.Schema({ builderId: mongoose.Schema.Types.ObjectId, amountPaid: Number, paymentMode: String, referenceNo: String, date: { type: Date, default: Date.now } }));

// --- SHARED CALCULATION FUNCTION ---
async function getBuilderStats(builderId) {
    const sites = await Site.find({ builderId });
    const payments = await Payment.find({ builderId });
    let totalBilled = 0;
    for (let site of sites) {
        const res = await calculateSiteBill(site._id);
        totalBilled += res.subtotal + res.service;
    }
    const totalPaid = payments.reduce((sum, p) => sum + p.amountPaid, 0);
    return { totalBilled, totalPaid, outstanding: totalBilled - totalPaid, payments };
}

async function calculateSiteBill(siteId) {
    const txns = await Transaction.find({ siteId }).sort({ date: 1 });
    let service = 0, bill = [], items = {};
    txns.forEach(t => {
        service += (t.loadingCharges || 0) + (t.unloadingCharges || 0);
        if (!items[t.itemId]) items[t.itemId] = { dc: [], rc: [] };
        t.type === 'DC' ? items[t.itemId].dc.push({ ...t._doc }) : items[t.itemId].rc.push({ ...t._doc });
    });
    for (let id in items) {
        const info = await Inventory.findById(id);
        if(!info) continue;
        let dcs = items[id].dc, rcs = items[id].rc;
        rcs.forEach(r => {
            let q = r.quantity;
            dcs.forEach(d => {
                if (d.quantity > 0 && q > 0) {
                    let take = Math.min(d.quantity, q);
                    let days = Math.max(1, Math.floor((new Date(r.date) - new Date(d.date)) / 86400000) + 1);
                    bill.push({ name: info.itemName, cat: info.category, qty: take, days, rate: d.rate, total: take * d.rate * days, duration: `${new Date(d.date).toLocaleDateString()} to ${new Date(r.date).toLocaleDateString()}` });
                    d.quantity -= take; q -= take;
                }
            });
        });
        dcs.forEach(d => {
            if (d.quantity > 0) {
                let days = Math.max(1, Math.floor((new Date() - new Date(d.date)) / 86400000) + 1);
                bill.push({ name: info.itemName, cat: info.category, qty: d.quantity, days, rate: d.rate, total: d.quantity * d.rate * days, duration: `${new Date(d.date).toLocaleDateString()} to Still on Site` });
            }
        });
    }
    const subtotal = bill.reduce((s, i) => s + i.total, 0);
    return { bill, service, subtotal };
}

// --- ROUTES ---
app.get('/builders', async (req, res) => res.json(await Builder.find()));
app.get('/sites/:builderId', async (req, res) => res.json(await Site.find({ builderId: req.params.builderId })));
app.get('/inventory', async (req, res) => res.json(await Inventory.find()));

app.post('/add-item', async (req, res) => {
    const { itemName, category, godown, totalStock } = req.body;
    let item = await Inventory.findOne({ itemName: itemName.trim(), category: category.trim(), godown });
    if (item) {
        item.totalStock += Number(totalStock); item.availableStock += Number(totalStock);
        await item.save();
    } else { await new Inventory({ ...req.body, availableStock: totalStock }).save(); }
    res.send("OK");
});

app.post('/transfer-stock', async (req, res) => {
    try {
        const { itemName, category, fromGodown, toGodown, quantity } = req.body;
        const qty = Number(quantity);

        if (!qty || qty <= 0) return res.status(400).json({ message: "Invalid quantity" });

        // 1. Find Source Stock (Exact match only)
        let src = await Inventory.findOne({ 
            itemName: itemName.trim(),
            category: category.trim(),
            godown: fromGodown 
        });

        // 2. Strict Stock Check
        if (!src || src.availableStock < qty) {
            return res.status(400).json({ 
                message: `Insufficient stock! ${fromGodown} only has ${src ? src.availableStock : 0} units.` 
            });
        }

        // 3. Find or Create Destination
        let dst = await Inventory.findOne({ 
            itemName: itemName.trim(),
            category: category.trim(),
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

        // 4. Atomic Update
        src.availableStock -= qty;
        src.totalStock -= qty;
        dst.availableStock += qty;
        dst.totalStock += qty;

        await src.save();
        await dst.save();

        res.json({ message: "Transfer Successful" });
    } catch (e) {
        res.status(500).json({ message: "Server Error: " + e.message });
    }
});

app.post('/dispatch', async (req, res) => {
    const item = await Inventory.findById(req.body.itemId);
    if (!item || item.availableStock < req.body.quantity) return res.status(400).send("No Stock");
    item.availableStock -= req.body.quantity; await item.save();
    const count = await Transaction.countDocuments({ type: 'DC' });
    const challan = await new Transaction({ ...req.body, type: 'DC', challanNo: `DC-${1001 + count}`, godown: item.godown }).save();
    res.json(challan);
});

app.post('/return', async (req, res) => {
    const item = await Inventory.findById(req.body.itemId);
    item.availableStock += Number(req.body.quantity); await item.save();
    const count = await Transaction.countDocuments({ type: 'RC' });
    const challan = await new Transaction({ ...req.body, type: 'RC', challanNo: `RC-${1001 + count}`, godown: item.godown }).save();
    res.json(challan);
});

app.get('/site-balance/:siteId', async (req, res) => {
    const txns = await Transaction.find({ siteId: req.params.siteId });
    let bal = {};
    for (let t of txns) { bal[t.itemId] = (bal[t.itemId] || 0) + (t.type === 'DC' ? t.quantity : -t.quantity); }
    let out = [];
    for (let id in bal) {
        if (bal[id] > 0) {
            const info = await Inventory.findById(id);
            if (info) out.push({ itemName: info.itemName, category: info.category, currentBalance: bal[id] });
        }
    }
    res.json(out);
});

app.get('/calculate-bill/:siteId', async (req, res) => {
    try { res.json(await calculateSiteBill(req.params.siteId)); } 
    catch (e) { res.status(500).send(e.message); }
});

app.get('/statement/:builderId', async (req, res) => res.json(await getBuilderStats(req.params.builderId)));
app.post('/add-payment', async (req, res) => { await new Payment(req.body).save(); res.send("OK"); });

app.get('/company-stats', async (req, res) => {
    const builders = await Builder.find();
    let billed = 0, out = 0;
    for (let b of builders) {
        const s = await getBuilderStats(b._id);
        billed += s.totalBilled; out += s.outstanding;
    }
    res.json({ currentMonthBilled: billed, totalOutstanding: out });
});

app.listen(5000);
