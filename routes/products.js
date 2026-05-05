const express = require('express')
const router = express.Router()
const { requireAuth } = require('../middleware/auth')
const { supabase, supabaseAdmin } = require('../config/supabase')

router.get('/', requireAuth, async (req, res) => {
  try {
    const [{ data: products }, { data: categories }] = await Promise.all([
      supabase.from('products').select('*, category:product_categories(name)').order('name'),
      supabase.from('product_categories').select('*').eq('is_active', true).order('name')
    ])
    res.render('products/index', {
      title: 'สินค้า', activePage: 'products',
      products: products || [], categories: categories || [],
      success: req.flash('success'), error: req.flash('error')
    })
  } catch (err) {
    res.render('products/index', {
      title: 'สินค้า', activePage: 'products',
      products: [], categories: [], success: [], error: ['ไม่สามารถโหลดข้อมูลได้']
    })
  }
})

router.post('/', requireAuth, async (req, res) => {
  const { code, name, description, category_id, unit, cost_price, retail_price, stock_qty, vat_type } = req.body
  try {
    const { error } = await supabaseAdmin.from('products').insert([{
      code: code || null, name,
      description: description || null,
      category_id: category_id || null,
      unit: unit || 'ชิ้น',
      cost_price: parseFloat(cost_price) || 0,
      retail_price: parseFloat(retail_price) || 0,
      stock_qty: parseFloat(stock_qty) || 0,
      vat_type: vat_type || 'vat7'
    }])
    if (error) throw error
    req.flash('success', `เพิ่มสินค้า "${name}" เรียบร้อยแล้ว`)
  } catch (err) {
    req.flash('error', `บันทึกไม่สำเร็จ: ${err.message}`)
  }
  res.redirect('/products')
})

router.put('/:id', requireAuth, async (req, res) => {
  const { code, name, description, category_id, unit, cost_price, retail_price, stock_qty, vat_type } = req.body
  try {
    const { error } = await supabaseAdmin.from('products').update({
      code: code || null, name,
      description: description || null,
      category_id: category_id || null,
      unit: unit || 'ชิ้น',
      cost_price: parseFloat(cost_price) || 0,
      retail_price: parseFloat(retail_price) || 0,
      stock_qty: parseFloat(stock_qty) || 0,
      vat_type: vat_type || 'vat7',
      updated_at: new Date()
    }).eq('id', req.params.id)
    if (error) throw error
    req.flash('success', 'อัปเดตสินค้าเรียบร้อยแล้ว')
  } catch (err) {
    req.flash('error', 'อัปเดตไม่สำเร็จ')
  }
  res.redirect('/products')
})

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabaseAdmin.from('products').delete().eq('id', req.params.id)
    if (error) throw error
    req.flash('success', 'ลบสินค้าเรียบร้อยแล้ว')
  } catch (err) {
    req.flash('error', 'ไม่สามารถลบได้ เนื่องจากมีรายการที่ใช้สินค้านี้อยู่')
  }
  res.redirect('/products')
})

module.exports = router
