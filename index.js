const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
// console.log(app);
console.log("START", new Date().toISOString());
// Custom Middleware lọc và log traffic từ FB/Threads
app.use((req, res, next) => {
    const referer = req.headers['referer'] || '';
    const userAgent = req.headers['user-agent'] || '';
    
    // Chỉ xử lý nếu referer chứa facebook hoặc threads
    if (referer.includes('facebook.com') || referer.includes('threads.com') || userAgent.includes('uptimerobot.com')) {
        const logData = {
            time: new Date().toISOString(),
            source: referer,
            ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
            url: req.originalUrl,
            'sec-fetch-mode': req.headers['sec-fetch-mode'],
            'sec-fetch-site': req.headers['sec-fetch-site'],
            country: req.headers['cf-ipcountry'],
            userAgent: req.headers['user-agent']
        };
        
        // In ra console của Render (Chỉ in các click này để tiết kiệm dung lượng log)
        console.log(userAgent.includes('uptimerobot.com')?`[SOCIAL-CLICK]`:`[UPTIME_ROBOT]`, JSON.stringify(logData));
    }
    
    next();
});

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

async function readDatabase() {
    try {
        // Check if file exists asynchronously using access
        try {
            await fs.access(DB_FILE);
        } catch {
            await fs.writeFile(DB_FILE, JSON.stringify({}), 'utf8');
            return {};
        }

        const data = await fs.readFile(DB_FILE, 'utf8');
        return data.trim() ? JSON.parse(data) : {};
    } catch (error) {
        console.error("Lỗi đọc file database:", error);
        return {};
    }
}

async function writeDatabase(data) {
    try {
        await fs.writeFile(DB_FILE, JSON.stringify(data, null, 4), 'utf8');
    } catch (error) {
        console.error("Lỗi ghi file database:", error);
    }
}

// Cơ chế hàng đợi (Lock) để tránh Race Condition khi ghi file
let dbQueue = Promise.resolve();

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'app.html'));
});

app.post('/api/push', async (req, res) => {
    const { myPhoneNumber, token, type, incomingNumber, content, time } = req.body;

    // Kiểm tra tối thiểu phải có Số điện thoại
    if (!myPhoneNumber) {
        return res.status(400).json({ error: "Thiếu thông tin Số điện thoại thiết bị!" });
    }

    // Đưa toàn bộ logic vào hàng đợi để xử lý tuần tự
    dbQueue = dbQueue.then(async () => {
        let db = await readDatabase(); 

        // 1. Nếu chưa có tài khoản trên Server -> Khởi tạo shell mới
        if (!db[myPhoneNumber]) {
            db[myPhoneNumber] = {
                token: token || "", 
                createdAt: new Date().toISOString(),
                calls: [],
                sms: []
            };
            console.log(`[SYSTEM] Khởi tạo tài khoản mới cho: ${myPhoneNumber}`);
        } 
        
        // 2. Đồng bộ Token
        else if (db[myPhoneNumber].token !== token) {
            console.log(`[SYNC] Cập nhật Token của ${myPhoneNumber}`);
            db[myPhoneNumber].token = token || ""; 
        }

        // Xử lý các loại request
        if (type === "RESET" || type === "PING") {
            await writeDatabase(db);
            console.log(`[HEARTBEAT] ${myPhoneNumber} thành công.`);
            return; // Thoát ra khỏi block queue này
        }

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

        await writeDatabase(db);
        console.log(`[DATA] Ghi nhận log ${type} cho user ${myPhoneNumber}`);
    }).catch(err => {
        console.error("Lỗi trong hàng đợi xử lý DB:", err);
    });

    // Chờ hàng đợi xử lý xong request này rồi mới trả về Response cho client
    await dbQueue;
    res.status(200).json({ status: "SUCCESS" });
});

app.get('/api/fetch', async (req, res) => {
    const { phone, token, lastId } = req.query;

    // 🌟 BỔ SUNG: Chặn ngay từ vòng gửi xe nếu user trên Web gửi token rỗng, trống hoặc không truyền
    if (!token || token.trim() === "") {
        console.log(`[WEB REJECT] Từ chối fetch dữ liệu của số ${phone} vì Web gửi Token rỗng.`);
        return res.status(401).json({ error: "Token không được để trống!" });
    }

    let db = await readDatabase();

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

app.post('/api/clear', async (req, res) => {
    const { phone, token } = req.body;
    if (!phone || !token) return res.status(400).json({ error: "Thiếu thông tin!" });

    let db = await readDatabase();
    if (db[phone] && db[phone].token === token) {
        db[phone].calls = [];
        db[phone].sms = [];
        await writeDatabase(db);
        console.log(`[SYSTEM] Đã xóa sạch dữ liệu của số ${phone}`);
        return res.status(200).json({ status: "SUCCESS" });
    }
    return res.status(403).json({ error: "Xác thực thất bại!" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`=== SERVER GƯƠNG CHIẾU INFORMINI ĐANG CHẠY TẠI PORT: ${PORT} ===`);
});