const path = require('path'); // Move this to line 1
require('dotenv').config({ path: path.join(__dirname, '.env') }); // Move this to line 2

const express = require('express');
const fs = require('fs'); // Built-in Node.js module (No install required!)

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const inventoryPath = path.join(__dirname, 'inventory.json');

// Helper function to read the JSON file safely
function readInventory() {
    const data = fs.readFileSync(inventoryPath, 'utf8');
    return JSON.parse(data);
}

// Helper function to write updates back to the JSON file safely
function writeInventory(data) {
    fs.writeFileSync(inventoryPath, JSON.stringify(data, null, 4), 'utf8');
}

// Endpoint 1: Send inventory list to frontend storefront loop
app.get('/api/shirts', (req, res) => {
    const shirts = readInventory();
    res.json(shirts);
});

// Endpoint 2: Process checkout, update database limits, and notify Slack
app.post('/api/checkout', async (req, res) => {
    const cartItems = req.body.cart;
    const customerEmail = req.body.email || 'No email provided';
    const customerName = req.body.fullName || 'No name provided';
    const customerAddress = req.body.streetAddress
        ? `${req.body.streetAddress}, ${req.body.state} ${req.body.zipCode}`
        : 'No address provided';
    let inventory = readInventory();
    let issues = [];
    let orderTotal = 0;

    // 1. First validation loop check: Verify if items are in stock
    cartItems.forEach(cartItem => {
        const item = inventory.find(s => s.name === cartItem.name);
        if (!item) {
            issues.push(`Item "${cartItem.name}" not found.`);
        } else {
            if (item.stock < cartItem.quantity) {
                issues.push(`Sorry, "${cartItem.name}" only has ${item.stock} left in stock.`);
            }

            const size = cartItem.size;
            if (size && item.stockBySize && item.stockBySize[size] !== undefined && item.stockBySize[size] < cartItem.quantity) {
                issues.push(`Sorry, "${cartItem.name}" only has ${item.stockBySize[size]} left in ${size} stock.`);
            }
        }
    });

    // 2. Reject request transaction if inventory limits are broken
    if (issues.length > 0) {
        return res.status(400).json({ success: false, errors: issues });
    }

    // 3. Execution loop logic step: Subtract bought amounts & calculate total
    let itemsSummaryList = [];
    cartItems.forEach(cartItem => {
        const item = inventory.find(s => s.name === cartItem.name);
        item.stock -= cartItem.quantity;

        if (cartItem.size && item.stockBySize && item.stockBySize[cartItem.size] !== undefined) {
            item.stockBySize[cartItem.size] -= cartItem.quantity;
            item.stockBySize[cartItem.size] = Math.max(0, item.stockBySize[cartItem.size]);
        }

        // Keep track of cost and text styling for the notification
        const itemCost = (item.price || 0) * cartItem.quantity;
        orderTotal += itemCost;
        itemsSummaryList.push(`• ${cartItem.quantity}x ${cartItem.name} (${cartItem.size || 'No Size'}) - $${itemCost.toFixed(2)}`);
    });

    // 4. Save modifications back to the text file database
    writeInventory(inventory);

    // 5. Read order notification API key securely from your system environment variables
    const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
    
    if (!SLACK_WEBHOOK_URL) {
        console.error("⚠️ Error: SLACK_WEBHOOK_URL environment variable is missing!");
    } else {
        const slackMessage = {
            text: `🛍️ *New ShirtShop Order Received!*\n` +
                  `• *Customer Name:* ${customerName}\n` +
                  `• *Customer Email:* ${customerEmail}\n` +
                  `• *Customer Address:* ${customerAddress}\n` +
                  `• *Items Ordered:*\n${itemsSummaryList.join('\n')}\n` +
                  `• *Total Value:* $${orderTotal.toFixed(2)}`
        };

        try {
            await fetch(SLACK_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(slackMessage)
            });
            console.log('Order notification successfully pushed to Slack!');
        } catch (error) {
            // Log error locally but do not crash the customer checkout process
            console.error('Failed to dispatch alert to Slack:', error);
        }
    }

    // Return success response to the client frontend
    res.json({ success: true, message: "Order processed, inventory updated!" });
});

// Clean Routing for Main Pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/cart', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/cart.html'));
});

app.get('/checkout', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/checkout.html'));
});

// Start the server (Consolidated to run cleanly once)
app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
