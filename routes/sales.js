const express = require('express')
const router = express.Router()
const { requireAuth } = require('../middleware/auth')
const { supabase, supabaseAdmin } = require('../config/supabase')

// สร้างเลขที่เอกสารอัตโนมัติ
async function generateDocNo(docType) {
  const now = new Date()
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`

  const { data: seq } = await supabase
    .from('doc_sequences').select('*').eq('doc_type', docType).single()

  let nextNum = 1
  if (seq) {
    nextNum = (seq.year_month === ym ? seq.last_number : 0) + 1
    await supabaseAdmin.from('doc_sequences')
      .update({ last_number: nextNum, year_month: ym, updated_at: new Date() })
      .eq('doc_type', docType)
  }
  const prefix = seq ? seq.prefix : docType.toUpperCase().slice(0, 2)
  return `${prefix}${ym}${String(nextNum).padStart(4, '0')}`
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const { data: orders } = await supabase
      .from('sale_orders')
      .select('*, customer:customers(name)')
      .order('doc_date', { ascending: false })
    res.render('sales/index', {
      title: 'งานขาย', activePage: 'sales',
      orders: orders || [],
      success: req.flash('success'), error: req.flash('error')
    })
  } catch (err) {
    res.render('sales/index', {
      title: 'งานขาย', activePage: 'sales',
      orders: [], success: [], error: ['ไม่สามารถโหลดข้อมูลได้']
    })
  }
})

router.get('/new', requireAuth, async (req, res) => {
  try {
    const [{ data: customers }, { data: products }] = await Promise.all([
      supabase.from('customers').select('id,name,tax_id,address,branch_name').eq('is_active', true).order('name'),
      supabase.from('products').select('id,code,name,unit,retail_price,vat_type').eq('is_active', true).order('name')
    ])
    res.render('sales/new', {
      title: 'สร้างงานขายใหม่', activePage: 'sales',
      customers: customers || [],
      products: products || []
    })
  } catch (err) {
    req.flash('error', 'เกิดข้อผิดพลาดในการโหลดข้อมูล')
    res.redirect('/sales')
  }
})

router.post('/', requireAuth, async (req, res) => {
  try {
    const { doc_type, doc_date, due_date, customer_id, customer_name, customer_address, customer_tax_id,
            subtotal, discount_amount, vat_amount, total, net_payable, payment_method, notes,
            product_id, product_name, product_code, unit, qty, unit_price, line_total } = req.body

    const doc_no = await generateDocNo(doc_type)

    const { data: order, error: orderError } = await supabaseAdmin
      .from('sale_orders').insert([{
        doc_no, doc_type, doc_date, due_date: due_date || null,
        customer_id: customer_id || null,
        customer_name, customer_address, customer_tax_id: customer_tax_id || null,
        subtotal: parseFloat(subtotal) || 0,
        discount_amount: parseFloat(discount_amount) || 0,
        vat_amount: parseFloat(vat_amount) || 0,
        total: parseFloat(total) || 0,
        net_payable: parseFloat(net_payable) || 0,
        payment_method: payment_method || null,
        payment_status: 'pending',
        notes: notes || null,
        created_by: req.session.user.id
      }]).select().single()

    if (orderError) throw orderError

    // insert line items
    if (product_name) {
      const names = Array.isArray(product_name) ? product_name : [product_name]
      const items = names.map((n, i) => ({
        order_id: order.id,
        product_id: Array.isArray(product_id) ? product_id[i] || null : product_id || null,
        product_code: Array.isArray(product_code) ? product_code[i] || null : product_code || null,
        product_name: n,
        unit: Array.isArray(unit) ? unit[i] || 'ชิ้น' : unit || 'ชิ้น',
        qty: parseFloat(Array.isArray(qty) ? qty[i] : qty) || 1,
        unit_price: parseFloat(Array.isArray(unit_price) ? unit_price[i] : unit_price) || 0,
        line_total: parseFloat(Array.isArray(line_total) ? line_total[i] : line_total) || 0,
        sort_order: i
      })).filter(item => item.product_name.trim())

      if (items.length > 0) {
        const { error: itemsError } = await supabaseAdmin.from('sale_order_items').insert(items)
        if (itemsError) throw itemsError
      }
    }

    req.flash('success', `สร้างเอกสาร ${doc_no} เรียบร้อยแล้ว`)
    res.redirect('/sales')
  } catch (err) {
    console.error('Sale create error:', err)
    req.flash('error', `สร้างไม่สำเร็จ: ${err.message}`)
    res.redirect('/sales/new')
  }
})

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const [{ data: order }, { data: items }] = await Promise.all([
      supabase.from('sale_orders').select('*, customer:customers(*)').eq('id', req.params.id).single(),
      supabase.from('sale_order_items').select('*').eq('order_id', req.params.id).order('sort_order')
    ])
    if (!order) return res.redirect('/sales')
    res.render('sales/view', {
      title: `เอกสาร ${order.doc_no}`, activePage: 'sales',
      order, items: items || []
    })
  } catch (err) {
    res.redirect('/sales')
  }
})

router.put('/:id/status', requireAuth, async (req, res) => {
  const { payment_status } = req.body
  try {
    const { error } = await supabaseAdmin.from('sale_orders')
      .update({ payment_status, updated_at: new Date() })
      .eq('id', req.params.id)
    if (error) throw error
    req.flash('success', 'อัปเดตสถานะเรียบร้อยแล้ว')
  } catch (err) {
    req.flash('error', 'อัปเดตสถานะไม่สำเร็จ')
  }
  res.redirect('/sales')
})

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabaseAdmin.from('sale_orders').delete().eq('id', req.params.id)
    if (error) throw error
    req.flash('success', 'ลบเอกสารเรียบร้อยแล้ว')
  } catch (err) {
    req.flash('error', 'ไม่สามารถลบได้')
  }
  res.redirect('/sales')
})

module.exports = router
