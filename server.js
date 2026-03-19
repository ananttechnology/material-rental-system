const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
// FINAL CORS FIX: Explicitly allow your GitHub domain
app.use(cors({
    origin: ["https://ananttechnology.github.io", "http://127.0.0.1:5500"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type"]
}));
app.use(express.json());

const MONGO_URI = "mongodb+srv://ananttechnology25:Lkg7begZ0WcFIqoC@materialtenting.aczjrep.mongodb.net/?appName=materialtenting"; 

mongoose.connect(MONGO_URI).then(() => console.log("✅ System Audit: DB Connected"));

// --- MODELS ---
const Builder = mongoose.model('Builder', new mongoose.Schema({ companyName: String, mobile: String, gstNumber: String, address: String }));
const Site = mongoose.model('Site', new mongoose.Schema({ builderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Builder' }, siteName: String, siteAddress: String }));
const Inventory = mongoose.model('Inventory', new mongoose.Schema({ itemName: String, category: String, godown: String, totalStock: Number, availableStock: Number }));
const Transaction = mongoose.model('Transaction', new mongoose.Schema({ type: String, challanNo: String, builderId: mongoose.Schema.Types.ObjectId, siteId: mongoose.Schema.Types.ObjectId, itemId: mongoose.Schema.Types.ObjectId, godown: String, quantity: Number, rate: { type: Number, default: 0 }, loadingCharges: { type: Number, default: 0 }, unloadingCharges: { type: Number, default: 0 }, date: { type: Date, default: Date.now } }));
const Payment = mongoose.model('Payment', new mongoose.Schema({ builderId: mongoose.Schema.Types.ObjectId, amountPaid: Number, paymentMode: String, referenceNo: String, date: { type: Date, default: Date.now } }));

// --- BILLING ENGINE LOGIC ---
async function calculateSiteBill(siteId, startDate = null, endDate = null) {
    const txns = await Transaction.find({ siteId }).sort({ date: 1 });
    let service = 0, bill = [], items = {};
    
    // Convert strings to Date objects if they exist
    const filterStart = startDate ? new Date(startDate) : null;
    const filterEnd = endDate ? new Date(endDate) : new Date();

    txns.forEach(t => {
        // Only count service charges (loading/unloading) if they fall within the range
        if (!filterStart || (new Date(t.date) >= filterStart && new Date(t.date) <= filterEnd)) {
            service += (t.loadingCharges || 0) + (t.unloadingCharges || 0);
        }
        const key = t.itemId.toString();
        if (!items[key]) items[key] = { dc: [], rc: [] };
        t.type === 'DC' ? items[key].dc.push({ ...t._doc }) : items[key].rc.push({ ...t._doc });
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
                    
                    // Logic: Start rent at (Dispatch Date OR Filter Start), End at (Return Date)
                    let rentStart = filterStart && new Date(d.date) < filterStart ? filterStart : new Date(d.date);
                    let rentEnd = new Date(r.date);

                    if (rentStart <= rentEnd && (!filterEnd || rentStart <= filterEnd)) {
                        let actualEnd = filterEnd && rentEnd > filterEnd ? filterEnd : rentEnd;
                        let days = Math.max(1, Math.floor((actualEnd - rentStart) / 86400000) + 1);
                        
                        bill.push({ 
                            name: info.itemName, cat: info.category, qty: take, days, rate: d.rate, 
                            total: take * d.rate * days, 
                            duration: `${rentStart.toLocaleDateString()} to ${actualEnd.toLocaleDateString()}` 
                        });
                    }
                    d.quantity -= take; q -= take;
                }
            });
        });

        dcs.forEach(d => {
            if (d.quantity > 0) {
                let rentStart = filterStart && new Date(d.date) < filterStart ? filterStart : new Date(d.date);
                let rentEnd = filterEnd; // For items on site, we stop at the filter end date

                if (rentStart <= rentEnd) {
                    let days = Math.max(1, Math.floor((rentEnd - rentStart) / 86400000) + 1);
                    bill.push({ 
                        name: info.itemName, cat: info.category, qty: d.quantity, days, rate: d.rate, 
                        total: d.quantity * d.rate * days, 
                        duration: `${rentStart.toLocaleDateString()} to ${filterEnd ? filterEnd.toLocaleDateString() : 'On Site'}` 
                    });
                }
            }
        });
    }
    return { bill, service, subtotal: bill.reduce((s, i) => s + i.total, 0) };
}
app.get('/company-stats', async (req, res) => {
    try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

        // We fetch the collections directly to ensure we have data
        const builders = await mongoose.model('Builder').find({});
        let grandTotal = 0;
        let breakdown = [];

        for (let b of builders) {
            const sites = await mongoose.model('Site').find({ builderId: b._id });
            let builderSum = 0;

            for (let s of sites) {
                try {
                    // Using 'global' check to find your function anywhere in the file
                    const billingFn = typeof calculateSiteBill === 'function' ? calculateSiteBill : null;
                    
                    if (billingFn) {
                        const result = await billingFn(s._id, startOfMonth, endOfToday);
                        if (result && result.subtotal) {
                            builderSum += result.subtotal;
                        }
                    }
                } catch (err) {
                    console.log("Skipping site due to data error");
                }
            }
            if (builderSum > 0) {
                grandTotal += builderSum;
                breakdown.push({ name: b.companyName, amount: Math.round(builderSum) });
            }
        }

        res.json({
            currentMonthBilled: Math.round(grandTotal),
            monthName: now.toLocaleString('default', { month: 'Long' }),
            builderBreakdown: breakdown
        });
    } catch (e) {
        console.error("DASHBOARD CRASH:", e.message);
        res.status(500).json({ error: e.message });
    }
});

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
    } else { await new Inventory({ ...req.body, totalStock, availableStock: totalStock }).save(); }
    res.send("OK");
});

