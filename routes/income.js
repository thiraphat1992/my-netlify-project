// routes/income.js
const express = require('express')
const router = express.Router()
const { requireAuth } = require('../middleware/auth')
const { supabase, supabaseAdmin } = require('../config/supabase')

// ==========================================
// ส่วนจัดการหมวดหมู่บัญชี (Categories)
// ==========================================

// GET: หน้าจัดการหมวดหมู่
router.get('/categories', requireAuth, async (req, res) => {
  try {
    const { data: categories } = await supabase
      .from('transaction_categories')
      .select('*')
      .order('type')
      .order('name')
      
    res.render('income/categories', { 
      title: 'จัดการหมวดหมู่บัญชี', 
      activePage: 'income', 
      categories: categories || [],
      error: req.flash('error'),
      success: req.flash('success')
    })
  } catch (err) {
    req.flash('error', 'ไม่สามารถโหลดข้อมูลหมวดหมู่ได้')
    res.redirect('/income')
  }
})

// POST: เพิ่มหมวดหมู่ใหม่
router.post('/categories', requireAuth, async (req, res) => {
  const { name, type, code } = req.body
  try {
    const { error } = await supabaseAdmin
      .from('transaction_categories')
      .insert([{ name, type, code }])

    if (error) throw error

    req.flash('success', 'เพิ่มหมวดหมู่เรียบร้อยแล้ว')
  } catch (err) {
    console.error('🚨 Insert Category Error:', err)
    req.flash('error', `บันทึกไม่สำเร็จ: ${err.message}`)
  }
  res.redirect('/income/categories')
})

// GET: หน้าฟอร์มแก้ไขหมวดหมู่
router.get('/categories/:id/edit', requireAuth, async (req, res) => {
  try {
    const { data: category, error } = await supabase
      .from('transaction_categories')
      .select('*')
      .eq('id', req.params.id)
      .single()
      
    if (error) throw error

    res.render('income/category_edit', { 
      title: 'แก้ไขหมวดหมู่บัญชี', 
      activePage: 'income', 
      category 
    })
  } catch (err) {
    req.flash('error', 'ไม่พบข้อมูลหมวดหมู่ที่ต้องการแก้ไข')
    res.redirect('/income/categories')
  }
})

// PUT: อัปเดตข้อมูลหมวดหมู่
router.put('/categories/:id', requireAuth, async (req, res) => {
  const { name, type, code, is_active } = req.body
  try {
    const { error } = await supabaseAdmin
      .from('transaction_categories')
      .update({
        name, 
        type, 
        code, 
        is_active: is_active === 'on' 
      })
      .eq('id', req.params.id)

    if (error) throw error

    req.flash('success', 'อัปเดตหมวดหมู่เรียบร้อยแล้ว')
  } catch (err) {
    console.error('🚨 Update Category Error:', err)
    req.flash('error', 'อัปเดตหมวดหมู่ไม่สำเร็จ')
  }
  res.redirect('/income/categories')
})

// DELETE: ลบหมวดหมู่
router.delete('/categories/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('transaction_categories')
      .delete()
      .eq('id', req.params.id)

    if (error) throw error

    req.flash('success', 'ลบหมวดหมู่เรียบร้อยแล้ว')
  } catch (err) {
    console.error('🚨 Delete Category Error:', err)
    req.flash('error', 'ไม่สามารถลบได้ เนื่องจากมีรายการบัญชีที่ใช้หมวดหมู่นี้อยู่')
  }
  res.redirect('/income/categories')
})


// ==========================================
// ส่วนจัดการรายการบัญชีรายรับ-รายจ่าย (Transactions)
// ==========================================

