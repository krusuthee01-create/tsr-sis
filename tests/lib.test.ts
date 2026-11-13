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

test("นำเข้ารายชื่อครูจาก Excel", async () => {
  const { parseStaffSheet, diffStaff, splitFullName, toStaffRecord } = await import("../src/lib/staff-import.ts");
  assert.deepEqual(splitFullName("นางสาวมานี มีนา"), { prefix: "นางสาว", first_name: "มานี", last_name: "มีนา" });
  const r = parseStaffSheet([
    ["รายชื่อครู"],
    ["คำนำหน้า", "ชื่อ", "นามสกุล", "ตำแหน่ง", "วิทยฐานะ", "กลุ่มสาระ", "โทรศัพท์", "อีเมล Google"],
    ["นาง", "สมใจ", "รักเรียน", "ครู", "ชำนาญการ", "ภาษาไทย", 812345678, "Somjai@Gmail.com"],
    ["น.ส.", "มานี", "มีนา", "ครูผู้ช่วย", "", "", "", "ไม่ใช่อีเมล"],
    ["นาย", "", "ไม่มีชื่อ", "", "", "", "", ""],
    ["นาย", "ซ้ำ", "อีเมล", "", "", "", "", "somjai@gmail.com"],
    [],
  ]);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].email, "somjai@gmail.com");
  assert.equal(r.rows[0].phone, "0812345678");
  assert.equal(r.rows[1].prefix, "นางสาว");
  assert.equal(r.rows[1].email, null);
  assert.deepEqual(r.issues.map((i) => i.level).sort(), ["error", "error", "warning"]);

  const full = parseStaffSheet([["ชื่อ-สกุล", "ตำแหน่ง"], ["นายมานะ สอนดี", "ครู"]]);
  assert.equal(full.rows[0].first_name, "มานะ");
  assert.equal(full.rows[0].prefix, "นาย");

  const changes = diffStaff(r.rows, [
    { id: "1", prefix: "นาง", first_name: "สมใจ", last_name: "รักเรียน", position: "ครู", academic_rank: null, learning_area: null, phone: null, email: "somjai@gmail.com" },
  ]);
  assert.equal(changes[0].kind, "update");
  assert.equal(changes[1].kind, "new");
  assert.equal(toStaffRecord(r.rows[1]).email, undefined);
});

test("ภาวะโภชนาการ: แปลผลและคำเตือน", async () => {
  const { classify, refMaps, ageInMonths, parseMeasure, measureWarnings, monthlyRounds } = await import("../src/lib/nutrition.ts");
  assert.equal(ageInMonths("2020-09-15", "2026-10-15"), 73);
  assert.equal(ageInMonths("2020-09-16", "2026-10-15"), 72);
  const { ageRef, heightRef } = refMaps(
    [{ sex: 1, age_months: 73, w_m2: 15.6, w_m15: 16.7, w_p15: 25.6, w_p2: 27.6, h_m2: 105.9, h_m15: 108.2, h_p15: 121.9, h_p2: 124.2 }],
    [{ sex: 1, height_cm: 115, m2: 16, m15: 16.8, p15: 22.2, p2: 23.2, p3: 25.4 }],
  );
  assert.deepEqual(classify(1, 73, 21.6, 115, ageRef, heightRef), { wfa: 3, hfa: 3, wfh: 3 });
  assert.deepEqual(classify(1, 73, 15.5, 100, ageRef, heightRef), { wfa: 1, hfa: 1, wfh: null });
  assert.equal(classify(1, 73, 27.6, 114.6, ageRef, heightRef).wfa, 4);
  assert.equal(classify(1, 73, 26, 114.6, ageRef, heightRef).wfh, 6);
  assert.equal(classify(1, 73, 24, 115.4, ageRef, heightRef).wfh, 5);
  assert.equal(parseMeasure("18,5"), 18.5);
  assert.ok(Number.isNaN(parseMeasure("18.5.1") as number));
  assert.equal(parseMeasure(" "), null);
  assert.equal(measureWarnings(500, 110, undefined, 5)[0].level, "error");
  assert.match(measureWarnings(26, 115, { weight: 20, height: 114 }, 5)[0].text, /ต่างจากครั้งก่อน 6.0/);
  assert.equal(measureWarnings(20, 115, { weight: 20, height: 114 }, 5).length, 0);
  const rounds = monthlyRounds([{ start_date: "2026-05-16", end_date: "2026-10-10" }, { start_date: "2026-11-02", end_date: "2027-03-31" }]);
  assert.equal(rounds.length, 11);
  assert.deepEqual(rounds[0], { name: "พ.ค. 2569", start_date: "2026-05-16", end_date: "2026-05-31" });
  assert.equal(rounds.at(-1)?.name, "มี.ค. 2570");
});