app.post('/transfer-stock', async (req, res) => {
    const { itemName, category, fromGodown, toGodown, quantity } = req.body;
    const qty = Number(quantity);
    let src = await Inventory.findOne({ itemName: itemName.trim(), category: category.trim(), godown: fromGodown });
    if (!src || src.availableStock < qty) return res.status(400).json({ message: "Insufficient Stock" });
    let dst = await Inventory.findOne({ itemName: itemName.trim(), category: category.trim(), godown: toGodown });
    if (!dst) dst = new Inventory({ itemName: src.itemName, category: src.category, godown: toGodown, totalStock: 0, availableStock: 0 });
    src.availableStock -= qty; src.totalStock -= qty; dst.availableStock += qty; dst.totalStock += qty;
    await src.save(); await dst.save(); res.json({ message: "Success" });
});

app.post('/dispatch', async (req, res) => {
    const item = await Inventory.findById(req.body.itemId);
    if (!item || item.availableStock < req.body.quantity) return res.status(400).json({message: "No Stock"});
    item.availableStock -= Number(req.body.quantity); await item.save();
    const count = await Transaction.countDocuments({ type: 'DC' });
    const challan = await new Transaction({ ...req.body, type: 'DC', challanNo: `DC-${1001 + count}`, godown: item.godown }).save();
    res.json(challan);
});

