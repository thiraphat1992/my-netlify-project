const express = require('express')
const router = express.Router()
const { requireAuth } = require('../middleware/auth')
const { supabase, supabaseAdmin } = require('../config/supabase')

// หน้าหลัก HR = รายชื่อพนักงาน
router.get('/', requireAuth, async (req, res) => {
  try {
    const [{ data: employees }, { data: departments }] = await Promise.all([
      supabase.from('employees').select('*, dept:departments(name)').order('first_name'),
      supabase.from('departments').select('*').eq('is_active', true).order('name')
    ])
    res.render('hr/index', {
      title: 'พนักงาน', activePage: 'hr',
      tab: 'employees',
      employees: employees || [],
      departments: departments || [],
      success: req.flash('success'), error: req.flash('error')
    })
  } catch (err) {
    res.render('hr/index', {
      title: 'พนักงาน', activePage: 'hr', tab: 'employees',
      employees: [], departments: [], success: [], error: ['ไม่สามารถโหลดข้อมูลได้']
    })
  }
})

// สร้างพนักงานใหม่ (GET)
router.get('/employees/new', requireAuth, async (req, res) => {
  const { data: departments } = await supabase.from('departments').select('*').eq('is_active', true).order('name')
  res.render('hr/employee_form', {
    title: 'เพิ่มพนักงานใหม่', activePage: 'hr',
    employee: null, departments: departments || []
  })
})

// สร้างพนักงานใหม่ (POST)
router.post('/employees', requireAuth, async (req, res) => {
  const { code, title, first_name, last_name, nickname, national_id, birth_date, gender, phone, email,
          department_id, position, employment_type, start_date, base_salary, salary_type,
          bank_name, bank_account, address } = req.body
  try {
    const { error } = await supabaseAdmin.from('employees').insert([{
      code, title: title || null, first_name, last_name,
      nickname: nickname || null,
      national_id: national_id || null,
      birth_date: birth_date || null,
      gender: gender || null,
      phone: phone || null, email: email || null,
      department_id: department_id || null,
      position: position || null,
      employment_type: employment_type || 'full_time',
      start_date,
      base_salary: parseFloat(base_salary) || 0,
      salary_type: salary_type || 'monthly',
      bank_name: bank_name || null,
      bank_account: bank_account || null,
      address: address || null,
      status: 'active'
    }])
    if (error) throw error
    req.flash('success', `เพิ่มพนักงาน ${first_name} ${last_name} เรียบร้อยแล้ว`)
  } catch (err) {
    req.flash('error', `บันทึกไม่สำเร็จ: ${err.message}`)
  }
  res.redirect('/hr')
})

// แก้ไขพนักงาน (GET)
router.get('/employees/:id/edit', requireAuth, async (req, res) => {
  try {
    const [{ data: employee }, { data: departments }] = await Promise.all([
      supabase.from('employees').select('*').eq('id', req.params.id).single(),
      supabase.from('departments').select('*').eq('is_active', true).order('name')
    ])
    if (!employee) return res.redirect('/hr')
    res.render('hr/employee_form', {
      title: 'แก้ไขข้อมูลพนักงาน', activePage: 'hr',
      employee, departments: departments || []
    })
  } catch (err) {
    res.redirect('/hr')
  }
})

// อัปเดตพนักงาน (PUT)
router.put('/employees/:id', requireAuth, async (req, res) => {
  const { code, title, first_name, last_name, nickname, national_id, birth_date, gender, phone, email,
          department_id, position, employment_type, start_date, base_salary, salary_type,
          bank_name, bank_account, address, status } = req.body
  try {
    const { error } = await supabaseAdmin.from('employees').update({
      code, title: title || null, first_name, last_name,
      nickname: nickname || null, national_id: national_id || null,
      birth_date: birth_date || null, gender: gender || null,
      phone: phone || null, email: email || null,
      department_id: department_id || null, position: position || null,
      employment_type: employment_type || 'full_time',
      start_date, base_salary: parseFloat(base_salary) || 0,
      salary_type: salary_type || 'monthly',
      bank_name: bank_name || null, bank_account: bank_account || null,
      address: address || null, status: status || 'active',
      updated_at: new Date()
    }).eq('id', req.params.id)
    if (error) throw error
    req.flash('success', 'อัปเดตข้อมูลพนักงานเรียบร้อยแล้ว')
  } catch (err) {
    req.flash('error', 'อัปเดตไม่สำเร็จ')
  }
  res.redirect('/hr')
})

