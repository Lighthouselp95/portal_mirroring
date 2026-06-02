const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const FILE_PATH = path.join(__dirname, 'all_logs.json');

// Khởi tạo file nếu chưa có
if (!fs.existsSync(FILE_PATH)) {
    fs.writeFileSync(FILE_PATH, JSON.stringify({}), 'utf8');
}

function readDatabase() {
    try {
        return JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
    } catch (e) {
        return {};
    }
}

/**
 * ========================================================
 * 0. SERVE FILE FRONTEND (CẤU HÌNH MỚI)
 * Định tuyến để trả về giao diện app.html khi vào trang gốc
 * ========================================================
 */
app.get('/', (req, res) => {
    // Trả trực tiếp file app.html nằm cùng thư mục với server.js
    res.sendFile(path.join(__dirname, 'app.html'));
});

/**
 * 1. API ĐÓN DATA TỪ APP MOBILE ĐẨY LÊN
 * URL: http://<IP>:3000/api/push
 */
app.post('/api/push', (req, res) => {
    const { myPhoneNumber, token, type, incomingNumber, content, time } = req.body;

    if (!myPhoneNumber || !token || !type || !incomingNumber) {
        return res.status(400).json({ error: "Thiếu dữ liệu (myPhoneNumber, token, type, incomingNumber)" });
    }

    const db = readDatabase();

    // Nếu số điện thoại này chưa từng có trong hệ thống, tạo mới và gắn Token luôn
    if (!db[myPhoneNumber]) {
        db[myPhoneNumber] = {
            token: token,
            calls: [],
            sms: []
        };
    }

    // Bảo mật: Nếu số điện thoại đã tồn tại nhưng gửi sai Token từ app, chặn lại ngay
    if (db[myPhoneNumber].token !== token) {
        return res.status(403).json({ error: "Token từ thiết bị di động không trùng khớp!" });
    }

    const logItem = {
        id: `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        incomingNumber,
        content: content || "",
        time: time || new Date().toLocaleString('vi-VN')
    };

    // Đẩy dữ liệu vào mảng và cắt tỉa giới hạn tối đa 50 dòng cho mỗi loại
    if (type === 'CALL') {
        db[myPhoneNumber].calls.unshift(logItem);
        if (db[myPhoneNumber].calls.length > 50) db[myPhoneNumber].calls.pop();
    } else if (type === 'SMS') {
        db[myPhoneNumber].sms.unshift(logItem);
        if (db[myPhoneNumber].sms.length > 50) db[myPhoneNumber].sms.pop();
    } else {
        return res.status(400).json({ error: "Loại dữ liệu phải là CALL hoặc SMS" });
    }

    fs.writeFileSync(FILE_PATH, JSON.stringify(db, null, 2), 'utf8');
    res.status(200).json({ success: true, message: "Ghi nhận log vào file tổng thành công." });
});

/**
 * 2. API TRẢ DATA CHO WEB FRONTEND (BẢO MẬT)
 * URL: http://<IP>:3000/api/fetch?phone=0912345678&token=XYZ
 */
/**
 * 2. API TRẢ DATA CHO WEB FRONTEND (ĐÃ SỬA LỖI ĐÓNG DẤU TYPE)
 * URL: http://localhost:3000/api/fetch?phone=0912345678&token=XYZ
 */
app.get('/api/fetch', (req, res) => {
    const { phone, token } = req.query;

    if (!phone || !token) {
        return res.status(200).json([]);
    }

    const db = readDatabase();
    const userData = db[phone];

    if (!userData || userData.token !== token) {
        return res.status(200).json([]);
    }

    // ÉP LOGIC: Tự động bổ sung trường type vào từng đối tượng trước khi gộp mảng
    const mappedCalls = (userData.calls || []).map(item => ({ ...item, type: 'CALL' }));
    const mappedSms = (userData.sms || []).map(item => ({ ...item, type: 'SMS' }));

    // Gộp 2 mảng đã được gắn nhãn chắc chắn
    const combinedLogs = [...mappedCalls, ...mappedSms];

    res.status(200).json(combinedLogs);
});

// Chạy server
app.listen(3000, () => {
    console.log('====================================================');
    console.log('Hệ thống xác thực và serve frontend đang hoạt động.');
    console.log('Truy cập giao diện Web tại: http://localhost:3000');
    console.log('====================================================');
});