app.post('/return', async (req, res) => {
    try {
        const { itemId, siteId, quantity } = req.body;
        const qty = Number(quantity);

        // 1. VALIDATION: Check if site actually holds this much
        const txns = await Transaction.find({ siteId: siteId, itemId: itemId });
        let currentSiteBalance = 0;
        txns.forEach(t => {
            currentSiteBalance += (t.type === 'DC' ? t.quantity : -t.quantity);
        });

        if (qty > currentSiteBalance) {
            return res.status(400).json({ message: `Return failed! Site only has ${currentSiteBalance} units remaining.` });
        }

        // 2. PROCESS RETURN: If valid, update inventory
        const item = await Inventory.findById(itemId);
        if(!item) return res.status(404).json({message: "Item not found"});
        
        item.availableStock += qty;
        await item.save();

        const count = await Transaction.countDocuments({ type: 'RC' });
        const challanNo = `RC-${1001 + count}`;
        
        const newTxn = new Transaction({ ...req.body, type: 'RC', challanNo, godown: item.godown });
        await newTxn.save();

        res.json({ challanNo });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// Add this right below your other app.post routes in server.js
app.post('/add-builder', async (req, res) => {
    try {
        const builder = new Builder(req.body);
        await builder.save();
        res.status(200).json({ message: "Builder saved successfully" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Also add the missing Site route while you are there
app.post('/add-site', async (req, res) => {
    try {
        const site = new Site(req.body);
        await site.save();
        res.status(200).json({ message: "Site linked successfully" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/site-balance/:siteId', async (req, res) => {
    const txns = await Transaction.find({ siteId: req.params.siteId });
    let bal = {};
    for (let t of txns) { 
        const id = t.itemId.toString();
        bal[id] = (bal[id] || 0) + (t.type === 'DC' ? t.quantity : -t.quantity); 
    }
    let out = [];
    for (let id in bal) {
        if (bal[id] > 0) {
            const info = await Inventory.findById(id);
            if (info) out.push({ itemId: id, itemName: info.itemName, category: info.category, godown: info.godown, currentBalance: bal[id] });
        }
    }
    res.json(out);
});

app.get('/calculate-bill/:siteId', async (req, res) => {
    const { siteId } = req.params;
    const { start, end, builderId } = req.query; // Added builderId as a query param

    try {
        if (siteId === "ALL") {
            // 1. Logic for Total (Consolidated) Billing
            const sites = await Site.find({ builderId });
            let consolidatedData = {
                isConsolidated: true,
                sites: [],
                grandTotal: 0,
                totalService: 0,
                totalSubtotal: 0
            };

            for (let s of sites) {
                const siteBill = await calculateSiteBill(s._id, start, end);
                consolidatedData.sites.push({
                    siteName: s.siteName,
                    bill: siteBill.bill,
                    subtotal: siteBill.subtotal,
                    service: siteBill.service
                });
                consolidatedData.totalSubtotal += siteBill.subtotal;
                consolidatedData.totalService += siteBill.service;
            }
            res.json(consolidatedData);
        } else {
            // 2. Logic for Single Site Billing (Existing Functionality)
            const result = await calculateSiteBill(siteId, start, end);
            res.json({ ...result, isConsolidated: false });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.post('/add-payment', async (req, res) => { await new Payment(req.body).save(); res.send("OK"); });
app.get('/statement/:builderId', async (req, res) => {
    const sites = await Site.find({ builderId: req.params.builderId });
    const payments = await Payment.find({ builderId: req.params.builderId });
    let totalBilled = 0;
    for (let s of sites) { const res = await calculateSiteBill(s._id); totalBilled += (res.subtotal + res.service); }
    const totalPaid = payments.reduce((sum, p) => sum + p.amountPaid, 0);
    res.json({ totalBilled, totalPaid, outstanding: totalBilled - totalPaid, payments });
});

app.get('/all-transactions', async (req, res) => {
    try {
        const txns = await Transaction.find().sort({ date: -1 }); // Newest first
        const builders = await Builder.find();
        const sites = await Site.find();
        const items = await Inventory.find();

        const history = txns.map(t => {
            const b = builders.find(x => x._id.toString() === t.builderId.toString());
            const s = sites.find(x => x._id.toString() === t.siteId.toString());
            const i = items.find(x => x._id.toString() === t.itemId.toString());
            return {
                ...t._doc,
                builderName: b ? b.companyName : 'N/A',
                siteName: s ? s.siteName : 'N/A',
                itemName: i ? i.itemName + " (" + i.category + ")" : 'N/A'
            };
        });
        res.json(history);
    } catch (e) {
        res.status(500).send(e.message);
    }
});
app.put('/edit-transaction/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { date, itemId, quantity, rate, loadingCharges, unloadingCharges } = req.body;

        const oldTxn = await Transaction.findById(id);
        if (!oldTxn) return res.status(404).json({ error: "Transaction not found" });

        const oldQty = parseFloat(oldTxn.quantity) || 0;
        const newQty = parseFloat(quantity) || 0;
        const oldItemId = oldTxn.itemId.toString();
        const newItemId = itemId;

        // STEP 1: UNDO OLD STOCK (Temporary)
        const oldInvItem = await Inventory.findById(oldItemId);
        if (oldInvItem) {
            if (oldTxn.type === 'DC') oldInvItem.availableStock += oldQty;
            else oldInvItem.availableStock -= oldQty;
            // We don't save yet, just update the object in memory
        }

        // STEP 2: SAFETY CHECK FOR NEW ITEM
        const newInvItem = (oldItemId === newItemId) ? oldInvItem : await Inventory.findById(newItemId);
        if (!newInvItem) return res.status(404).json({ error: "New item not found" });

        // If it's a Dispatch (DC), check if we have enough
        if (oldTxn.type === 'DC' && newInvItem.availableStock < newQty) {
            return res.status(400).json({ 
                error: `Insufficient Stock! ${newInvItem.itemName} only has ${newInvItem.availableStock} available.` 
            });
        }

        // STEP 3: APPLY NEW STOCK
        if (oldTxn.type === 'DC') newInvItem.availableStock -= newQty;
        else newInvItem.availableStock += newQty;

        // STEP 4: SAVE EVERYTHING (Atomic-like)
        if (oldInvItem && oldItemId !== newItemId) await oldInvItem.save();
        await newInvItem.save();

        oldTxn.date = date;
        oldTxn.itemId = newItemId;
        oldTxn.quantity = newQty;
        oldTxn.rate = parseFloat(rate) || 0;
        if (oldTxn.type === 'DC') oldTxn.loadingCharges = parseFloat(loadingCharges) || 0;
        else oldTxn.unloadingCharges = parseFloat(unloadingCharges) || 0;
        
        await oldTxn.save();
        res.json({ message: "Success" });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// --- MOVE THIS TO THE VERY BOTTOM OF SERVER.JS ---

app.listen(5000);