test("อ่านตารางเกณฑ์อ้างอิงรูปแบบโปรแกรม ปพ.5", async () => {
  const { parseAgeSheet, parseHeightSheet } = await import("../src/lib/growth-ref.ts");
  const age = parseAgeSheet([
    ["code", "median_wt", "sd_wt", "sd_2_wt", "sd_15_wt", "sd15_wt", "sd2_wt", "median_ht", "sd_ht", "sd_2_ht", "sd_15_ht", "sd15_ht", "sd2_ht"],
    ["173", 21.6, 3, 15.6, 16.7, 25.6, 27.6, 115.05, 4.575, 105.9, 108.2, 121.9, 124.2],
    ["2227", 52.1, 5, 40, 42, 60, 63, 157, 5, 147, 149.5, 164.5, 167],
  ]);
  assert.equal(age.error, undefined);
  assert.deepEqual([age.rows[0].sex, age.rows[0].age_months, age.rows[1].sex, age.rows[1].age_months], [1, 73, 2, 227]);
  const bad = parseAgeSheet([["code", "median_wt", "sd_2_wt", "sd_15_wt", "sd15_wt", "sd2_wt", "median_ht", "sd_2_ht", "sd_15_ht", "sd15_ht", "sd2_ht"], ["173", 21, 30, 16, 25, 27, 115, 105, 108, 121, 124]]);
  assert.equal(bad.error, undefined);
  assert.match(bad.warnings[0] ?? "", /ไม่เรียง/);
  const ht = parseHeightSheet([["code", "median", "sd", "sd_2", "sd_15", "sd15", "sd2", "sd3"], ["1115", 19.6, 1.8, 16, 16.8, 22.2, 23.2, 25.4]]);
  assert.deepEqual([ht.rows[0].sex, ht.rows[0].height_cm, ht.rows[0].p3], [1, 115, 25.4]);
  assert.match(parseHeightSheet([["ไม่มี", "หัว"]]).error ?? "", /code/);
});

test("SDQ: คิดคะแนนเหมือนฐานข้อมูล", async () => {
  const { sdqScore, compressionPlan } = await import("../src/lib/care.ts");
  const teacher = { total: [15, 18], emotional: [3, 4], conduct: [3, 4], hyperactivity: [5, 6], peer: [3, 4], prosocial: [3] };
  const zero = sdqScore(Array(25).fill(0), teacher)!;
  assert.deepEqual([zero.emotional, zero.conduct, zero.hyperactivity, zero.peer, zero.prosocial, zero.total], [0, 2, 4, 4, 0, 10]);
  assert.equal(zero.levels.prosocial, 3);
  const v = [0,2,2,0,0, 0,2,2,0,2, 2,0,2,2,2, 2,0,0,0,0, 2,0,0,2,2];
  const s = sdqScore(v, teacher)!;
  assert.deepEqual([s.emotional, s.hyperactivity, s.total, s.levels.total], [10, 6, 16, 2]);
  assert.equal(sdqScore(Array(24).fill(0), teacher), null);
  assert.equal(sdqScore([...Array(24).fill(0), null], teacher), null);
  assert.deepEqual(compressionPlan(4000, 3000), { w: 1280, h: 960 });
  assert.deepEqual(compressionPlan(800, 600), { w: 800, h: 600 });
});

