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
 * 2. API TRẢ DATA CHO WEB FRONTEND (BẢO MẬT THEO ĐÚNG YÊU CẦU CỦA BẠN)
 * URL: http://<IP>:3000/api/fetch?phone=0912345678&token=XYZ
 */
app.get('/api/fetch', (req, res) => {
    const { phone, token } = req.query;

    // Nếu không nhập đủ tham số, trả về tệp trống []
    if (!phone || !token) {
        return res.status(200).json([]);
    }

    const db = readDatabase();
    const userData = db[phone];

    // ĐỐI CHIẾU BẢO MẬT: Nếu không tìm thấy số điện thoại HOẶC sai token -> Trả về mảng rỗng []
    if (!userData || userData.token !== token) {
        return res.status(200).json([]); 
    }

    // Nếu đúng hoàn toàn, gộp 50 cuộc gọi và 50 SMS lại gửi về cho Frontend
    const combinedLogs = [...userData.calls, ...userData.sms];
    res.status(200).json(combinedLogs);
});

app.listen(3000, () => console.log('Hệ thống xác thực file tổng đang hoạt động tại port 3000'));