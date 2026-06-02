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
app.get('/api/fetch', (req, res) => {
    const { phone, token } = req.query;

    if (!phone || !token) {
        return res.status(200).json([]);
    }

    const db = readDatabase();
    const userData = db[phone];

    // Xác thực an toàn: Phải tồn tại SĐT đó và token nhập trên Web phải khớp với token hiện tại của JSON gốc
    if (!userData || userData.token !== token) {
        return res.status(200).json([]); 
    }

    // Map dữ liệu đóng dấu nhãn loại log để Frontend nhận diện chuẩn xác
    const mappedCalls = (userData.calls || []).map(item => ({ ...item, type: 'CALL' }));
    const mappedSms = (userData.sms || []).map(item => ({ ...item, type: 'SMS' }));

    // Gộp mảng phẳng trả về cho giao diện hiển thị tinh gọn
    const combinedLogs = [...mappedCalls, ...mappedSms];
    
    res.status(200).json(combinedLogs);
});

// Kích hoạt cổng lắng nghe linh hoạt tương thích tốt khi triển khai lên Render Cloud
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`=== SERVER GƯƠNG CHIẾU ĐỒNG BỘ ĐANG CHẠY TẠI CỔNG: ${PORT} ===`);
});