test("EQ: แปลผลตามช่วงปกติเหมือนฐานข้อมูล", async () => {
  const { eqLevel } = await import("../src/lib/care.ts");
  assert.equal(eqLevel(50, undefined), null);
  assert.equal(eqLevel(null, [48, 58]), null);
  assert.deepEqual([eqLevel(47, [48, 58]), eqLevel(48, [48, 58]), eqLevel(58, [48, 58]), eqLevel(59, [48, 58])], [0, 1, 1, 2]);
});

test("ปพ.5: อ่านเกรด คุณลักษณะ กิจกรรม และ GPA", async () => {
  const { parsePp5Workbook, normalizeGrade, classFromPp5, gpa } = await import("../src/lib/pp5-grades.ts");
  // @ts-expect-error ไฟล์ช่วยทดสอบเป็น JavaScript
  const { fakePp5Sheets } = await import("./fake-pp5.mjs");
  assert.deepEqual(classFromPp5("ประถมศึกษาปีที่ 6/2"), { grade: "ป.6", room: 2 });
  assert.deepEqual([normalizeGrade(3.5), normalizeGrade("4"), normalizeGrade("ร"), normalizeGrade(" มส "), normalizeGrade(2.3), normalizeGrade(5), normalizeGrade("")], ["3.5", "4", "ร", "มส", null, null, null]);
  const sheets = fakePp5Sheets({
    subjects: [{ code: "ท16101", name: "ภาษาไทย", hours: 160, area: "ภาษาไทย" }, { code: "ค16101", name: "คณิตศาสตร์", hours: 40, area: "คณิตศาสตร์" }],
    students: [
      { name: "เด็กชายทดสอบ หนึ่ง", citizen_id: "1000000000001", trait: true, term2: true, grades: [{ t1: [30, 10, 4], t2: [28, 10, 3.5], year: [78, 4] }, { t1: [20, 5, 2], t2: [15, 5, "ร"], year: [40, "ร"] }] },
      { name: "เด็กหญิงทดสอบ สอง", citizen_id: "1000000000002", grades: [{ t1: [10, 5, 1] }] },
      { name: "เด็กหญิงไม่มีเลข", citizen_id: "" },
    ],
  });
  const f = parsePp5Workbook((n: string) => sheets[n] ?? null);
  assert.deepEqual([f.grade, f.room, f.year, f.term, f.subjects.length, f.students.length], ["ป.6", 1, 2569, 2, 2, 2]);
  assert.equal(f.warnings.length, 1);
  const [a, b] = f.students;
  assert.deepEqual(a.results.map((r) => `${r.code}/${r.term}=${r.grade}`).sort(), ["ค16101/0=ร", "ค16101/1=2", "ค16101/2=ร", "ท16101/0=4", "ท16101/1=4", "ท16101/2=3.5"]);
  assert.deepEqual(b.results.map((r) => `${r.code}/${r.term}=${r.grade}`), ["ท16101/1=1"]);
  assert.equal(a.results.find((r) => r.code === "ท16101" && r.term === 1)?.total, 40);
  // คุณลักษณะ: ใช้ผลที่กรอกจริง ไม่ใช้ค่า "ไม่ผ่าน" จากสูตรของแถวว่าง
  assert.deepEqual(a.assessments.filter((x) => x.term === 1).map((x) => `${x.kind}=${x.result}`).sort(), ["activity=ผ่าน", "rtw=ดีเยี่ยม", "trait=ดีเยี่ยม", "values=ดีเยี่ยม"]);
  assert.equal(b.assessments.length, 0);
  assert.equal(a.assessments.find((x) => x.kind === "activity")?.items && Object.keys(a.assessments.find((x) => x.kind === "activity")!.items).length, 4);
  // GPA ถ่วงชั่วโมง ไม่นับ ร ตัดทศนิยม
  assert.equal(gpa([{ grade: "4", hours: 160 }, { grade: "ร", hours: 40 }]), 4);
  assert.equal(gpa([{ grade: "3.5", hours: 200 }, { grade: "0", hours: 960 - 200 }]), 0.72);
  assert.equal(gpa([{ grade: "ร", hours: 40 }]), null);
});

