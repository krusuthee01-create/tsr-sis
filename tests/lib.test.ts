// ทดสอบฟังก์ชันหลัก: npm test (ข้อมูลสมมติทั้งหมด)
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDmcSheet, uniqueHeaders, diffDmc } from "../src/lib/dmc.ts";
import { parseDmcDate, formatThaiDate, todayISO, academicYearOf, ageOf, addDays, isWeekend } from "../src/lib/thai-date.ts";
import { isValidCitizenId, nextGrade, compareForNumbering, nextAttendanceStatus, formatCitizenId } from "../src/lib/domain.ts";
import { buildPp5Grid } from "../src/lib/reports.ts";

const HEADERS = [
  "รหัสโรงเรียน", "ชื่อโรงเรียน", "เลขประจำตัวประชาชน", "ชั้น", "ห้อง", "รหัสนักเรียน", "เพศ", "คำนำหน้าชื่อ", "ชื่อ", "นามสกุล",
  "วันเกิด", "จำนวนพี่ชาย", "หมายเลขโทรศัพท์ของผู้ปกครอง", "เลขที่บ้าน (ที่อยู่ปัจจุบัน)", "หมู่ (ที่อยู่ปัจจุบัน)",
  "ตำบล (ที่อยู่ปัจจุบัน)", "อำเภอ (ที่อยู่ปัจจุบัน)", "จังหวัด (ที่อยู่ปัจจุบัน)", "น้ำหนัก", "ส่วนสูง", "จำนวนพี่ชาย",
];

test("วันที่ DMC แบบ พ.ศ.", () => {
  assert.equal(parseDmcDate("30/03/2566"), "2023-03-30");
  assert.equal(parseDmcDate("08/11/2565"), "2022-11-08");
  assert.equal(parseDmcDate("31/02/2566"), null);
  assert.equal(parseDmcDate(""), null);
  assert.equal(parseDmcDate(45016), "2023-03-31");
});

test("แสดงวันที่ภาษาไทย", () => {
  assert.equal(formatThaiDate("2026-10-22"), "22 ต.ค. 2569");
  assert.equal(formatThaiDate("2026-10-22", "long"), "22 ตุลาคม 2569");
  assert.equal(formatThaiDate("2026-10-22", "weekday"), "พฤหัสบดี 22 ต.ค. 2569");
  assert.equal(todayISO(new Date("2026-10-21T18:00:00Z")), "2026-10-22");
  assert.equal(academicYearOf("2026-10-22"), 2569);
  assert.equal(academicYearOf("2027-03-01"), 2569);
  assert.equal(ageOf("2017-02-14", "2026-10-22"), "9 ปี 8 เดือน");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(isWeekend("2026-10-24"), true);
});

test("เลขประชาชนและระดับชั้น", () => {
  assert.equal(isValidCitizenId("1101700230708"), true);
  assert.equal(isValidCitizenId("1101700230706"), false);
  assert.equal(formatCitizenId("1101700230708"), "1-1017-00230-70-8");
  assert.equal(nextGrade("อ.3"), "ป.1");
  assert.equal(nextGrade("ป.6"), null);
  assert.equal(nextAttendanceStatus(4), 0);
});

test("เรียงเลขที่ ชายก่อนหญิง แล้วตามชื่อ", () => {
  const list = [
    { gender: "ญ", first_name: "กัญญา" },
    { gender: "ช", first_name: "ภูผา" },
    { gender: "ช", first_name: "กวินท์" },
  ].sort(compareForNumbering);
  assert.deepEqual(list.map((s) => s.first_name), ["กวินท์", "ภูผา", "กัญญา"]);
});

test("หัวคอลัมน์ซ้ำได้ชื่อไม่ซ้ำ", () => {
  assert.deepEqual(uniqueHeaders(["ก", "ข", "ก"]), ["ก", "ข", "ก (2)"]);
});

