export const metadata = { title: "ไม่มีสัญญาณ" };

export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-semibold">ไม่มีสัญญาณอินเทอร์เน็ต</h1>
      <p className="max-w-sm text-muted">หน้านี้ยังไม่เคยเปิดไว้ในเครื่อง หน้าเช็กชื่อที่เคยเปิดแล้วยังใช้ได้ตามปกติ</p>
      <a href="/attendance" className="rounded-xl bg-navy-700 px-5 py-3 font-semibold text-white">ไปหน้าเช็กชื่อ</a>
    </div>
  );
}
