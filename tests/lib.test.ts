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