test("พัฒนาการอนุบาล: อ่านสมุดบันทึกและคิดระดับรายด้าน", async () => {
  const { parseKgWorkbook, kgDomainLevels, kgLevel } = await import("../src/lib/kg-dev.ts");
  // @ts-expect-error ไฟล์ช่วยทดสอบเป็น JavaScript
  const { fakeKgSheets } = await import("./fake-pp5.mjs");
  assert.deepEqual([kgLevel(1.49), kgLevel(1.5), kgLevel(2.49), kgLevel(2.5), kgLevel(null)], [1, 2, 2, 3, null]);
  const three = Array(33).fill(3);
  const sheets = fakeKgSheets({ students: [
    { name: "เด็กชายทดสอบ หนึ่ง", t1: three, t2: [1, 1, 1, 1, ...Array(29).fill(2)] },
    { name: "เด็กหญิงทดสอบ สอง", t1: [3, "x", 4, ...Array(30).fill(2)] },
  ] });
  const f = parseKgWorkbook((n: string) => sheets[n] ?? null);
  assert.deepEqual([f.grade, f.room, f.year, f.students.length, f.indicators.length], ["อ.3", 1, 2569, 2, 33]);
  assert.equal(f.warnings.length, 1);
  assert.deepEqual(f.students[1].t1.slice(0, 3), [3, null, null]);
  assert.deepEqual(kgDomainLevels(f.students[0].t1), { physical: 3, emotional: 3, civic: 3, intellectual: 3 });
  assert.deepEqual(kgDomainLevels(f.students[0].t2), { physical: 1, emotional: 2, civic: 2, intellectual: 2 });
  assert.deepEqual(kgDomainLevels(f.students[0].t1, f.students[0].t2), { physical: 2, emotional: 3, civic: 3, intellectual: 3 });
  const noInfo = fakeKgSheets({ students: [{ name: "ก ข", t1: three }], withInfo: false });
  assert.equal(parseKgWorkbook((n: string) => noInfo[n] ?? null).grade, null);
});

test("ระบบเดิม: แปลงวันที่ ตัดซ้ำ ข้ามวันหยุด และตรวจน้ำหนักส่วนสูง", async () => {
  const { parseLegacyWorkbook, legacyDate, legacyClass, roundName } = await import("../src/lib/legacy-import.ts");
  // @ts-expect-error ไฟล์ช่วยทดสอบเป็น JavaScript
  const { fakeLegacySheets, excelSerial } = await import("./fake-pp5.mjs");
  assert.equal(legacyDate(excelSerial("2026-06-25", true)), "2026-06-25");
  assert.equal(legacyDate(excelSerial("2026-06-25")), "2026-06-25");
  assert.equal(legacyDate("25/06/2569"), "2026-06-25");
  assert.deepEqual([legacyClass("อนุบาล 1/1"), legacyClass("ป.2/2")], ["อ.1/1", "ป.2/2"]);
  assert.equal(roundName("2026-06"), "มิ.ย. 2569");
  const sheets = fakeLegacySheets({
    days: ["2026-06-22", "2026-06-23", "2026-06-27"], // 27 มิ.ย. = วันเสาร์
    students: [{ code: "7317", name: "ก", cls: "ป.2/2", status: ["มา", "ลา"] }, { code: "7220", name: "ข", cls: "อนุบาล 1/1", status: ["ขาด", "มา"] }],
    weights: [
      { code: "7317", cls: "ป.2/2", date: "2026-06-10", w: 22, h: 120 },
      { code: "7220", cls: "อนุบาล 1/1", date: "2026-06-11", w: 105, h: 18 },   // สลับช่อง → แก้ให้
      { code: "7220", cls: "อนุบาล 2/1", date: "2026-07-11", w: 175, h: 105 },  // ไม่สมเหตุสมผล → ข้าม
      { code: "7317", cls: "ป.2/2", date: "2026-07-10", w: 17, h: 11 },        // ไม่สมเหตุสมผล → ข้าม
    ],
  });
  // บันทึกซ้ำ: แถวหลัง (เวลาใหม่กว่า) ต้องชนะ
  const dup = [...sheets.Attendance[1]]; dup[0] += 0.1; dup[6] = "สาย";
  sheets.Attendance.push(dup);
  const read: string[] = [];
  const f = parseLegacyWorkbook((n: string) => { read.push(n); return sheets[n] ?? null; });
  assert.ok(!read.includes("Teachers"), "ห้ามอ่านชีตรหัสผ่านครู");
  assert.equal(f.attendance.length, 4);
  assert.deepEqual([f.stats.weekend, f.stats.duplicates, f.stats.days], [2, 1, 2]);
  const first = f.attendance.find((a) => a.code === "7317" && a.date === "2026-06-22")!;
  assert.equal(first.status, 1);
  const leave = f.attendance.find((a) => a.code === "7317" && a.date === "2026-06-23")!;
  assert.deepEqual([leave.status, leave.leave, leave.milk], [3, true, false]);
  assert.deepEqual(f.measures.map((m) => [m.code, m.month, m.weight, m.height, m.swapped]), [["7220", "2026-06", 18, 105, true], ["7317", "2026-06", 22, 120, false]]);
  assert.equal(f.issues.length, 2);
});

