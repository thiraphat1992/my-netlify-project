const express = require('express')
const router = express.Router()
const { requireAuth } = require('../middleware/auth')
const { supabaseAdmin } = require('../config/supabase')

router.get('/', requireAuth, async (req, res) => {
  try {
    const { data: customers } = await supabaseAdmin
      .from('customers').select('*').order('name')
    res.render('customers/index', {
      title: 'ลูกค้า', activePage: 'customers',
      customers: customers || [],
      success: req.flash('success'), error: req.flash('error')
    })
  } catch (err) {
    res.render('customers/index', {
      title: 'ลูกค้า', activePage: 'customers',
      customers: [], success: [], error: ['ไม่สามารถโหลดข้อมูลได้']
    })
  }
})

router.post('/', requireAuth, async (req, res) => {
  const { code, name, tax_id, branch_name, address, province, postal_code, phone, email, contact_person, credit_days } = req.body
  try {
    const { error } = await supabaseAdminAdmin.from('customers').insert([{
      code: code || null, name,
      tax_id: tax_id || null,
      branch_name: branch_name || 'สำนักงานใหญ่',
      address: address || null,
      province: province || null,
      postal_code: postal_code || null,
      phone: phone || null,
      email: email || null,
      contact_person: contact_person || null,
      credit_days: parseInt(credit_days) || 0
    }])
    if (error) throw error
    req.flash('success', `เพิ่มลูกค้า "${name}" เรียบร้อยแล้ว`)
  } catch (err) {
    req.flash('error', `บันทึกไม่สำเร็จ: ${err.message}`)
  }
  res.redirect('/customers')
})

router.put('/:id', requireAuth, async (req, res) => {
  const { code, name, tax_id, branch_name, address, province, postal_code, phone, email, contact_person, credit_days } = req.body
  try {
    const { error } = await supabaseAdminAdmin.from('customers').update({
      code: code || null, name,
      tax_id: tax_id || null,
      branch_name: branch_name || 'สำนักงานใหญ่',
      address: address || null,
      province: province || null,
      postal_code: postal_code || null,
      phone: phone || null,
      email: email || null,
      contact_person: contact_person || null,
      credit_days: parseInt(credit_days) || 0,
      updated_at: new Date()
    }).eq('id', req.params.id)
    if (error) throw error
    req.flash('success', 'อัปเดตข้อมูลลูกค้าเรียบร้อยแล้ว')
  } catch (err) {
    req.flash('error', 'อัปเดตไม่สำเร็จ')
  }
  res.redirect('/customers')
})

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabaseAdminAdmin.from('customers').delete().eq('id', req.params.id)
    if (error) throw error
    req.flash('success', 'ลบลูกค้าเรียบร้อยแล้ว')
  } catch (err) {
    req.flash('error', 'ไม่สามารถลบได้ เนื่องจากมีงานขายที่ใช้ลูกค้านี้อยู่')
  }
  res.redirect('/customers')
})

module.exports = router
