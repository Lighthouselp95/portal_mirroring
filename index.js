const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const DB_FILE = path.join(__dirname, 'all_logs.json');

function readDatabase() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            fs.writeFileSync(DB_FILE, JSON.stringify({}));
            return {};
        }
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return data.trim() ? JSON.parse(data) : {};
    } catch (error) {
        console.error("Lỗi đọc file database:", error);
        return {};
    }
}

function writeDatabase(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 4), 'utf8');
    } catch (error) {
        console.error("Lỗi ghi file database:", error);
    }
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'app.html'));
});

app.post('/api/push', (req, res) => {
    const { myPhoneNumber, token, type, incomingNumber, content, time } = req.body;

    // Basic sanitation validation
    if (!myPhoneNumber || !token) {
        return res.status(400).json({ error: "Missing required authentication fields." });
    }

    let db = readDatabase(); // Load your all_logs.json file
    
    if (type === "RESET") {
        if (db[myPhoneNumber]) {
            db[myPhoneNumber].token = ""; // Chuyển trực tiếp token trên server thành rỗng
            writeDatabase(db);
            console.log(`[SYSTEM] Tài khoản ${myPhoneNumber} đã hủy kích hoạt Token thành công.`);
            return res.status(200).json({ status: "SUCCESS", message: "Token has been cleared." });
        }
        return res.status(200).json({ status: "SUCCESS", message: "User not found, nothing to clear." });
    }

    // 🌟 AUTOMATIC REGISTRATION: If the user doesn't exist in the database, create them right now!
    if (!db[myPhoneNumber]) {
        db[myPhoneNumber] = {
            token: token,
            createdAt: new Date().toISOString(),
            calls: [],
            sms: []
        };
        console.log(`[SYSTEM] Dynamically created new account profile for: ${myPhoneNumber}`);
        // We don't save yet, let the logic flow down or handle the write below
    }

    // AUTHENTICATION CHECK: Verify credentials if the user already existed
    if (db[myPhoneNumber].token !== token) {
        return res.status(403).json({ error: "Invalid Token credentials!" });
    }

    // 🌟 SILENT PING FILTER: If this is just the 5-minute check-in, do not save it to logs
    if (type === "PING") {
        writeDatabase(db); // Commit registration changes if it was a new user
        console.log(`[HEARTBEAT] User ${myPhoneNumber} verified alive.`);
        return res.status(200).json({ status: "OK", message: "Heartbeat acknowledged. User profile verified/active." });
    }

    // REGULAR DATA HANDLING: If it's a real CALL or SMS, push it into the correct array
    const logItem = {
        id: `${Date.now()}_${type}_${Math.floor(100 + Math.random() * 900)}`, // Standardized numeric-first ID
        incomingNumber: incomingNumber,
        content: content,
        time: time
    };

    if (type === "CALL") {
        db[myPhoneNumber].calls = db[myPhoneNumber].calls || [];
        db[myPhoneNumber].calls.push(logItem);
    } else if (type === "SMS") {
        db[myPhoneNumber].sms = db[myPhoneNumber].sms || [];
        db[myPhoneNumber].sms.push(logItem);
    }

    // Save changes to disk
    writeDatabase(db);
    console.log(`[DATA] Successfully logged ${type} from ${incomingNumber} for user ${myPhoneNumber}`);

    return res.status(200).json({ status: "SUCCESS" });
});

app.get('/api/fetch', (req, res) => {
    const { phone, token, lastId } = req.query;

    let db = readDatabase();
    if (!db[phone] || db[phone].token !== token) {
        return res.status(403).json({ error: "Sai thông tin hoặc chưa kích hoạt!" });
    }

    const accountData = db[phone];

    return res.status(200).json({
        phone: phone,
        calls: (accountData.calls || []).map(item => ({
            ...item,
            isNew: (lastId && lastId.trim() !== "") ? (item.id > lastId) : false
        })),
        sms: (accountData.sms || []).map(item => ({
            ...item,
            isNew: (lastId && lastId.trim() !== "") ? (item.id > lastId) : false
        }))
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`=== SERVER GƯƠNG CHIẾU INFORMINI ĐANG CHẠY TẠI PORT: ${PORT} ===`);
});