test("อ่านไฟล์ DMC และตรวจข้อผิดพลาดรายแถว", () => {
  const sheet: unknown[][] = [
    HEADERS,
    ["54010116", "รร.ทดสอบ", "1101700230708", "ป.3", 1, "9001", "ช", "เด็กชาย", "กวินท์", "แสงทอง", "14/02/2560", 1, "081-234-5678", "12/3", "4", "บ้านกลาง", "สอง", "แพร่", "24.0", "127.0", 0],
    ["54010116", "รร.ทดสอบ", "", "ป.3", 1, "9002", "ญ", "เด็กหญิง", "ไม่มีเลข", "ทดสอบ", "", 0, "-", "", "", "", "", "", "", "", 0],
    ["54010116", "รร.ทดสอบ", "1101700230708", "ป.3", 1, "9003", "ญ", "เด็กหญิง", "ซ้ำ", "ทดสอบ", "", 0, "-", "", "", "", "", "", "", "", 0],
    ["54010116", "รร.ทดสอบ", "1101700230706", "ม.1", 1, "9004", "ญ", "เด็กหญิง", "ผิดชั้น", "ทดสอบ", "", 0, "-", "", "", "", "", "", "", "", 0],
    [],
  ];
  const r = parseDmcSheet(sheet);
  assert.equal(r.missingHeaders.length, 0);
  assert.equal(r.schoolCode, "54010116");
  assert.equal(r.rows.length, 1);
  assert.equal(r.issues.filter((i) => i.level === "error").length, 3);
  const s = r.rows[0];
  assert.equal(s.birth_date, "2017-02-14");
  assert.equal(s.guardian_phone, "081-234-5678");
  assert.equal(s.address_current, "12/3 หมู่ 4 ต.บ้านกลาง อ.สอง จ.แพร่");
  assert.equal(s.weight, 24);
  assert.equal(s.raw["จำนวนพี่ชาย (2)"], 0);
});

test("ไฟล์ที่ไม่ใช่ DMC", () => {
  const r = parseDmcSheet([["ชื่อ", "นามสกุล"], ["ก", "ข"]]);
  assert.ok(r.missingHeaders.length > 0);
});

test("เทียบข้อมูลก่อนนำเข้า", () => {
  const rows = parseDmcSheet([
    HEADERS,
    ["1", "x", "1101700230708", "ป.3", 2, "9001", "ช", "เด็กชาย", "กวินท์", "แสงทอง", "14/02/2560", 0, "081-234-5678", "", "", "", "", "", "", "", 0],
    ["1", "x", "3100000000001", "ป.1", 1, "9100", "ญ", "เด็กหญิง", "ใหม่", "มาก", "", 0, "", "", "", "", "", "", "", "", 0],
  ]).rows;
  const changes = diffDmc(rows, [
    { id: "a", citizen_id: "1101700230708", first_name: "กวินท์", last_name: "แสงทอง", prefix: "เด็กชาย", student_code: "9001",
      birth_date: "2017-02-14", gender: "ช", guardian_phone: "081-234-5678", classroom: "ป.3/1", status: "studying" },
    { id: "b", citizen_id: "9999999999999", first_name: "ย้าย", last_name: "ไป", status: "studying" },
  ]);
  assert.deepEqual(changes.map((c) => c.kind).sort(), ["changed", "missing", "new"]);
  const changed = changes.find((c) => c.kind === "changed");
  assert.ok(changed && changed.kind === "changed" && changed.fields.some((f) => f.label === "ห้อง" && f.to === "ป.3/2"));
});

test("ตารางเวลาเรียนแบบโปรแกรม ปพ.5", () => {
  const grid = buildPp5Grid(
    [{ student_id: "a", number: 1, name: "ก" }, { student_id: "b", number: 2, name: "ข" }],
    ["2026-10-01", "2026-10-02"],
    [{ student_id: "a", date: "2026-10-01", status: 0 }, { student_id: "a", date: "2026-10-02", status: 4 },
     { student_id: "b", date: "2026-10-01", status: 1 }],
  );
  assert.deepEqual(grid[0], ["ชื่อ-สกุล", "เลขที่", 1, 2, "มา", "ขาด/ลา"]);
  assert.deepEqual(grid[1], ["ก", 1, "", "ข", 1, 1]);
  assert.deepEqual(grid[2], ["ข", 2, "ส", "", 1, 0]);
});

test("อ่านรายวิชาจากโปรแกรม ปพ.5", async () => {
  const { parsePp5Subjects, gradeFromPp5 } = await import("../src/lib/pp5.ts");
  assert.equal(gradeFromPp5("ประถมศึกษาปีที่ 6/2"), "ป.6");
  const subjects = parsePp5Subjects([
    ["กรอกข้อมูลชั้นเรียน", null],
    ["ชั้น", "ประถมศึกษาปีที่ 1/1"],
    ["ที่", "รหัสวิชา", "รายวิชา", "เวลาเรียน (ชั่วโมง/ปี)", "กลุ่มสาระการเรียนรู้", "ครูประจำวิชา"],
    [1, "ท11101", "ภาษาไทย ", 200, "ภาษาไทย", null],
    [2, "", "", null, null, null],
    [3, "ค11101", "คณิตศาสตร์", 200, "คณิตศาสตร์", null],
  ]);
  assert.deepEqual(subjects.map((s) => s.code), ["ท11101", "ค11101"]);
  assert.equal(subjects[0].name, "ภาษาไทย");
  assert.equal(subjects[0].grade, "ป.1");
  assert.equal(subjects[0].hours, 200);
});