test("DMC แบบย่อ: หาเลขประชาชนจากค่า และไม่ส่งฟิลด์ที่ไฟล์ไม่มี", async () => {
  const { parseDmcSheet, toImportPayload, diffDmc } = await import("../src/lib/dmc.ts");
  const head = ["รหัสโรงเรียน", "ชื่อโรงเรียน", "เลขประจำตัวนักเรียน", "ชั้น", "ห้อง", "เลขประจำตัวนักเรียน", "เพศ", "คำนำหน้าชื่อ", "ชื่อ", "นามสกุล", "วันเกิด", "อายุ(ปี)", "น้ำหนัก", "ส่วนสูง", "กลุ่มเลือด", "ศาสนา", "เชื้อชาติ", "สัญชาติ", "บ้านเลขที่", "หมู่", "ถนน/ซอย", "ตำบล", "อำเภอ", "จังหวัด", "คำนำหน้าชื่อผู้ปกครอง", "ชื่อผู้ปกครอง", "นามสกุลผู้ปกครอง", "อาชีพของผู้ปกครอง", "ความเกี่ยวข้องของผู้ปกครองกับนักเรียน"];
  const row = ["99999999", "โรงเรียนทดสอบ", "1101700203451", "ป.2", 1, "7491", "ช", "เด็กชาย", "ทดสอบ", "ใจดี", "01/05/2561", 8, 22, 118, "-", "พุทธ", "ไทย", "ไทย", "12/3", "4", "-", "บ้านกลาง", "สอง", "แพร่", "นาง", "แม่", "ใจดี", "รับจ้าง", "มารดา"];
  const p = parseDmcSheet([head, row]);
  assert.equal(p.format, "short");
  assert.deepEqual(p.missingHeaders, []);
  assert.equal(p.rows.length, 1);
  const r = p.rows[0];
  assert.deepEqual([r.citizen_id, r.student_code, r.grade, r.room, r.guardian_name, r.blood_group], ["1101700203451", "7491", "ป.2", 1, "นาง แม่ ใจดี", null]);
  assert.equal(r.address_current, "12/3 หมู่ 4 ต.บ้านกลาง อ.สอง จ.แพร่");
  const payload = toImportPayload(r, p.present);
  for (const k of ["father_phone", "mother_phone", "guardian_phone", "first_name_en", "address_registered"]) assert.ok(!(k in payload), `ห้ามส่ง ${k}`);
  assert.ok("address_current" in payload && "weight" in payload);
  // หน้าตรวจผลไม่แสดงว่าเบอร์โทร "ถูกลบ" เพราะไฟล์ไม่มีคอลัมน์นั้น
  const d = diffDmc(p.rows, [{ id: "x", citizen_id: "1101700203451", student_code: "7491", prefix: "เด็กชาย", first_name: "ทดสอบ", last_name: "ใจดี", birth_date: r.birth_date,
    gender: "ช", guardian_name: "นาง แม่ ใจดี", guardian_phone: "0811111111", father_phone: "0822222222", address_current: r.address_current, classroom: "ป.2/1", status: "studying" }], p.present);
  assert.equal(d[0].kind, "same");
  // ไฟล์ที่ไม่มีคอลัมน์เลข 13 หลักเลย ยังแจ้งว่าไม่ใช่ไฟล์ DMC
  assert.deepEqual(parseDmcSheet([head.map((h) => (h === "เลขประจำตัวนักเรียน" ? "รหัส" : h)), row]).missingHeaders, ["เลขประจำตัวประชาชน"]);
});

