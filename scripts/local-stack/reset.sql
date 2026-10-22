truncate audit_log, record_sessions, attendance_daily, health_daily, attendance_subject, student_status_history, enrollments, students,
  teaching_assignments, homeroom_assignments, subjects, classrooms, terms, holidays, academic_years restart identity cascade;
delete from staff where email not in ('admin.test@users.tsr-sis.local', 'krusomjai@users.tsr-sis.local') or email is null;
update staff set roles = '{}', approved = false, tour_done = false, font_scale = 1;
delete from auth.users where email not in ('admin.test@users.tsr-sis.local', 'krusomjai@users.tsr-sis.local');
update school_settings set current_year = null;
