// สร้างแถวของไฟล์ ปพ.5 สมมติ (โครงสร้างเดียวกับโปรแกรมจริง) — ใช้ทั้ง unit test และ E2E
export function fakePp5Sheets({ grade = "ประถมศึกษาปีที่ 6/1", year = 2569, term = 2, students, subjects }) {
  const sheets = {};
  sheets["รายวิชา"] = [
    ["กรอกข้อมูลชั้นเรียน"], ["ชั้น", grade], ["ภาคเรียนที่", term], ["ปีการศึกษา", year],
    ["ที่", "รหัสวิชา", "รายวิชา", "เวลาเรียน (ชั่วโมง/ปี)", "กลุ่มสาระการเรียนรู้", "ครูประจำวิชา"],
    ...subjects.map((s, i) => [i + 1, s.code, s.name, s.hours, s.area, null]),
    ...Array.from({ length: 20 - subjects.length }, (_, i) => [subjects.length + i + 1]),
  ];
  sheets["ชื่อนักเรียน"] = [[`ชั้น${grade} ปีการศึกษา ${year}`], ["เลขที่", "เลขประจำตัวนักเรียน", "ชื่อ-สกุล", "เลขประจำตัวประชาชน", "วัน/เดือน/ปีเกิด"],
    ...students.map((s, i) => [i + 1, s.code ?? String(9000 + i), s.name, s.citizen_id, null])];
  subjects.forEach((sub, si) => {
    const rows = Array.from({ length: 6 }, () => Array(100).fill(null));
    rows[1][2] = `รายวิชา ${sub.code} ${sub.name}`;
    rows[3][0] = "เลขที่"; rows[3][28] = "สอบปลายภาค"; rows[3][58] = "สอบปลายภาค";
    rows[4][70] = "รวมรายปี";
    students.forEach((st, i) => {
      const r = Array(100).fill(null);
      r[0] = i + 1; r[1] = st.name;
      r[29] = 0; r[30] = 0; r[31] = 0; r[59] = 0; r[60] = 0; r[61] = 0; r[72] = 0; // ค่าเริ่มต้นจากสูตร
      const g = st.grades?.[si];
      if (g) {
        [r[27], r[28], r[29], r[30], r[31]] = [g.t1[0], g.t1[1], g.t1[0] + g.t1[1], (g.t1[0] + g.t1[1]) * 2, g.t1[2]];
        if (g.t2) {
          [r[57], r[58], r[59], r[60], r[61]] = [g.t2[0], g.t2[1], g.t2[0] + g.t2[1], (g.t2[0] + g.t2[1]) * 2, g.t2[2]];
          [r[70], r[71], r[72]] = [g.year[0], g.year[0], g.year[1]];
        }
      }
      rows.push(r);
    });
    sheets[`วิชาที่ ${si + 1}`] = rows;
  });
  for (const suffix of ["1", "2", "รวม"]) {
    const head = () => [[null, "สรุป"], [null, "เลขที่", "คุณลักษณะ", null, "แนะแนว", null, "ลูกเสือ-เนตรนารี", null, "ชุมนุม", null, "กิจกรรมเพื่อสังคม"], [], []];
    const trait = head(), values = head(), act = head();
    students.forEach((st, i) => {
      const t = Array(40).fill(null), v = Array(40).fill(null), a = Array(12).fill(null);
      t[0] = v[0] = a[0] = st.name; t[1] = v[1] = a[1] = i + 1;
      // สูตรในโปรแกรมใส่ "ไม่ผ่าน" ไว้เมื่อยังไม่กรอก
      t[12] = "/"; t[21] = "/";
      if (st.trait && (suffix === "1" || st.term2)) {
        for (let k = 0; k < 8; k++) t[2 + k] = 3;
        t[12] = null; t[15] = "/";
        for (let k = 0; k < 5; k++) t[16 + k] = 2;
        t[21] = null; t[24] = "/";
        for (let k = 0; k < 12; k++) v[2 + k] = 3;
        v[17] = "/";
        a[3] = "/"; a[5] = "/"; a[7] = "/"; a[9] = "/";
      }
      trait.push(t); values.push(v); act.push(a);
    });
    sheets[`คุณลักษณะ ${suffix}`] = trait; sheets[`ค่านิยม ${suffix}`] = values; sheets[`กิจกรรม ${suffix}`] = act;
  }
  return sheets;
}
