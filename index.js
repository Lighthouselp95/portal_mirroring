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

/**
 * 1. API NHẬN REQUEST ĐẨY LÊN TỪ APP MOBILE (POST)
 * Thiết bị đẩy lên đủ: myPhoneNumber, token, type, incomingNumber, content, time
 */
// Thêm dòng này để Server hiểu và tự động trả file app.html về khi truy cập trang chủ
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'app.html'));
});
/**
 * 1. API NHẬN REQUEST ĐẨY LÊN TỪ APP MOBILE (POST)
 */
app.post('/api/push', (req, res) => {
    const { myPhoneNumber, token, type, incomingNumber, content, time } = req.body;

    // Kiểm tra thông tin cốt lõi
    if (!myPhoneNumber || !token || !type) {
        return res.status(400).json({ error: "Thiếu thông tin định danh (SĐT hoặc Token)!" });
    }

    const db = readDatabase();
    const isNewAccount = !db[myPhoneNumber];

    // KIỂM TRA & KHỞI TẠO HỒ SƠ
    if (isNewAccount) {
        db[myPhoneNumber] = {
            token: token,
            calls: [],
            sms: []
        };
        console.log(`[Khởi tạo] Tạo hồ sơ gốc tự động cho số: ${myPhoneNumber}`);
    } else {
        // Nếu tài khoản đã có sẵn nhưng đổi mã Token mới
        if (db[myPhoneNumber].token !== token) {
            console.log(`[Cập nhật] Số ${myPhoneNumber} cập nhật mã Token mới: ${token}`);
            db[myPhoneNumber].token = token;
        }
    }

    // XỬ LÝ RIÊNG CHO LỆNH KHỞI TẠO TỰ ĐỘNG (INIT)
    if (type.toUpperCase() === 'INIT') {
        // Tạo một log thông báo hệ thống chào mừng đặt vào mảng SMS làm mẫu
        const logId = "INIT_" + Date.now();
        db[myPhoneNumber].sms.push({
            id: logId,
            incomingNumber: incomingNumber || "HỆ THỐNG",
            content: content || "Thiết bị kết nối thành công.",
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
 * 2. API TRẢ DATA VỀ CHO WEB FRONTEND MONITOR (GET)
 * URL truy vấn mẫu: http://localhost:3000/api/fetch?phone=123213123&token=MÃ_BẢO_MẬT
 */
/**
 * 2. API TRẢ DATA VỀ CHO WEB FRONTEND MONITOR (GET) - ĐÃ CẬP NHẬT TÁCH BIỆT LỖI SAI TOKEN
 * URL: https://portal-mirroring.onrender.com/api/fetch?phone=0967684284&token=17abe4f9
 */
app.get('/api/fetch', (req, res) => {
    // Ép trình duyệt LUÔN LUÔN lấy dữ liệu mới nhất từ Server, KHÔNG cho phép Cache (Chống lỗi trạng thái 304)
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const { phone, token } = req.query;

    if (!phone || !token) {
        return res.status(400).json({ error: "Thiếu tham số truy vấn phone hoặc token!" });
    }

    const db = readDatabase();
    const userData = db[phone];

    // TRƯỜNG HỢP 1: Số điện thoại này hoàn toàn chưa tồn tại trong file tổng
    if (!userData) {
        console.log(`[Fetch Bảo mật] Thiết bị ${phone} chưa từng được khởi tạo từ App.`);
        return res.status(404).json({ error: "DEVICE_NOT_FOUND", message: "Số điện thoại này chưa được thiết lập trên App di động!" });
    }

    // TRƯỜNG HỢP 2: Số điện thoại có tồn tại, nhưng Token nhập trên Web không khớp với Token trong JSON gốc
    if (userData.token !== token) {
        console.log(`[Fetch Bảo mật] Thiết bị ${phone} truy cập thất bại do nhập SAI mã Token.`);
        return res.status(401).json({ error: "INVALID_TOKEN", message: "Mã Token định danh không chính xác!" });
    }

    // TRƯỜNG HỢP 3: Hợp lệ -> Đóng gói mảng dữ liệu trả về (Có thể trả về [] nếu tài khoản mới chưa có log)
    const mappedCalls = (userData.calls || []).map(item => ({ ...item, type: 'CALL' }));
    const mappedSms = (userData.sms || []).map(item => ({ ...item, type: 'SMS' }));

    const combinedLogs = [...mappedCalls, ...mappedSms];
    
    return res.status(200).json(combinedLogs);
});

// Kích hoạt cổng lắng nghe linh hoạt tương thích tốt khi triển khai lên Render Cloud
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`=== SERVER GƯƠNG CHIẾU ĐỒNG BỘ ĐANG CHẠY TẠI CỔNG: ${PORT} ===`);
});