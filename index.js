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

    if (!myPhoneNumber || !token || !type) {
        return res.status(400).json({ error: "Thiếu thông tin định danh (SĐT hoặc Token)!" });
    }

    const db = readDatabase();
    const isNewAccount = !db[myPhoneNumber];

    if (isNewAccount) {
        db[myPhoneNumber] = {
            token: token,
            calls: [],
            sms: []
        };
    } else {
        if (db[myPhoneNumber].token !== token) {
            db[myPhoneNumber].token = token;
        }
    }

    if (type.toUpperCase() === 'INIT') {
        const logId = "INIT_" + Date.now();
        db[myPhoneNumber].sms.push({
            id: logId,
            incomingNumber: incomingNumber || "HỆ THỐNG",
            content: content || "Thiết bị kết nối ngầm thành công.",
            time: time || new Date().toLocaleTimeString()
        });
        
        writeDatabase(db);
        return res.status(200).json({ status: "Success", message: "Đã kích hoạt tài khoản trực tuyến từ xa thành công." });
    }

    if (!incomingNumber) {
        return res.status(400).json({ error: "Thiếu số điện thoại đối tác gửi đến!" });
    }

    const logId = type.toUpperCase() + "_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    const newLogItem = {
        id: logId,
        incomingNumber: incomingNumber,
        content: content || "",
        time: time || new Date().toLocaleTimeString()
    };

    if (type.toUpperCase() === 'CALL') {
        db[myPhoneNumber].calls.push(newLogItem);
    } else if (type.toUpperCase() === 'SMS') {
        db[myPhoneNumber].sms.push(newLogItem);
    }

    writeDatabase(db);
    return res.status(200).json({ status: "Success", message: "Đã đồng bộ dữ liệu thành công." });
});

app.get('/api/fetch', (req, res) => {
    const { phone, token, lastId } = req.query;

    let db = readDatabase();
    if (!db[phone] || db[phone].token !== token) {
        return res.status(403).json({ error: "Sai thông tin hoặc chưa kích hoạt!" });
    }

    const accountData = db[phone];

    // Trả dữ liệu về, so sánh trực tiếp chuỗi ID thời gian để xác định thuộc tính isNew
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