// ลบพนักงาน
router.delete('/employees/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabaseAdmin.from('employees').delete().eq('id', req.params.id)
    if (error) throw error
    req.flash('success', 'ลบพนักงานเรียบร้อยแล้ว')
  } catch (err) {
    req.flash('error', 'ไม่สามารถลบได้')
  }
  res.redirect('/hr')
})

// หน้าเงินเดือน
router.get('/payroll', requireAuth, async (req, res) => {
  try {
    const [{ data: employees }, { data: departments }] = await Promise.all([
      supabase.from('employees').select('*, dept:departments(name)').eq('status', 'active').order('first_name'),
      supabase.from('departments').select('*').eq('is_active', true).order('name')
    ])
    res.render('hr/index', {
      title: 'เงินเดือน', activePage: 'payroll',
      tab: 'payroll',
      employees: employees || [],
      departments: departments || [],
      success: req.flash('success'), error: req.flash('error')
    })
  } catch (err) {
    res.render('hr/index', {
      title: 'เงินเดือน', activePage: 'payroll', tab: 'payroll',
      employees: [], departments: [], success: [], error: []
    })
  }
})

// หน้าวันลา
router.get('/leave', requireAuth, async (req, res) => {
  try {
    const [{ data: employees }, { data: departments }, { data: leaves }] = await Promise.all([
      supabase.from('employees').select('id,first_name,last_name').eq('status', 'active').order('first_name'),
      supabase.from('departments').select('*').eq('is_active', true).order('name'),
      supabase.from('leave_requests')
        .select('*, emp:employees(first_name,last_name)')
        .order('created_at', { ascending: false })
        .limit(100)
    ])
    res.render('hr/index', {
      title: 'วันลา', activePage: 'leave',
      tab: 'leave',
      employees: employees || [],
      departments: departments || [],
      leaves: leaves || [],
      success: req.flash('success'), error: req.flash('error')
    })
  } catch (err) {
    res.render('hr/index', {
      title: 'วันลา', activePage: 'leave', tab: 'leave',
      employees: [], departments: [], leaves: [], success: [], error: []
    })
  }
})

// บันทึกวันลา
router.post('/leave', requireAuth, async (req, res) => {
  const { employee_id, leave_type, start_date, end_date, days, reason } = req.body
  try {
    const { error } = await supabaseAdmin.from('leave_requests').insert([{
      employee_id, leave_type, start_date, end_date,
      days: parseFloat(days) || 1,
      reason: reason || null,
      status: 'pending'
    }])
    if (error) throw error
    req.flash('success', 'บันทึกคำขอลาเรียบร้อยแล้ว')
  } catch (err) {
    req.flash('error', `บันทึกไม่สำเร็จ: ${err.message}`)
  }
  res.redirect('/hr/leave')
})

// อนุมัติ/ปฏิเสธวันลา
router.put('/leave/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body
  try {
    const { error } = await supabaseAdmin.from('leave_requests')
      .update({ status, approved_by: req.session.user.id })
      .eq('id', req.params.id)
    if (error) throw error
    req.flash('success', status === 'approved' ? 'อนุมัติคำขอลาแล้ว' : 'ปฏิเสธคำขอลาแล้ว')
  } catch (err) {
    req.flash('error', 'ดำเนินการไม่สำเร็จ')
  }
  res.redirect('/hr/leave')
})

// แผนก CRUD
router.post('/departments', requireAuth, async (req, res) => {
  const { name, description } = req.body
  try {
    const { error } = await supabaseAdmin.from('departments').insert([{ name, description: description || null }])
    if (error) throw error
    req.flash('success', `เพิ่มแผนก "${name}" เรียบร้อยแล้ว`)
  } catch (err) {
    req.flash('error', `บันทึกไม่สำเร็จ: ${err.message}`)
  }
  res.redirect('/hr')
})

module.exports = router
