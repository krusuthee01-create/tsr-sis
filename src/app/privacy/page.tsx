import { withBase } from "@/lib/base-path";

// หน้าสาธารณะ (ไม่ต้องเข้าสู่ระบบ) — Google ใช้เป็น "Application privacy policy link" ของหน้ายินยอม OAuth
export const metadata = { title: "นโยบายความเป็นส่วนตัว" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-5 p-6 leading-relaxed">
      <h1 className="text-2xl font-semibold">นโยบายความเป็นส่วนตัว</h1>
      <p>
        ระบบสารสนเทศนักเรียน (TSR-SIS) และระบบสารบรรณอิเล็กทรอนิกส์ของ<strong>โรงเรียนอนุบาลเทพสุนทรินทร์</strong>
        {" "}สังกัดสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 1 ใช้สำหรับงานของโรงเรียนเท่านั้น
        ผู้ใช้คือครูและบุคลากรของโรงเรียนที่ได้รับอนุมัติ
      </p>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">ข้อมูลที่เก็บ</h2>
        <ul className="list-disc pl-6">
          <li>บัญชีผู้ใช้: ชื่อ อีเมล และบทบาทของครูและบุคลากร</li>
          <li>ข้อมูลนักเรียนเพื่องานของโรงเรียน เช่น การมาเรียน ภาวะโภชนาการ การดูแลช่วยเหลือ และผลการเรียน</li>
          <li>งานสารบรรณ: ทะเบียนหนังสือรับ คำสั่งการ ผู้ได้รับมอบหมาย เวลาที่อ่าน และไฟล์ PDF ของหนังสือ</li>
          <li>ภาพลายเซ็นที่ผู้ใช้อัปโหลดเอง (เปิดได้เฉพาะเจ้าของ) และข้อมูลการรับแจ้งเตือนบนอุปกรณ์</li>
          <li>ประวัติการแก้ไขข้อมูล เพื่อตรวจสอบย้อนหลัง</li>
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">การใช้สิทธิ์บัญชี Google</h2>
        <ul className="list-disc pl-6">
          <li>เข้าสู่ระบบ: ใช้เฉพาะชื่อและอีเมลเพื่อยืนยันตัวตนครู</li>
          <li>
            เก็บไฟล์หนังสือราชการ: ผู้ดูแลระบบเชื่อมต่อบัญชี Google ของโรงเรียนครั้งเดียว ระบบขอสิทธิ์{" "}
            <code>drive.file</code> ซึ่ง<strong>เข้าถึงได้เฉพาะไฟล์และโฟลเดอร์ที่ระบบนี้สร้างเอง</strong> ไม่เห็นไฟล์อื่นในไดรฟ์ของบัญชีนั้น
          </li>
          <li>ข้อมูลที่ได้จาก Google ใช้เพื่องานข้างต้นเท่านั้น ไม่ขาย ไม่โฆษณา ไม่ส่งต่อให้บุคคลภายนอก และไม่ใช้ฝึกโมเดล AI</li>
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">การเก็บรักษาและการเข้าถึง</h2>
        <ul className="list-disc pl-6">
          <li>ฐานข้อมูลอยู่ที่ Supabase และเว็บอยู่ที่ Vercel (ศูนย์ข้อมูลสิงคโปร์) ไฟล์ PDF อยู่ใน Google Drive ของโรงเรียน</li>
          <li>สิทธิ์การมองเห็นบังคับที่ฐานข้อมูลตามบทบาท หนังสือลับเห็นได้เฉพาะผู้อำนวยการ เจ้าหน้าที่ธุรการ และผู้ได้รับมอบหมาย</li>
          <li>หนังสือราชการเก็บไว้ตามระเบียบสำนักนายกรัฐมนตรีว่าด้วยงานสารบรรณ การลบในระบบเป็นการซ่อน ไม่ลบไฟล์</li>
          <li>สำรองข้อมูลแบบเข้ารหัสทุกสัปดาห์</li>
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">สิทธิ์ของเจ้าของข้อมูลและการติดต่อ</h2>
        <p>
          ผู้ใช้ขอดู แก้ไข หรือสอบถามเกี่ยวกับข้อมูลของตนได้ที่ผู้ดูแลระบบของโรงเรียนอนุบาลเทพสุนทรินทร์
          ตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 และยกเลิกสิทธิ์ที่ให้แก่ระบบได้ที่{" "}
          <a className="underline" href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>
        </p>
      </section>

      <p className="text-sm text-muted">ปรับปรุงล่าสุด 21 พฤศจิกายน 2569</p>
      <a href={withBase("/")} className="self-start underline">กลับหน้าแรก</a>
    </main>
  );
}
