# Echo Grid — ขั้นตอนขึ้นเว็บ

เกมฝึกความจำใช้งานแบบ dual N-back ชิ้นที่สองของ brain-shift-lab (คู่กับ Signal Shift)

## ไฟล์
```
echo-grid/
├── index.html            ตัวเกมทั้งหมด (ไฟล์เดียว)
├── config.js             ใส่ URL ของ Apps Script
├── apps-script/Code.gs   โค้ดฝั่ง Google (ไม่ต้องอัปขึ้น GitHub ก็ได้)
└── README.md
```

## 1. ขึ้น GitHub Pages (~2 นาที)
แนะนำให้วางเป็นโฟลเดอร์ย่อยใน repo เดิม `brain-shift-lab/brain-shift-lab.github.io`

1. เปิด repo บน GitHub → **Add file → Upload files**
2. ลากโฟลเดอร์ `echo-grid` ทั้งโฟลเดอร์ลงไป → Commit to `main`
3. รอ 1–2 นาที เกมจะอยู่ที่ **https://brain-shift-lab.github.io/echo-grid/**

ตอนนี้เล่นได้ทันทีแล้ว แต่คะแนนและข้อมูลวิจัยจะอยู่แค่ในเครื่องผู้เล่น จนกว่าจะทำขั้นที่ 2

> ทางเลือก: สร้าง repo ใหม่ชื่อ `echo-grid` ใน org แล้วเปิด Pages จาก main /root ก็ได้ URL เดียวกัน

## 2. เชื่อม Google Sheet เดิม (~5 นาที)
ใช้ชีต **Signal Shift Data** ตัวเดิม เกมนี้จะสร้างแท็บของตัวเอง 3 แท็บ (`eg_scores`, `eg_runs`, `eg_trials`) และไม่แตะแท็บของ Signal Shift เลย

1. ล็อกอิน ltanapolarism@gmail.com แล้วเปิด https://script.google.com → **New project** ตั้งชื่อ `Echo Grid Backend`
   (เป็นโปรเจกต์แยก ไม่ใช่ใน Signal Shift Backend เพราะสคริปต์หนึ่งมี doGet/doPost ได้ชุดเดียว)
2. ลบโค้ดเดิม วางเนื้อหา `apps-script/Code.gs` ทั้งไฟล์
3. แก้บรรทัด `SHEET_ID` ใส่ ID ของชีต (ส่วนยาวๆ ใน URL ระหว่าง `/d/` กับ `/edit`)
4. เลือกฟังก์ชัน `setup` → **Run** → อนุญาตสิทธิ์ (จะเห็นแท็บ eg_ ใหม่ 3 แท็บในชีต)
5. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. คัดลอก Web app URL ไปใส่ใน `config.js` บน GitHub:
   ```js
   window.ECHO_GRID_CONFIG = { backendUrl: 'https://script.google.com/macros/s/xxxx/exec' };
   ```
7. ทดสอบ: เปิด `URL?action=ping` ในเบราว์เซอร์ ควรเห็น `{"ok":true,"game":"echo-grid",...}`

## ข้อมูลที่ได้
- **eg_scores** — คะแนนดีที่สุดต่อเครื่อง (อาร์เคดตลอดกาล / ภารกิจรายวัน) กันโกงแบบเบาๆ: จำกัดคะแนนตามจำนวนข้อ, ส่งได้ทุก 5 วินาที, ภารกิจรับเฉพาะวันนี้กับเมื่อวาน
- **eg_runs** — สรุปรายครั้งของโหมดวิจัย: accuracy, d′ รวม, hit/FA rate, RT มัธยฐาน, FA ที่ตัวหลอกเทียบกับทั่วไป, d′ แยกเงื่อนไข (dP1, dP2, dP2d, dS2d, dP3d, dS3d) และ dualCost
- **eg_trials** — รายข้อ (join กับ eg_runs ด้วย runId) มีตำแหน่ง สัญลักษณ์ เป้า/ตัวหลอก การกด และ RT ของแต่ละช่องทาง
- ข้อความทุกช่องเขียนนำด้วย `'` กันสูตรและการแปลงอัตโนมัติ

## โปรโตคอลโหมดวิจัย (~8 นาที)
ข้อละ 3 วินาที (สัญลักษณ์ขึ้น 0.5 วินาที) เป้าหมาย 30% ต่อช่องทาง ตัวหลอก ~12% สุ่มใหม่ทุกครั้ง

| ช่วง | เงื่อนไข | ข้อ |
|---|---|---|
| ฝึก | 1-back คู่ (ไม่วิเคราะห์) | 13 |
| 1 | 1-back ตำแหน่ง | 21 |
| 2 | 2-back ตำแหน่ง | 32 |
| 3 | 2-back คู่ | 32 |
| 4 | 3-back คู่ | 33 |

## อัปเดตภายหลัง
- แก้ `index.html` บน GitHub → Pages อัปเดตใน 1–2 นาที
- แก้ Apps Script → **Deploy → Manage deployments → Edit → Version: New version** (URL เดิม)
- ประวัติในเครื่องผู้เล่นเก็บด้วยคีย์ `eg-…` แยกจาก Signal Shift แม้อยู่โดเมนเดียวกัน (ชื่อที่ตั้งไว้ใน Signal Shift จะถูกดึงมาใช้ให้อัตโนมัติ)