test("เมนูสลับระบบ / ลงเวลา (แบบ ก ประตูเดียว)", async () => {
  const { linkOr, DEFAULT_PORTAL_URL, DEFAULT_ATTENDANCE_URL, PORTAL_URL, ATTENDANCE_URL } = await import("../src/lib/portal-links.ts");
  const { navFor, isActive, BOTTOM_NAV, EXTERNAL_ITEMS } = await import("../src/components/nav-items.ts");
  assert.equal(DEFAULT_PORTAL_URL, "https://gotime.anubantep.ac.th/start?choose=1");
  assert.equal(DEFAULT_ATTENDANCE_URL, "https://gotime.anubantep.ac.th");
  // ไม่ตั้งค่าใน env (ชุดทดสอบ) → ค่าเริ่มต้น
  if (!process.env.NEXT_PUBLIC_PORTAL_URL) assert.equal(PORTAL_URL, DEFAULT_PORTAL_URL);
  if (!process.env.NEXT_PUBLIC_ATTENDANCE_URL) assert.equal(ATTENDANCE_URL, DEFAULT_ATTENDANCE_URL);
  assert.equal(linkOr(undefined, "https://a.test"), "https://a.test");
  assert.equal(linkOr("  ", "https://a.test"), "https://a.test");
  assert.equal(linkOr("javascript:alert(1)", "https://a.test"), "https://a.test");
  assert.equal(linkOr("ไม่ใช่ลิงก์", "https://a.test"), "https://a.test");
  assert.equal(linkOr(" https://b.test/start?choose=1 ", "https://a.test"), "https://b.test/start?choose=1");
  // ทุกบทบาทเห็นทั้งสองเมนู (รวมครูที่ไม่มีบทบาทพิเศษ)
  for (const roles of [[], ["admin"], ["executive"], ["academic"]]) {
    const items = navFor(roles).filter((i) => i.external);
    assert.deepEqual(items.map((i) => i.label), ["สลับระบบ", "ลงเวลา / การลา"]);
  }
  assert.deepEqual(EXTERNAL_ITEMS.map((i) => i.href), [PORTAL_URL, ATTENDANCE_URL]);
  // ไม่เป็นเมนูที่เลือกอยู่ในหน้าใดเลย และไม่อยู่ในแถบเมนูล่าง
  for (const p of ["/", "/attendance", "/start", "/manual"]) {
    for (const it of EXTERNAL_ITEMS) assert.equal(isActive(p, it.href), false);
  }
  assert.equal(isActive("/", "/"), true);
  assert.equal(isActive("/students/1", "/students"), true);
  assert.deepEqual(BOTTOM_NAV, ["/", "/attendance", "/students", "/reports"]);
});

// ---------------- /sis: เปิดใต้ที่อยู่เดียวกับระบบลงเวลา (gotime.anubantep.ac.th/sis) ----------------

