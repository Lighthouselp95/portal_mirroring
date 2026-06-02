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
app.post('/api/push', (express.json()), (req, res) => {
    const { myPhoneNumber, token, type, incomingNumber, content, time } = req.body;

    // Kiểm tra tính đầy đủ của thông tin đầu vào bắt buộc
    if (!myPhoneNumber || !token || !type || !incomingNumber) {
        return res.status(400).json({ error: "Thiếu thông tin dữ liệu push bắt buộc!" });
    }

    const db = readDatabase();

    // KIỂM TRA: Nếu số điện thoại này chưa từng tồn tại trên hệ thống
    if (!db[myPhoneNumber]) {
        // Tạo mới duy nhất một đối tượng JSON làm gốc cho số máy này
        db[myPhoneNumber] = {
            token: token,
            calls: [],
            sms: []
        };
        console.log(`[Hệ thống] Đã tạo hồ sơ JSON mới cho số thiết bị: ${myPhoneNumber}`);
    } else {
        // Nếu số điện thoại ĐÃ CÓ HỒ SƠ: Kiểm tra xem token gửi lên có thay đổi không
        if (db[myPhoneNumber].token !== token) {
            console.log(`[Cập nhật] Token của số ${myPhoneNumber} đổi từ [${db[myPhoneNumber].token}] thành [${token}]`);
            // Chỉ cập nhật (ghi đè) lại trường token mới, tuyệt đối giữ nguyên mảng calls/sms cũ
            db[myPhoneNumber].token = token;
        }
    }

    // Tự sinh ID định danh duy nhất cho từng bản ghi log để frontend đối chiếu cache
    const logId = type.toUpperCase() + "_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    const newLogItem = {
        id: logId,
        incomingNumber: incomingNumber,
        content: content || "",
        time: time || new Date().toLocaleTimeString()
    };

    // Phân loại và đẩy bản ghi vào đúng mảng con bên trong đối tượng JSON của số điện thoại đó
    if (type.toUpperCase() === 'CALL') {
        db[myPhoneNumber].calls.push(newLogItem);
    } else if (type.toUpperCase() === 'SMS') {
        db[myPhoneNumber].sms.push(newLogItem);
    }

    // Ghi lưu dữ liệu cập nhật xuống file cứng all_logs.json
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