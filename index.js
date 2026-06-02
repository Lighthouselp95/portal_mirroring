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
/**
 * 2. API TRẢ DỮ LIỆU VỀ CHO GIAO DIỆN WEB POLLING (GET)
 * Luồng chạy: Mỗi lần Web gọi, Server đọc trực tiếp từ file JSON theo SĐT để tránh cache nhầm tài khoản
 */
/**
 * 2. API TRẢ DỮ LIỆU VỀ CHO GIAO DIỆN WEB POLLING (GET)
 * Luồng chạy: Kiểm tra đối tượng theo SĐT, nếu CHƯA CÓ thì TỰ ĐỘNG TẠO MỚI ngay lập tức.
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

    // ĐỐI CHIẾU & TỰ ĐỘNG KHỞI TẠO NẾU CHƯA CÓ TRÊN SERVER
    if (isNewAccount) {
        console.log(`[Tự động Khởi tạo] Không tìm thấy đối tượng ${phone} trên hệ thống. Đang tạo phân vùng mới...`);
        
        // Khởi tạo cấu hình tài khoản trống mặc định với Token lấy từ giao diện Web gửi lên
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
        
        // Ghi lại dữ liệu mới vào file all_logs.json
        writeDatabase(db);
    } else {
        // Nếu ĐÃ CÓ đối tượng nhưng người dùng đổi Token mới trên Web, hãy kiểm tra tính hợp lệ
        // (Hoặc nếu bạn muốn ép Server cập nhật luôn Token mới từ Web theo cơ chế tin cậy hoàn toàn, hãy bỏ comment dòng dưới)
        if (db[phone].token !== token) {
            console.log(`[Fetch Bảo mật] Thiết bị ${phone} nhập sai mã Token trên Web.`);
            return res.status(403).json({ 
                error: "Sai mã Token định danh của thiết bị! Vui lòng kiểm tra lại." 
            });
        }
    }

    // Bốc chính xác dữ liệu của số điện thoại này trả về cho giao diện Web
    const accountData = db[phone];

    return res.status(200).json({
        status: "Success",
        phone: phone,
        calls: accountData.calls || [],
        sms: accountData.sms || []
    });
});
// Kích hoạt cổng lắng nghe linh hoạt tương thích tốt khi triển khai lên Render Cloud
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`=== SERVER GƯƠNG CHIẾU ĐỒNG BỘ ĐANG CHẠY TẠI CỔNG: ${PORT} ===`);
});