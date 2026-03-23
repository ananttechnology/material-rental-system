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
const Transaction = mongoose.model('Transaction', new mongoose.Schema({ type: String, challanNo: String, builderId: mongoose.Schema.Types.ObjectId, siteId: mongoose.Schema.Types.ObjectId, items: [{ itemId: mongoose.Schema.Types.ObjectId, itemName: String, quantity: Number, rate: { type: Number, default: 0 }, damagedQty: { type: Number, default: 0 }, damagedRate: { type: Number, default: 0 } }], loadingCharges: { type: Number, default: 0 }, unloadingCharges: { type: Number, default: 0 }, date: { type: Date, default: Date.now } }));
const Payment = mongoose.model('Payment', new mongoose.Schema({ builderId: mongoose.Schema.Types.ObjectId, amountPaid: Number, paymentMode: String, referenceNo: { type: String, default: "" }, date: { type: Date, default: Date.now } }));

// --- BILLING ENGINE LOGIC ---
async function calculateSiteBill(siteId, startDate = null, endDate = null) {
    const txns = await Transaction.find({ siteId }).sort({ date: 1 });
    let service = 0, bill = [], items = {}, damageTotal = 0, damageList = []; // damageTotal initialized
    
    const filterStart = startDate ? new Date(startDate) : null;
    const filterEnd = endDate ? new Date(endDate) : new Date();
    //console.log(`--- Billing Debug for Site: ${siteId} ---`);
    //console.log(`Filter Range: ${filterStart} to ${filterEnd}`);
    //console.log(`Total Transactions Found: ${txns.length}`);

    txns.forEach(t => {
        // Fix 1: Ensure we check the transaction date correctly for Service & Damage
        const txnDate = new Date(t.date);
        if (!filterStart || (txnDate >= filterStart && txnDate <= filterEnd)) {
            //service += (t.loadingCharges || 0) + (t.unloadingCharges || 0);
            
            // Fix 2: Add Damage Penalty logic specifically here
            if (t.type === 'RC' && t.items) {
                //console.log(`Processing RC Challan: ${t.challanNo} on Date: ${txnDate}`);
                t.items.forEach(item => {
                    // We use Number() to ensure math works even if data is a string
                    const dQty = Number(item.damagedQty) || 0;
                    const dRate = Number(item.damagedRate) || 0;
                    if (dQty > 0) {
                        const currentDmg = dQty * dRate;
                        damageTotal += currentDmg;
                        //console.log(`>> DAMAGE FOUND: ${item.itemName} | Qty: ${dQty} | Rate: ${dRate} | Sum: ${currentDmg}`);
                        damageList.push({
                            name: item.itemName,
                            qty: dQty,
                            rate: dRate,
                            total: dQty * dRate,
                            date: t.date
                        });
                    }
                });
            }
            service += (t.loadingCharges || 0) + (t.unloadingCharges || 0);
        } else {
            // This will tell us if the transaction is being ignored because of the date
            if (t.type === 'RC') {
                //console.log(`SKIPPED RC ${t.challanNo}: Date ${txnDate} is OUTSIDE filter range.`);
            }
        }
        
        t.items.forEach(item => {
            const key = item.itemId.toString();
            if (!items[key]) items[key] = { dc: [], rc: [] };
            
            const flatItem = { 
                ...t._doc, 
                quantity: item.quantity, 
                rate: item.rate,
                itemName: item.itemName,
                category: item.category 
            };
            t.type === 'DC' ? items[key].dc.push(flatItem) : items[key].rc.push(flatItem);
        });
    });

    for (let id in items) {
        const info = await Inventory.findById(id);
        if(!info) continue;
        let dcs = items[id].dc, rcs = items[id].rc;

        // Your original matching logic (Unchanged)
        rcs.forEach(r => {
            let q = r.quantity;
            dcs.forEach(d => {
                if (d.quantity > 0 && q > 0) {
                    let take = Math.min(d.quantity, q);
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
                let rentEnd = filterEnd; 

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

    //console.log(`Final calculated damageTotal: ${damageTotal}`);
    const subtotal = bill.reduce((s, i) => s + i.total, 0);
    // grandTotal now correctly includes the calculated damageTotal
    return { bill, service, subtotal, damageTotal, damageList, grandTotal: subtotal + service + damageTotal };
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

// 1. Modified Dispatch to handle Deposit
app.post('/dispatch', async (req, res) => {
    try {
        const { builderId, siteId, items, loadingCharges, deposit, date, godown } = req.body;

        // 1. Validate ALL items in basket first
        for (const cartItem of items) {
            const inv = await Inventory.findById(cartItem.itemId);
            if (!inv || inv.availableStock < cartItem.quantity) {
                return res.status(400).json({ message: `Insufficient Stock for ${cartItem.itemName}` });
            }
        }

        // 2. If all valid, deduct stock
        for (const cartItem of items) {
            await Inventory.findByIdAndUpdate(cartItem.itemId, { 
                $inc: { availableStock: -Number(cartItem.quantity) } 
            });
        }

        // 3. Create Single Challan
        const count = await Transaction.countDocuments({ type: 'DC' });
        const challan = new Transaction({
            type: 'DC',
            challanNo: `DC-${1001 + count}`,
            builderId, siteId, godown, items, loadingCharges, deposit, date
        });
        await challan.save();

        // 4. Auto-Deposit Payment
        if (deposit && Number(deposit) > 0) {
            await new Payment({
                builderId, amountPaid: Number(deposit),
                paymentMode: 'Cash', referenceNo: 'Advance Deposit', date: date || new Date()
            }).save();
        }
        res.json(challan);
    } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/return', async (req, res) => {
    try {
        const { siteId, items, unloadingCharges, date, builderId } = req.body;

        // 1. GET CURRENT SITE BALANCE (Exact same logic as your code)
        const txns = await Transaction.find({ siteId: siteId });
        let siteBalances = {};
        
        txns.forEach(t => {
            t.items.forEach(item => {
                const id = item.itemId.toString();
                // Logic: Adds if DC, Subtracts if RC
                siteBalances[id] = (siteBalances[id] || 0) + (t.type === 'DC' ? item.quantity : -item.quantity);
            });
        });

        // 2. VALIDATION: Check every item in the return basket against Site Balance
        for (const returnItem of items) {
            const currentBal = siteBalances[returnItem.itemId] || 0;
            // Validate the Total Quantity being returned (both good and damaged)
            if (Number(returnItem.quantity) > currentBal) {
                return res.status(400).json({ 
                    message: `Return Failed! Site only has ${currentBal} units of ${returnItem.itemName} remaining.` 
                });
            }
        }

        // 3. PROCESS: Update Inventory Stock
        for (const returnItem of items) {
            const inv = await Inventory.findById(returnItem.itemId);
            if (inv) {
                // NEW LOGIC: Only "Good" items return to available inventory.
                // Subtract damagedQty from the total quantity returned.
                const returnToStock = Number(returnItem.quantity) - (Number(returnItem.damagedQty) || 0);
                
                if (returnToStock > 0) {
                    inv.availableStock += returnToStock;
                    await inv.save();
                }
            }
        }

        // 4. CREATE RC CHALLAN (Using your counter and naming convention)
        const count = await Transaction.countDocuments({ type: 'RC' });
        const challanNo = `RC-${1001 + count}`;
        
        const newTxn = new Transaction({ 
            ...req.body, 
            type: 'RC', 
            challanNo
        });
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
    
    txns.forEach(t => {
        t.items.forEach(item => {
            const id = item.itemId.toString();
            if (!bal[id]) bal[id] = { name: item.itemName, cat: item.category, qty: 0, godown: t.godown };
            bal[id].qty += (t.type === 'DC' ? item.quantity : -item.quantity);
        });
    });

    let out = Object.keys(bal)
        .filter(id => bal[id].qty > 0)
        .map(id => ({
            itemId: id,
            itemName: bal[id].name,
            category: bal[id].cat,
            godown: bal[id].godown,
            currentBalance: bal[id].qty
        }));
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
                totalSubtotal: 0,
                totalDamage: 0
            };

            for (let s of sites) {
                const siteBill = await calculateSiteBill(s._id, start, end);
                consolidatedData.sites.push({
                    siteName: s.siteName,
                    bill: siteBill.bill,
                    subtotal: siteBill.subtotal,
                    service: siteBill.service,
                    damageTotal: siteBill.damageTotal,
                    damageList: siteBill.damageList
                });
                consolidatedData.totalSubtotal += siteBill.subtotal;
                consolidatedData.totalService += siteBill.service;
                consolidatedData.totalDamage += (siteBill.damageTotal || 0);
            }
            consolidatedData.grandTotal = consolidatedData.totalSubtotal + consolidatedData.totalService + consolidatedData.totalDamage;
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
// 2. Modified Statement for Month-wise calculation
app.get('/statement/:builderId', async (req, res) => {
    const bId = req.params.builderId;
    const sites = await Site.find({ builderId: bId });
    const payments = await Payment.find({ builderId: bId }).sort({ date: 1 });
    
    // Find the first ever dispatch date for this builder
    const firstTxn = await Transaction.findOne({ builderId: bId }).sort({ date: 1 });
    
    let monthlyBilled = [];
    let totalBilled = 0;

    if (firstTxn) {
        let current = new Date(firstTxn.date);
        current.setDate(1); // Start of the first month
        const today = new Date();

        while (current <= today) {
            const mStart = new Date(current.getFullYear(), current.getMonth(), 1);
            const mEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
            const calcEnd = mEnd > today ? today : mEnd;

            let monthTotal = 0;
            for (let s of sites) {
                const result = await calculateSiteBill(s._id, mStart, calcEnd);
                monthTotal += (result.subtotal + result.service);
            }

            monthlyBilled.push({
                month: current.toLocaleString('default', { month: 'long', year: 'numeric' }),
                amount: monthTotal
            });
            totalBilled += monthTotal;
            current.setMonth(current.getMonth() + 1);
        }
    }

    const totalPaid = payments.reduce((sum, p) => sum + p.amountPaid, 0);
    res.json({ 
        monthlyBilled, 
        totalBilled, 
        totalPaid, 
        outstanding: totalBilled - totalPaid, 
        payments 
    });
});

app.get('/company-stats', async (req, res) => {
    try {
        const builders = await Builder.find();
        
        // Define Current Month Range
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const today = new Date();

        let totalCurrentMonthBilled = 0;
        let breakdown = [];

        for (let b of builders) {
            const sites = await Site.find({ builderId: b._id });
            let builderTotal = 0;
            let siteBreakdown = [];

            for (let s of sites) {
                // Use your existing calculateSiteBill logic but pass the current month range
                const result = await calculateSiteBill(s._id, startOfMonth, today);
                const siteTotal = result.subtotal + result.service;
                
                builderTotal += siteTotal;
                siteBreakdown.push({ siteName: s.siteName, amount: siteTotal });
            }

            totalCurrentMonthBilled += builderTotal;
            breakdown.push({
                builderName: b.companyName,
                builderTotal: builderTotal,
                sites: siteBreakdown
            });
        }

        res.json({ 
            currentMonthBilled: totalCurrentMonthBilled, 
            breakdown: breakdown // Sending this for the Modal view
        });
    } catch (e) {
        res.status(500).send(e.message);
    }
});
app.get('/all-transactions', async (req, res) => {
    try {
        const txns = await Transaction.find().sort({ date: -1 });
        const builders = await Builder.find();
        const sites = await Site.find();

        const history = txns.map(t => {
            const b = builders.find(x => x._id.toString() === t.builderId?.toString());
            const s = sites.find(x => x._id.toString() === t.siteId?.toString());
            
            // Map the items array to a readable string for the "Item Name" column
            const itemsSummary = t.items.map(i => `${i.itemName} (${i.quantity})`).join(", ");

            return {
                ...t._doc,
                builderName: b ? b.companyName : 'N/A',
                siteName: s ? s.siteName : 'N/A',
                itemName: itemsSummary || 'No Items' 
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
        const { date, items, loadingCharges, unloadingCharges } = req.body;

        const oldTxn = await Transaction.findById(id);
        if (!oldTxn) return res.status(404).json({ error: "Transaction not found" });

        // STEP 1: UNDO OLD STOCK IMPACT
        for (const oldItem of oldTxn.items) {
            const inv = await Inventory.findById(oldItem.itemId);
            if (inv) {
                if (oldTxn.type === 'DC') {
                    inv.availableStock += oldItem.quantity;
                } else {
                    // NEW: Subtract only what was previously added as "Good" stock
                    const oldGoodQty = Number(oldItem.quantity) - (Number(oldItem.damagedQty) || 0);
                    inv.availableStock -= oldGoodQty;
                }
                await inv.save();
            }
        }

        // STEP 2: VALIDATE NEW BASKET STOCK (Only for Dispatches)
        if (oldTxn.type === 'DC') {
            for (const newItem of items) {
                const inv = await Inventory.findById(newItem.itemId);
                // Note: availableStock is already "restored" from Step 1 here
                if (!inv || inv.availableStock < newItem.quantity) {
                    // ROLLBACK: Put stock back to original state before erroring
                    for (const oldItem of oldTxn.items) {
                        const invRoll = await Inventory.findById(oldItem.itemId);
                        if(invRoll) {
                           if(oldTxn.type === 'DC') invRoll.availableStock -= oldItem.quantity;
                           else invRoll.availableStock += (Number(oldItem.quantity) - (Number(oldItem.damagedQty) || 0));
                           await invRoll.save();
                        }
                    }
                    return res.status(400).json({ error: `Insufficient stock for ${newItem.itemName}` });
                }
            }
        }

        // STEP 3: APPLY NEW STOCK IMPACT
        for (const newItem of items) {
            const inv = await Inventory.findById(newItem.itemId);
            if (inv) {
                if (oldTxn.type === 'DC') {
                    inv.availableStock -= newItem.quantity;
                } else {
                    // NEW: Add only the "Good" quantity from the new edit
                    const newGoodQty = Number(newItem.quantity) - (Number(newItem.damagedQty) || 0);
                    inv.availableStock += newGoodQty;
                }
                await inv.save();
            }
        }

        // STEP 4: UPDATE TRANSACTION RECORD
        oldTxn.date = date;
        oldTxn.items = items; // This now saves damagedQty/damageRate correctly
        if (oldTxn.type === 'DC') oldTxn.loadingCharges = parseFloat(loadingCharges) || 0;
        else oldTxn.unloadingCharges = parseFloat(unloadingCharges) || 0;
        
        await oldTxn.save();
        res.json({ message: "Success" });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/edit-payment/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { amountPaid, paymentMode, referenceNo, date } = req.body;

        // Validation: Ensure no fields are empty or null
        if (!amountPaid || !paymentMode || !date) {
            return res.status(400).json({ error: "All fields are compulsory." });
        }

        const updatedPayment = await Payment.findByIdAndUpdate(
            id,
            { amountPaid: Number(amountPaid), paymentMode, referenceNo, date: new Date(date) },
            { new: true }
        );

        if (!updatedPayment) return res.status(404).json({ error: "Payment record not found." });

        res.json({ message: "Payment updated successfully" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.delete('/delete-transaction/:id', async (req, res) => {
    try {
        const txn = await Transaction.findById(req.params.id);
        if (!txn) return res.status(404).json({ message: "Transaction not found" });

        // Rewind stock for EVERY item in the basket
        for (const item of txn.items) {
            const factor = (txn.type === 'DC') ? 1 : -1; // Add back if Dispatch, Subtract if Return
            await Inventory.findByIdAndUpdate(item.itemId, { 
                $inc: { availableStock: item.quantity * factor } 
            });
        }

        await Transaction.findByIdAndDelete(req.params.id);
        res.json({ message: "Transaction deleted and stock restored" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.listen(5000);