// GET: หน้าตารางแสดงรายการบัญชี (หน้าหลัก)
router.get('/', requireAuth, async (req, res) => {
  try {
    // 1. ดึงรายการบัญชี
    const { data: transactions, error } = await supabase
      .from('transactions')
      .select('*, category:transaction_categories(name, type)')
      .order('transaction_date', { ascending: false })

    if (error) throw error

    // 2. ดึงหมวดหมู่ทั้งหมด มาเตรียมไว้ให้ Popup (เพิ่มใหม่!)
    const { data: categories } = await supabase
      .from('transaction_categories')
      .select('*')
      .eq('is_active', true)
      .order('name')

    res.render('income/index', { 
      title: 'รายรับ-รายจ่าย', 
      activePage: 'income', 
      transactions: transactions || [],
      categories: categories || [], // ส่งหมวดหมู่ไปให้ EJS
      success: req.flash('success'),
      error: req.flash('error')
    })
  } catch (err) {
    res.render('income/index', { 
      title: 'รายรับ-รายจ่าย', 
      activePage: 'income', 
      transactions: [],
      categories: [],
      success: [],
      error: ['ไม่สามารถโหลดข้อมูลรายการได้']
    })
  }
})

// GET: หน้าฟอร์มเพิ่มรายการใหม่
router.get('/new', requireAuth, async (req, res) => {
  try {
    const { data: categories } = await supabase
      .from('transaction_categories')
      .select('id, name, type')
      .eq('is_active', true)
      .order('name')

    res.render('income/form', { 
      title: 'เพิ่มรายการใหม่', 
      activePage: 'income', 
      categories: categories || [] 
    })
  } catch (err) {
    req.flash('error', 'เกิดข้อผิดพลาดในการโหลดแบบฟอร์ม')
    res.redirect('/income')
  }
})

// POST: บันทึกรายการใหม่
router.post('/', requireAuth, async (req, res) => {
  const { type, category_id, amount, description, transaction_date } = req.body
  try {
    const { error } = await supabaseAdmin.from('transactions').insert([{
      type, 
      category_id, 
      amount: parseFloat(amount), 
      net_amount: parseFloat(amount), 
      description, 
      transaction_date, 
      created_by: req.session.user.id
    }])

    if (error) throw error

    req.flash('success', 'บันทึกรายการบัญชีเรียบร้อยแล้ว')
    res.redirect('/income')
  } catch (err) {
    req.flash('error', 'ไม่สามารถบันทึกข้อมูลได้')
    res.redirect('/income/new')
  }
})

// GET: หน้าฟอร์มแก้ไขรายการบัญชี
router.get('/:id/edit', requireAuth, async (req, res) => {
  try {
    const { data: transaction, error: tError } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', req.params.id)
      .single()

    if (tError) throw tError

    const { data: categories } = await supabase
      .from('transaction_categories')
      .select('id, name, type')
      .eq('is_active', true)
      .order('name')
    
    res.render('income/edit', { 
      title: 'แก้ไขรายการ', 
      activePage: 'income', 
      transaction, 
      categories: categories || [] 
    })
  } catch (err) {
    req.flash('error', 'ไม่พบข้อมูลรายการที่ต้องการแก้ไข')
    res.redirect('/income')
  }
})

// PUT: อัปเดตข้อมูลรายการบัญชี
router.put('/:id', requireAuth, async (req, res) => {
  const { type, category_id, amount, description, transaction_date } = req.body
  try {
    const { error } = await supabaseAdmin
      .from('transactions')
      .update({
        type, 
        category_id, 
        amount: parseFloat(amount), 
        net_amount: parseFloat(amount), 
        description, 
        transaction_date 
      })
      .eq('id', req.params.id)

    if (error) throw error

    req.flash('success', 'แก้ไขรายการบัญชีเรียบร้อยแล้ว')
    res.redirect('/income')
  } catch (err) {
    req.flash('error', 'อัปเดตข้อมูลรายการบัญชีไม่สำเร็จ')
    res.redirect(`/income/${req.params.id}/edit`)
  }
})
// === เพิ่มระบบลบรายการบัญชีตรงนี้ ===
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabaseAdmin.from('transactions').delete().eq('id', req.params.id)
    if (error) throw error
    req.flash('success', 'ลบรายการบัญชีเรียบร้อยแล้ว')
  } catch (err) {
    req.flash('error', 'ไม่สามารถลบรายการได้')
  }
  res.redirect('/income')
})

module.exports = router