test("basePath /sis และ withBase", async () => {
  const { BASE_PATH, withBase } = await import("../src/lib/base-path.ts");
  const config = (await import("../next.config.ts")).default;
  assert.equal(BASE_PATH, "/sis");
  assert.equal(config.basePath, BASE_PATH);
  assert.equal(withBase("/"), "/sis");
  assert.equal(withBase("/auth/callback"), "/sis/auth/callback");
  assert.equal(withBase("/attendance?c=1&k=line"), "/sis/attendance?c=1&k=line");
  assert.throws(() => withBase("attendance"));
  assert.throws(() => withBase("//evil.test/x"));
});

test("ที่อยู่เดิม (ไม่มี /sis) redirect ไป /sis — ยกเว้น /sis เอง และ /_next", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const { getPathMatch } = require("next/dist/shared/lib/router/utils/path-match.js");
  const config = (await import("../next.config.ts")).default;
  const rules = await config.redirects!();
  assert.ok(rules.every((r) => r.basePath === false && r.permanent === false), "ต้องเป็น redirect ชั่วคราวนอก basePath");
  // จำลองการทำงานของ Next: กฎแรกที่ตรงชนะ แล้วแทน :path ใน destination
  const resolve = (path: string): string | null => {
    for (const r of rules) {
      const m = getPathMatch(r.source, { strict: true, removeUnnamedParams: true })(path);
      if (m) return r.destination.replace(":path", m.path ?? "");
    }
    return null;
  };
  assert.equal(resolve("/"), "/sis");
  assert.equal(resolve("/attendance"), "/sis/attendance");
  assert.equal(resolve("/login"), "/sis/login");
  assert.equal(resolve("/auth/callback"), "/sis/auth/callback"); // ลิงก์ Google ที่ค้างอยู่ระหว่าง deploy
  assert.equal(resolve("/students/abc"), "/sis/students/abc");
  assert.equal(resolve("/manifest.webmanifest"), "/sis/manifest.webmanifest");
  assert.equal(resolve("/icons/icon-192.png"), "/sis/icons/icon-192.png");
  assert.equal(resolve("/sisters"), "/sis/sisters");
  for (const keep of ["/sis", "/sis/", "/sis/attendance", "/sis/_next/static/x.js", "/_next/static/x.js"]) {
    assert.equal(resolve(keep), null, keep);
  }
});

test("คุกกี้เข้าสู่ระบบอยู่ที่ /sis และย้ายคุกกี้รุ่นเก่า (path /) ครั้งเดียว", async () => {
  const c = await import("../src/lib/supabase/cookies.ts");
  assert.deepEqual(c.AUTH_COOKIE_OPTIONS, { path: "/sis" });
  const key = c.authStorageKey("https://abcdefghij.supabase.co");
  assert.equal(key, "sb-abcdefghij-auth-token");
  assert.equal(c.isAuthCookie("sb-abcdefghij-auth-token.0", key), true);
  assert.equal(c.isAuthCookie("sb-abcdefghij-auth-token-code-verifier", key), true);
  // คุกกี้ของระบบลงเวลา (คนละโปรเจกต์ Supabase) บน origin เดียวกัน — ห้ามแตะ
  assert.equal(c.isAuthCookie("sb-zyxwvutsrq-auth-token", key), false);
  const plan = c.planCookieMigration([
    { name: "sb-abcdefghij-auth-token.0", value: "A" },
    { name: "sb-abcdefghij-auth-token.1", value: "B" },
    { name: "sb-zyxwvutsrq-auth-token", value: "G" },
    { name: "tsr-font", value: "1" },
  ], key);
  assert.equal(plan.done, false);
  assert.deepEqual(plan.copy, [{ name: "sb-abcdefghij-auth-token.0", value: "A" }, { name: "sb-abcdefghij-auth-token.1", value: "B" }]);
  assert.deepEqual(plan.clear, ["sb-abcdefghij-auth-token.0", "sb-abcdefghij-auth-token.1"]);
  // ย้ายแล้ว: ไม่ทำซ้ำ (ไม่เขียนทับคุกกี้ /sis ด้วยค่าที่อาจเก่ากว่า)
  assert.deepEqual(c.planCookieMigration([{ name: c.MIGRATED_COOKIE, value: "1" }, { name: key, value: "X" }], key), { done: true, copy: [], clear: [] });
  assert.equal(c.clearRootCookieHeader(key), `${key}=; Path=/; Max-Age=0; SameSite=Lax`);
});

