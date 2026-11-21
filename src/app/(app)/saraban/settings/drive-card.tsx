import { GoogleDriveLogo } from "@phosphor-icons/react/dist/ssr";
import { Card, SectionTitle, btnClass } from "@/components/ui";
import { withBase } from "@/lib/base-path";
import { formatThaiDateTime } from "@/lib/thai-date";

const RESULT: Record<string, { tone: "ok" | "err"; text: string }> = {
  ok: { tone: "ok", text: "เชื่อมต่อ Google Drive แล้ว ไฟล์ PDF จะเก็บในไดรฟ์ของบัญชีนี้" },
  denied: { tone: "err", text: "เฉพาะผู้ดูแลระบบหรือผู้อำนวยการเท่านั้นที่เชื่อมต่อได้" },
  noclient: { tone: "err", text: "ยังไม่ได้ตั้งค่า GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / NEXT_PUBLIC_SITE_URL บน Vercel (ดูคู่มือติดตั้ง ข้อ 6.2)" },
  cancelled: { tone: "err", text: "ยกเลิกการเชื่อมต่อที่หน้าของ Google" },
  state: { tone: "err", text: "การเชื่อมต่อหมดเวลาหรือไม่ถูกต้อง กรุณากดเชื่อมต่อใหม่" },
  norefresh: { tone: "err", text: "Google ไม่ส่งสิทธิ์ระยะยาวมา กรุณากดเชื่อมต่อใหม่ (ถ้ายังไม่ได้ ให้ลบสิทธิ์ของระบบที่ myaccount.google.com › ความปลอดภัย › แอปของบุคคลที่สาม แล้วลองอีกครั้ง)" },
  otheraccount: { tone: "err", text: "มีไฟล์หนังสือในบัญชีเดิมแล้ว เปลี่ยนเป็นบัญชีอื่นไม่ได้ (ไฟล์เก่าจะเปิดไม่ได้) กรุณาเชื่อมต่อด้วยบัญชีเดิม" },
  failed: { tone: "err", text: "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่" },
};

/** สถานะการเก็บไฟล์ PDF: เชื่อมต่อด้วยบัญชี Google ของโรงเรียน (เฉพาะผู้ดูแลระบบ/ผอ.) */
export function DriveCard({
  config,
  serviceAccount,
  result,
}: {
  config: { account_email: string | null; connected_at: string } | null;
  serviceAccount: boolean;
  result?: string;
}) {
  const msg = result ? RESULT[result] : undefined;
  return (
    <Card className="flex flex-col gap-3">
      <SectionTitle>ที่เก็บไฟล์ PDF (Google Drive)</SectionTitle>
      {msg && (
        <p role="status" className={`rounded-lg px-3 py-2 text-sm ${msg.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
          {msg.text}
        </p>
      )}
      {config ? (
        <p className="text-sm">
          เชื่อมต่อกับบัญชี <strong>{config.account_email ?? "ไม่ทราบอีเมล"}</strong> เมื่อ {formatThaiDateTime(config.connected_at)}
          <br />
          <span className="text-slate-500">ไฟล์อยู่ในโฟลเดอร์ “eSaraban - หนังสือรับ (ห้ามลบ)” ของบัญชีนี้ ใช้พื้นที่ของบัญชีนี้</span>
        </p>
      ) : serviceAccount ? (
        <p className="text-sm">ใช้ service account + Shared Drive ตามค่าที่ตั้งไว้บน Vercel</p>
      ) : (
        <p className="text-sm text-amber-800">ยังไม่ได้เชื่อมต่อ — ลงรับหนังสือพร้อมไฟล์ PDF ไม่ได้จนกว่าจะเชื่อมต่อ</p>
      )}
      <p className="text-sm text-slate-500">
        ใช้บัญชี Google ของโรงเรียน (เช่น @phrae1.go.th) ที่จะเป็นเจ้าของเอกสาร ระบบขอสิทธิ์เฉพาะไฟล์ที่ระบบสร้างเอง ไม่เห็นไฟล์อื่นในไดรฟ์
        {config && " · เชื่อมต่อใหม่ได้ด้วยบัญชีเดิมเท่านั้น (ไฟล์เก่าเป็นของบัญชีนี้)"}
      </p>
      <a href={withBase("/saraban/api/drive/connect")} className={`${btnClass(config ? "secondary" : "primary")} self-start`}>
        <GoogleDriveLogo aria-hidden className="h-5 w-5" />
        {config ? "เชื่อมต่อใหม่" : "เชื่อมต่อ Google Drive"}
      </a>
    </Card>
  );
}
