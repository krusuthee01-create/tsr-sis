import { HELP } from "@/lib/help";
import { PageHeader, PrintHeader } from "@/components/page-header";
import { Card } from "@/components/ui";
import { PrintButton } from "@/components/export-button";
import { HelpTopicBody } from "@/components/help";

export const metadata = { title: "คู่มือการใช้งาน" };

export default function ManualPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="คู่มือการใช้งาน" module="manual" subtitle="ทุกหน้ามีปุ่ม ? เปิดหัวข้อของหน้านั้นได้ทันที" actions={<PrintButton label="พิมพ์คู่มือ / PDF" />} />
      <PrintHeader title="คู่มือการใช้งานระบบสารสนเทศนักเรียน" school="โรงเรียนอนุบาลเทพสุนทรินทร์" />
      <Card className="no-print mb-4">
        <h2 className="mb-2 font-semibold">สารบัญ</h2>
        <ol className="grid list-decimal gap-1 pl-5 sm:grid-cols-2">
          {HELP.map((h) => <li key={h.key}><a href={`#${h.key}`} className="font-medium text-navy-700 hover:underline">{h.title}</a></li>)}
        </ol>
      </Card>
      <div className="flex flex-col gap-4">
        {HELP.map((h, i) => (
          <Card key={h.key} id={h.key} className="scroll-mt-20 break-inside-avoid">
            <h2 className="mb-3 text-xl font-semibold">{i + 1}. {h.title}</h2>
            <HelpTopicBody topic={h} />
          </Card>
        ))}
      </div>
    </div>
  );
}