test("manifest และ service worker อยู่ใต้ /sis และไม่แตะคำขอ/แคชของระบบอื่นบน origin เดียวกัน", async () => {
  const { readFileSync } = await import("node:fs");
  const vm = await import("node:vm");
  const manifest = JSON.parse(readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  assert.equal(manifest.start_url, "/sis");
  assert.equal(manifest.scope, "/sis");
  for (const i of [...manifest.icons, ...manifest.shortcuts.flatMap((s: { icons: unknown[] }) => s.icons)]) assert.match(i.src, /^\/sis\/icons\//);
  for (const s of manifest.shortcuts) assert.match(s.url, /^\/sis\//);

  const load = (file: string, extraKeys: string[] = []) => {
    const handlers: Record<string, (e: unknown) => void> = {};
    const deleted: string[] = [];
    const sandbox = {
      self: { addEventListener: (t: string, fn: (e: unknown) => void) => { handlers[t] = fn; }, location: { origin: "https://gotime.test" },
        skipWaiting: () => Promise.resolve(), clients: { claim: () => Promise.resolve() }, registration: { unregister: () => Promise.resolve(true) } },
      caches: { keys: async () => ["shell-v2", "tsr-v1-pages", "tsr-v1-static", "tsr-v2-pages", "other", ...extraKeys], delete: async (k: string) => { deleted.push(k); return true; },
        open: async () => ({ addAll: async () => {}, put: async () => {} }), match: async () => undefined },
      fetch: async () => new Response("ok"), Response, URL, Promise,
    };
    vm.runInNewContext(readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8"), sandbox);
    return { handlers, deleted };
  };
  const sw = load("sw.js");
  const handled = (url: string, mode = "navigate") => {
    let called = false;
    sw.handlers.fetch({ request: { method: "GET", url, mode, headers: { get: () => null } }, respondWith: () => { called = true; } });
    return called;
  };
  // หน้า/ไฟล์ของระบบลงเวลา (origin เดียวกัน) — ไม่แตะ
  for (const u of ["/", "/start", "/offline", "/_next/static/a.js", "/icons/icon-192.png", "/sisx"]) assert.equal(handled("https://gotime.test" + u, u.includes(".") ? "no-cors" : "navigate"), false, u);
  // ของ TSR-SIS
  assert.equal(handled("https://gotime.test/sis"), true);
  assert.equal(handled("https://gotime.test/sis/attendance?c=1"), true);
  assert.equal(handled("https://gotime.test/sis/_next/static/a.js", "no-cors"), true);
  assert.equal(handled("https://gotime.test/sis/login"), false);
  assert.equal(handled("https://gotime.test/sis/auth/callback?code=x"), false);
  let wait: Promise<unknown> = Promise.resolve();
  sw.handlers.activate({ waitUntil: (p: Promise<unknown>) => { wait = p; } });
  await wait;
  // ไม่ลบ shell-v2 ของระบบลงเวลา · tsr-v1 หน้าเว็บลบพร้อมถอนตัวเก่า · tsr-v2 คือรุ่นปัจจุบัน
  assert.deepEqual(sw.deleted, []);
  const later = load("sw.js", ["tsr-v3-pages"]);
  later.handlers.activate({ waitUntil: (p: Promise<unknown>) => { wait = p; } });
  await wait;
  assert.deepEqual(later.deleted, ["tsr-v3-pages"]); // รุ่นอื่นของ TSR-SIS ลบได้
});
